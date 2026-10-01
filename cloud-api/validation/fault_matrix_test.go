// Spec §38 (Fault Injection Matrix) — combined failures. Distributed systems
// fail in combinations, not in isolation.
package validation

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV38_DesktopDisconnectPlusBifrostTimeout: the client drops while the
// upstream is also stalled — everything still converges.
func TestV38_DesktopDisconnectPlusBifrostTimeout(t *testing.T) {
	o := defaultOpts()
	o.idleTimeout = 1500 * time.Millisecond
	s := newStack(t, o)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"stall"}}]}`, delay: 30 * time.Second},
	)
	sess := s.sessionFor("combo1", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunStarted, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no events")
	}
	runID := events[0].env.RunID

	// Desktop disconnects 300ms later; the upstream is stalled in parallel.
	resp.Body.Close()

	// The idle watchdog OR the disconnect fires — one clean terminal state.
	if !waitFor(t, 10*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("combined disconnect+stall left run stuck: %+v", s.runs.get(runID))
	}
	if s.bifrost.cancelCount() == 0 {
		t.Fatal("upstream survived both faults")
	}
}

// TestV38_DesktopReconnectPlusReplicaRestart: client reconnects while the
// serving replica restarts — resume works against the new replica.
func TestV38_DesktopReconnectPlusReplicaRestart(t *testing.T) {
	s := newStack(t, func() stackOpts {
		o := defaultOpts()
		o.replicas = 2
		return o
	}())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("combo2", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Complete a run on replica 0.
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "seed", true), nil)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	runID := events[0].env.RunID

	// Restart replica 0 (destroy + fresh).
	old := s.replicas[0]
	old.srv.Close()
	s.replicas[0] = s.buildReplica(t)

	// Reconnect to the fresh replica 0 and resume the buffered run.
	conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err != nil {
		t.Fatalf("re-dial after restart: %v", err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(map[string]any{"type": "resume", "run_id": runID, "last_sequence": 0}); err != nil {
		t.Fatalf("resume: %v", err)
	}
	_, controls := wsRead(t, conn, "", 10*time.Second)
	outcome := ""
	for _, c := range controls {
		if c["type"] == "RESUME_OK" {
			outcome = "RESUME_OK"
		}
		if c["type"] == "RESUME_MISSED" {
			outcome = "RESUME_MISSED"
		}
	}
	if outcome == "" {
		t.Fatalf("no resume outcome after replica restart: %v", controls)
	}
	vm(t, "reconnect_after_replica_restart", outcome)
}

// TestV38_RedisFailurePlusHighRate: Redis dies while a request burst is in
// flight (fail-open posture) — bounded, no crash, recovers.
func TestV38_RedisFailurePlusHighRate(t *testing.T) {
	s, proxy := outageStack(t, defaultOpts())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("combo3", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// High rate while the outage begins mid-burst.
	var wg sync.WaitGroup
	results := make(chan int, 60)
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			if n == 30 {
				proxy.breakConn() // outage begins mid-burst
			}
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", false), nil)
			if err != nil {
				results <- -1
				return
			}
			code := resp.StatusCode
			resp.Body.Close()
			results <- code
		}(i)
	}
	wg.Wait()
	close(results)

	accepted, rejected, hardFail := 0, 0, 0
	for c := range results {
		switch {
		case c == 200:
			accepted++
		case c == 429 || c == 503:
			rejected++
		default:
			hardFail++
		}
	}
	if hardFail > 5 {
		t.Fatalf("outage+burst: %d hard failures (500s/transport) — clean degradation required", hardFail)
	}
	if goroutines() > 400 {
		t.Fatalf("outage+burst goroutines=%d — unbounded", goroutines())
	}

	// Recovery.
	proxy.restore()
	s.bifrost.reset()
	s.bifrost.setScript(standardScript()...)
	ok := 0
	for i := 0; i < 5; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "post", false), nil)
		if err == nil && resp.StatusCode == 200 {
			ok++
			resp.Body.Close()
		} else if err == nil {
			resp.Body.Close()
		}
	}
	if ok < 1 {
		t.Fatal("no recovery after Redis outage + burst")
	}
	vm(t, "redis_outage_burst_accepted", accepted)
	vm(t, "redis_outage_burst_rejected", rejected)
}

// TestV38_PostgresLatencyPlusHighConcurrency: slow PG under high concurrency
// — bounded latencies, no deadlock, no goroutine explosion.
func TestV38_PostgresLatencyPlusHighConcurrency(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("combo4", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// 100ms per session lookup under 60 concurrent requests.
	s.sessions.inject(nil, nil, 100*time.Millisecond)

	base := goroutines()
	start := time.Now()
	var wg sync.WaitGroup
	var okCount atomic.Int64
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", false), nil)
			if err != nil {
				return
			}
			if resp.StatusCode == 200 {
				okCount.Add(1)
			}
			resp.Body.Close()
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)

	if okCount.Load() < 50 {
		t.Fatalf("slow-pg burst: only %d/60 succeeded", okCount.Load())
	}
	if elapsed > 30*time.Second {
		t.Fatalf("slow-pg burst took %s — deadlock-like behavior", elapsed)
	}
	if goroutines() > base+120 {
		t.Fatalf("slow-pg burst goroutines=%d (base=%d)", goroutines(), base)
	}
	vm(t, "pg_latency_concurrency_ms", elapsed.Milliseconds())
	vm(t, "pg_latency_concurrency_ok", okCount.Load())
}

// TestV38_Bifrost429PlusClientRetry: provider 429 while clients retry —
// retry amplification is bounded by the API's own retry policy.
func TestV38_Bifrost429PlusClientRetry(t *testing.T) {
	o := defaultOpts()
	o.maxRetries = 1
	o.retryMin = 30 * time.Millisecond
	s := newStack(t, o)
	s.bifrost.setMode(bifrostHTTPStatus, 429, bifrostErrBody(429, "429", "rate limited"), 0)
	sess := s.sessionFor("combo5", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// 20 clients each issuing a request (the "retry" leg — client-side).
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", false), nil)
			if err == nil {
				resp.Body.Close()
			}
		}()
	}
	wg.Wait()

	// Bounded upstream amplification: 20 requests × (1 + MaxRetries) = 40
	// maximum; the retry policy must not hammer harder.
	if got := s.bifrost.count(); got > 40 {
		t.Fatalf("429 retry amplification: %d upstream attempts for 20 requests (policy bound 40)", got)
	}
	if got := s.bifrost.count(); got < 20 {
		t.Fatalf("expected at least one attempt per request: %d", got)
	}
	vm(t, "bifrost_429_retry_attempts", s.bifrost.count())
}

// TestV38_BifrostDisconnectPlusCancellation: upstream drops while the user
// cancels — single terminal state.
func TestV38_BifrostDisconnectPlusCancellation(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: dropConn, delay: 600 * time.Millisecond},
	)
	sess := s.sessionFor("combo6", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	tap, stopTap := sseTap(t, resp)
	defer stopTap()
	var runID string
	for runID == "" {
		select {
		case ev := <-tap:
			if ev.env.Type == streaming.EventRunStarted {
				runID = ev.env.RunID
			}
		case <-time.After(5 * time.Second):
			t.Fatal("no start event")
		}
	}

	// User cancels 300ms before the upstream drop lands.
	go func() {
		time.Sleep(300 * time.Millisecond)
		cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
		if err == nil {
			cresp.Body.Close()
		}
	}()

	if !waitFor(t, 10*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("disconnect+cancel combo left run stuck: %+v", s.runs.get(runID))
	}
	r := s.runs.get(runID)
	if r.Status != "cancelled" && r.Status != "failed" {
		t.Fatalf("invalid combo outcome: %+v", r)
	}
	// At most one billing row.
	n := 0
	for _, u := range s.usage.records() {
		if u.RunID == runID {
			n++
		}
	}
	if n > 1 {
		t.Fatalf("combo billed %d times", n)
	}
}

// TestV38_APIShutdownPlusActiveWebSocket: shutdown fires while WS runs are
// live (the §30 combination, compressed).
func TestV38_APIShutdownPlusActiveWebSocket(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 30 * time.Second},
	)
	sess := s.sessionFor("combo7", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "x", true))
	events, _ := wsRead(t, conn, streaming.EventRunStarted, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no run")
	}
	runID := events[0].RunID

	// Fire the production shutdown sequence.
	rp := s.replicas[0]
	go func() {
		rp.srv.Close()
		rp.api.ShutdownWS()
		rp.mgr.Shutdown(10 * time.Second)
		rp.meter.Close(5 * time.Second)
	}()

	// The WS connection observes closure.
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			_ = conn.SetReadDeadline(time.Now().Add(20 * time.Second))
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
	select {
	case <-closed:
	case <-time.After(25 * time.Second):
		t.Fatal("WS connection survived shutdown")
	}

	if !waitFor(t, 10*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("WS run stuck after shutdown: %+v", s.runs.get(runID))
	}
}

// Guard against unused imports drifting with edits.
var (
	_ = errors.New
	_ = http.StatusOK
	_ = strings.Contains
)
