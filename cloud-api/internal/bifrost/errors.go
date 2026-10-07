package bifrost

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"go.opentelemetry.io/otel/trace"
)

// netDialer aliases net.Dialer for transport construction.
type netDialer = net.Dialer

func traceSpanContext(ctx context.Context) trace.SpanContext {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		return sc
	}
	return trace.SpanContext{}
}

func traceFormat(sc trace.SpanContext) string {
	return "00-" + sc.TraceID().String() + "-" + sc.SpanID().String() + "-01"
}

// ---------------------------------------------------------------------------
// Error normalization
//
// BifrostError wire format (verified from OpenAPI):
//   { "event_id", "type", "is_bifrost_error", "status_code",
//     "error": {"type","code","message","param","event_id"},
//     "extra_fields": {"provider","model_requested"} }
// ---------------------------------------------------------------------------

// ErrorResponse is Bifrost's error body.
type ErrorResponse struct {
	EventID        string            `json:"event_id"`
	Type           string            `json:"type"`
	IsBifrostError bool              `json:"is_bifrost_error"`
	StatusCode     int               `json:"status_code"`
	Error          ErrorField        `json:"error"`
	ExtraFields    *ErrorExtraFields `json:"extra_fields,omitempty"`

	// headerRetryAfter carries the HTTP Retry-After header (parsed); it is
	// not part of the wire body. withRetry honors it, bounded by
	// RetryMaxBackoff, instead of guessing the 429/503 pacing.
	headerRetryAfter time.Duration `json:"-"`
}

// ErrorField is the nested error detail.
type ErrorField struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param"`
	EventID string `json:"event_id"`
}

// ErrorExtraFields carries upstream context.
type ErrorExtraFields struct {
	Provider       string `json:"provider"`
	ModelRequested string `json:"model_requested"`
}

// toDomain converts a BifrostError into the stable NexaU error model.
// Messages are passed through (they are provider text, not secrets) but are
// always classified: retryable flag + safe HTTP mapping.
func (be *ErrorResponse) toDomain(status int) error {
	de := &domain.Error{
		Code: be.upstreamCode(),
		// Bifrost/provider messages can be long and leak provider detail
		// (model names, org ids). Keep them out of the client payload; the
		// safe summary carries the classification, event id rides in details.
		Message: "The LLM gateway returned an error for this request.",
		HTTP:    safeStatus(status),
		Details: map[string]any{},
		Cause:   errors.New(be.Error.Type + ": " + be.Error.Message),
	}
	if be.EventID != "" {
		de.Details["upstream_event_id"] = be.EventID
	}
	if be.ExtraFields != nil && be.ExtraFields.Provider != "" {
		de.Details["provider"] = be.ExtraFields.Provider
	}
	retry := be.retryable(status)
	de.Details["retryable"] = retry
	if ra := be.retryAfter(); ra > 0 {
		de.Details["retry_after_ms"] = ra.Milliseconds()
	}
	return de
}

func (be *ErrorResponse) upstreamCode() string {
	if be.Error.Code != "" {
		return "UPSTREAM_" + sanitizeCode(be.Error.Code)
	}
	if be.Error.Type != "" {
		return "UPSTREAM_" + sanitizeCode(be.Error.Type)
	}
	return "UPSTREAM_ERROR"
}

// sanitizeCode uppercases and strips characters that must never appear in the
// client-facing code contract.
func sanitizeCode(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z':
			out = append(out, c-32)
		case (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_':
			out = append(out, c)
		case c == '-' || c == ' ':
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "ERROR"
	}
	if len(out) > 64 {
		out = out[:64]
	}
	return string(out)
}

func (be *ErrorResponse) retryable(status int) bool {
	if status == http.StatusTooManyRequests {
		return true
	}
	return status >= 500
}

// retryAfter reports the header-derived Retry-After hint (0 = none).
func (be *ErrorResponse) retryAfter() time.Duration { return be.headerRetryAfter }

// parseRetryAfter decodes the HTTP Retry-After header: delta-seconds or
// HTTP-date (RFC 7231 §7.1.3). Bounded to 10 minutes — larger hints are
// treated as "none" (the retry policy's own backoff bounds pacing anyway).
func parseRetryAfter(h string) time.Duration {
	h = strings.TrimSpace(h)
	if h == "" {
		return 0
	}
	if secs, err := strconv.Atoi(h); err == nil {
		if secs < 0 {
			return 0
		}
		return boundedRetryAfter(time.Duration(secs) * time.Second)
	}
	if at, err := http.ParseTime(h); err == nil {
		return boundedRetryAfter(time.Until(at))
	}
	return 0
}

func boundedRetryAfter(d time.Duration) time.Duration {
	if d <= 0 || d > 10*time.Minute {
		return 0
	}
	return d
}

func safeStatus(status int) int {
	switch {
	case status == http.StatusTooManyRequests:
		return http.StatusTooManyRequests
	case status == http.StatusNotFound:
		return http.StatusNotFound
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		// Upstream credential problems are OUR problem: never forward 401
		// (which would suggest the client's token was wrong).
		return http.StatusBadGateway
	case status >= 500:
		return http.StatusBadGateway
	default:
		return http.StatusBadGateway
	}
}

// readErrorBody parses the BifrostError JSON from an error status body.
func readErrorBody(r io.Reader, status int, headerRetryAfter time.Duration) (error, bool) {
	raw, err := io.ReadAll(io.LimitReader(r, 1<<20))
	if err != nil || len(raw) == 0 {
		return upstreamStatusError(status, headerRetryAfter), false
	}
	var be ErrorResponse
	if jerr := json.Unmarshal(raw, &be); jerr != nil {
		return upstreamStatusError(status, headerRetryAfter), false
	}
	be.headerRetryAfter = headerRetryAfter
	return be.toDomain(status), be.IsBifrostError
}

func upstreamStatusError(status int, headerRetryAfter time.Duration) error {
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return upErr("UPSTREAM_AUTH", "The LLM gateway rejected the service credential.", http.StatusBadGateway, false)
	case status == http.StatusNotFound:
		return upErr("MODEL_NOT_FOUND", "The requested model was not found upstream.", http.StatusNotFound, false)
	case status == http.StatusTooManyRequests:
		de := upErr("UPSTREAM_RATE_LIMITED", "The LLM gateway is rate limiting.", http.StatusTooManyRequests, true)
		if headerRetryAfter > 0 {
			de.Details["retry_after_ms"] = headerRetryAfter.Milliseconds()
		}
		return de
	case status >= 500:
		de := upErr("UPSTREAM_UNAVAILABLE", "The LLM gateway is unavailable.", http.StatusBadGateway, true)
		if headerRetryAfter > 0 {
			de.Details["retry_after_ms"] = headerRetryAfter.Milliseconds()
		}
		return de
	default:
		return upErr("UPSTREAM_BAD_REQUEST", "The LLM gateway rejected the request.", http.StatusBadGateway, false)
	}
}

func upErr(code, msg string, httpStatus int, retryable bool) *domain.Error {
	return &domain.Error{
		Code: code, Message: msg, HTTP: httpStatus,
		Details: map[string]any{"retryable": retryable},
	}
}

// classifyTransportError maps net/http layer failures to domain errors,
// flagging retryability.
func classifyTransportError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return domain.ErrCancelled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return domain.ErrUpstreamTimeout("connect")
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return domain.ErrUpstreamTimeout("transport")
	}
	return domain.ErrUpstreamUnavailable()
}

// retryAfterFrom extracts a Retry-After hint encoded in the domain error.
func retryAfterFrom(err error) time.Duration {
	if de := asDomainErr(err); de != nil {
		if v, ok := de.Details["retry_after_ms"].(int64); ok && v > 0 {
			return time.Duration(v) * time.Millisecond
		}
	}
	return 0
}

// retryable decides whether an error (pre-first-byte) may be retried safely.
func retryable(err error) bool {
	if de := asDomainErr(err); de != nil {
		if v, ok := de.Details["retryable"].(bool); ok {
			return v
		}
		switch de.Code {
		case "UPSTREAM_UNAVAILABLE", "MODEL_TIMEOUT", "UPSTREAM_RATE_LIMITED":
			return true
		}
	}
	return false
}

func asDomainErr(err error) *domain.Error {
	if err == nil {
		return nil
	}
	var de *domain.Error
	if errors.As(err, &de) {
		return de
	}
	return nil
}

func backoffWithJitter(min, max time.Duration, attempt int) time.Duration {
	if max <= min {
		return min
	}
	base := min << uint(attempt) // exponential: 1x, 2x, 4x …
	if base > max || base <= 0 {
		base = max
	}
	// Full jitter over [base/2, base].
	half := base / 2
	return half + time.Duration(rand.Int63n(maxI64(int64(half))))
}

func maxI64(a int64) int64 { return maxOf(1, a) }

func maxOf(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
