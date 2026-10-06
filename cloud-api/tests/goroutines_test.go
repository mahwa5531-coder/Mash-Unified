package tests

import (
	"fmt"
	"net/http"
	"runtime"
	"testing"
	"time"
)

// TestNoGoroutineLeaks: after a burst of streaming runs, the goroutine count
// returns to baseline — producers, watchers, heartbeats, batchers and pumps
// all have clear lifecycles.
func TestNoGoroutineLeaks(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)

	// Warm up (lazy internals, redis connections, batcher…).
	for i := 0; i < 3; i++ {
		body := fmt.Sprintf(`{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"warm %d"}]}`, i)
		resp, err := h.postChatCompletions(body, nil)
		if err != nil {
			t.Fatalf("warmup: %v", err)
		}
		readRawSSE(t, resp, 5*time.Second)
	}
	waitFor(t, 3*time.Second, func() bool { return h.usage.count() >= 3 })
	time.Sleep(100 * time.Millisecond)

	http.DefaultTransport.(*http.Transport).CloseIdleConnections()
	h.bfClient.CloseIdleConnections()
	time.Sleep(50 * time.Millisecond)

	baseline := runtime.NumGoroutine()

	// Burst: streaming completions.
	for i := 0; i < 6; i++ {
		body := fmt.Sprintf(`{"model":"openai/gpt-4o","stream":true,"idempotency_key":"leak-%d","messages":[{"role":"user","content":"x"}]}`, i)
		resp, err := h.postChatCompletions(body, nil)
		if err != nil {
			t.Fatalf("burst: %v", err)
		}
		readRawSSE(t, resp, 5*time.Second)
	}

	// Everything settles: producers finalize, handlers return, idle conns closed.
	waitFor(t, 5*time.Second, func() bool {
		http.DefaultTransport.(*http.Transport).CloseIdleConnections()
		h.bfClient.CloseIdleConnections()
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
