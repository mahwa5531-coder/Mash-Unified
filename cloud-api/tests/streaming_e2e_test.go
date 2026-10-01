package tests

import (
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestStreamingIsIncremental proves the API forwards chunks as they arrive —
// it does NOT buffer the complete model response (spec §39: verify chunk 1,
// chunk 2, chunk 3 … arrive incrementally; first-byte vs last-byte spread
// must track the upstream pacing).
func TestStreamingIsIncremental(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"Analyze sales"}]}`
	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status: %d", resp.StatusCode)
	}

	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) < 8 {
		t.Fatalf("expected full event lifecycle, got %d", len(events))
	}

	// Incremental proof: the 2nd content delta must arrive measurably after
	// the 1st (upstream pacing: 150ms between chunks). A buffering gateway
	// would deliver both at stream end.
	var first, second time.Time
	sawText := 0
	for _, ev := range events {
		if ev.env.Type == streaming.EventTextMessageContent {
			sawText++
			switch sawText {
			case 1:
				first = ev.at
			case 2:
				second = ev.at
			}
		}
	}
	if sawText < 2 {
		t.Fatalf("expected ≥2 content deltas, got %d", sawText)
	}
	gap := second.Sub(first)
	if gap < 100*time.Millisecond {
		t.Fatalf("chunks were buffered: gap=%v (want ≥100ms of upstream pacing)", gap)
	}

	// Lifecycle ordering: START precedes CONTENT precedes END; RUN bookends present.
	types := make([]string, len(events))
	for i, e := range events {
		types[i] = e.env.Type
	}
	assertOrder(t, types, streaming.EventRunStarted, streaming.EventTextMessageStart)
	assertOrder(t, types, streaming.EventTextMessageContent, streaming.EventTextMessageEnd)
	assertOrder(t, types, streaming.EventToolCallStart, streaming.EventToolCallEnd)
	assertLast(t, types, streaming.EventRunFinished)

	// Sequences are monotonic and gap-free.
	for i := 1; i < len(events); i++ {
		if events[i].env.Sequence != events[i-1].env.Sequence+1 {
			t.Fatalf("sequence gap at %d: %d → %d", i, events[i-1].env.Sequence, events[i].env.Sequence)
		}
	}

	// Usage event carries authoritative (Bifrost) numbers.
	var usage *streaming.RunUsageData
	for _, e := range events {
		if e.env.Type == streaming.EventUsageUpdate {
			var d streaming.RunUsageData
			if err := decode(e.env.Data, &d); err == nil {
				usage = &d
			}
		}
	}
	if usage == nil {
		t.Fatal("USAGE_UPDATE missing")
	}
	if usage.InputTokens != 80 { // 100 prompt − 20 cached read (NexAU semantics)
		t.Errorf("usage input: %d", usage.InputTokens)
	}
	if usage.TotalTokens != 140 {
		t.Errorf("usage total: %d", usage.TotalTokens)
	}
	if usage.TotalCost != 0.003 {
		t.Errorf("usage cost: %v", usage.TotalCost)
	}

	// Run row: completed with resolved model + provider (finalization lands
	// right after the last event — poll for the terminal state).
	runID := events[0].env.RunID
	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil {
		t.Fatal("run row missing")
	}
	if run.Status != domain.RunCompleted {
		t.Errorf("run status: %s", run.Status)
	}
	if run.ResolvedModel != "gpt-4o-2024" || run.Provider != "openai" {
		t.Errorf("resolved model/provider: %s / %s", run.ResolvedModel, run.Provider)
	}

	// Metering: exactly one usage record with the authoritative tokens.
	waitFor(t, 3*time.Second, func() bool { return h.usage.count() == 1 })
	if h.usage.count() != 1 {
		t.Fatalf("usage records: %d (want exactly 1)", h.usage.count())
	}
	if tot := h.usage.total(); tot.TotalTokens != 140 || tot.CacheReadTokens != 20 {
		t.Errorf("metered usage: %+v", tot)
	}
}

// TestDesktopDisconnectCancelsUpstream: the desktop drops the connection
// mid-stream; the upstream Bifrost request MUST be cancelled (spec §20) and
// the run finalized as disconnected.
func TestDesktopDisconnectCancelsUpstream(t *testing.T) {
	h := newHarness(t)
	// Long-running upstream: chunks every 300ms forever (script holds open).
	h.bifrost.setScript(
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 50 * time.Millisecond},
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 300 * time.Millisecond},
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"c"}}]}`, delay: 300 * time.Millisecond},
	)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"x"}]}`
	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}

	// Read the first event, then drop the connection.
	events := readSSE(t, resp, streaming.EventTextMessageContent, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no events before disconnect")
	}
	runID := events[0].env.RunID

	// Upstream cancellation must be observed promptly.
	waitFor(t, 3*time.Second, h.bifrost.wasCanceled)
	if !h.bifrost.wasCanceled() {
		t.Fatal("desktop disconnect must cancel the upstream request")
	}

	// Run finalizes as disconnected.
	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil || run.Status != domain.RunDisconnected {
		t.Fatalf("run status after disconnect: %+v", run)
	}
}

// TestCancelEndpointPropagates: POST /v1/agent/runs/{id}/cancel cancels the
// running stream from a SECOND connection while the SSE stream stays attached
// (spec §20 cancellation path — no disconnect involved).
func TestCancelEndpointPropagates(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 50 * time.Millisecond},
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 10 * time.Minute}, // stream keeps flowing
	)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"x"}]}`
	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}

	// Consume events asynchronously: the connection stays attached.
	runIDCh := make(chan string, 1)
	go func() {
		defer resp.Body.Close()
		buf := make([]byte, 32<<10)
		for {
			n, err := resp.Body.Read(buf)
			_ = n
			if err != nil {
				return
			}
			if id, ok := extractRunID(buf[:n]); ok {
				select {
				case runIDCh <- id:
				default:
				}
			}
		}
	}()

	var runID string
	select {
	case runID = <-runIDCh:
	case <-time.After(5 * time.Second):
		t.Fatal("no events observed")
	}

	// Cancel via the REST endpoint (second connection).
	req, _ := newRequest(t, "POST", h.srv.URL+"/v1/agent/runs/"+runID+"/cancel")
	req.Header.Set("Authorization", "Bearer "+h.token)
	cresp, err := httpDo(req)
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}
	defer cresp.Body.Close()
	if cresp.StatusCode != 200 {
		t.Fatalf("cancel status: %d", cresp.StatusCode)
	}

	waitFor(t, 3*time.Second, h.bifrost.wasCanceled)
	if !h.bifrost.wasCanceled() {
		t.Fatal("cancel must propagate upstream")
	}

	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil || run.Status != domain.RunCancelled {
		t.Fatalf("run status after cancel: %+v", run)
	}
	if run.CancelReason != "user" {
		t.Errorf("cancel reason: %s (want user)", run.CancelReason)
	}
}

// extractRunID pulls the first run id out of raw SSE bytes.
func extractRunID(b []byte) (string, bool) {
	s := string(b)
	needle := `"run_id":"`
	for {
		i := strings.Index(s, needle)
		if i < 0 {
			return "", false
		}
		rest := s[i+len(needle):]
		j := strings.IndexByte(rest, '"')
		if j > 0 {
			return rest[:j], true
		}
		s = rest
	}
}

// TestUpstreamDisconnectSurfacesError: Bifrost drops mid-stream without
// [DONE]; the desktop receives a clean RUN_ERROR (never a hang), and the run
// fails with the protocol error code (spec §39).
func TestUpstreamDisconnectSurfacesError(t *testing.T) {
	h := newHarness(t)
	// Script drops the connection after one chunk: no [DONE], raw TCP end.
	h.bifrost.setScript(
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"part"}}]}`, delay: 50 * time.Millisecond},
		scriptChunk{data: sentinelClose},
	)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"x"}]}`
	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}

	deadline := time.Now().Add(8 * time.Second)
	var sawRunError bool
	var runID string
	for time.Now().Before(deadline) {
		ev := readOne(t, resp)
		if ev == nil {
			break
		}
		if runID == "" {
			runID = ev.env.RunID
		}
		if ev.env.Type == streaming.EventRunError {
			sawRunError = true
			var d streaming.RunErrorData
			_ = decode(ev.env.Data, &d)
			if d.Message == "" {
				t.Error("RUN_ERROR must carry a message")
			}
			break
		}
	}
	if !sawRunError {
		t.Fatal("upstream disconnect must surface RUN_ERROR")
	}

	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil || run.Status != domain.RunFailed {
		t.Fatalf("run status after upstream drop: %+v", run)
	}
}

// TestTenantIsolation: a tenant-A token cannot touch tenant-B sessions
// (404, no existence leak) — the tenancy backbone (spec §38).
func TestTenantIsolation(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	foreign := h.createForeignSession()

	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"x"}]}`
	resp, err := h.postRun(foreign, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("foreign session must 404, got %d", resp.StatusCode)
	}
	if strings.Contains(readAll(t, resp), "run_") {
		t.Fatal("error body must not leak run identifiers")
	}
}

// TestIdempotencyPreventsDuplicateExecution: the same Idempotency-Key with
// the same body triggers exactly ONE upstream call (spec §19).
func TestIdempotencyPreventsDuplicateExecution(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":true,"idempotency_key":"op-123","messages":[{"role":"user","content":"x"}]}`
	resp1, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	events := readSSE(t, resp1, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("first run produced no events")
	}

	// Duplicate: same key, same body.
	resp2, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("duplicate: %v", err)
	}
	events2 := readSSE(t, resp2, streaming.EventRunFinished, 10*time.Second)

	// Exactly one upstream request must have been made.
	if n := h.bifrost.count(); n != 1 {
		t.Fatalf("idempotent duplicate reached upstream: %d requests", n)
	}
	// The duplicate must not be a NEW run.
	if len(events2) > 0 && events2[0].env.RunID != events[0].env.RunID {
		t.Fatalf("duplicate must reference the original run: %s vs %s",
			events2[0].env.RunID, events[0].env.RunID)
	}

	// Exactly-once billing.
	waitFor(t, 3*time.Second, func() bool { return h.usage.count() == 1 })
	if h.usage.count() != 1 {
		t.Fatalf("usage records after duplicate: %d (want 1)", h.usage.count())
	}
}

// TestIdempotencyKeyReuseRejected: same key with a DIFFERENT body is a
// client error (422), never a silent second execution.
func TestIdempotencyKeyReuseRejected(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	first := `{"model":"openai/gpt-4o","stream":true,"idempotency_key":"op-456","messages":[{"role":"user","content":"A"}]}`
	resp1, err := h.postRun(sess, first, nil)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	readSSE(t, resp1, streaming.EventRunFinished, 10*time.Second)

	second := `{"model":"openai/gpt-4o","stream":true,"idempotency_key":"op-456","messages":[{"role":"user","content":"DIFFERENT"}]}`
	resp2, err := h.postRun(sess, second, nil)
	if err != nil {
		t.Fatalf("reuse: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != 422 {
		t.Fatalf("key reuse with different body must 422, got %d", resp2.StatusCode)
	}
}

// TestNonStreamRun: stream=false returns the OpenAI-compatible completion
// plus run envelope, metered and finalized (ARCHITECTURE §4.1).
func TestNonStreamRun(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()

	body := `{"model":"openai/gpt-4o","stream":false,"messages":[{"role":"user","content":"x"}]}`
	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status: %d body=%s", resp.StatusCode, readAll(t, resp))
	}

	var out struct {
		Run struct {
			ID            string `json:"id"`
			Status        string `json:"status"`
			ResolvedModel string `json:"resolved_model"`
		} `json:"run"`
		Completion struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"completion"`
		Usage domain.TokenUsage `json:"usage"`
	}
	if err := jsonUnmarshal([]byte(readAll(t, resp)), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Run.Status != "completed" {
		t.Errorf("run status: %s", out.Run.Status)
	}
	if len(out.Completion.Choices) != 1 || out.Completion.Choices[0].Message.Content == "" {
		t.Errorf("completion missing: %+v", out.Completion)
	}
	if out.Usage.TotalTokens != 60 {
		t.Errorf("usage: %+v", out.Usage)
	}
	if out.Run.ResolvedModel != "gpt-4o-2024" {
		t.Errorf("resolved model: %s", out.Run.ResolvedModel)
	}

	// Authoritative metering happened exactly once.
	waitFor(t, 3*time.Second, func() bool { return h.usage.count() == 1 })
	if h.usage.count() != 1 {
		t.Fatalf("usage records: %d", h.usage.count())
	}
}

// TestRateLimiting: when the user sliding window is exhausted, run creation
// gets 429 with the canonical error body (spec §38).
func TestRateLimiting(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	body := `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"x"}]}`

	// Exhaust the user window directly in the shared Redis (the limiter's
	// own ZSET semantics, same clock domain: score = unix ms).
	key := "rl:rpm:user:ten_A:usr_1"
	now := float64(time.Now().UnixMilli())
	for i := 0; i < 1000; i++ {
		h.mr.ZAdd(key, now, "m"+itoa(i))
	}

	resp, err := h.postRun(sess, body, nil)
	if err != nil {
		t.Fatalf("postRun: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 429 {
		t.Fatalf("exhausted window must 429, got %d body=%s", resp.StatusCode, readAll(t, resp))
	}
	var bodyJSON struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := jsonUnmarshal([]byte(readAll(t, resp)), &bodyJSON); err != nil || bodyJSON.Error.Code != "RATE_LIMITED" {
		t.Fatalf("429 body must carry RATE_LIMITED: %q", readAll(t, resp))
	}
	if h.bifrost.count() != 0 {
		t.Fatalf("rate-limited request must not reach upstream: %d", h.bifrost.count())
	}
}

// --- helpers ------------------------------------------------------------------

func assertOrder(t *testing.T, types []string, before, after string) {
	t.Helper()
	bi, ai := -1, -1
	for i, s := range types {
		if s == before && bi < 0 {
			bi = i
		}
		if s == after && ai < 0 {
			ai = i
		}
	}
	if bi < 0 || ai < 0 || bi > ai {
		t.Fatalf("ordering violated: %s (%d) vs %s (%d) in %v", before, bi, after, ai, types)
	}
}

func assertLast(t *testing.T, types []string, want string) {
	t.Helper()
	if len(types) == 0 || types[len(types)-1] != want {
		t.Fatalf("last event must be %s, got %v", want, types)
	}
}

func waitFor(t *testing.T, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func decode(data []byte, v any) error { return jsonUnmarshal(data, v) }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
