// Package auth implements token verification, identity resolution and the
// login/refresh/logout flows. Two verification backends are supported:
//
//   - local:  HS256 access tokens minted by this API (self-contained).
//   - jwks:   RS*/ES* tokens minted by an external identity provider.
//   - hybrid: both (external IdP tokens + locally minted tokens).
//
// Refresh tokens are always opaque, hash-stored server-side, rotated on every
// use, with family-based reuse detection.
package auth

import "time"

// Claims is the verified access-token payload.
type Claims struct {
	Subject   string    // sub — user id (usr_...)
	TenantID  string    // tid — active tenant (ten_...)
	Role      string    // rol — tenant role
	DeviceID  string    // dev — device binding (optional)
	TokenID   string    // jti — revocation key
	Issuer    string    // iss
	Audience  string    // aud
	IssuedAt  time.Time // iat
	ExpiresAt time.Time // exp
	Method    string    // how this token was verified: "local" | "jwks"
}

// Identity is the server-authoritative context for one request: everything
// the authorization layer needs, resolved from PostgreSQL (never the client).
type Identity struct {
	User       UserInfo
	Tenant     TenantInfo
	Membership MembershipInfo
	// Models allowlist (nil = unrestricted) and restriction flag.
	Models     []string
	Restricted bool
	// Plan-enforced limits (merged with tenant overrides).
	Limits Limits
	// Subscription state for authorization decisions.
	SubscriptionStatus string
}

type UserInfo struct {
	ID              string `json:"id"`
	Email           string `json:"email"`
	DisplayName     string `json:"display_name"`
	Status          string `json:"status"`
	IsPlatformAdmin bool   `json:"is_platform_admin"`
	EmailVerified   bool   `json:"email_verified,omitempty"`
}

type TenantInfo struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Name   string `json:"name"`
	Status string `json:"status"`
}

type MembershipInfo struct {
	Role   string
	Status string
}

// Limits mirrors domain.PlanLimits but keeps this package storage-free.
type Limits struct {
	RequestsPerMinuteUser   int64
	RequestsPerMinuteTenant int64
	ConcurrentRunsUser      int64
	ConcurrentRunsTenant    int64
	MaxRequestBytes         int64
	MonthlyTokenQuota       int64
}

// CanRun checks account/tenant/subscription state. Returns a stable domain
// error reason string when denied.
func (id *Identity) CanRun() string {
	switch {
	case id.User.Status != "active":
		return "ACCOUNT_" + upper(id.User.Status)
	case id.Tenant.Status != "active":
		return "TENANT_" + upper(id.Tenant.Status)
	case id.Membership.Status != "active":
		return "MEMBERSHIP_" + upper(id.Membership.Status)
	case !id.SubscriptionEffective():
		return "SUBSCRIPTION_INACTIVE"
	}
	return ""
}

func (id *Identity) SubscriptionEffective() bool {
	switch id.SubscriptionStatus {
	case "trialing", "active", "past_due":
		return true
	default:
		return false
	}
}

// upper is a tiny helper without importing strings here.
func upper(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'a' && c <= 'z' {
			b[i] = c - 32
		}
	}
	return string(b)
}
