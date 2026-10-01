// Spec §10 (Bifrost Disconnect), §13 (Provider Error Test).
//
// Every upstream failure must surface as a STABLE NexaU error carrying
// request correlation, with no leaked internals (credentials, URLs, provider
// details, stack traces), and correct retry semantics.
package validation

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV10_BifrostDisconnectMidStream: upstream TCP drop mid-stream →
// stable RUN_ERROR, run failed, no internal leakage.
func TestV10_BifrostDisconnectMidStream(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"partial"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: dropConn, delay: 80 * time.Millisecond},
	)
	sess := s.sessionFor("drop", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)

	var code, msg string
	var runID string
	for _, e := range events {
		if e.env.Type == streaming.EventRunError {
			var d streaming.RunErrorData
			_ = jsonUnmarshal(e.env.Data, &d)
			code, msg = d.Code, d.Message
			runID = e.env.RunID
		}
	}
	if code == "" {
		t.Fatalf("no RUN_ERROR after upstream drop (events=%d)", len(events))
	}
	if code != "UPSTREAM_PROTOCOL" && code != "UPSTREAM_UNAVAILABLE" {
		t.Fatalf("unexpected stable code %q", code)
	}

	// Leakage checks: the client-visible failure must not mention provider
	// internals, credentials, hosts, or stack traces.
	for _, banned := range []string{"sk-live", "org_7731", "127.0.0.1", "bifrost", "goroutine", "http.", "provider"} {
		if strings.Contains(msg, banned) {
			t.Fatalf("error message leaks internal %q: %s", banned, msg)
		}
	}

	// Run row records the failure with the request correlation (the terminal
	// event is emitted before the row write lands; poll for the final state).
	if !waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatalf("run row never reached a terminal state after upstream drop: %+v", s.runs.get(runID))
	}
	r := s.runs.get(runID)
	if r.Status != "failed" {
		t.Fatalf("run row after upstream drop: %+v", r)
	}
	if r.RequestID == "" {
		t.Fatal("run row missing request_id (spec §29: failures must record it)")
	}
	if strings.Contains(r.ErrorMessage, "sk-live") || strings.Contains(r.ErrorMessage, "127.0.0.1") {
		t.Fatalf("run row error message leaks internals: %s", r.ErrorMessage)
	}
}

// TestV13_ProviderStatusMatrix: every provider error status maps into the
// stable NexaU error model with the documented safe HTTP mapping, on BOTH
// client surfaces:
//   - agent runs surface (stream=false): HTTP 200 + run envelope with
//     status=failed and the stable error_code (the run is the outcome unit)
//   - OpenAI-compatible surface: proper HTTP error + domain error body
func TestV13_ProviderStatusMatrix(t *testing.T) {
	cases := []struct {
		upstream int
		wantHTTP int
		wantCode string
	}{
		{401, http.StatusBadGateway, "UPSTREAM_401"},
		{403, http.StatusBadGateway, "UPSTREAM_403"},
		{404, http.StatusNotFound, "UPSTREAM_404"},
		{408, http.StatusBadGateway, "UPSTREAM_408"},
		{409, http.StatusBadGateway, "UPSTREAM_409"},
		{429, http.StatusTooManyRequests, "UPSTREAM_429"},
		{500, http.StatusBadGateway, "UPSTREAM_500"},
		{502, http.StatusBadGateway, "UPSTREAM_502"},
		{503, http.StatusBadGateway, "UPSTREAM_503"},
		{504, http.StatusBadGateway, "UPSTREAM_504"},
	}

	for _, tc := range cases {
		t.Run(http.StatusText(tc.upstream), func(t *testing.T) {
			s := newStackDefault(t)
			s.bifrost.setMode(bifrostHTTPStatus, tc.upstream, bifrostErrBody(tc.upstream, fmt.Sprintf("%d", tc.upstream), "provider quota exceeded for key sk-live-9f3a org_7731"), 0)
			sess := s.sessionFor("prov", "ten_A", "usr_1")
			tok := s.tokenFor("usr_1", "ten_A")

			// Surface 1 — OpenAI-compatible (chat/completions, non-stream):
			// must surface the mapped HTTP error.
			resp, err := s.chat(0, tok, runBody("openai/gpt-4o", "x", false), nil)
			if err != nil {
				t.Fatalf("chat: %v", err)
			}
			eb := decodeErr(t, resp)
			if resp.StatusCode != tc.wantHTTP {
				t.Fatalf("compat upstream %d: HTTP=%d want=%d (code %s)", tc.upstream, resp.StatusCode, tc.wantHTTP, eb.Error.Code)
			}
			if eb.Error.Code != tc.wantCode {
				t.Fatalf("compat upstream %d: code=%s want=%s", tc.upstream, eb.Error.Code, tc.wantCode)
			}
			if eb.Error.RequestID == "" {
				t.Fatalf("upstream %d: missing request_id in error body", tc.upstream)
			}
			for _, banned := range []string{"sk-live", "org_7731", "quota exceeded for key"} {
				if strings.Contains(eb.Error.Message, banned) {
					t.Fatalf("upstream %d leaked provider detail: %s", tc.upstream, eb.Error.Message)
				}
			}

			// Surface 2 — agent runs (stream=false): 200 + failed run view with
			// the stable code.
			resp, err = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", false), nil)
			if err != nil {
				t.Fatalf("post: %v", err)
			}
			body := readAllBody(t, resp)
			var run struct {
				Run struct {
					Status    string `json:"status"`
					ErrorCode string `json:"error_code"`
				} `json:"run"`
			}
			if err := jsonUnmarshal([]byte(body), &run); err != nil {
				t.Fatalf("runs response not JSON: %s", body)
			}
			if run.Run.Status != "failed" || run.Run.ErrorCode != tc.wantCode {
				t.Fatalf("runs upstream %d: run=%+v, want failed/%s", tc.upstream, run.Run, tc.wantCode)
			}
		})
	}
}

// TestV13_RetrySemantics: retryable upstream failures are retried
// pre-first-byte (with a fresh attempt each); non-retryable ones are not.
func TestV13_RetrySemantics(t *testing.T) {
	t.Run("503 retried up to MaxRetries then surfaces", func(t *testing.T) {
		o := defaultOpts()
		o.maxRetries = 2
		o.retryMin = 10 * time.Millisecond
		s := newStack(t, o)
		s.bifrost.setMode(bifrostHTTPStatus, 503, bifrostErrBody(503, "503", "gateway overloaded"), 0)
		sess := s.sessionFor("retry", "ten_A", "usr_1")

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", false), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		body := readAllBody(t, resp)
		var run struct {
			Run struct {
				Status    string `json:"status"`
				ErrorCode string `json:"error_code"`
			} `json:"run"`
		}
		if err := jsonUnmarshal([]byte(body), &run); err != nil {
			t.Fatalf("body not JSON: %s", body)
		}
		if run.Run.Status != "failed" || run.Run.ErrorCode != "UPSTREAM_503" {
			t.Fatalf("503-after-retries: %+v (body %s)", run.Run, body)
		}
		if got := s.bifrost.count(); got != 3 {
			t.Fatalf("attempts=%d, want 3 (1 + 2 retries)", got)
		}
		vm(t, "retry_attempts_503", s.bifrost.count())
	})

	t.Run("401 never retried", func(t *testing.T) {
		o := defaultOpts()
		o.maxRetries = 2
		s := newStack(t, o)
		s.bifrost.setMode(bifrostHTTPStatus, 401, bifrostErrBody(401, "401", "invalid service credential"), 0)
		sess := s.sessionFor("retry", "ten_A", "usr_1")

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", false), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		body := readAllBody(t, resp)
		var run struct {
			Run struct {
				Status    string `json:"status"`
				ErrorCode string `json:"error_code"`
			} `json:"run"`
		}
		if err := jsonUnmarshal([]byte(body), &run); err != nil {
			t.Fatalf("body not JSON: %s", body)
		}
		if run.Run.ErrorCode != "UPSTREAM_401" {
			t.Fatalf("401: %+v (body %s)", run.Run, body)
		}
		if got := s.bifrost.count(); got != 1 {
			t.Fatalf("401 attempts=%d, want exactly 1 (never retry auth failures)", got)
		}
	})

	t.Run("successful retry after transient 503", func(t *testing.T) {
		o := defaultOpts()
		o.maxRetries = 2
		o.retryMin = 10 * time.Millisecond
		s := newStack(t, o)
		// First upstream call: 503. Second: success.
		s.bifrost.setScriptFn(func(n int) []chunk {
			if n == 1 {
				return nil // consumed by mode
			}
			return nil
		})
		// Use a stateful mock: fail the first request only.
		s.bifrost.setMode(bifrostHTTPStatus, 503, bifrostErrBody(503, "503", "overloaded"), 0)
		// After the first request lands, switch to normal script.
		go func() {
			for i := 0; i < 50; i++ {
				if s.bifrost.count() >= 1 {
					s.bifrost.setMode(bifrostScript, 0, "", 0)
					s.bifrost.setScript(
						chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"recovered"}}]}`, delay: 10 * time.Millisecond},
						chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}`, delay: 10 * time.Millisecond},
						chunk{data: `[DONE]`, delay: 0},
					)
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
		}()
		sess := s.sessionFor("retryok", "ten_A", "usr_1")
		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
		if len(events) == 0 || events[len(events)-1].env.Type != streaming.EventRunFinished {
			t.Fatalf("recovered run did not complete: %v", lastType(events))
		}
	})
}

// TestV13_MalformedAndInBandErrors: protocol-level upstream faults.
func TestV13_MalformedAndInBandErrors(t *testing.T) {
	t.Run("malformed SSE chunk", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setMode(bifrostMalformed, 0, "", 0)
		sess := s.sessionFor("mal", "ten_A", "usr_1")

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
		var code string
		for _, e := range events {
			if e.env.Type == streaming.EventRunError {
				var d streaming.RunErrorData
				_ = jsonUnmarshal(e.env.Data, &d)
				code = d.Code
			}
		}
		if code != "UPSTREAM_PROTOCOL" {
			t.Fatalf("malformed chunk: code=%s, want UPSTREAM_PROTOCOL", code)
		}
	})

	t.Run("in-band BifrostError on a 200 stream", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setMode(bifrostInBandErr, 0, "", 0)
		sess := s.sessionFor("inband", "ten_A", "usr_1")

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
		var code, msg string
		for _, e := range events {
			if e.env.Type == streaming.EventRunError {
				var d streaming.RunErrorData
				_ = jsonUnmarshal(e.env.Data, &d)
				code, msg = d.Code, d.Message
			}
		}
		if code != "UPSTREAM_500" && code != "UPSTREAM_PROVIDER_ERROR" {
			t.Fatalf("in-band error: code=%s, want UPSTREAM_*", code)
		}
		for _, banned := range []string{"sk-live", "org_7731"} {
			if strings.Contains(msg, banned) {
				t.Fatalf("in-band error leaked credentials: %s", msg)
			}
		}
	})

	t.Run("error status with garbage body (unparseable)", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setMode(bifrostGarbageBody, 502, "<html>gateway exploded", 0)
		sess := s.sessionFor("garb", "ten_A", "usr_1")

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", false), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		body := readAllBody(t, resp)
		var run struct {
			Run struct {
				Status    string `json:"status"`
				ErrorCode string `json:"error_code"`
			} `json:"run"`
		}
		if err := jsonUnmarshal([]byte(body), &run); err != nil {
			t.Fatalf("body not JSON: %s", body)
		}
		if run.Run.ErrorCode != "UPSTREAM_UNAVAILABLE" {
			t.Fatalf("garbage 502: %+v (status-only mapping expected)", run.Run)
		}
	})
}

// TestV13_CompatStreamUpstreamFailure guards audit finding 8: the
// OpenAI-compatible STREAMING surface must never answer an upstream failure
// with HTTP 200 followed by a bare [DONE] — standard OpenAI SDKs parse that
// as a successful, empty completion and surface no error at all.
func TestV13_CompatStreamUpstreamFailure(t *testing.T) {
	t.Run("pre-stream failure -> real HTTP error (no 200)", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setMode(bifrostHTTPStatus, 503, bifrostErrBody(503, "503", "gateway overloaded"), 0)
		tok := s.tokenFor("usr_1", "ten_A")

		resp, err := s.chat(0, tok, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("chat: %v", err)
		}
		if resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			t.Fatal("pre-stream upstream failure answered HTTP 200 — OpenAI SDKs would see an empty success")
		}
		eb := decodeErr(t, resp)
		if eb.Error.Code != "UPSTREAM_503" {
			t.Fatalf("code=%s, want UPSTREAM_503", eb.Error.Code)
		}
		if eb.Error.RequestID == "" {
			t.Fatal("missing request_id in the streamed-failure error body")
		}
	})

	t.Run("mid-stream drop -> in-band error event before [DONE]", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setScript(
			chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"partial"}}]}`, delay: 10 * time.Millisecond},
			chunk{data: dropConn, delay: 30 * time.Millisecond},
		)
		tok := s.tokenFor("usr_1", "ten_A")

		resp, err := s.chat(0, tok, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("chat: %v", err)
		}
		lines := readRawSSE(t, resp, 15*time.Second)
		if len(lines) == 0 {
			t.Fatal("no SSE frames received")
		}

		sawInBandError, sawDone := false, false
		for _, l := range lines {
			if l == "[DONE]" {
				sawDone = true
				continue
			}
			if strings.Contains(l, `"error"`) && strings.Contains(l, `"message"`) {
				sawInBandError = true
			}
		}
		if !sawInBandError {
			t.Fatalf("mid-stream upstream failure produced NO in-band error event: %q", lines)
		}
		if !sawDone {
			t.Fatalf("stream did not terminate with [DONE]: %q", lines)
		}
	})
}
