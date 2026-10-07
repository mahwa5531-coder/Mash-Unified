// Package domain defines the core business types of the MASh Cloud API and
// its stable, client-facing error model. Nothing in this package depends on
// transport, storage or protocol details.
package domain

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// ---- Identity ----

// User is a MASh identity (Google OAuth only).
type User struct {
	ID              string
	Email           string
	DisplayName     string // Google `name` claim
	AvatarURL       string // Google `picture` claim
	Status          string // active | suspended | deleted
	IsPlatformAdmin bool
	AuthProvider    string // "google"
	ExternalSubject string // Google `sub` claim — the immutable identity anchor
	EmailVerified   bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Tenant is an isolated customer organization (one per user in v1).
type Tenant struct {
	ID     string
	Slug   string
	Name   string
	Status string // active | suspended | deleted
}

// Membership links a user to a tenant with a role.
type Membership struct {
	TenantID string
	UserID   string
	Role     string // owner | admin | member
	Status   string // active | suspended | removed
}

// Role constants.
const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
)

// PlanLimits are enforced limits coming from the subscription plan. All of
// them live in plans.limits (JSONB) and are hot-changeable via SQL — the API
// process picks up edits within its short identity-cache TTL.
type PlanLimits struct {
	RequestsPerMinuteUser    int64 `json:"requests_per_minute_user,omitempty"`
	RequestsPerMinuteTenant  int64 `json:"requests_per_minute_tenant,omitempty"`
	ConcurrentRequestsUser   int64 `json:"concurrent_requests_per_user,omitempty"`
	ConcurrentRequestsTenant int64 `json:"concurrent_requests_per_tenant,omitempty"`
	MaxRequestBytes          int64 `json:"max_request_bytes,omitempty"`
	// Rolling normalized-token budgets (the quota currency — see
	// token_normalization): a 5-hour burst window and a 7-day weekly
	// window. Either can bind; 0 disables that window.
	Window5hTokens     int64 `json:"window_5h_tokens,omitempty"`
	WindowWeeklyTokens int64 `json:"window_weekly_tokens,omitempty"`
}

// Plan is a subscribable tier.
type Plan struct {
	ID     string
	Code   string
	Name   string
	Limits PlanLimits
	Models []string // allowlist entries: exact "openai/gpt-4o" or pattern "anthropic/*"
}

// Subscription is a tenant's effective plan state.
type Subscription struct {
	ID                 string
	TenantID           string
	PlanID             string
	Plan               Plan
	Status             string // trialing | active | past_due | canceled | expired
	CurrentPeriodStart time.Time
	CurrentPeriodEnd   *time.Time
}

// Effective reports whether the subscription grants entitlement.
func (s *Subscription) Effective() bool {
	if s == nil {
		return false
	}
	switch s.Status {
	case "trialing", "active":
		return true
	case "past_due":
		return true // grace period: allow, meter everything
	default:
		return false
	}
}

// Device is a registered desktop installation.
type Device struct {
	ID         string
	UserID     string
	Name       string
	Platform   string
	CreatedAt  time.Time
	LastSeenAt time.Time
	RevokedAt  *time.Time
}

// ---- LLM call metering ----

// LLM call statuses (terminal only — a call is recorded once, at completion).
const (
	CallCompleted = "completed"
	CallFailed    = "failed"
	CallCancelled = "cancelled"
)

// TokenUsage is the canonical usage shape with Bifrost cost fields for
// billing. Input/Output/Total are the NORMALIZED values (the quota currency,
// derived via the model's token_normalization rule); Raw* preserve the
// provider-reported numbers so per-row accounting stays reconstructible for
// any past or future weights.
type TokenUsage struct {
	InputTokens         int64   `json:"input_tokens"`
	OutputTokens        int64   `json:"output_tokens"`
	TotalTokens         int64   `json:"total_tokens"` // = InputTokens + OutputTokens
	RawPromptTokens     int64   `json:"raw_prompt_tokens,omitempty"`
	RawCompletionTokens int64   `json:"raw_completion_tokens,omitempty"`
	ReasoningTokens     int64   `json:"reasoning_tokens"`
	CacheReadTokens     int64   `json:"cache_read_tokens"`
	CacheWriteTokens    int64   `json:"cache_write_tokens"`
	InputCost           float64 `json:"input_cost,omitempty"`
	OutputCost          float64 `json:"output_cost,omitempty"`
	TotalCost           float64 `json:"total_cost,omitempty"`
}

// Add returns the element-wise sum.
func (u TokenUsage) Add(o TokenUsage) TokenUsage {
	return TokenUsage{
		InputTokens:         u.InputTokens + o.InputTokens,
		OutputTokens:        u.OutputTokens + o.OutputTokens,
		TotalTokens:         u.TotalTokens + o.TotalTokens,
		RawPromptTokens:     u.RawPromptTokens + o.RawPromptTokens,
		RawCompletionTokens: u.RawCompletionTokens + o.RawCompletionTokens,
		ReasoningTokens:     u.ReasoningTokens + o.ReasoningTokens,
		CacheReadTokens:     u.CacheReadTokens + o.CacheReadTokens,
		CacheWriteTokens:    u.CacheWriteTokens + o.CacheWriteTokens,
		InputCost:           u.InputCost + o.InputCost,
		OutputCost:          u.OutputCost + o.OutputCost,
		TotalCost:           u.TotalCost + o.TotalCost,
	}
}

// LLMCall is the persisted metering fact for one proxied LLM request.
// Payloads are never stored — metering facts only.
type LLMCall struct {
	CallID         string
	TenantID       string
	UserID         string
	RequestID      string
	RequestedModel string
	ResolvedModel  string
	Provider       string
	Stream         bool
	Status         string // completed | failed | cancelled
	ErrorCode      string
	ErrorMessage   string
	Usage          TokenUsage
	LatencyMS      int
	StartedAt      time.Time
	CompletedAt    *time.Time
}

// NormRule is one row of token-accounting weights — how raw provider usage is
// converted into the quota currency (normalized tokens). Rows live in the
// token_normalization table and are hot-changeable via SQL; Model is an exact
// "provider/model" key, a "provider/*" pattern, or "*" (the default rule).
//
//	normalized_input  = max(0, round(prompt·InputWeight)
//	                        − round(cache_read·CachedReadWeight)
//	                        − round(cache_write·CachedWriteWeight))
//	normalized_output = round(completion·OutputWeight)
//	normalized_total  = normalized_input + normalized_output
type NormRule struct {
	Model             string
	InputWeight       float64
	CachedReadWeight  float64
	CachedWriteWeight float64
	OutputWeight      float64
}

// DefaultNormRule is the identity accounting used when no table row matches:
// cached tokens are free (subtracted 1:1 from input), everything else counts
// 1:1. Identical to the seeded '*' row.
var DefaultNormRule = NormRule{
	Model: "*", InputWeight: 1, CachedReadWeight: 1, CachedWriteWeight: 1, OutputWeight: 1,
}

// WindowUsage is the rolling-window normalized-token position the quota gate
// admits against — the exact sums /v1/me renders.
type WindowUsage struct {
	Used5h     int64 // rolling 5 hours
	UsedWeekly int64 // rolling 7 days
}

// UsageSummary aggregates usage over a window for GET /v1/usage.
type UsageSummary struct {
	TenantID         string
	From             time.Time
	To               time.Time
	Calls            int64
	InputTokens      int64
	OutputTokens     int64
	TotalTokens      int64
	ReasoningTokens  int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	TotalCost        float64
}

// ---- Error model (stable, client-facing) ----

// Error is the canonical MASh error. It maps to the wire format:
//
//	{"error":{"code":"MODEL_TIMEOUT","message":"...","request_id":"req_...","details":{}}}
//
// Rule: code and HTTP status are API contract; message is operator-safe human
// text; details is a safe, non-sensitive context bag. Internal causes are
// carried only in logs/traces, never in the client payload.
type Error struct {
	Code      string
	Message   string
	HTTP      int
	RequestID string
	Details   map[string]any
	// Cause is for logs only. It is deliberately excluded from ClientJSON.
	Cause error
}

func (e *Error) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.Cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.Cause }

// WithRequestID attaches the correlation id.
func (e *Error) WithRequestID(id string) *Error {
	e.RequestID = id
	return e
}

// WithDetail attaches a safe detail value. Values must be non-sensitive.
func (e *Error) WithDetail(key string, val any) *Error {
	if e.Details == nil {
		e.Details = map[string]any{}
	}
	e.Details[key] = val
	return e
}

// ClientJSON is the safe, wire-ready error body value.
func (e *Error) ClientJSON() map[string]any {
	body := map[string]any{
		"code":    e.Code,
		"message": e.Message,
	}
	if e.RequestID != "" {
		body["request_id"] = e.RequestID
	}
	if len(e.Details) > 0 {
		body["details"] = e.Details
	}
	return body
}

// AsError coerces any error into *Error; unknown errors become INTERNAL.
func AsError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return ErrCancelled
	}
	return &Error{Code: "INTERNAL", Message: "An internal error occurred.", HTTP: http.StatusInternalServerError, Cause: err}
}

// Well-known error constructors. Every client-visible failure maps here.
var (
	ErrUnauthorized = func(cause error) *Error {
		return &Error{Code: "UNAUTHORIZED", Message: "Authentication required or invalid.", HTTP: http.StatusUnauthorized, Cause: cause}
	}
	ErrTokenExpired = func() *Error {
		return &Error{Code: "TOKEN_EXPIRED", Message: "The access token has expired.", HTTP: http.StatusUnauthorized}
	}
	ErrTokenRevoked = func() *Error {
		return &Error{Code: "TOKEN_REVOKED", Message: "The access token has been revoked.", HTTP: http.StatusUnauthorized}
	}
	ErrForbidden = func(msg string) *Error {
		return &Error{Code: "FORBIDDEN", Message: msg, HTTP: http.StatusForbidden}
	}
	ErrTenantSuspended = func() *Error {
		return &Error{Code: "TENANT_SUSPENDED", Message: "The tenant account is suspended.", HTTP: http.StatusForbidden}
	}
	ErrSubscriptionInactive = func() *Error {
		return &Error{Code: "SUBSCRIPTION_INACTIVE", Message: "No active subscription for this tenant.", HTTP: http.StatusForbidden}
	}
	ErrModelNotEntitled = func(model string) *Error {
		return &Error{Code: "MODEL_NOT_ENTITLED", Message: "The requested model is not entitled for this tenant.", HTTP: http.StatusForbidden, Details: map[string]any{"model": model}}
	}
	ErrNotFound = func(what string) *Error {
		return &Error{Code: "NOT_FOUND", Message: "The requested " + what + " was not found.", HTTP: http.StatusNotFound}
	}
	ErrValidation = func(msg string) *Error {
		return &Error{Code: "INVALID_REQUEST", Message: msg, HTTP: http.StatusBadRequest}
	}
	ErrPayloadTooLarge = func(limit int64) *Error {
		return &Error{Code: "PAYLOAD_TOO_LARGE", Message: "The request payload exceeds the allowed size.", HTTP: http.StatusRequestEntityTooLarge, Details: map[string]any{"limit_bytes": limit}}
	}
	ErrRateLimited = func(retryAfterMS int64, scope string) *Error {
		// retryAfterMS is carried in Details AND surfaced as the
		// Retry-After header by middleware.WriteDomainError.
		d := map[string]any{"scope": scope}
		if retryAfterMS > 0 {
			d["retry_after_ms"] = retryAfterMS
		}
		return &Error{Code: "RATE_LIMITED", Message: "Too many requests.", HTTP: http.StatusTooManyRequests, Details: d}
	}
	ErrConcurrencyLimited = func(scope string) *Error {
		return &Error{Code: "CONCURRENCY_LIMIT", Message: "Too many concurrent requests.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"scope": scope}}
	}
	// OAuth & web-to-desktop handshake. OAUTH_STATE_INVALID and
	// INVALID_OR_EXPIRED_CODE are deliberately generic (expired, replayed
	// and never-issued values are indistinguishable — no probing oracle).
	ErrOAuthState = func() *Error {
		return &Error{Code: "OAUTH_STATE_INVALID", Message: "The sign-in session is invalid or has expired. Try again.", HTTP: http.StatusBadRequest}
	}
	ErrOAuthProvider = func(cause error) *Error {
		return &Error{Code: "OAUTH_PROVIDER_ERROR", Message: "The identity provider could not complete sign-in.", HTTP: http.StatusBadGateway, Cause: cause}
	}
	ErrOAuthDisabled = func() *Error {
		return &Error{Code: "OAUTH_DISABLED", Message: "This sign-in method is not enabled on this deployment.", HTTP: http.StatusServiceUnavailable}
	}
	ErrOAuthEmailUnverified = func() *Error {
		return &Error{Code: "OAUTH_EMAIL_UNVERIFIED", Message: "The identity provider did not confirm this email address.", HTTP: http.StatusForbidden}
	}
	ErrIdentityConflict = func() *Error {
		return &Error{Code: "IDENTITY_CONFLICT", Message: "This email is already linked to a different identity. Sign in with the original method.", HTTP: http.StatusConflict}
	}
	// ErrWindowQuotaExceeded: a rolling plan window ("5h" | "weekly") is
	// exhausted. resets_at (optional) is the exact earliest instant usage
	// drops back below quota — clients use it to schedule the retry.
	ErrWindowQuotaExceeded = func(window string, quota, used int64, resetsAt *time.Time) *Error {
		d := map[string]any{"window": window, "quota_tokens": quota, "used_tokens": used}
		if resetsAt != nil {
			d["resets_at"] = resetsAt.UTC().Format(time.RFC3339)
		}
		return &Error{Code: "WINDOW_QUOTA_EXCEEDED", Message: "The token quota for this plan window has been reached.", HTTP: http.StatusTooManyRequests, Details: d}
	}
	ErrDesktopCode = func() *Error {
		return &Error{Code: "INVALID_OR_EXPIRED_CODE", Message: "This sign-in code is invalid or has expired. Restart sign-in from the app.", HTTP: http.StatusBadRequest}
	}
	ErrCancelled       = &Error{Code: "CANCELLED", Message: "The request was cancelled.", HTTP: 499} // 499: client closed (nginx convention)
	ErrUpstreamTimeout = func(scope string) *Error {
		return &Error{Code: "MODEL_TIMEOUT", Message: "The model request timed out.", HTTP: http.StatusGatewayTimeout, Details: map[string]any{"scope": scope}}
	}
	ErrUpstreamUnavailable = func() *Error {
		return &Error{Code: "UPSTREAM_UNAVAILABLE", Message: "The LLM gateway is currently unavailable.", HTTP: http.StatusBadGateway}
	}
	ErrUpstreamError = func(code, msg string, httpStatus int) *Error {
		if httpStatus == 0 {
			httpStatus = http.StatusBadGateway
		}
		return &Error{Code: code, Message: msg, HTTP: httpStatus}
	}
	ErrStreamProtocol = func(msg string) *Error {
		return &Error{Code: "UPSTREAM_PROTOCOL", Message: msg, HTTP: http.StatusBadGateway}
	}
	ErrInternal = func(cause error) *Error {
		return &Error{Code: "INTERNAL", Message: "An internal error occurred.", HTTP: http.StatusInternalServerError, Cause: cause}
	}
	ErrDependencyUnavailable = func(dep string) *Error {
		return &Error{Code: "DEPENDENCY_UNAVAILABLE", Message: "A required dependency is unavailable. Try again shortly.", HTTP: http.StatusServiceUnavailable, Details: map[string]any{"dependency": dep}}
	}
)
