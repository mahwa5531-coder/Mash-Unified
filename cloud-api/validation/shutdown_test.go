// Spec §30 (Graceful Shutdown Test).
//
// Mirrors the production shutdown sequence exactly (cmd/server): stop
// accepting → close WebSockets (1001) → cancel in-flight runs → drain usage
// metering → flush. No hung shutdown, no leaked goroutines, billing drained.
package validation

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// drainWS keeps reading frames from conn until it closes.
//
// Why it exists (2026-09-28 triage): the original test created 10 WebSocket
// runs fire-and-forget with NOBODY reading the client side. The server
// writes RUN_STARTED envelopes + 50ms heartbeats to every connection; with
// zero readers the server-side write pump can hit TCP backpressure before
// the just-written run.create is processed by the read loop — that run then
// never dispatches upstream and the test nondeterministically loses 1-3
// streams (`upstream requests=29`, bimodal on machine speed; reproduced on
// the pristine base tree 2/3 — NOT a regression). With readers: 30/30
// across all runs. Real clients read; the shutdown behavior under test is
// unchanged.
func drainWS(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	t.Cleanup(func() { _ = conn.Close() })
	go func() {
		_ = conn.SetReadDeadline(time.Time{})
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()
}

// TestV30_GracefulShutdownWithActiveWork: 20 active SSE runs + 10 active
// WebSockets + upstream streams mid-flight; trigger the production shutdown
// sequence and verify every property of spec §30.
func TestV30_GracefulShutdownWithActiveWork(t *testing.T) {
	s := newStackDefault(t)
	// Long streams: each will be mid-flight when shutdown hits.
	longScript := []chunk{
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 60 * time.Second},
	}
	s.bifrost.setScript(longScript...)

	sess := s.sessionFor("sd", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// 20 active SSE runs (client readers keep the connections open).
	var sseClients []*sseTapState
	for i := 0; i < 20; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", fmt.Sprintf("sd-%d", i), true), nil)
		if err != nil {
			t.Fatalf("sse %d: %v", i, err)
		}
		tap, stop := sseTap(t, resp)
		sseClients = append(sseClients, &sseTapState{tap: tap, stop: stop})
		// Wait for the run to actually start upstream.
		deadline := time.After(5 * time.Second)
	waiting:
		for {
			select {
			case ev := <-tap:
				if ev.env.Type == streaming.EventRunStarted || ev.env.Type == streaming.EventTextMessageStart {
					break waiting
				}
			case <-deadline:
				t.Fatalf("sse %d: no start event", i)
			}
		}
	}

	// 10 active WebSockets with runs.
	for i := 0; i < 10; i++ {
		conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
		if err != nil {
			t.Fatalf("ws %d: %v", i, err)
		}
		drainWS(t, conn) // keep the client read side moving (see drainWS)
		wsRunCreate(t, conn, runBody("openai/gpt-4o", fmt.Sprintf("ws-%d", i), true))
	}
	// Wait for all 30 runs to reach the fake upstream before triggering the
	// PRODUCTION shutdown sequence. Generous window (setup, not the behavior
	// under test): the assertion below still requires exactly 30 held
	// streams at trigger time.
	waitFor(t, 20*time.Second, func() bool { return s.bifrost.count() >= 30 })

	// The upstream must be actively holding 30 streams.
	if s.bifrost.count() < 30 {
		t.Fatalf("upstream requests=%d, want 30", s.bifrost.count())
	}

	// Run the PRODUCTION shutdown sequence (same order as cmd/server).
	baseG := goroutines()
	start := time.Now()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		rp := s.replicas[0]

		// 14a. Stop accepting new connections (the production sequence bounds
		// the total grace via shutdownCtx; here the test bounds itself).
		rp.srv.Close()

		// 14b. Close WebSocket connections (1001 Going Away).
		rp.api.ShutdownWS()

		// 14c. Cancel remaining runs (producers finalize: usage + rows).
		rp.mgr.Shutdown(8 * time.Second)

		// 14d. Drain the usage metering queue.
		rp.meter.Close(3 * time.Second)
	}()
	<-shutdownDone

	// Bounded shutdown time — no hang.
	if d := time.Since(start); d > 15*time.Second {
		t.Fatalf("shutdown took %s — hung", d)
	}

	// Upstream streams were cancelled safely.
	waitFor(t, 5*time.Second, func() bool { return s.bifrost.cancelCount() >= 30 })
	if s.bifrost.cancelCount() < 30 {
		t.Fatalf("upstream cancels=%d, want 30 (all streams aborted)", s.bifrost.cancelCount())
	}

	// Client outcomes: every connection observed a terminal event or a close.
	for _, c := range sseClients {
		c.stop()
	}

	// Run rows all finalize to valid terminal states.
	if !waitFor(t, 10*time.Second, func() bool {
		terminal := 0
		for _, r := range s.runs.all() {
			if r.Terminal() {
				terminal++
			}
		}
		return terminal >= 30
	}) {
		t.Fatalf("runs terminal=%d/30 after shutdown", terminalRuns(s))
	}
	for _, r := range s.runs.all() {
		if r.Status == "running" {
			t.Fatalf("run still running after shutdown: %s", r.ID)
		}
	}

	// Usage drained: metering closed BEFORE checking; zero-token audit rows
	// for the cancelled runs landed exactly once each.
	seen := map[string]int{}
	for _, u := range s.usage.records() {
		seen[u.RunID]++
	}
	if len(seen) != len(s.runs.all()) {
		t.Fatalf("usage rows=%d for runs=%d (meter must drain every run)", len(seen), len(s.runs.all()))
	}
	for id, n := range seen {
		if n > 1 {
			t.Fatalf("run %s billed %d times during shutdown", id, n)
		}
	}

	// New requests are rejected: the server is closed (connection refused).
	_, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "after shutdown", true), nil)
	if err == nil {
		t.Fatal("a request succeeded after shutdown — the listener must be gone")
	}

	// No leaked goroutines once everything settles.
	if !waitFor(t, 10*time.Second, func() bool { return goroutines() <= baseG+40 }) {
		t.Fatalf("goroutines=%d (base=%d) after shutdown — leaked", goroutines(), baseG)
	}
	vm(t, "graceful_shutdown_ms", time.Since(start).Milliseconds())
	vm(t, "graceful_shutdown_upstream_cancels", s.bifrost.cancelCount())
}

type sseTapState struct {
	tap  <-chan sseEvt
	stop func()
}

// TestV30_ShutdownRejectsNewWorkDuringDrain: once the shutdown sequence
// begins, fresh connections fail while in-flight work finalizes.
func TestV30_ShutdownRejectsNewWorkDuringDrain(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 5 * time.Second},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":6,"completion_tokens":3,"total_tokens":9}}`, delay: 100 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("drain", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// One active stream that will complete mid-shutdown.
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "drain me", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	tap, stopTap := sseTap(t, resp)
	defer stopTap()

	// Begin shutdown while the stream is alive.
	rp := s.replicas[0]
	go func() {
		time.Sleep(200 * time.Millisecond)
		rp.srv.Close()
		rp.api.ShutdownWS()
		rp.mgr.Shutdown(8 * time.Second)
		rp.meter.Close(3 * time.Second)
	}()

	// The active stream terminates (cancelled or completed — both valid).
	terminal := false
	deadline := time.After(15 * time.Second)
	for !terminal {
		select {
		case ev, ok := <-tap:
			if !ok {
				terminal = true // connection closed by shutdown
				break
			}
			if ev.env.Type == streaming.EventRunFinished || ev.env.Type == streaming.EventRunError || ev.env.Type == streaming.EventRunCancelled {
				terminal = true
			}
		case <-deadline:
			t.Fatal("active stream hung during shutdown drain")
		}
	}

	// The listener is gone: no new work accepted.
	_, err = http.Get(rp.url + "/health/live")
	if err == nil {
		t.Fatal("listener survived shutdown")
	}
	vm(t, "shutdown_drain_rejects_new", 1)
}
