// Package domain defines the core business types of the NexaU Cloud API and
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

// User is a NexaU identity.
type User struct {
	ID              string
	Email           string
	DisplayName     string
	Status          string // active | suspended | deleted
	IsPlatformAdmin bool
	AuthProvider    string
	EmailVerified   bool // local mode: email verification state (signup starts false)
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Tenant is an isolated customer organization.
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

// PlanLimits are enforced limits coming from the subscription plan.
type PlanLimits struct {
	RequestsPerMinuteUser   int64 `json:"requests_per_minute_user,omitempty"`
	RequestsPerMinuteTenant int64 `json:"requests_per_minute_tenant,omitempty"`
	ConcurrentRunsUser      int64 `json:"concurrent_runs_per_user,omitempty"`
	ConcurrentRunsTenant    int64 `json:"concurrent_runs_per_tenant,omitempty"`
	MaxRequestBytes         int64 `json:"max_request_bytes,omitempty"`
	MonthlyTokenQuota       int64 `json:"monthly_token_quota,omitempty"`
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

// ---- Sessions & runs ----

// Session statuses.
const (
	SessionActive = "active"
	SessionClosed = "closed"
)

// Session is cloud-side metadata for a desktop agent session.
type Session struct {
	ID         string
	TenantID   string
	UserID     string
	Status     string
	Metadata   map[string]any // client labels (never message content)
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  *time.Time // sliding idle deadline: extended on activity
}

// Run statuses.
const (
	RunRunning      = "running"
	RunCompleted    = "completed"
	RunFailed       = "failed"
	RunCancelled    = "cancelled"
	RunDisconnected = "disconnected"
)

// Run is one logical LLM request within a session.
type Run struct {
	ID             string
	SessionID      string
	TenantID       string
	UserID         string
	RequestID      string
	TurnID         string
	IdempotencyKey string
	RequestedModel string
	ResolvedModel  string
	Provider       string
	Stream         bool
	Status         string
	ErrorCode      string
	ErrorMessage   string
	CancelReason   string
	CancelBy       string
	StartedAt      time.Time
	CompletedAt    *time.Time
}

// Terminal reports whether the run has reached a final state.
func (r *Run) Terminal() bool {
	switch r.Status {
	case RunCompleted, RunFailed, RunCancelled, RunDisconnected:
		return true
	default:
		return false
	}
}

// ---- Usage ----

// TokenUsage is the NexAU-canonical usage shape (nexau/core/usage.py parity)
// with Bifrost cost fields added for billing.
type TokenUsage struct {
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	ReasoningTokens  int64   `json:"reasoning_tokens"`
	CacheReadTokens  int64   `json:"cache_read_tokens"`
	CacheWriteTokens int64   `json:"cache_write_tokens"`
	InputCost        float64 `json:"input_cost,omitempty"`
	OutputCost       float64 `json:"output_cost,omitempty"`
	TotalCost        float64 `json:"total_cost,omitempty"`
}

// Add returns the element-wise sum (NexAU TokenUsage.__add__ parity).
func (u TokenUsage) Add(o TokenUsage) TokenUsage {
	return TokenUsage{
		InputTokens:      u.InputTokens + o.InputTokens,
		OutputTokens:     u.OutputTokens + o.OutputTokens,
		TotalTokens:      u.TotalTokens + o.TotalTokens,
		ReasoningTokens:  u.ReasoningTokens + o.ReasoningTokens,
		CacheReadTokens:  u.CacheReadTokens + o.CacheReadTokens,
		CacheWriteTokens: u.CacheWriteTokens + o.CacheWriteTokens,
		InputCost:        u.InputCost + o.InputCost,
		OutputCost:       u.OutputCost + o.OutputCost,
		TotalCost:        u.TotalCost + o.TotalCost,
	}
}

// UsageRecord is the persisted, authoritative billing fact.
type UsageRecord struct {
	RunID          string
	CallSeq        int
	TenantID       string
	UserID         string
	SessionID      string
	Provider       string
	Model          string
	RequestedModel string
	Status         string
	Usage          TokenUsage
	LatencyMS      int
	StartedAt      time.Time
	CompletedAt    *time.Time
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

// Error is the canonical NexaU error. It maps to the wire format:
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
	ErrSessionNotFound = func() *Error { return ErrNotFound("session") }
	ErrRunNotFound     = func() *Error { return ErrNotFound("run") }
	ErrSessionClosed   = func() *Error {
		return &Error{Code: "SESSION_CLOSED", Message: "The session is closed.", HTTP: http.StatusConflict}
	}
	ErrValidation = func(msg string) *Error {
		return &Error{Code: "INVALID_REQUEST", Message: msg, HTTP: http.StatusBadRequest}
	}
	ErrPayloadTooLarge = func(limit int64) *Error {
		return &Error{Code: "PAYLOAD_TOO_LARGE", Message: "The request payload exceeds the allowed size.", HTTP: http.StatusRequestEntityTooLarge, Details: map[string]any{"limit_bytes": limit}}
	}
	ErrRateLimited = func(retryAfterMS int64, scope string) *Error {
		// retryAfterMS is carried in Details AND surfaced as the
		// Retry-After header by middleware.WriteDomainError — it was
		// previously accepted and silently dropped (E2E 2026-09-23).
		d := map[string]any{"scope": scope}
		if retryAfterMS > 0 {
			d["retry_after_ms"] = retryAfterMS
		}
		return &Error{Code: "RATE_LIMITED", Message: "Too many requests.", HTTP: http.StatusTooManyRequests, Details: d}
	}
	ErrConcurrencyLimited = func(scope string) *Error {
		return &Error{Code: "CONCURRENCY_LIMIT", Message: "Too many concurrent runs.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"scope": scope}}
	}
	ErrWSConnLimit = func() *Error {
		return &Error{Code: "WS_CONNECTION_LIMIT", Message: "Too many open WebSocket connections.", HTTP: http.StatusTooManyRequests}
	}
	ErrDuplicate = func() *Error {
		return &Error{Code: "DUPLICATE_IN_PROGRESS", Message: "An identical request is already being processed.", HTTP: http.StatusConflict}
	}
	ErrIdempotencyMismatch = func() *Error {
		return &Error{Code: "IDEMPOTENCY_KEY_REUSE", Message: "The Idempotency-Key was reused with a different request body.", HTTP: http.StatusUnprocessableEntity}
	}
	ErrIdemOrphaned = func() *Error {
		return &Error{Code: "IDEMPOTENCY_ORPHANED", Message: "The Idempotency-Key referenced a run that no longer exists; the key has been reset. Retry the same request.", HTTP: http.StatusConflict}
	}
	// Signup & account recovery (OWASP-aligned: generic messages, no
	// account existence leaks on recovery surfaces).
	ErrEmailTaken = func() *Error {
		return &Error{Code: "EMAIL_TAKEN", Message: "An account with this email already exists. Sign in instead.", HTTP: http.StatusConflict}
	}
	ErrEmailNotVerified = func() *Error {
		return &Error{Code: "EMAIL_NOT_VERIFIED", Message: "Verify your email address before signing in.", HTTP: http.StatusForbidden, Details: map[string]any{"resend_endpoint": "/v1/auth/email/resend"}}
	}
	ErrInvalidRecoveryToken = func() *Error {
		// Deliberately generic: expired, already-used and unknown
		// tokens are indistinguishable (OWASP Forgot Password CS).
		return &Error{Code: "INVALID_TOKEN", Message: "This link is invalid or has expired. Request a new one.", HTTP: http.StatusBadRequest}
	}
	ErrPasswordWeak = func(reason string) *Error {
		return &Error{Code: "PASSWORD_WEAK", Message: "The password does not meet the policy.", HTTP: http.StatusBadRequest, Details: map[string]any{"reason": reason}}
	}
	ErrResendCooldown = func(retryAfterSec int64) *Error {
		return &Error{Code: "RESEND_COOLDOWN", Message: "Please wait before requesting another email.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"retry_after_sec": retryAfterSec}}
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
	ErrOAuthAccountUnverified = func() *Error {
		// Anti pre-hijacking: a Google-verified identity never auto-links
		// onto an UNVERIFIED local account with that email (an attacker
		// could have seeded it with their own password). The email owner
		// must first prove mailbox control (password reset flips the flag).
		return &Error{Code: "OAUTH_ACCOUNT_UNVERIFIED", Message: "An account with this email exists but its address was never verified. Sign in with your password (or reset it) first, then link Google.", HTTP: http.StatusConflict}
	}
	ErrPlanQuotaExceeded = func(quota, used int64) *Error {
		return &Error{Code: "PLAN_QUOTA_EXCEEDED", Message: "The monthly token quota for this plan has been reached.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"quota_tokens": quota, "used_tokens": used}}
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
