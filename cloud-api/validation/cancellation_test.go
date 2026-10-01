// Spec §27 (Cancellation Race Tests).
//
// Races between completion, cancellation, timeout, disconnect and provider
// failure. The final state must be deterministic and valid: exactly one
// terminal transition, no double billing, no stuck "running" rows.
package validation

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// terminalRuns reports how many runs are in a terminal state.
func terminalRuns(s *stack) int {
	n := 0
	for _, r := range s.runs.all() {
		if r.Terminal() {
			n++
		}
	}
	return n
}

// sseTap reads a run stream continuously in the background (the connection
// stays open — the race tests need the client alive while cancel/disconnect
// fire). Returns the event channel and a stop function.
func sseTap(t *testing.T, resp *http.Response) (<-chan sseEvt, func()) {
	t.Helper()
	events := make(chan sseEvt, 256)
	done := make(chan struct{})
	go func() {
		defer close(events)
		buf := make([]byte, 64<<10)
		var carry []byte
		for {
			select {
			case <-done:
				return
			default:
			}
			n, err := resp.Body.Read(buf)
			if n > 0 {
				carry = append(carry, buf[:n]...)
				for {
					idx := indexTerminator(carry)
					if idx < 0 {
						break
					}
					frame := string(carry[:idx])
					carry = carry[idx+2:]
					if line, ok := strings.CutPrefix(frame, "data: "); ok {
						if env, derr := streaming.DecodeEnvelope([]byte(line)); derr == nil {
							select {
							case events <- sseEvt{env: *env, at: time.Now()}:
							default:
							}
						}
					}
				}
			}
			if err != nil {
				return
			}
		}
	}()
	return events, func() { close(done); resp.Body.Close() }
}

// TestV27_CompletionJustBeforeCancel: the run finishes; a late cancel is a
// no-op that reports the terminal state (idempotent cancel).
func TestV27_CompletionJustBeforeCancel(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("late", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	runID := events[0].env.RunID
	if !waitFor(t, 5*time.Second, func() bool { return s.runs.get(runID).Terminal() }) {
		t.Fatal("run did not complete")
	}

	// Late cancel: must NOT resurrect or mutate the completed run.
	cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
	if err != nil {
		t.Fatalf("late cancel: %v", err)
	}
	cresp.Body.Close()
	if cresp.StatusCode != http.StatusOK {
		t.Fatalf("late cancel status: %d", cresp.StatusCode)
	}
	r := s.runs.get(runID)
	if r.Status != "completed" {
		t.Fatalf("late cancel mutated terminal state: %+v", r)
	}
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("usage records=%d after late cancel, want 1", len(s.usage.records()))
	}
}

// TestV27_CancelJustBeforeCompletion: cancel lands while the final chunk is
// in flight — exactly one terminal state, deterministic outcome.
func TestV27_CancelJustBeforeCompletion(t *testing.T) {
	s := newStackDefault(t)
	// Long stream with a completion at the end.
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 400 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}`, delay: 400 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("race", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	tap, stopTap := sseTap(t, resp)
	defer stopTap()

	var runID string
	deadline := time.After(5 * time.Second)
	for runID == "" {
		select {
		case ev := <-tap:
			if ev.env.Type == streaming.EventRunStarted {
				runID = ev.env.RunID
			}
		case <-deadline:
			t.Fatal("no start event")
		}
	}

	// Fire the cancel RIGHT as the final chunk is being produced.
	time.Sleep(650 * time.Millisecond)
	cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	cresp.Body.Close()

	// Deterministic + valid: the run is terminal; usage at most once.
	if !waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("run never settled after cancel/completion race: %+v", s.runs.get(runID))
	}
	r := s.runs.get(runID)
	if r.Status != "completed" && r.Status != "cancelled" {
		t.Fatalf("invalid race outcome: %+v", r)
	}
	// Billing: either the final usage chunk was seen (1 record) or not (0).
	n := 0
	for _, u := range s.usage.records() {
		if u.RunID == runID {
			n++
		}
	}
	if n > 1 {
		t.Fatalf("run billed %d times in the race window", n)
	}
	vm(t, "cancel_vs_completion_outcome", r.Status)
}

// TestV27_TimeoutJustBeforeCompletion: the idle timeout fires as the stream
// is completing — the final state stays valid.
func TestV27_TimeoutJustBeforeCompletion(t *testing.T) {
	o := defaultOpts()
	o.idleTimeout = 700 * time.Millisecond
	s := newStack(t, o)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"slow"}}]}`, delay: 800 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}`, delay: 50 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("race", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, "", 15*time.Second)
	last := "<none>"
	if len(events) > 0 {
		last = events[len(events)-1].env.Type
	}
	if last != streaming.EventRunFinished && last != streaming.EventRunError {
		t.Fatalf("timeout race ended without terminal event: %s", last)
	}

	for _, r := range s.runs.all() {
		if !r.Terminal() {
			t.Fatalf("run stuck running after timeout race: %+v", r)
		}
	}
}

// TestV27_DisconnectDuringCancellation: the client disconnects while a
// cancel is in flight — both paths converge to one terminal state.
func TestV27_DisconnectDuringCancellation(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 15 * time.Second},
	)
	sess := s.sessionFor("disc", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "x", true))
	events, _ := wsRead(t, conn, streaming.EventRunStarted, 5*time.Second)
	runID := events[0].RunID

	// Simultaneous disconnect + cancel.
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_ = conn.UnderlyingConn().Close()
	}()
	go func() {
		defer wg.Done()
		time.Sleep(50 * time.Millisecond)
		cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
		if err == nil {
			cresp.Body.Close()
		}
	}()
	wg.Wait()

	if !waitFor(t, 10*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("run never settled after disconnect+cancel: %+v", s.runs.get(runID))
	}
	r := s.runs.get(runID)
	if r.Status != "cancelled" && r.Status != "disconnected" {
		t.Fatalf("invalid combined outcome: %+v", r)
	}
}

// TestV27_ProviderFailureDuringCancellation: upstream drop racing an
// explicit cancel — one terminal state, one classification.
func TestV27_ProviderFailureDuringCancellation(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: dropConn, delay: 1 * time.Second},
	)
	sess := s.sessionFor("provfail", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	tap, stopTap := sseTap(t, resp)
	defer stopTap()

	var runID string
	deadline := time.After(5 * time.Second)
	for runID == "" {
		select {
		case ev := <-tap:
			if ev.env.Type == streaming.EventRunStarted {
				runID = ev.env.RunID
			}
		case <-deadline:
			t.Fatal("no start event")
		}
	}

	// Cancel racing the upstream drop.
	go func() {
		time.Sleep(400 * time.Millisecond)
		cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
		if err == nil {
			cresp.Body.Close()
		}
	}()

	if !waitFor(t, 10*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("run never settled after provider-failure+cancel race: %+v", s.runs.get(runID))
	}
	// Exactly one terminal transition happened (the fake enforces
	// exactly-once Complete; assert the row is coherent).
	r := s.runs.get(runID)
	if r.Status != "cancelled" && r.Status != "failed" {
		t.Fatalf("invalid race outcome: %+v", r)
	}
}

// TestV27_HighFrequencyRaceMatrix: 30 rounds of randomized
// cancel/disconnect/failure timing — every round lands in a valid terminal
// state with at most one billing record per run.
func TestV27_HighFrequencyRaceMatrix(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("matrix", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	for round := 0; round < 30; round++ {
		variant := round % 3
		s.bifrost.setScript(
			chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
			chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 300 * time.Millisecond},
			func() chunk {
				if variant == 2 {
					return chunk{data: dropConn, delay: 100 * time.Millisecond}
				}
				return chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`, delay: 100 * time.Millisecond}
			}(),
			chunk{data: `[DONE]`, delay: 0},
		)

		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("round %d post: %v", round, err)
		}
		events := readSSE(t, resp, streaming.EventRunStarted, 5*time.Second)
		if len(events) == 0 {
			t.Fatalf("round %d: no start event", round)
		}
		runID := events[0].env.RunID

		switch variant {
		case 0: // cancel mid-stream
			go func() {
				time.Sleep(150 * time.Millisecond)
				cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
				if err == nil {
					cresp.Body.Close()
				}
			}()
		case 1: // disconnect mid-stream
			resp.Body.Close()
		}

		if !waitFor(t, 10*time.Second, func() bool {
			r := s.runs.get(runID)
			return r != nil && r.Terminal()
		}) {
			t.Fatalf("round %d variant %d: run stuck: %+v", round, variant, s.runs.get(runID))
		}
	}

	// Global invariants: every run terminal, at most one usage record per run.
	seen := map[string]int{}
	for _, r := range s.runs.all() {
		if !r.Terminal() {
			t.Fatalf("non-terminal run after matrix: %+v", r)
		}
	}
	for _, u := range s.usage.records() {
		seen[u.RunID]++
		if seen[u.RunID] > 1 {
			t.Fatalf("run %s billed %d times", u.RunID, seen[u.RunID])
		}
	}
	vm(t, "race_matrix_rounds", 30)
}
