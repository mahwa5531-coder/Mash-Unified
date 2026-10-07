package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/domain"
)

// handleRefresh: POST /v1/auth/refresh {refresh_token}
// Per-IP throttled (2026-09-19 audit, cluster A): rotation is a PG-write +
// bcrypt-grade workload per request; an unthrottled surface let a single
// source burn DB capacity with garbage tokens.
func (a *API) handleRefresh(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, refreshThrottleKey, a.cfg.Auth.MaxRefreshPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "refresh_ip"))
		return
	}

	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := decodeJSON(r, &body); err != nil || body.RefreshToken == "" {
		writeError(w, r, domain.ErrValidation("refresh_token is required"))
		return
	}
	if len(body.RefreshToken) > 512 {
		writeError(w, r, domain.ErrValidation("refresh_token exceeds the allowed length"))
		return
	}
	pair, err := a.authSvc.Refresh(r.Context(), body.RefreshToken, r.Header.Get("User-Agent"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, pair)
}

// handleLogout: POST /v1/auth/logout {refresh_token?}
func (a *API) handleLogout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	_ = decodeJSON(r, &body) // optional body

	claims := auth.FromClaims(r.Context())
	var jti string
	var ttl time.Duration
	if claims != nil {
		jti = claims.TokenID
		ttl = time.Until(claims.ExpiresAt)
	}
	if err := a.authSvc.Logout(r.Context(), body.RefreshToken, jti, ttl); err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, struct {
		LoggedOut bool `json:"logged_out"`
	}{true})
}

// handleLogoutAll: POST /v1/auth/logout-all — revoke every refresh-token
// family for the authenticated user (sign out everywhere: lost/stolen
// device response). The response counts the revoked sessions; the presented
// access token is blacklisted for its remaining lifetime when revocation
// checking is on.
func (a *API) handleLogoutAll(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	claims := auth.FromClaims(r.Context())
	var jti string
	var ttl time.Duration
	if claims != nil {
		jti = claims.TokenID
		ttl = time.Until(claims.ExpiresAt)
	}
	n, err := a.authSvc.LogoutAll(r.Context(), idn.User.ID, jti, ttl)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	// The cached identity is fine (plan/status unchanged); only token state
	// is invalidated, and that lives in refresh_tokens + the jti blacklist.
	writeOK(w, struct {
		LoggedOut      bool  `json:"logged_out"`
		SessionsKilled int64 `json:"sessions_killed"`
	}{true, n})
}

// clientIP extracts the source address. X-Forwarded-For is honored only when
// the deployment runs behind a trusted proxy (config flag) — spoofing an
// untrusted header must not shift rate-limit buckets.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
			if i := strings.IndexByte(xf, ','); i > 0 {
				return strings.TrimSpace(xf[:i])
			}
			return strings.TrimSpace(xf)
		}
		if xr := r.Header.Get("X-Real-IP"); xr != "" {
			return strings.TrimSpace(xr)
		}
	}
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return strings.Trim(host, "[]")
}
