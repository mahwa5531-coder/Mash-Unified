package api

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// Signup & recovery handlers (mounted only in local mode with SignupEnabled).
//
// Surface design (one backend, two front doors — the website and the desktop
// app are both first-party clients of these endpoints):
//
//      POST /v1/auth/register            create account (email+password)
//      POST /v1/auth/email/verify        consume the emailed token
//      POST /v1/auth/email/resend        re-issue the verification email (generic 202)
//      POST /v1/auth/password/forgot     request a reset email (generic 202)
//      POST /v1/auth/password/reset      consume the reset token, set new password
//      POST /v1/auth/password/change     authed change (current + new password)
//
// Anti-abuse: every unauthenticated endpoint sits behind the same per-IP
// throttle the login uses (counted on ANY request, not only failures — these
// endpoints send email, so the budget is stricter by construction).

// signupIPThrottleKey counts signup-surface requests per source IP.
func signupIPThrottleKey(ip string) string { return "rl:signup:ip:" + ip }

// signupAdmit atomically enforces the per-IP signup budget and records the
// request when admitted (one Redis round-trip). Replaces the old
// signupIPLimited + countSignupRequest pair — a check-then-act race that let
// concurrent signup bursts pass the 30/15m budget un-counted (E2E 2026-09-23).
func (a *API) signupAdmit(r *http.Request, ip string) bool {
	if a.lim == nil || a.cfg.Auth.MaxFailedLoginsPerIP <= 0 || ip == "" {
		return true
	}
	return a.lim.Admit(r.Context(), signupIPThrottleKey(ip), 15*time.Minute,
		a.cfg.Auth.MaxFailedLoginsPerIP,
		fmt.Sprintf("%x-%d", time.Now().UnixNano(), admitSeq.Add(1)))
}

// handleRegister: POST /v1/auth/register {email, password, display_name?}
func (a *API) handleRegister(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.signupAdmit(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "signup_ip"))
		return
	}

	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" || body.Password == "" {
		writeError(w, r, domain.ErrValidation("email and password are required"))
		return
	}
	if len(body.Email) > 320 || len(body.Password) > 256 || len(body.DisplayName) > 128 {
		writeError(w, r, domain.ErrValidation("email, password or display name exceeds the allowed length"))
		return
	}

	res, err := a.authSvc.Register(r.Context(), body.Email, body.Password, body.DisplayName,
		ip, r.Header.Get("User-Agent"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user_id":               res.User.ID,
		"email":                 res.User.Email,
		"display_name":          res.User.DisplayName,
		"verification_required": res.VerificationRequired,
	})
}

// handleVerifyEmail: POST /v1/auth/email/verify {token}
// The emailed link opens a WEBSITE page which POSTs here (a direct GET from
// the email client would leak the token via referrer — OWASP).
// Throttled like the rest of the signup surface (2026-09-19 audit, cluster A:
// this endpoint did PG work per request with no budget — token probing floods).
func (a *API) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.signupAdmit(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "signup_ip"))
		return
	}

	var body struct {
		Token string `json:"token"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Token == "" {
		writeError(w, r, domain.ErrValidation("token is required"))
		return
	}
	if len(body.Token) > 512 {
		writeError(w, r, domain.ErrValidation("token exceeds the allowed length"))
		return
	}
	email, already, err := a.authSvc.VerifyEmail(r.Context(), body.Token)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	resp := map[string]any{"verified": true}
	if email != "" {
		resp["email"] = email
	}
	if already {
		resp["already_verified"] = true
	}
	writeOK(w, resp)
}

// handleResendVerification: POST /v1/auth/email/resend {email} → always 202.
func (a *API) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.signupAdmit(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "signup_ip"))
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" || len(body.Email) > 320 {
		writeError(w, r, domain.ErrValidation("a valid email address is required"))
		return
	}
	if err := a.authSvc.ResendVerification(r.Context(), body.Email, ip, r.Header.Get("User-Agent")); err != nil {
		if de := domain.AsError(err); de != nil && de.Code == "RESEND_COOLDOWN" {
			if rts, ok := de.Details["retry_after_sec"].(int64); ok && rts > 0 {
				w.Header().Set("Retry-After", strconv.FormatInt(rts, 10))
			}
		}
		writeError(w, r, domain.AsError(err))
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"message": "If the address matches an unverified account, a verification email has been sent.",
	})
}

// handleForgotPassword: POST /v1/auth/password/forgot {email} → always 202.
func (a *API) handleForgotPassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.signupAdmit(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "signup_ip"))
		return
	}

	var body struct {
		Email string `json:"email"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Email == "" || len(body.Email) > 320 {
		writeError(w, r, domain.ErrValidation("a valid email address is required"))
		return
	}
	if err := a.authSvc.ForgotPassword(r.Context(), body.Email, ip, r.Header.Get("User-Agent")); err != nil {
		if de := domain.AsError(err); de != nil && de.Code == "RESEND_COOLDOWN" {
			if rts, ok := de.Details["retry_after_sec"].(int64); ok && rts > 0 {
				w.Header().Set("Retry-After", strconv.FormatInt(rts, 10))
			}
		}
		writeError(w, r, domain.AsError(err))
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"message": "If the address matches an account, a password reset email has been sent.",
	})
}

// handleResetPassword: POST /v1/auth/password/reset {token, new_password}
func (a *API) handleResetPassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if !a.signupAdmit(r, ip) {
		w.Header().Set("Retry-After", "60")
		writeError(w, r, domain.ErrRateLimited(60_000, "signup_ip"))
		return
	}

	var body struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.Token == "" || body.NewPassword == "" {
		writeError(w, r, domain.ErrValidation("token and new_password are required"))
		return
	}
	if len(body.Token) > 512 || len(body.NewPassword) > 256 {
		writeError(w, r, domain.ErrValidation("token or password exceeds the allowed length"))
		return
	}
	if err := a.authSvc.ResetPassword(r.Context(), body.Token, body.NewPassword); err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, map[string]any{
		"reset":   true,
		"message": "Password updated. All sessions were signed out; sign in with the new password.",
	})
}

// handleChangePassword: POST /v1/auth/password/change {current_password, new_password} (authed)
// Returns a FRESH token pair: the calling session survives, every other
// refresh family is revoked.
func (a *API) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := decodeJSON(r, &body); err != nil || body.CurrentPassword == "" || body.NewPassword == "" {
		writeError(w, r, domain.ErrValidation("current_password and new_password are required"))
		return
	}
	if len(body.CurrentPassword) > 256 || len(body.NewPassword) > 256 {
		writeError(w, r, domain.ErrValidation("password exceeds the allowed length"))
		return
	}

	claims := auth.FromClaims(r.Context())
	if claims == nil || claims.Subject == "" {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	pair, err := a.authSvc.ChangePassword(r.Context(), claims.Subject, body.CurrentPassword, body.NewPassword)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, pair)
}
