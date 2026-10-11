package phonepe

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// Client is the PhonePe PG v1 transport. Safe for concurrent use (one
// shared http.Client, no mutable state). Every request carries an X-VERIFY
// checksum computed over its own checksum base (signature.go).
type Client struct {
	baseURL      string
	merchantID   string
	saltKey      string
	saltIndex    string
	redirectURL  string // frontend return page (gets ?order_id= appended)
	redirectMode string // POST | REDIRECT
	callbackURL  string // public API base + /v1/payments/webhook
	http         *http.Client

	// Retry policy — GET-only by design (see orders.go CreateOrder).
	retryMax    int
	retryWait   time.Duration
	retryJitter func() time.Duration
}

// Config assembles the client.
type Config struct {
	MerchantID   string
	SaltKey      string
	SaltIndex    string
	RedirectURL  string // required: the frontend return page (absolute URL)
	RedirectMode string // POST (default) | REDIRECT
	CallbackURL  string // required in production: public webhook URL
	BaseURL      string // "" → DefaultBaseURL (preprod override for testing)
	HTTP         *http.Client
	RetryMax     int           // default 2
	RetryWait    time.Duration // default 150ms base backoff
}

// New builds the client (single instance per process).
func New(cfg Config) *Client {
	if cfg.BaseURL == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.RedirectMode == "" {
		cfg.RedirectMode = "POST"
	}
	if cfg.HTTP == nil {
		cfg.HTTP = &http.Client{
			Timeout: 20 * time.Second,
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
		baseURL: cfg.BaseURL, merchantID: cfg.MerchantID,
		saltKey: cfg.SaltKey, saltIndex: cfg.SaltIndex,
		redirectURL: cfg.RedirectURL, redirectMode: cfg.RedirectMode,
		callbackURL: cfg.CallbackURL, http: cfg.HTTP,
		retryMax: cfg.RetryMax, retryWait: cfg.RetryWait,
		retryJitter: func() time.Duration { return time.Duration(rand.Int63n(int64(cfg.RetryWait))) },
	}
}

// Name implements payment.Provider.
func (c *Client) Name() string { return payment.ProviderPhonepe }

// PublicKeyID implements payment.Provider — PhonePe's browser-safe handle
// is the merchant id (everything else happens on the hosted PAY_PAGE).
func (c *Client) PublicKeyID() string { return c.merchantID }

// --- transport ---------------------------------------------------------------

// doRequest performs a checksummed request. payBody (non-nil) is the /pay
// payload: it is base64-encoded and the X-VERIFY base is
// base64(payload)+path+saltKey. For GETs (status fetches) the X-VERIFY
// base is the request path itself. retryable decides whether transport
// failures are retried (GETs only, by design).
func (c *Client) doRequest(ctx context.Context, method, path string, payBody []byte, retryable bool) ([]byte, error) {
	var lastErr error
	attempts := 1 + c.retryMax
	if !retryable {
		attempts = 1
	}
	for attempt := 0; attempt < attempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		req, err := c.buildRequest(ctx, method, path, payBody)
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
	return nil, &payment.ProviderError{Kind: payment.ProviderErrUnavailable, Err: fmt.Errorf("phonepe: exhausted retries: %w", lastErr)}
}

func (c *Client) buildRequest(ctx context.Context, method, path string, payBody []byte) (*http.Request, error) {
	var rdr io.Reader
	var verify string
	if payBody != nil {
		// /pay: the body is the base64 of the payload; the checksum base
		// is base64(payload) + path + saltKey — i.e. the checksum covers
		// EXACTLY the bytes on the wire.
		b64 := base64.StdEncoding.EncodeToString(payBody)
		rdr = bytes.NewReader([]byte(b64))
		verify = payChecksum(payBody, c.saltKey) + "###" + c.saltIndex
	} else {
		// Status fetch: the checksum base is the request path + saltKey.
		verify = statusChecksum(path, c.saltKey) + "###" + c.saltIndex
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-VERIFY", verify)
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

// classifyHTTP maps a non-2xx PG v1 response onto the provider error
// kinds: 401 → auth (bad salt key/index), 404 → request (unknown
// transaction), 5xx → unavailable (retryable).
func classifyHTTP(status int, body []byte) *payment.ProviderError {
	var e errorDTO
	_ = json.Unmarshal(body, &e) // best-effort: code/message are diagnostic only
	desc := e.Code
	if desc == "" {
		desc = string(body)
		if len(desc) > 200 {
			desc = desc[:200]
		}
	}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &payment.ProviderError{Kind: payment.ProviderErrAuth, HTTP: status, Detail: desc}
	case status == http.StatusNotFound:
		return &payment.ProviderError{Kind: payment.ProviderErrRequest, HTTP: status, Detail: desc}
	case status == http.StatusTooManyRequests:
		return &payment.ProviderError{Kind: payment.ProviderErrUnavailable, HTTP: status, Detail: "rate limited: " + desc}
	case status >= 500:
		return &payment.ProviderError{Kind: payment.ProviderErrUnavailable, HTTP: status, Detail: desc}
	default:
		return &payment.ProviderError{Kind: payment.ProviderErrRequest, HTTP: status, Detail: desc}
	}
}
