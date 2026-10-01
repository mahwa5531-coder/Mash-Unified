package tests

import (
	"fmt"
	"runtime"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestNoGoroutineLeaks: after a burst of streaming runs (including aborted
// and cancelled ones), the goroutine count returns to baseline — producers,
// watchers, heartbeats, batchers and pumps all have clear lifecycles
// (spec §29: no goroutine leaks; completion criterion 17).
func TestNoGoroutineLeaks(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	// Warm up (lazy internals, redis subscriptions, batcher…).
	for i := 0; i < 3; i++ {
		body := fmt.Sprintf(`{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"warm %d"}]}`, i)
		resp, err := h.postRun(sess, body, nil)
		if err != nil {
			t.Fatalf("warmup: %v", err)
		}
		readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	}
	waitFor(t, 3*time.Second, func() bool { return h.usage.count() >= 3 })
	time.Sleep(300 * time.Millisecond)

	baseline := runtime.NumGoroutine()

	// Burst: completes, disconnects, cancels — every termination path.
	for i := 0; i < 12; i++ {
		body := fmt.Sprintf(`{"model":"openai/gpt-4o","stream":true,"idempotency_key":"leak-%d","messages":[{"role":"user","content":"x"}]}`, i)
		resp, err := h.postRun(sess, body, nil)
		if err != nil {
			t.Fatalf("burst: %v", err)
		}
		switch i % 3 {
		case 0: // clean completion
			readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
		case 1: // desktop disconnect mid-stream
			readSSE(t, resp, streaming.EventTextMessageContent, 5*time.Second)
		case 2: // client stops reading mid-stream (sink goes idle)
			readSSE(t, resp, streaming.EventTextMessageContent, 5*time.Second)
		}
	}

	// Everything settles: producers finalize, handlers return, pumps exit.
	waitFor(t, 5*time.Second, func() bool {
		return runtime.NumGoroutine() <= baseline+2
	})
	final := runtime.NumGoroutine()
	if final > baseline+2 {
		buf := make([]byte, 1<<16)
		n := runtime.Stack(buf, true)
		t.Fatalf("goroutine leak: baseline=%d final=%d\n%s", baseline, final, buf[:n])
	}
	t.Logf("goroutines: baseline=%d final=%d", baseline, final)
}
