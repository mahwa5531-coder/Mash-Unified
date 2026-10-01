package bifrost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
)

// domainError keeps the test file readable.
type domainError = domain.Error

// streamBody feeds an SSE body through the StreamReader.
func streamBody(t *testing.T, lines string) *StreamReader {
	t.Helper()
	body := io.NopCloser(strings.NewReader(lines))
	return newStreamReader(context.Background(), body, nil, nil)
}

func chunkLine(t *testing.T, c *ChatChunk) string {
	t.Helper()
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("marshal chunk: %v", err)
	}
	return "data: " + string(b) + "\n\n"
}

func TestStreamParsesChunks(t *testing.T) {
	sr := streamBody(t, "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\n"+
		"data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Revenue\"}}]}\n\n"+
		"data: [DONE]\n\n")

	n := 0
	for {
		c, raw, done, err := sr.Next()
		if err != nil {
			t.Fatalf("Next: %v", err)
		}
		if done {
			break
		}
		n++
		if c == nil || len(raw) == 0 {
			t.Fatalf("chunk %d: missing payload", n)
		}
	}
	if n != 2 {
		t.Fatalf("expected 2 chunks, got %d", n)
	}
	sr.Close()
}

func TestStreamIgnoresComments(t *testing.T) {
	sr := streamBody(t, ": ping\n: keepalive\n\n"+
		"data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"x\"}}]}\n\n"+
		"data: [DONE]\n\n")
	c, _, done, err := sr.Next()
	if err != nil || done || c == nil {
		t.Fatalf("Next: err=%v done=%v c=%v", err, done, c)
	}
	if _, _, done, err := sr.Next(); err != nil || !done {
		t.Fatalf("expected DONE, err=%v done=%v", err, done)
	}
	sr.Close()
}

func TestStreamInBandError(t *testing.T) {
	errChunk := &ChatChunk{
		Type:           "bifrost_error",
		IsBifrostError: true,
		StatusCode:     500,
		Error:          &ErrorField{Type: "provider_error", Code: "rate_limited", Message: "upstream busy"},
	}
	sr := streamBody(t, chunkLine(t, errChunk))
	_, _, _, err := sr.Next()
	if err == nil {
		t.Fatal("in-band error must surface")
	}
	var de interface{ Error() string }
	if !errors.As(err, &de) {
		t.Fatalf("error must be domain.Error, got %T", err)
	}
	// The domain error must carry the sanitized upstream code.
	msg := err.Error()
	if !strings.Contains(msg, "UPSTREAM") {
		t.Fatalf("error code must be upstream-classified: %s", msg)
	}
	sr.Close()
}

func TestStreamMalformedChunk(t *testing.T) {
	sr := streamBody(t, "data: {not json}\n\n")
	if _, _, _, err := sr.Next(); err == nil {
		t.Fatal("malformed chunk must error")
	}
	sr.Close()
}

func TestStreamUnexpectedEOF(t *testing.T) {
	sr := streamBody(t, "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"x\"}}]}\n\n")
	// EOF without [DONE]: protocol termination.
	sr.Next()
	if _, _, _, err := sr.Next(); err == nil {
		t.Fatal("EOF without DONE must error")
	}
	sr.Close()
}

func TestStreamIdleWatchdogFires(t *testing.T) {
	// A body that never sends data: the idle watchdog (300ms here) cancels.
	ctx := WithIdleTimeout(context.Background(), 250*time.Millisecond)
	body := io.NopCloser(strings.NewReader(""))
	sr := newStreamReader(ctx, body, nil, nil)
	start := time.Now()
	_, _, _, err := sr.Next()
	if err == nil {
		t.Fatal("idle stream must abort")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("watchdog too slow: %v", time.Since(start))
	}
	sr.Close()
}

func TestStreamCloseIsIdempotent(t *testing.T) {
	sr := streamBody(t, "data: [DONE]\n\n")
	if err := sr.Close(); err != nil {
		t.Fatalf("first close: %v", err)
	}
	_ = sr.Close() // must not panic
}

func TestStreamSSEFieldSplit(t *testing.T) {
	cases := []struct {
		line  string
		field string
		value string
	}{
		{"data: x", "data", "x"},
		{"data:x", "data", "x"},
		{"event: foo", "event", "foo"},
		{"id: 42\r", "id", "42"},
	}
	for _, c := range cases {
		f, v, ok := splitSSELine([]byte(c.line))
		if !ok || string(f) != c.field || string(v) != c.value {
			t.Errorf("splitSSELine(%q) = (%q,%q,%v), want (%q,%q)", c.line, f, v, ok, c.field, c.value)
		}
	}
}

func TestChunkErrorDetection(t *testing.T) {
	cases := []struct {
		name  string
		chunk ChatChunk
		want  bool
	}{
		{"plain", ChatChunk{ID: "1"}, false},
		{"flagged", ChatChunk{IsBifrostError: true}, true},
		{"error-field", ChatChunk{Error: &ErrorField{Message: "x"}}, true},
		{"empty-error-field", ChatChunk{Error: &ErrorField{}}, false},
	}
	for _, c := range cases {
		if got := c.chunk.IsError(); got != c.want {
			t.Errorf("%s: IsError=%v want %v", c.name, got, c.want)
		}
	}
}

// --- error normalization ----------------------------------------------------

func TestBifrostErrorNormalization(t *testing.T) {
	be := &ErrorResponse{
		EventID:        "evt_1",
		Type:           "bifrost_error",
		IsBifrostError: true,
		StatusCode:     500,
		Error:          ErrorField{Type: "provider", Code: "rate limit exceeded", Message: "slow down"},
		ExtraFields:    &ErrorExtraFields{Provider: "openai", ModelRequested: "openai/gpt-4o"},
	}
	err := be.toDomain(500)
	de, ok := err.(*domainError)
	if !ok {
		t.Fatalf("must be domain error, got %T", err)
	}
	if de.Code != "UPSTREAM_RATE_LIMIT_EXCEEDED" {
		t.Fatalf("code: %q", de.Code)
	}
	if de.HTTP != http.StatusBadGateway {
		t.Fatalf("status: %d", de.HTTP)
	}
	if de.Details["provider"] != "openai" {
		t.Fatalf("provider detail missing")
	}
	if de.Details["retryable"] != true {
		t.Fatalf("500 must be retryable")
	}
	// Client message must not leak provider text.
	if strings.Contains(de.Message, "slow down") {
		t.Fatal("provider message must not reach the client payload")
	}
}

func TestSafeStatusMapping(t *testing.T) {
	cases := []struct {
		in, want int
	}{
		{401, http.StatusBadGateway}, // upstream creds are OUR problem
		{403, http.StatusBadGateway},
		{429, http.StatusTooManyRequests},
		{500, http.StatusBadGateway},
		{200, http.StatusBadGateway},
	}
	for _, c := range cases {
		if got := safeStatus(c.in); got != c.want {
			t.Errorf("safeStatus(%d)=%d want %d", c.in, got, c.want)
		}
	}
}

func TestClassifyTransportError(t *testing.T) {
	if classifyTransportError(context.Canceled) == nil {
		t.Fatal("canceled must classify")
	}
	if classifyTransportError(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}

// --- client retry policy against a mock Bifrost -----------------------------

func TestClientRetriesPreFirstByte(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := attempts.Add(1)
		if n < 3 {
			// 503 twice, then success: retryable pre-first-byte failures.
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"message":"upstream down"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"1","object":"chat.completion","created":1,"model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer srv.Close()

	c := NewClient(TransportConfig{
		BaseURL: srv.URL, MaxRetries: 3,
		RetryMinBackoff: time.Millisecond, RetryMaxBackoff: 5 * time.Millisecond,
	}, nil)
	resp, err := c.Completion(context.Background(), &ChatRequest{Model: "openai/gpt-4o"})
	if err != nil {
		t.Fatalf("Completion after retries: %v", err)
	}
	if resp.ID != "1" {
		t.Fatalf("bad response: %+v", resp)
	}
	if n := attempts.Load(); n != 3 {
		t.Fatalf("expected 3 attempts, got %d", n)
	}
}

func TestClientNoRetryOn4xx(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"type":"bifrost_error","is_bifrost_error":true,"status_code":400,"error":{"type":"invalid_request","message":"bad param"}}`))
	}))
	defer srv.Close()

	c := NewClient(TransportConfig{BaseURL: srv.URL, MaxRetries: 3, RetryMinBackoff: time.Millisecond}, nil)
	_, err := c.Completion(context.Background(), &ChatRequest{Model: "openai/gpt-4o"})
	if err == nil {
		t.Fatal("400 must fail")
	}
	if n := attempts.Load(); n != 1 {
		t.Fatalf("4xx must not retry, attempts=%d", n)
	}
}

func TestClientStreamCancellation(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		flusher.Flush()
		// Hold the stream open until the client cancels.
		<-r.Context().Done()
		close(release)
	}))
	defer srv.Close()

	c := NewClient(TransportConfig{BaseURL: srv.URL}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	sr, err := c.CompletionStream(ctx, &ChatRequest{Model: "openai/gpt-4o", Stream: true})
	if err != nil {
		t.Fatalf("stream open: %v", err)
	}
	<-started
	cancel()
	// The reader must observe cancellation promptly (Next errors out).
	errCh := make(chan error, 1)
	go func() {
		_, _, _, err := sr.Next()
		errCh <- err
	}()
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("cancellation must terminate the stream read")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("stream read did not observe cancellation")
	}
	select {
	case <-release:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream did not observe cancellation")
	}
	sr.Close()
}

func TestClientStreamChunksIncrementally(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		for i := 0; i < 3; i++ {
			fmt.Fprintf(w, "data: {\"id\":\"1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"c%d\"}}]}\n\n", i)
			flusher.Flush()
			time.Sleep(20 * time.Millisecond)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	c := NewClient(TransportConfig{BaseURL: srv.URL}, nil)
	sr, err := c.CompletionStream(context.Background(), &ChatRequest{Model: "openai/gpt-4o", Stream: true})
	if err != nil {
		t.Fatalf("stream open: %v", err)
	}
	defer sr.Close()

	var got []string
	for {
		chunk, _, done, err := sr.Next()
		if err != nil {
			t.Fatalf("Next: %v", err)
		}
		if done {
			break
		}
		if len(chunk.Choices) > 0 {
			got = append(got, chunk.Choices[0].Delta.Content)
		}
	}
	if strings.Join(got, "") != "c0c1c2" {
		t.Fatalf("chunks: %v", got)
	}
}

// TestClientPropagatesCorrelationHeaders pins the reader half of upstream
// correlation: x-request-id and x-nexau-run-id must arrive on every Bifrost
// request when the context carries them. (The run-id writer half lived
// un-wired in agent.Service until the 2026-09-23 cleanup — the header was
// always empty in production; see agent.TestCreateRunAttachesRunIDToProducerContext
// for the wiring half.)
func TestClientPropagatesCorrelationHeaders(t *testing.T) {
	var gotReqID, gotRunID string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotReqID = r.Header.Get("x-request-id")
		gotRunID = r.Header.Get("x-nexau-run-id")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"1","object":"chat.completion","created":1,"model":"openai/gpt-4o","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"hi"}}]}`))
	}))
	defer srv.Close()

	c := NewClient(TransportConfig{BaseURL: srv.URL}, nil)
	ctx := reqctx.WithRequestID(context.Background(), "req_corr_1")
	ctx = reqctx.WithRunID(ctx, "run_corr_1")
	if _, err := c.Completion(ctx, &ChatRequest{Model: "openai/gpt-4o"}); err != nil {
		t.Fatalf("Completion: %v", err)
	}
	if gotReqID != "req_corr_1" {
		t.Fatalf("x-request-id = %q, want req_corr_1", gotReqID)
	}
	if gotRunID != "run_corr_1" {
		t.Fatalf("x-nexau-run-id = %q, want run_corr_1", gotRunID)
	}
}
