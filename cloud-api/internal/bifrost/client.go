// Package bifrost is the dedicated integration layer for the Bifrost LLM
// gateway. It speaks Bifrost's OpenAI-compatible chat-completions surface
// (verified against maximhq/bifrost OpenAPI):
//
//	POST {base}/v1/chat/completions      model = "provider/model"
//	Authorization: Bearer {api key}      (cloud-side credential only)
//	SSE stream: "data: {...}" … "data: [DONE]"
//	Bifrost standardization: finish_reason + usage arrive in the LAST chunk.
//
// One shared http.Client per process; connection reuse, HTTP/2, bounded pools.
// Cancellation propagates via context.Context. Errors are normalized into the
// domain model with retryability classification.
package bifrost

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/reqctx"
)

// Client is safe for concurrent use by multiple goroutines.
type Client struct {
	cfg     TransportConfig
	http    *http.Client
	metrics *observability.Metrics
	cb      *circuitBreaker
}

// TransportConfig carries the tuned, deployment-specific transport settings.
type TransportConfig struct {
	BaseURL             string
	APIKey              string
	DialTimeout         time.Duration
	TLSTimeout          time.Duration
	ResponseHeaderTO    time.Duration
	IdleConnTimeout     time.Duration
	MaxIdleConns        int
	MaxIdleConnsPerHost int
	MaxConnsPerHost     int
	DisableHTTP2        bool
	MaxRetries          int
	RetryMinBackoff     time.Duration
	RetryMaxBackoff     time.Duration

	// CircuitBreaker protects the upstream path. Zero value = disabled;
	// production defaults come from config.Load.
	CircuitBreaker CircuitBreakerConfig
}

// NewClient builds the shared transport. Never create one per request.
func NewClient(cfg TransportConfig, metrics *observability.Metrics) *Client {
	dialer := &netDialer{Timeout: cfg.DialTimeout, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           dialer.DialContext,
		MaxIdleConns:          cfg.MaxIdleConns,
		MaxIdleConnsPerHost:   cfg.MaxIdleConnsPerHost,
		MaxConnsPerHost:       cfg.MaxConnsPerHost,
		IdleConnTimeout:       cfg.IdleConnTimeout,
		TLSHandshakeTimeout:   cfg.TLSTimeout,
		ResponseHeaderTimeout: cfg.ResponseHeaderTO,
		ForceAttemptHTTP2:     !cfg.DisableHTTP2,
		// Streams: responses must not be buffer-limited by transport.
		WriteBufferSize: 32 << 10,
		ReadBufferSize:  32 << 10,
	}
	return &Client{
		cfg:     cfg,
		http:    &http.Client{Transport: transport},
		metrics: metrics,
		cb:      newCircuitBreaker(cfg.CircuitBreaker, metrics),
	}
}

// Completion sends a non-streaming chat completion.
func (c *Client) Completion(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	if err := c.gate(); err != nil {
		return nil, err
	}
	body, err := req.MarshalJSON()
	if err != nil {
		return nil, domain.ErrValidation("cannot encode request")
	}

	var out *ChatResponse
	err = c.withRetry(ctx, req, false, func(ctx context.Context) (firstByteSeen bool, err error) {
		resp, err := c.post(ctx, body, false)
		if err != nil {
			// Caller-side aborts (client cancel / budget deadline) are
			// not gateway faults: the caller's context is done.
			if ctx.Err() == nil {
				c.cb.recordFailure()
			}
			return false, err
		}
		defer drainClose(resp.Body)
		if !statusOK(resp.StatusCode) {
			c.cb.recordStatus(resp.StatusCode)
			bErr, _ := readErrorBody(resp.Body, resp.StatusCode, parseRetryAfter(resp.Header.Get("Retry-After")))
			// Error statuses forward nothing to the client (we translate them
			// into our own error model), so no downstream byte exists yet:
			// retryability is decided purely by the error classification.
			return false, bErr
		}
		c.cb.recordSuccess() // 2xx headers: gateway is alive
		dec := json.NewDecoder(io.LimitReader(resp.Body, maxNonStreamBody))
		cr := &ChatResponse{}
		if err := dec.Decode(cr); err != nil {
			return true, domain.ErrStreamProtocol("malformed upstream response")
		}
		out = cr
		return true, nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// CompletionStream opens a streaming chat completion. The returned
// StreamReader must be closed by the caller.
func (c *Client) CompletionStream(ctx context.Context, req *ChatRequest) (*StreamReader, error) {
	if err := c.gate(); err != nil {
		return nil, err
	}
	body, err := req.MarshalJSON()
	if err != nil {
		return nil, domain.ErrValidation("cannot encode request")
	}

	var reader *StreamReader
	err = c.withRetry(ctx, req, true, func(ctx context.Context) (firstByteSeen bool, err error) {
		resp, err := c.post(ctx, body, true)
		if err != nil {
			// Same caller-abort neutrality as Completion.
			if ctx.Err() == nil {
				c.cb.recordFailure()
			}
			return false, err
		}
		if !statusOK(resp.StatusCode) {
			c.cb.recordStatus(resp.StatusCode)
			bErr, _ := readErrorBody(resp.Body, resp.StatusCode, parseRetryAfter(resp.Header.Get("Retry-After")))
			drainClose(resp.Body)
			// Same reasoning as Completion: an error status has forwarded
			// nothing; 502/503/504/429 may be retried, 4xx must not.
			return false, bErr
		}
		// First byte not yet seen: headers arrived but body may still stall.
		// The reader enforces the idle watchdog from this point on and
		// reports mid-stream gateway faults to the circuit breaker.
		c.cb.recordSuccess() // 2xx headers: gateway is alive
		reader = newStreamReader(ctx, resp.Body, c.metrics, c.cb)
		return true, nil
	})
	if err != nil {
		return nil, err
	}
	return reader, nil
}

// Health probes Bifrost's GET /health for readiness checks. It bypasses
// the circuit breaker deliberately: readiness reporting stays independent
// of the serving-path protection (a tripped breaker must not darken the
// health probe, and a healthy /health must not close a tripped breaker).
func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.cfg.BaseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer drainClose(resp.Body)
	if resp.StatusCode == http.StatusOK {
		return nil
	}
	return fmt.Errorf("bifrost health: status %d", resp.StatusCode)
}

// CircuitState reports the upstream circuit-breaker state for ops surfaces
// ("disabled", "closed", "open", "half_open").
func (c *Client) CircuitState() string { return c.cb.stateName() }

// gate applies the circuit breaker before any upstream work. A denied call
// costs zero network and surfaces as a 503 with a Retry-After hint.
func (c *Client) gate() error {
	ok, retryAfter := c.cb.allow()
	if ok {
		return nil
	}
	c.cb.noteRejected()
	de := &domain.Error{
		Code:    "UPSTREAM_CIRCUIT_OPEN",
		Message: "The LLM gateway is temporarily unavailable. Retry shortly.",
		HTTP:    http.StatusServiceUnavailable,
		Details: map[string]any{"retryable": true, "circuit": c.cb.stateName()},
	}
	if retryAfter > 0 {
		de.Details["retry_after_ms"] = retryAfter.Milliseconds()
	}
	return de
}

// --- internals -------------------------------------------------------------

func (c *Client) post(ctx context.Context, body []byte, stream bool) (*http.Response, error) {
	url := c.cfg.BaseURL + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, domain.ErrInternal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if stream {
		req.Header.Set("Accept", "text/event-stream")
	}
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}
	// Correlation: propagate our request id + OTel trace context.
	if rid := reqctx.RequestID(ctx); rid != "" {
		req.Header.Set("x-request-id", rid)
	}
	if cid := reqctx.CallID(ctx); cid != "" {
		req.Header.Set("x-mash-call-id", cid)
	}
	traceparentFromContext(ctx, req)

	start := time.Now()
	resp, err := c.http.Do(req)
	if c.metrics != nil {
		status := "ok"
		if err != nil {
			status = "error"
		} else {
			status = strconv.Itoa(resp.StatusCode)
		}
		c.metrics.BifrostRequests.Add(ctx, 1, observability.Attr("status", status))
	}
	if err != nil {
		// Network-layer error: classify into retryable vs not.
		return nil, classifyTransportError(err)
	}
	if c.metrics != nil {
		c.metrics.BifrostDurationMS.Record(ctx, time.Since(start).Milliseconds())
	}
	return resp, nil
}

// withRetry executes fn with the pre-first-byte retry policy: only failures
// that could not have triggered billable upstream work are retried. Errors
// after the first byte, and every 4xx, are final.
func (c *Client) withRetry(ctx context.Context, req *ChatRequest, stream bool, fn func(ctx context.Context) (bool, error)) error {
	attempts := c.cfg.MaxRetries + 1
	var lastErr error
	for i := 0; i < attempts; i++ {
		if err := ctx.Err(); err != nil {
			return domain.ErrCancelled
		}
		firstByteSeen, err := fn(ctx)
		if err == nil {
			return nil
		}
		lastErr = err
		if firstByteSeen {
			return err // side effects possible; never retry
		}
		if !retryable(err) {
			return err
		}
		if i == attempts-1 {
			return err
		}
		// Honor Retry-After when present, bounded by our max backoff.
		backoff := backoffWithJitter(c.cfg.RetryMinBackoff, c.cfg.RetryMaxBackoff, i)
		if ra := retryAfterFrom(err); ra > 0 && ra < c.cfg.RetryMaxBackoff {
			backoff = ra
		}
		select {
		case <-ctx.Done():
			return domain.ErrCancelled
		case <-time.After(backoff):
		}
	}
	return lastErr
}

func statusOK(code int) bool { return code >= 200 && code < 300 }

func drainClose(body io.ReadCloser) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 64<<10))
	_ = body.Close()
}

// traceparentFromContext writes W3C traceparent into the request headers.
func traceparentFromContext(ctx context.Context, req *http.Request) {
	if sc := traceSpanContext(ctx); sc.IsValid() {
		req.Header.Set("traceparent", traceFormat(sc))
	}
}

const maxNonStreamBody = 64 << 20 // 64 MiB: non-stream completion ceiling
