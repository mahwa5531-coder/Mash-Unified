// Spec §28 (Usage Accounting Tests).
//
// Token usage must be accurate, attributed, exactly-once: never
// double-counted, never billed twice, always tied to the correct
// tenant/user/run.
package validation

import (
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV28_SuccessfulRun: exactly one record, correct attribution, correct
// token normalization (Bifrost usage → NexAU canonical fields).
func TestV28_SuccessfulRun(t *testing.T) {
	s := newStackDefault(t)
	// standardScript usage: prompt 100, completion 40, cached_read 20.
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("usage", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	runID := events[0].env.RunID

	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("usage records=%d, want 1", len(s.usage.records()))
	}
	u := s.usage.records()[0]
	if u.RunID != runID {
		t.Fatalf("usage run attribution: %s want %s", u.RunID, runID)
	}
	if u.TenantID != "ten_A" || u.UserID != "usr_1" || u.SessionID != sess {
		t.Fatalf("usage attribution: %+v", u)
	}
	if u.Provider != "openai" || u.Model != "gpt-4o-2024" || u.RequestedModel != "openai/gpt-4o" {
		t.Fatalf("usage model attribution: %+v", u)
	}
	// NexAU-canonical semantics: input_tokens EXCLUDES cached reads
	// (prompt 100 - cached_read 20 = 80); total keeps the prompt+completion.
	if u.Usage.InputTokens != 80 || u.Usage.OutputTokens != 40 || u.Usage.TotalTokens != 140 {
		t.Fatalf("usage tokens: %+v", u.Usage)
	}
	if u.Usage.CacheReadTokens != 20 {
		t.Fatalf("cache read tokens: %d (NexAU cache semantics)", u.Usage.CacheReadTokens)
	}
	vm(t, "usage_success_input", u.Usage.InputTokens)
	vm(t, "usage_success_output", u.Usage.OutputTokens)
}

// TestV28_FailedRun: upstream error → no billing (no tokens were consumed
// that the gateway reported).
func TestV28_FailedRun(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setMode(bifrostHTTPStatus, 500, bifrostErrBody(500, "500", "provider down"), 0)
	sess := s.sessionFor("failed", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	readSSE(t, resp, streaming.EventRunError, 15*time.Second)

	// Failed runs produce exactly ONE zero-token audit record (every run is
	// accounted; failures bill nothing). Never more, never tokens.
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("failed run usage records=%d, want exactly 1 audit row", len(s.usage.records()))
	}
	u := s.usage.records()[0]
	if u.Status != "failed" || u.Usage.TotalTokens != 0 {
		t.Fatalf("failed run usage row: status=%s tokens=%+v (must be zero-token)", u.Status, u.Usage)
	}
	vm(t, "usage_failed_zero_billed", 1)
}

// TestV28_CancelledRun: cancellation before the usage-bearing final chunk →
// no billing.
func TestV28_CancelledRun(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 20 * time.Second},
	)
	sess := s.sessionFor("cancel", "ten_A", "usr_1")
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

	cresp, err := s.post(0, tok, "/v1/agent/runs/"+runID+"/cancel", "")
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	cresp.Body.Close()

	waitFor(t, 5*time.Second, func() bool { return s.runs.get(runID).Terminal() })
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("cancelled run usage records=%d, want 1 audit row", len(s.usage.records()))
	}
	if u := s.usage.records()[0]; u.Status != "cancelled" || u.Usage.TotalTokens != 0 {
		t.Fatalf("cancelled run usage row: status=%s tokens=%+v", u.Status, u.Usage)
	}
}

// TestV28_DesktopDisconnect: no final chunk delivered → no billing.
func TestV28_DesktopDisconnect(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 20 * time.Second},
	)
	sess := s.sessionFor("disc", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	readSSE(t, resp, streaming.EventRunStarted, 5*time.Second)
	resp.Body.Close() // hard disconnect

	waitFor(t, 5*time.Second, func() bool { return s.bifrost.cancelCount() > 0 })
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("disconnected run usage records=%d, want 1 audit row", len(s.usage.records()))
	}
	if u := s.usage.records()[0]; u.Usage.TotalTokens != 0 {
		t.Fatalf("disconnected run usage row: %+v (must be zero-token)", u.Usage)
	}
}

// TestV28_ProviderTimeout: idle-timeout failure → no billing.
func TestV28_ProviderTimeout(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"stall"}}]}`, delay: 10 * time.Minute},
	)
	sess := s.sessionFor("timeout", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("timed-out run usage records=%d, want 1 audit row", len(s.usage.records()))
	}
	if u := s.usage.records()[0]; u.Usage.TotalTokens != 0 {
		t.Fatalf("timed-out run usage row: %+v (must be zero-token)", u.Usage)
	}
}

// TestV28_RetryBillsOnce: a transient 503 + successful retry bills the
// successful attempt only.
func TestV28_RetryBillsOnce(t *testing.T) {
	o := defaultOpts()
	o.maxRetries = 2
	o.retryMin = 10 * time.Millisecond
	s := newStack(t, o)
	s.bifrost.setFailFirst(1, 503)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"recovered"}}]}`, delay: 10 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`, delay: 10 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("retrybill", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)

	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("usage records=%d, want exactly 1 (retry must not double-bill)", len(s.usage.records()))
	}
	if got := s.usage.records()[0].Usage.TotalTokens; got != 15 {
		t.Fatalf("usage tokens=%d, want 15", got)
	}
}

// TestV28_DuplicateRequestBillsOnce: idempotent replay adds no second record.
func TestV28_DuplicateRequestBillsOnce(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("dupbill", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "bill once", true)
	hdrs := map[string]string{"Idempotency-Key": "idem_bill_1"}

	for i := 0; i < 3; i++ {
		resp, err := s.postRun(0, tok, sess, body, hdrs)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		readSSE(t, resp, "", 10*time.Second)
	}
	if s.bifrost.count() != 1 {
		t.Fatalf("upstream executions=%d, want 1", s.bifrost.count())
	}
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 1 }) {
		t.Fatalf("usage records=%d after 3 identical requests, want 1", len(s.usage.records()))
	}
}

// TestV28_MultiRunTotals: usage across many runs aggregates exactly.
func TestV28_MultiRunTotals(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("multi", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	const runs = 5
	for i := 0; i < runs; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	}
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == runs }) {
		t.Fatalf("usage records=%d, want %d", len(s.usage.records()), runs)
	}
	tot := s.usage.total()
	if tot.InputTokens != 80*runs || tot.OutputTokens != 40*runs {
		t.Fatalf("aggregate usage: %+v (want in=%d out=%d)", tot, 80*runs, 40*runs)
	}
	// Every record maps to a distinct run.
	ids := map[string]bool{}
	for _, u := range s.usage.records() {
		if ids[u.RunID] {
			t.Fatalf("duplicate run billing: %s", u.RunID)
		}
		ids[u.RunID] = true
	}
	vm(t, "usage_multi_run_total_tokens", tot.TotalTokens)
}
