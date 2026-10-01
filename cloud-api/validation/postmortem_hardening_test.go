package validation

// Spec §43 — Post-mortem hardening (2026-09-18 audit, driven by the
// danluu/post-mortems catalog): poison-pill / crash-loop class.
//
// The class (incident.io "one bad event", Google Service Control crash loop,
// AppNexus delayed-trigger crash): a single malformed or adversarial input
// reaches a code path that panics; the process dies; the deterministic
// trigger re-arrives after restart; the pod crash-loops and takes every
// co-tenant stream with it.
//
// The run producer runs DETACHED on the WebSocket path — before the audit it
// had NO panic containment (the Recovery middleware cannot reach a goroutine
// it did not spawn). The producer, WS pumps, control-plane loop, metering
// batcher and housekeeping now carry panic guards, and this section proves
// the end-to-end behavior through the full production stack (real middleware
// chain, real router, real WS transport, real Bifrost client):
//
//   - hostile upstream chunk shapes over WS produce VALID terminal states
//     (never a dropped stream, never a dead server);
//   - concurrent hostile runs do not exhaust goroutines;
//   - a clean run after the hostile storm completes normally on the same
//     replica (no state corruption leaks forward).

import (
	"os"
	"runtime/pprof"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// hostileUpstreamScripts returns adversarial SSE payloads for the mock
// Bifrost: wrong field types, junk JSON, empty choices, negative usage.
func hostileUpstreamScripts() [][]chunk {
	return [][]chunk{
		{{data: `{"id":123,"choices":"not-an-array"}`}},
		{{data: `{"choices":[{"delta":{"content":42}}]}`}},
		{{data: `not json at all`}},
		{{data: `{"choices":[]}`}},
		{{data: `{"choices":[{"index":0,"delta":{"role":"assistant","content":"partial"}}]}`, delay: 5 * time.Millisecond}, {data: `{"id":"c2","choices":[{"index":0,"delta":{"content":42}}]}`}},
		{{data: `{"choices":[{"index":0,"delta":{"content":"u"}}],"usage":{"prompt_tokens":-5,"completion_tokens":"junk","total_tokens":1e300}}`}},
	}
}

// TestV43_HostileUpstreamOverWS: every hostile shape yields a terminal run
// state and a live server; the same connection keeps working afterwards.
func TestV43_HostileUpstreamOverWS(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("pm43", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Baseline counts only OUR goroutines (producers, pumps, forwarders,
	// control plane). The harness's miniredis keeps one server goroutine per
	// pooled client connection alive until cleanup — global counts would
	// false-positive exactly like the §33 leak tests taught us.
	base := countNexauGoroutines(t)

	conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	scripts := hostileUpstreamScripts()
	for i, script := range scripts {
		s.bifrost.setScript(script...)
		wsRunCreate(t, conn, runBody("openai/gpt-4o", "hostile upstream payload", true))
		events, _ := wsRead(t, conn, streaming.EventRunError, 15*time.Second)
		if len(events) == 0 {
			// A tolerated shape may still finish cleanly: RUN_FINISHED counts.
			fin, _ := wsRead(t, conn, streaming.EventRunFinished, 15*time.Second)
			if len(fin) == 0 {
				t.Fatalf("hostile[%d]: neither RUN_ERROR nor RUN_FINISHED arrived (stream dropped)", i)
			}
		}
		// The connection must still answer pings (transport alive).
		if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
			t.Fatalf("hostile[%d]: connection dead after hostile run: %v", i, err)
		}
	}

	// Clean run on the SAME connection after the hostile storm: the producer
	// and transport must be fully serviceable.
	s.bifrost.setScript(
		chunk{data: `{"id":"cmpl_ok","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"All "}}]}`, delay: 5 * time.Millisecond},
		chunk{data: `{"id":"cmpl_ok","choices":[{"index":0,"delta":{"content":"clear."}}]}`, delay: 5 * time.Millisecond},
		chunk{data: `{"id":"cmpl_ok","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12},"extra_fields":{"provider":"openai"}}`, delay: 5 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "clean run after storm", true))
	clean, _ := wsRead(t, conn, streaming.EventRunFinished, 15*time.Second)
	if len(clean) == 0 {
		t.Fatal("clean run after hostile storm produced no events")
	}
	assertLifecycleW(t, clean, "post-storm clean run")

	// Close the connection, then check: an open conn legitimately keeps
	// its server-side pumps alive; a closed one must release them.
	_ = conn.Close()

	// Goroutines: the hostile runs must not have leaked producers or pumps.
	// (Settle first: server-side pumps exit asynchronously after the client
	// close; the two-round methodology mirrors §33.)
	time.Sleep(500 * time.Millisecond)
	if !waitFor(t, 15*time.Second, func() bool {
		return countNexauGoroutines(t) <= base+2
	}) {
		_ = pprof.Lookup("goroutine").WriteTo(os.Stdout, 1)
		t.Fatalf("our goroutines grew from %d to %d after hostile storm",
			base, countNexauGoroutines(t))
	}
	vm(t, "pm43_hostile_shapes", len(scripts))
}

// TestV43_ConcurrentHostileRunsDontKillReplica: a burst of hostile-shape runs
// across concurrent WS connections; the replica must stay live and a clean
// follow-up run must succeed (crash-loop class: N triggers, zero deaths).
func TestV43_ConcurrentHostileRunsDontKillReplica(t *testing.T) {
	s := newStackDefault(t)
	tok := s.tokenFor("usr_1", "ten_A")

	goroutinesBefore := countNexauGoroutines(t)
	scripts := hostileUpstreamScripts()

	const conns = 8
	var wg sync.WaitGroup
	for i := 0; i < conns; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sess := s.sessionFor("pm43c", "ten_A", "usr_1")
			conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
			if err != nil {
				t.Errorf("conn[%d] dial: %v", i, err)
				return
			}
			defer conn.Close()
			script := scripts[i%len(scripts)]
			s.bifrost.setScript(script...) // last-writer-wins is fine: all are hostile
			wsRunCreate(t, conn, runBody("openai/gpt-4o", "concurrent hostile", true))
			wsRead(t, conn, streaming.EventRunError, 20*time.Second)
		}(i)
	}
	wg.Wait()

	// The replica answers ordinary traffic afterwards.
	sess := s.sessionFor("pm43c2", "ten_A", "usr_1")
	s.bifrost.setScript(
		chunk{data: `{"id":"cmpl_f","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"still alive"}}]}`, delay: 5 * time.Millisecond},
		chunk{data: `{"id":"cmpl_f","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12},"extra_fields":{"provider":"openai"}}`, delay: 5 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "liveness probe after burst", true), nil)
	if err != nil {
		t.Fatalf("post-burst run create: %v", err)
	}
	evts := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if len(evts) == 0 {
		t.Fatal("post-burst clean run produced no events")
	}

	time.Sleep(500 * time.Millisecond)
	if !waitFor(t, 15*time.Second, func() bool {
		return countNexauGoroutines(t) <= goroutinesBefore+2
	}) {
		_ = pprof.Lookup("goroutine").WriteTo(os.Stdout, 1)
		t.Fatalf("our goroutines grew from %d to %d after hostile burst",
			goroutinesBefore, countNexauGoroutines(t))
	}
	vm(t, "pm43_concurrent_hostile_conns", conns)
}

// countNexauGoroutines counts stack frames belonging to this module's own
// packages across the goroutine profile — a monotone proxy for leaked
// producers, WS pumps, live forwarders and control-plane goroutines.
// Harness-owned bystanders (miniredis peer goroutines per pooled connection,
// httptest accept loops) are excluded by construction. Used as a DELTA:
// baseline vs post-burst with a small slack.
func countNexauGoroutines(t *testing.T) int {
	t.Helper()
	p := pprof.Lookup("goroutine")
	if p == nil {
		return 0
	}
	var sb strings.Builder
	if err := p.WriteTo(&sb, 1); err != nil {
		return 0
	}
	n := 0
	for _, line := range strings.Split(sb.String(), "\n") {
		if strings.HasPrefix(line, "#") && strings.Contains(line, "nexau-api/internal") {
			n++
		}
	}
	return n
}
