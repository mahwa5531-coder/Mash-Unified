package razorpay

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/payment"
)

// Client is the Razorpay REST transport. Safe for concurrent use (one
// shared http.Client, no mutable state).
type Client struct {
	baseURL       string
	keyID         string
	keySecret     string
	webhookSecret string
	http          *http.Client

	// Retry policy — GET-only by design (see createOrder comment).
	retryMax    int
	retryWait   time.Duration
	retryJitter func() time.Duration
}

// Config assembles the client.
type Config struct {
	KeyID         string
	KeySecret     string
	WebhookSecret string
	BaseURL       string // "" → DefaultBaseURL
	HTTP          *http.Client
	RetryMax      int           // default 2
	RetryWait     time.Duration // default 150ms base backoff
}

// New builds the client (single instance per process; connection pool
// shared across all payment traffic).
func New(cfg Config) *Client {
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{
			Timeout: 20 * time.Second, // covers dial + headers + body
			Transport: &http.Transport{
				MaxIdleConns:        16,
				MaxIdleConnsPerHost: 16,
				IdleConnTimeout:     90 * time.Second,
				TLSHandshakeTimeout: 10 * time.Second,
				DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			},
		}
	}
	if cfg.RetryMax < 0 {
		cfg.RetryMax = 0
	}
	if cfg.RetryMax == 0 {
		cfg.RetryMax = 2
	}
	if cfg.RetryWait <= 0 {
		cfg.RetryWait = 150 * time.Millisecond
	}
	return &Client{
		baseURL: cfg.BaseURL, keyID: cfg.KeyID, keySecret: cfg.KeySecret,
		webhookSecret: cfg.WebhookSecret, http: cfg.HTTP,
		retryMax: cfg.RetryMax, retryWait: cfg.RetryWait,
		retryJitter: func() time.Duration { return time.Duration(rand.Int63n(int64(cfg.RetryWait))) },
	}
}

// Name implements payment.Provider.
func (c *Client) Name() string { return payment.ProviderRazorpay }

// PublicKeyID implements payment.Provider — the browser-safe key id.
func (c *Client) PublicKeyID() string { return c.keyID }

// --- transport ---------------------------------------------------------------

// doRequest performs an authenticated request. method+path+body are the
// request; retryable decides whether transport failures are retried.
func (c *Client) doRequest(ctx context.Context, method, path string, body []byte, retryable bool) ([]byte, error) {
	var lastErr error
	attempts := 1 + c.retryMax
	if !retryable {
		attempts = 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		req, err := c.buildRequest(ctx, method, path, body)
		if err != nil {
			return nil, err
		}
		resp, err := c.http.Do(req)
		if err != nil {
			lastErr = err
			if retryable && attempt < attempts-1 {
				c.sleepBackoff(ctx, attempt)
				continue
			}
			return nil, &payment.ProviderError{Kind: payment.ProviderErrUnavailable, Err: err}
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // 1 MiB cap
		_ = resp.Body.Close()
		if err != nil {
			lastErr = err
			if retryable && attempt < attempts-1 {
				c.sleepBackoff(ctx, attempt)
				continue
			}
			return nil, &payment.ProviderError{Kind: payment.ProviderErrUnavailable, Err: err}
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return data, nil
		}
		perr := classifyHTTP(resp.StatusCode, data)
		// Retry budget applies ONLY to transient classes (429/5xx) and
		// only when the caller allowed retries (GETs).
		if retryable && (perr.Kind == payment.ProviderErrUnavailable) && attempt < attempts-1 {
			lastErr = perr
			c.sleepBackoff(ctx, attempt)
			continue
		}
		return nil, perr
	}
	return nil, &payment.ProviderError{Kind: payment.ProviderErrUnavailable, Err: fmt.Errorf("razorpay: exhausted retries: %w", lastErr)}
}

func (c *Client) buildRequest(ctx context.Context, method, path string, body []byte) (*http.Request, error) {
	var rdr io.Reader
	if body != nil {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(c.keyID, c.keySecret) // Razorpay auth scheme
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func (c *Client) sleepBackoff(ctx context.Context, attempt int) {
	wait := c.retryWait*(1<<attempt) + c.retryJitter()
	select {
	case <-ctx.Done():
	case <-time.After(wait):
	}
}

// classifyHTTP maps a non-2xx Razorpay response onto the provider error
// kinds (auth / request / unavailable).
func classifyHTTP(status int, body []byte) *payment.ProviderError {
	var e errorDTO
	_ = json.Unmarshal(body, &e) // best-effort: description is diagnostic only
	desc := e.Error.Description
	if desc == "" {
		desc = string(body)
		if len(desc) > 200 {
			desc = desc[:200]
		}
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &payment.ProviderError{Kind: payment.ProviderErrAuth, HTTP: status, Detail: desc}
	case status == http.StatusTooManyRequests:
		return &payment.ProviderError{Kind: payment.ProviderErrUnavailable, HTTP: status, Detail: "rate limited: " + desc}
	case status >= 500:
		return &payment.ProviderError{Kind: payment.ProviderErrUnavailable, HTTP: status, Detail: desc}
	default:
		return &payment.ProviderError{Kind: payment.ProviderErrRequest, HTTP: status, Detail: desc}
	}
}
