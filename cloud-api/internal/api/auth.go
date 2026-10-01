package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// handleLogin: POST /v1/auth/login {email, password}
//
// Rate-limited per source IP BEFORE any credential lookup (no user
// enumeration, no bcrypt work for flooded sources). Failures are uniform.
func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if a.ipLimited(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "login_ip"))
		return
	}

	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" || body.Password == "" {
		writeError(w, r, domain.ErrValidation("email and password are required"))
		return
	}
	if len(body.Email) > 320 || len(body.Password) > 256 {
		writeError(w, r, domain.ErrValidation("email or password exceeds the allowed length"))
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	ua := r.Header.Get("User-Agent")
	pair, err := a.authSvc.Login(r.Context(), body.Email, body.Password, ua)
	if err != nil {
		a.countLoginFailure(r, ip)
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, pair)
}

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

// loginThrottleKey is the per-IP failed-login window.
func loginThrottleKey(ip string) string { return "rl:login:ip:" + ip }

// ipLimited enforces the per-IP login throttle: sources that produced too
// many FAILED attempts inside the window are locked out (fail-open on Redis
// loss — availability, with the alarm counter from the limiter).
func (a *API) ipLimited(r *http.Request, ip string) bool {
	if a.lim == nil || a.cfg.Auth.MaxFailedLoginsPerIP <= 0 || ip == "" {
		return false
	}
	return a.lim.Count(r.Context(), loginThrottleKey(ip), 15*time.Minute) >=
		int64(a.cfg.Auth.MaxFailedLoginsPerIP)
}

// countLoginFailure records one failed attempt in the throttle window.
func (a *API) countLoginFailure(r *http.Request, ip string) {
	if a.lim == nil || a.cfg.Auth.MaxFailedLoginsPerIP <= 0 || ip == "" {
		return
	}
	a.lim.Hit(r.Context(), loginThrottleKey(ip), 15*time.Minute,
		strconv.FormatInt(time.Now().UnixNano(), 36))
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
