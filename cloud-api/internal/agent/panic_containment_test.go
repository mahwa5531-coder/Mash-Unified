package agent

// Poison-pill containment proofs (2026-09-18 post-mortem audit, driven by
// the danluu/post-mortems taxonomy: incident.io "poison pill" + Google
// Service Control crash-loop class).
//
// The run producer runs DETACHED on the WebSocket path (wshandler.go:
// `go h.svc.ProduceStream(...)`) where the Recovery middleware cannot reach
// it. Before the fix, any panic in the producer pipeline — a hostile upstream
// chunk shape, a dead sink edge, a mapper regression — terminated the whole
// process (every live stream and connection on the pod; a deterministic
// trigger = crash loop). These tests prove the post-fix contract:
//
//  1. a panicking sink is contained: ProduceStream returns normally, the run
//     row is finalized failed(INTERNAL), the handle finishes;
//  2. a clean run after a contained poison run behaves normally (no state
//     corruption leaks into the next run).

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// --- fixtures ----------------------------------------------------------------

// poisonSink panics on SendEvent (the simulated poison source).
type poisonSink struct{}

func (poisonSink) SendEvent(env *streaming.Envelope) error {
	panic("poison sink: simulated producer-path panic")
}

// collectSink records delivered envelopes.
type collectSink struct{ events []*streaming.Envelope }

func (c *collectSink) SendEvent(env *streaming.Envelope) error {
	c.events = append(c.events, env)
	return nil
}

// noopBus satisfies the agent Bus seam without Redis round trips.
type noopBus struct{}

func (noopBus) Publish(ctx context.Context, env *streaming.Envelope) error { return nil }
func (noopBus) Replay(ctx context.Context, runID string, afterSequence, maxBytes int64) ([]*streaming.Envelope, int64, bool, error) {
	return nil, 0, false, nil
}
func (noopBus) Retain(ctx context.Context, runID string) {}
func (noopBus) SubscribeLive(ctx context.Context, sessionID string) (*streaming.Live, error) {
	return nil, fmt.Errorf("no live subscription in unit harness")
}

// newPanicTestService builds a Service whose Bifrost leg is the real client
// against an httptest SSE server emitting the given data lines.
func newPanicTestService(t *testing.T, lines []string) (*Service, *fakeRuns) {
	t.Helper()

	// Real bifrost client against a scripted SSE upstream (production code
	// path: transport, SSE parser, idle watchdog, mapper input).
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for _, line := range lines {
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
		<-r.Context().Done()
	}))
	t.Cleanup(upstream.Close)

	bf := bifrost.NewClient(bifrost.TransportConfig{
		BaseURL:          upstream.URL,
		APIKey:           "test-key",
		DialTimeout:      2 * time.Second,
		TLSTimeout:       2 * time.Second,
		ResponseHeaderTO: 5 * time.Second,
		MaxRetries:       0,
	}, nil)

	mr := miniredis.RunT(t)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	lim := ratelimit.New(rdb, true, nil)
	mgr := NewManager(rdb, lim, time.Minute, nil)

	runs := &fakeRuns{runs: map[string]*domain.Run{}}
	svc := NewService(Config{
		Sessions: &fakeSessions{sess: &domain.Session{
			ID: "sess_1", TenantID: "ten_1", UserID: "usr_1", Status: domain.SessionActive,
		}},
		Runs:    runs,
		Bifrost: bf,
		Bus:     noopBus{},
		Idem:    idempotency.New(rdb, 24*time.Hour),
		Manager: mgr,
		Limiter: lim,
		Limits:  Limits{MaxMessages: 16, MaxTools: 8, MaxModelLen: 64},
		Rate:    RateRules{RPMUser: 1000, RPMTenant: 1000, ConcUser: 100, ConcTenant: 100},
		Timing:  StreamTiming{IdleTimeout: 5 * time.Second, MaxDuration: 10 * time.Second},
	})
	return svc, runs
}

func panicTestUpstreamLines() []string {
	return []string{
		`{"id":"cmpl_1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Revenue"}}]}`,
		`{"id":"cmpl_1","choices":[{"index":0,"delta":{"content":" is up"}}]}`,
	}
}

// --- tests ---------------------------------------------------------------------

// The core proof: a panic inside the producer pipeline is contained, the run
// is finalized as failed(INTERNAL), and the handle's waiters are released.
// Pre-fix this test would terminate the whole test binary (an unrecovered
// panic on the goroutine that would, on the WS path, be detached).
func TestProduceStreamContainsPoisonSink(t *testing.T) {
	svc, runs := newPanicTestService(t, panicTestUpstreamLines())
	idn := idemTestIdentity()
	req := idemTestRequest("key-poison-1")

	_, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
	if derr != nil || handle == nil {
		t.Fatalf("create: derr=%v handle=%v", derr, handle)
	}
	runID := handle.Run.ID

	// Exactly how the WS path invokes it: this call must RETURN normally.
	svc.ProduceStream(idn, handle, req, poisonSink{})

	select {
	case <-handle.Done():
	default:
		t.Fatal("handle must be finished after a contained panic")
	}

	r, _ := runs.Get(context.Background(), "ten_1", runID)
	if r == nil {
		t.Fatal("run row must exist")
	}
	if r.Status != domain.RunFailed {
		t.Fatalf("contained-panic run status = %s, want failed", r.Status)
	}
	if r.ErrorCode != "INTERNAL" {
		t.Fatalf("contained-panic run error code = %s, want INTERNAL", r.ErrorCode)
	}
}

// A poison run must not corrupt the next one: the immediately following
// clean run completes normally with events delivered.
func TestCleanRunAfterContainedPoisonRun(t *testing.T) {
	svc, runs := newPanicTestService(t, panicTestUpstreamLines())
	idn := idemTestIdentity()

	// 1. Poison run (contained).
	_, h1, d1 := svc.CreateRun(context.Background(), idn, "sess_1", idemTestRequest("key-poison-2"))
	if d1 != nil || h1 == nil {
		t.Fatalf("poison create: %v", d1)
	}
	svc.ProduceStream(idn, h1, idemTestRequest("key-poison-2"), poisonSink{})

	// 2. Clean run on the SAME service instance.
	good := &collectSink{}
	_, h2, d2 := svc.CreateRun(context.Background(), idn, "sess_1", idemTestRequest("key-clean-2"))
	if d2 != nil || h2 == nil {
		t.Fatalf("clean create: %v", d2)
	}
	svc.ProduceStream(idn, h2, idemTestRequest("key-clean-2"), good)

	r, _ := runs.Get(context.Background(), "ten_1", h2.Run.ID)
	if r == nil || r.Status != domain.RunCompleted {
		t.Fatalf("clean run after poison: status=%v want completed", r)
	}
	if len(good.events) == 0 {
		t.Fatal("clean run after poison delivered no events")
	}
}

// A hostile upstream chunk shape (wrong field types, junk lines) must not
// crash the process either — it degrades to a failed run at worst. This is
// the adversarial-input complement: containment + graceful error mapping.
func TestProduceStreamHostileUpstreamShapes(t *testing.T) {
	hostile := [][]string{
		{`{"id":123,"choices":"not-an-array"}`},
		{`{"choices":[{"delta":{"content":42}}]}`},
		{`not json at all`},
		{`{"choices":[]}`},
		{`{"id":"x","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":-5,"completion_tokens":"junk"}}`},
	}
	for i, lines := range hostile {
		svc, runs := newPanicTestService(t, lines)
		idn := idemTestIdentity()
		req := idemTestRequest(fmt.Sprintf("key-hostile-%d", i))

		_, handle, derr := svc.CreateRun(context.Background(), idn, "sess_1", req)
		if derr != nil || handle == nil {
			t.Fatalf("hostile[%d] create: %v", i, derr)
		}
		sink := &collectSink{}
		// Must return without crashing the test binary.
		svc.ProduceStream(idn, handle, req, sink)

		select {
		case <-handle.Done():
		default:
			t.Fatalf("hostile[%d]: handle not finished", i)
		}
		if r, _ := runs.Get(context.Background(), "ten_1", handle.Run.ID); r == nil {
			t.Fatalf("hostile[%d]: run row missing", i)
		}
	}
}

// Compile-time interface checks for the test seams.
var (
	_ EventSink = poisonSink{}
	_ EventSink = (*collectSink)(nil)
	_ Bus       = noopBus{}
)
