package api

// OAuth + web-to-desktop handshake handlers.
//
//      GET  /v1/auth/oauth/google           begin "Continue with Google" (302)
//      GET  /v1/auth/oauth/google/callback  finish OAuth → 302 web success page
//      POST /v1/auth/lookup                email → {exists, auth_provider}
//      POST /v1/auth/web/session            grant → short web access token
//      POST /v1/auth/desktop/code           (authed) mint single-use mcode
//      POST /v1/auth/desktop/exchange       mcode → full TokenPair
//
// Security posture (see internal/auth/oauth.go + desktop_code.go):
//   - tokens never cross the browser: only single-use short-TTL codes
//     (grant / mcode) travel in redirects and deep links;
//   - OAuth state is single-use, TTL-bounded and tx-cookie-bound;
//   - every unauthenticated POST is per-IP throttled and counted on ANY
//     request (not only failures) — they are enumeration/abuse surfaces;
//   - error codes are generic (expired vs replayed vs unknown is
//     indistinguishable);
//   - nothing sensitive is ever logged (request bodies are not logged by the
//     middleware; handler errors carry codes only).

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// oauthTxCookie binds the OAuth begin hop to the callback hop (login-CSRF
// defense; SameSite=Lax rides both top-level GET navigations).
const oauthTxCookie = "nexau_oauth_tx"

// --- per-IP throttles (counted every request; these are public surfaces) -----

func lookupThrottleKey(ip string) string      { return "rl:lookup:ip:" + ip }
func webSessionThrottleKey(ip string) string  { return "rl:webssn:ip:" + ip }
func desktopXchgThrottleKey(ip string) string { return "rl:dxchg:ip:" + ip }
func refreshThrottleKey(ip string) string     { return "rl:refresh:ip:" + ip }
func oauthThrottleKey(ip string) string       { return "rl:oauth:ip:" + ip }
func desktopCodeKey(userID string) string     { return "rl:dcode:user:" + userID }

// admitSeq guarantees unique zset members even for same-nanosecond events
// (duplicate members silently overwrite in a ZADD → undercount).
var admitSeq atomic.Uint64

// ipAdmit atomically enforces a per-IP counting-window budget and records
// the event when admitted (single Redis round-trip). Replaces the old
// ipCountedLimited + countIPRequest pair — a check-then-act race that let
// concurrent bursts pass the budget un-counted (E2E 2026-09-23).
func (a *API) ipAdmit(r *http.Request, ip string, keyFn func(string) string, budget int) bool {
	if a.lim == nil || budget <= 0 || ip == "" {
		return true
	}
	return a.lim.Admit(r.Context(), keyFn(ip), 15*time.Minute, budget,
		fmt.Sprintf("%x-%d", time.Now().UnixNano(), admitSeq.Add(1)))
}

// handleGoogleOAuthBegin: GET /v1/auth/oauth/google
//
// MUST be a top-level browser navigation (it sets the tx cookie on this hop;
// the callback returns as a top-level GET and needs it back).
// Per-IP throttled (2026-09-19 audit, cluster A): each begin writes Redis
// state + a tx secret — an unthrottled surface was a cheap Redis-fill vector.
func (a *API) handleGoogleOAuthBegin(w http.ResponseWriter, r *http.Request) {
	if a.authSvc.Google == nil {
		writeError(w, r, domain.ErrOAuthDisabled())
		return
	}
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, oauthThrottleKey, a.cfg.Auth.MaxOAuthPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "oauth_ip"))
		return
	}

	redirect, _, tx, err := a.authSvc.BeginGoogleOAuth(r.Context())
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthTxCookie,
		Value:    tx,
		Path:     "/v1/auth/oauth",
		MaxAge:   int(a.cfg.Auth.OAuthStateTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.cfg.Auth.OAuthCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, redirect, http.StatusFound)
}

// handleGoogleOAuthStart: POST /v1/auth/google/start
func (a *API) handleGoogleOAuthStart(w http.ResponseWriter, r *http.Request) {
	if a.authSvc.Google == nil {
		writeError(w, r, domain.ErrOAuthDisabled())
		return
	}
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, oauthThrottleKey, a.cfg.Auth.MaxOAuthPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "oauth_ip"))
		return
	}

	redirect, state, tx, err := a.authSvc.BeginGoogleOAuth(r.Context())
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthTxCookie,
		Value:    tx,
		Path:     "/v1/auth",
		MaxAge:   int(a.cfg.Auth.OAuthStateTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.cfg.Auth.OAuthCookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	writeOK(w, map[string]any{
		"auth_url": redirect,
		"state":    state,
	})
}

// handleGoogleOAuthCallback: GET /v1/auth/oauth/google/callback?code&state
//
// Errors redirect to the web login page (?error=code) when configured — the
// browser cannot render a JSON API error usefully mid-flow. No tokens are
// ever placed in URLs: the success redirect carries only the single-use grant.
func (a *API) handleGoogleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if a.authSvc.Google == nil {
		writeError(w, r, domain.ErrOAuthDisabled())
		return
	}
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, oauthThrottleKey, a.cfg.Auth.MaxOAuthPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "oauth_ip"))
		return
	}

	fail := func(de *domain.Error) {
		if a.cfg.Auth.WebLoginURL != "" {
			http.Redirect(w, r, a.cfg.Auth.WebLoginURL+"?error="+de.Code, http.StatusFound)
			return
		}
		writeError(w, r, de)
	}

	if e := r.URL.Query().Get("error"); e != "" {
		fail(domain.ErrOAuthProvider(nil).WithDetail("provider_error", e))
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	tx := ""
	if c, err := r.Cookie(oauthTxCookie); err == nil {
		tx = c.Value
	}

	_, grant, err := a.authSvc.FinishGoogleOAuth(r.Context(), code, state, tx)
	if err != nil {
		fail(domain.AsError(err))
		return
	}
	http.Redirect(w, r, a.cfg.Auth.WebSuccessURL+"?grant="+grant, http.StatusFound)
}

// handleAuthLookup: POST /v1/auth/lookup {email}
//
// Purposeful account-resolution surface for the login screen (Slack/Notion
// pattern). Response: {exists, auth_provider} — the provider is returned only
// when the account exists and is active.
func (a *API) handleAuthLookup(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, lookupThrottleKey, a.cfg.Auth.MaxLookupPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "lookup_ip"))
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" {
		writeError(w, r, domain.ErrValidation("a valid email address is required"))
		return
	}
	if len(body.Email) > 320 {
		writeError(w, r, domain.ErrValidation("email exceeds the allowed length"))
		return
	}

	exists, provider, err := a.authSvc.LookupEmail(r.Context(), body.Email)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	if exists {
		writeOK(w, map[string]any{"exists": true, "auth_provider": provider})
		return
	}
	writeOK(w, map[string]any{"exists": false})
}

// handleWebSession: POST /v1/auth/web/session {grant}
//
// Exchanges the single-use OAuth grant for a SHORT web access token (no
// refresh token — the browser is not a credential vault; the token lives in
// page memory only, long enough to mint a desktop code).
func (a *API) handleWebSession(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, webSessionThrottleKey, a.cfg.Auth.MaxWebSessionPerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "web_session_ip"))
		return
	}

	var body struct {
		Grant string `json:"grant"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Grant == "" || len(body.Grant) > 128 {
		writeError(w, r, domain.ErrDesktopCode())
		return
	}
	session, err := a.authSvc.ExchangeWebGrant(r.Context(), body.Grant)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, session)
}

// handleDesktopCode: POST /v1/auth/desktop/code (authenticated)
//
// Mints the 60-second single-use mcode the web page passes to the desktop
// (deep link + localhost loopback fallback). Per-user rate limited.
func (a *API) handleDesktopCode(w http.ResponseWriter, r *http.Request) {
	claims := auth.FromClaims(r.Context())
	identity := auth.FromIdentity(r.Context())
	if claims == nil || claims.Subject == "" {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}

	if a.lim != nil && a.cfg.Auth.MaxDesktopCodePerMin > 0 {
		if a.lim.Count(r.Context(), desktopCodeKey(claims.Subject), time.Minute) >= int64(a.cfg.Auth.MaxDesktopCodePerMin) {
			w.Header().Set("Retry-After", "60")
			writeError(w, r, domain.ErrRateLimited(60_000, "desktop_code_user"))
			return
		}
	}

	tenantID := ""
	if identity != nil {
		tenantID = identity.Tenant.ID
	}
	code, ttl, err := a.authSvc.IssueDesktopCode(r.Context(), claims.Subject, tenantID)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	if a.lim != nil && a.cfg.Auth.MaxDesktopCodePerMin > 0 {
		a.lim.Hit(r.Context(), desktopCodeKey(claims.Subject), time.Minute,
			strconv.FormatInt(time.Now().UnixNano(), 36))
	}
	writeOK(w, map[string]any{"code": code, "expires_in": ttl})
}

// handleDesktopExchange: POST /v1/auth/desktop/exchange
// {code, device_name?, platform?, device_id?}
//
// Public (the desktop is unauthenticated by definition — this is its login).
// Single-use by construction; the losing channel of the dual-channel
// handshake receives INVALID_OR_EXPIRED_CODE.
func (a *API) handleDesktopExchange(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.ipAdmit(r, ip, desktopXchgThrottleKey, a.cfg.Auth.MaxDesktopExchangePerIP) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "desktop_exchange_ip"))
		return
	}

	var body struct {
		Code       string `json:"code"`
		DeviceName string `json:"device_name"`
		Platform   string `json:"platform"`
		DeviceID   string `json:"device_id"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Code == "" {
		writeError(w, r, domain.ErrDesktopCode())
		return
	}
	if len(body.Code) > 128 || len(body.DeviceName) > 128 || len(body.DeviceID) > 64 || len(body.Platform) > 32 {
		writeError(w, r, domain.ErrValidation("request fields exceed the allowed lengths"))
		return
	}
	body.DeviceName = strings.TrimSpace(body.DeviceName)

	pair, err := a.authSvc.ExchangeDesktopCode(r.Context(), body.Code, body.DeviceID, body.DeviceName, body.Platform, r.Header.Get("User-Agent"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, pair)
}
