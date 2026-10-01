// Spec §44 (Upstream Circuit Breaker) — production-grade fast-fail semantics.
//
// When the Bifrost gateway is failing, the API must (a) keep serving every
// non-LLM surface (auth, sessions, replay, health), (b) reject new LLM work
// INSTANTLY with a stable UPSTREAM_CIRCUIT_OPEN error carrying a retry hint,
// and (c) recover automatically: after the cooldown, a probe run flows again
// and the circuit closes. The breaker state is visible on /health/ready.
//
// The harness default is an inert-but-enabled breaker (thresholds far above
// fault-injection volumes) so sections §1–§43 keep their documented outcomes;
// this section builds stacks with production-shaped, tight thresholds.
package validation

import (
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// cbOpts returns stackOpts with a tight, production-shaped circuit breaker.
func cbOpts() stackOpts {
	o := defaultOpts()
	o.cbEnabled = true
	o.cbConsecutive = 3 // trip after three consecutive gateway faults
	o.cbWindow = 16
	o.cbMinSamples = 6
	o.cbRate = 0.75
	o.cbOpenBase = 600 * time.Millisecond // short for test wall-clock
	o.cbOpenMax = 5 * time.Second
	o.cbProbes = 1
	return o
}

func runErrCode(t *testing.T, resp *http.Response) (code string, msg string) {
	t.Helper()
	events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	for _, e := range events {
		if e.env.Type == streaming.EventRunError {
			var d streaming.RunErrorData
			_ = jsonUnmarshal(e.env.Data, &d)
			return d.Code, d.Message
		}
	}
	return "", ""
}

// TestV44_UpstreamOutageFastFailAndRecover: 503 storm → trip → fast-fail with
// zero upstream traffic → cooldown → probe recovers → circuit closed.
func TestV44_UpstreamOutageFastFailAndRecover(t *testing.T) {
	o := cbOpts()
	s := newStack(t, o)
	s.bifrost.setMode(bifrostHTTPStatus, http.StatusServiceUnavailable,
		bifrostErrBody(503, "503", "upstream down"), 0)

	sess := s.sessionFor("cb1", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Three failing runs trip the breaker (threshold 3, one attempt each).
	// A well-formed 503 BifrostError body classifies as UPSTREAM_503; the exact
	// pre-trip code is not this section's subject — only that it is NOT the
	// circuit code.
	for i := 0; i < 3; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		code, _ := runErrCode(t, resp)
		if code == "UPSTREAM_CIRCUIT_OPEN" || code == "" {
			t.Fatalf("run %d: code %q — pre-trip failures must surface as upstream errors, not circuit rejections", i, code)
		}
	}
	hits := s.bifrost.count()
	if hits != 3 {
		t.Fatalf("upstream hits = %d, want 3", hits)
	}

	// Fourth run: INSTANT UPSTREAM_CIRCUIT_OPEN, zero upstream traffic.
	start := time.Now()
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("fast-failed run: %v", err)
	}
	code, msg := runErrCode(t, resp)
	elapsed := time.Since(start)
	if code != "UPSTREAM_CIRCUIT_OPEN" {
		t.Fatalf("code %q (msg %q), want UPSTREAM_CIRCUIT_OPEN", code, msg)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("fast-fail took %v — breaker must reject before any upstream work", elapsed)
	}
	if after := s.bifrost.count(); after != hits {
		t.Fatalf("upstream hits grew %d → %d while the circuit was open", hits, after)
	}
	for _, banned := range []string{"bifrost", "127.0.0.1", "goroutine", "sk-"} {
		if containsStr(msg, banned) {
			t.Fatalf("fast-fail message leaks internals: %q", msg)
		}
	}

	// Non-LLM surfaces keep serving while the circuit is open.
	if resp, err := s.get(0, tok, "/v1/agent/sessions/"+sess); err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("session GET during outage: %v %v — circuit must be scoped to the LLM path", err, respStatus(resp))
	}
	hl, err := http.Get(s.replica(0).base() + "/health/live")
	if err != nil || hl.StatusCode != http.StatusOK {
		t.Fatalf("liveness during outage: %v %v", err, respStatus(hl))
	}
	hl.Body.Close()

	hr, err := http.Get(s.replica(0).base() + "/health/ready")
	if err != nil || hr.StatusCode != http.StatusOK {
		t.Fatalf("readiness during outage: %v %v — LLM-path degradation must not gate readiness", err, respStatus(hr))
	}
	hr.Body.Close()

	// Recovery: gateway healthy again, cooldown elapses, probe run flows.
	s.bifrost.setScript(standardScript()...)
	s.bifrost.setMode(bifrostScript, 0, "", 0)
	time.Sleep(o.cbOpenBase + 300*time.Millisecond)

	resp, err = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "recover", true), nil)
	if err != nil {
		t.Fatalf("recovery run: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if len(events) == 0 {
		t.Fatal("recovery run produced no events")
	}
	sawFinished := false
	for _, e := range events {
		if e.env.Type == streaming.EventRunFinished {
			sawFinished = true
		}
		if e.env.Type == streaming.EventRunError {
			t.Fatalf("recovery run errored: %s", e.env.Data)
		}
	}
	if !sawFinished {
		t.Fatal("recovery run did not finish")
	}

	// The circuit closed: further runs flow normally.
	resp, err = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "again", true), nil)
	if err != nil {
		t.Fatalf("post-recovery run: %v", err)
	}
	events = readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	for _, e := range events {
		if e.env.Type == streaming.EventRunError {
			t.Fatalf("post-recovery run errored: %s", e.env.Data)
		}
	}
	if n := len(events); n < 4 {
		t.Fatalf("post-recovery run events = %d, want a full lifecycle", n)
	}
}

// TestV44_CircuitStateOnReadiness: the breaker state rides /health/ready as
// an informational field (open during outage, closed after recovery).
func TestV44_CircuitStateOnReadiness(t *testing.T) {
	o := cbOpts()
	s := newStack(t, o)
	s.bifrost.setMode(bifrostHTTPStatus, http.StatusBadGateway,
		bifrostErrBody(502, "502", "dead"), 0)

	sess := s.sessionFor("cb2", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	fetchCircuit := func() (string, int) {
		resp, err := http.Get(s.replica(0).base() + "/health/ready")
		if err != nil {
			t.Fatalf("readiness: %v", err)
		}
		defer resp.Body.Close()
		var body struct {
			Status         string `json:"status"`
			BifrostCircuit string `json:"bifrost_circuit"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		_ = jsonUnmarshal(raw, &body)
		return body.BifrostCircuit, resp.StatusCode
	}

	if st, code := fetchCircuit(); st != "closed" || code != http.StatusOK {
		t.Fatalf("pre-outage circuit = %q (status %d)", st, code)
	}

	for i := 0; i < o.cbConsecutive; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	}
	if st, code := fetchCircuit(); st != "open" || code != http.StatusOK {
		t.Fatalf("during outage circuit = %q (status %d), want open/200", st, code)
	}

	// Recover and confirm the state machine returns to closed.
	s.bifrost.setScript(standardScript()...)
	s.bifrost.setMode(bifrostScript, 0, "", 0)
	time.Sleep(o.cbOpenBase + 300*time.Millisecond)
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "r", true), nil)
	if err != nil {
		t.Fatalf("probe run: %v", err)
	}
	readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if st, code := fetchCircuit(); st != "closed" || code != http.StatusOK {
		t.Fatalf("post-recovery circuit = %q (status %d), want closed/200", st, code)
	}
}

// TestV44_HalfOpenRecoveryOverWebSocket: the same protection and recovery on
// the WS transport — a WS run.create is the probe that closes the circuit.
func TestV44_HalfOpenRecoveryOverWebSocket(t *testing.T) {
	o := cbOpts()
	s := newStack(t, o)
	s.bifrost.setScript(standardScript()...)
	s.bifrost.setMode(bifrostHTTPStatus, http.StatusServiceUnavailable,
		bifrostErrBody(503, "503", "down"), 0)

	sess := s.sessionFor("cb3", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Trip over the SSE path.
	for i := 0; i < o.cbConsecutive; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	}

	// Gateway recovers; cooldown elapses.
	s.bifrost.setScript(standardScript()...)
	s.bifrost.setMode(bifrostScript, 0, "", 0)
	time.Sleep(o.cbOpenBase + 300*time.Millisecond)

	// A WS run.create is admitted as the probe and completes.
	conn, _, err := dialWS(t, s.replica(0).base(), tok, sess)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	defer conn.Close()

	create := map[string]any{
		"type": "run.create",
		"request": map[string]any{
			"model":    "openai/gpt-4o",
			"messages": []map[string]any{{"role": "user", "content": "probe"}},
		},
	}
	if err := conn.WriteJSON(create); err != nil {
		t.Fatalf("run.create: %v", err)
	}
	events, _ := wsRead(t, conn, streaming.EventRunFinished, 15*time.Second)
	sawFinished := false
	for _, e := range events {
		if e.Type == streaming.EventRunFinished {
			sawFinished = true
		}
		if e.Type == streaming.EventRunError {
			t.Fatalf("WS probe run errored: %s", e.Data)
		}
	}
	if !sawFinished {
		t.Fatalf("WS probe run did not finish (%d events)", len(events))
	}

	// Circuit closed: an SSE run flows again without fast-fail.
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "post", true), nil)
	if err != nil {
		t.Fatalf("post-recovery SSE run: %v", err)
	}
	events2 := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	for _, e := range events2 {
		if e.env.Type == streaming.EventRunError {
			t.Fatalf("post-recovery SSE run errored: %s", e.env.Data)
		}
	}
}

// TestV44_OpenCircuitRejectsCompatChat: the OpenAI-compatible surface gets the
// same fast-fail treatment (both entry paths to the upstream are guarded).
func TestV44_OpenCircuitRejectsCompatChat(t *testing.T) {
	o := cbOpts()
	s := newStack(t, o)
	s.bifrost.setMode(bifrostHTTPStatus, http.StatusBadGateway,
		bifrostErrBody(502, "502", "dead"), 0)

	sess := s.sessionFor("cb4", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Trip through the agent-run path.
	for i := 0; i < o.cbConsecutive; i++ {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
		readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	}

	// The compat surface fast-fails with the circuit error.
	body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}],"stream":false}`
	resp, err := s.chat(0, tok, body, nil)
	if err != nil {
		t.Fatalf("compat chat: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("compat status = %d, want 503", resp.StatusCode)
	}
	var parsed struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				RetryAfterMs int64  `json:"retry_after_ms"`
				Retryable    bool   `json:"retryable"`
				Circuit      string `json:"circuit"`
			} `json:"details"`
		} `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = jsonUnmarshal(raw, &parsed)
	if parsed.Error.Code != "UPSTREAM_CIRCUIT_OPEN" {
		t.Fatalf("compat code = %q, want UPSTREAM_CIRCUIT_OPEN", parsed.Error.Code)
	}
	if !parsed.Error.Details.Retryable || parsed.Error.Details.RetryAfterMs <= 0 {
		t.Fatalf("retry hint missing: %+v", parsed.Error.Details)
	}
	if parsed.Error.Details.Circuit != "open" {
		t.Fatalf("circuit detail = %q", parsed.Error.Details.Circuit)
	}
	if after := s.bifrost.count(); after != o.cbConsecutive {
		t.Fatalf("upstream hits = %d, want %d (fast-fail must not reach Bifrost)", after, o.cbConsecutive)
	}
}

// --- helpers -----------------------------------------------------------------

func respStatus(r *http.Response) int {
	if r == nil {
		return 0
	}
	return r.StatusCode
}

func containsStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
