package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/ids"
	"github.com/nexau-cloud/nexau-api/internal/store"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

// Signup & account recovery flows. Sources (patterns NOT invented here):
//   - OWASP Forgot Password Cheat Sheet: single-use short-lived tokens, hashed
//     at rest, generic responses (no account-existence oracle), revoke all
//     sessions on reset, per-email/per-IP throttling.
//   - Paragonie "Untangling the Forget-Me-Knot": split tokens (selector +
//     hash-only verifier), newest-token-wins.
//   - NIST SP 800-63B: password length policy without composition rules,
//     denylist screening.
//
// Both client surfaces (website and desktop app) hit these endpoints; the
// email link targets the WEBSITE (AppBaseURL), whose page then POSTs the
// token to this API — one backend, two front doors.

// AccountStore provisions self-serve accounts (user + personal tenant +
// owner membership + trial subscription) atomically.
type AccountStore interface {
	// CreateAccount returns repos.ErrEmailTaken on duplicate (case-insensitive).
	CreateAccount(ctx context.Context, email, displayName, passwordHash, userID, tenantID string) error
}

// RecoveryStore issues and consumes single-use split tokens, atomically.
type RecoveryStore interface {
	// Issue supersedes previous live tokens of the purpose and stores the new
	// (selector, verifierHash) pair. ttl bounds validity.
	Issue(ctx context.Context, userID, purpose, selector, verifierHash string, ttl time.Duration, ip, ua string) error
	// ApplyVerification consumes a verify_email token and flips email_verified
	// in one transaction. already=true → account was already verified.
	ApplyVerification(ctx context.Context, selector, verifierHash string) (userID string, already bool, err error)
	// ResetPassword consumes a password_reset token, writes the new hash and
	// revokes every live refresh family — all in one transaction.
	ResetPassword(ctx context.Context, selector, verifierHash, newHash string) (userID string, revoked int64, err error)
}

// Register outcome for the HTTP layer.
type RegisterResult struct {
	User                 *domain.User
	VerificationRequired bool
}

// Register creates a self-serve account. Duplicate email → EMAIL_TAKEN
// (enumeration on signup is the accepted trade-off: the real user must be
// told to sign in instead; recovery surfaces stay enumeration-proof).
func (s *Service) Register(ctx context.Context, email, password, displayName, ip, ua string) (*RegisterResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	displayName = strings.TrimSpace(displayName)
	if email == "" || !validEmail(email) {
		return nil, domain.ErrValidation("a valid email address is required")
	}
	if len(email) > 320 || len(displayName) > 128 {
		return nil, domain.ErrValidation("email or display name exceeds the allowed length")
	}
	if err := ValidatePassword(password, s.MinPasswordLength); err != nil {
		return nil, err
	}

	hash, err := bcryptGenerate(password)
	if err != nil {
		return nil, domain.ErrInternal(err)
	}

	userID, tenantID := ids.UserID(), ids.TenantID()
	if err := s.Registrar.CreateAccount(ctx, email, displayName, hash, userID, tenantID); err != nil {
		if repos.IsEmailTaken(err) {
			return nil, domain.ErrEmailTaken()
		}
		return nil, repos.AsDomain(err)
	}

	u := &domain.User{ID: userID, Email: email, DisplayName: displayName, Status: "active", EmailVerified: false}
	res := &RegisterResult{User: u, VerificationRequired: s.RequireVerified}

	if s.RequireVerified {
		if err := s.sendRecoveryEmail(ctx, u, repos.PurposeVerifyEmail, s.VerifyTTL, ip, ua); err != nil {
			// Account exists but the email failed: log loudly, still succeed the
			// signup (resend is a first-class endpoint; failing the request would
			// leak relay state and create half-registered UX).
			slog.ErrorContext(ctx, "auth: verification email send failed", "error", err, "user_id", userID)
		}
	}
	return res, nil
}

// VerifyEmail consumes a verification token. Generic INVALID_TOKEN on
// unknown/expired/used/superseded (no probing oracle).
func (s *Service) VerifyEmail(ctx context.Context, rawToken string) (email string, already bool, err error) {
	selector, verifier, ok := parseSplitToken(rawToken)
	if !ok {
		return "", false, domain.ErrInvalidRecoveryToken()
	}
	userID, already, err := s.Recovery.ApplyVerification(ctx, selector, HashToken(verifier))
	if err != nil {
		if errors.Is(err, repos.ErrRecoveryInvalid) {
			return "", false, domain.ErrInvalidRecoveryToken()
		}
		return "", false, repos.AsDomain(err)
	}
	if u, uerr := s.Users.ByID(ctx, userID); uerr == nil && u != nil {
		email = u.Email
	}
	return email, already, nil
}

// ResendVerification re-issues a verification email. Enumeration-proof: for
// unknown, already-verified or cooldown-locked emails the caller still returns
// 202 with an identical body; only the log knows which branch ran.
func (s *Service) ResendVerification(ctx context.Context, email, ip, ua string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !validEmail(email) {
		return domain.ErrValidation("a valid email address is required")
	}
	if s.cooldownLocked(ctx, repos.PurposeVerifyEmail, email) {
		return domain.ErrResendCooldown(int64(s.ResendCooldown.Seconds()))
	}
	u, err := s.Users.ByEmail(ctx, email)
	if err != nil {
		return storeMapError(err)
	}
	if u == nil || u.Status != "active" || u.EmailVerified || !s.RequireVerified {
		return nil // generic 202, nothing sent
	}
	if err := s.sendRecoveryEmail(ctx, u, repos.PurposeVerifyEmail, s.VerifyTTL, ip, ua); err != nil {
		slog.ErrorContext(ctx, "auth: verification resend failed", "error", err)
	}
	return nil
}

// ForgotPassword issues a reset email. Same enumeration-proof posture: the
// HTTP response is an unconditional 202; unknown accounts send nothing.
func (s *Service) ForgotPassword(ctx context.Context, email, ip, ua string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || !validEmail(email) {
		return domain.ErrValidation("a valid email address is required")
	}
	if s.cooldownLocked(ctx, repos.PurposePasswordRest, email) {
		return domain.ErrResendCooldown(int64(s.ResendCooldown.Seconds()))
	}
	u, err := s.Users.ByEmail(ctx, email)
	if err != nil {
		return storeMapError(err)
	}
	if u == nil || u.Status != "active" || !s.hasLocalPassword(ctx, u) {
		return nil // generic 202, nothing sent (IdP-managed accounts never reset here)
	}
	if err := s.sendRecoveryEmail(ctx, u, repos.PurposePasswordRest, s.ResetTTL, ip, ua); err != nil {
		slog.ErrorContext(ctx, "auth: reset email send failed", "error", err)
	}
	return nil
}

// ResetPassword consumes the token, writes the new hash and revokes every
// live refresh family (log-out-everywhere, OWASP). The password policy runs
// BEFORE the token is consumed — a weak password must not burn the link.
func (s *Service) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	selector, verifier, ok := parseSplitToken(rawToken)
	if !ok {
		return domain.ErrInvalidRecoveryToken()
	}
	if err := ValidatePassword(newPassword, s.MinPasswordLength); err != nil {
		return err
	}
	hash, err := bcryptGenerate(newPassword)
	if err != nil {
		return domain.ErrInternal(err)
	}
	userID, _, err := s.Recovery.ResetPassword(ctx, selector, HashToken(verifier), hash)
	if err != nil {
		if errors.Is(err, repos.ErrRecoveryInvalid) {
			return domain.ErrInvalidRecoveryToken()
		}
		return repos.AsDomain(err)
	}
	// Belt-and-suspenders session kill: the SQL path revokes every family in
	// the same transaction; repeating here keeps the semantics service-owned
	// (idempotent — revoking twice is a no-op) and loud if it ever fails.
	if _, rerr := s.RefreshRepo.RevokeUser(ctx, userID, "password_reset"); rerr != nil {
		slog.ErrorContext(ctx, "auth: post-reset session revocation failed", "error", rerr, "user_id", userID)
	}
	return nil
}

// ChangePassword (authenticated): verifies the current password, writes the
// new one, revokes ALL refresh families (other devices log out), and returns
// a FRESH token pair so the calling session survives seamlessly.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) (*TokenPair, error) {
	u, err := s.Users.ByID(ctx, userID)
	if err != nil || u == nil {
		return nil, domain.ErrUnauthorized(errors.New("user not found"))
	}
	hash, err := s.Users.PasswordHash(ctx, userID)
	if err != nil || hash == "" {
		return nil, domain.ErrValidation("this account has no local password")
	}
	if !bcryptCompare(hash, currentPassword) {
		return nil, domain.ErrValidation("current password is incorrect")
	}
	if err := ValidatePassword(newPassword, s.MinPasswordLength); err != nil {
		return nil, err
	}
	if bcryptCompare(hash, newPassword) {
		return nil, domain.ErrPasswordWeak("the new password must differ from the current one")
	}
	newHash, err := bcryptGenerate(newPassword)
	if err != nil {
		return nil, domain.ErrInternal(err)
	}
	if err := s.Users.UpdatePasswordHash(ctx, userID, newHash); err != nil {
		return nil, storeMapError(err)
	}
	if _, err := s.RefreshRepo.RevokeUser(ctx, userID, "password_change"); err != nil {
		slog.ErrorContext(ctx, "auth: revoke on password change failed", "error", err)
	}
	return s.Login(ctx, u.Email, newPassword, "") // fresh family, fresh pair
}

// --- internals -----------------------------------------------------------------

// sendRecoveryEmail issues a split token and mails the link (website route).
func (s *Service) sendRecoveryEmail(ctx context.Context, u *domain.User, purpose string, ttl time.Duration, ip, ua string) error {
	if s.Recovery == nil || s.Mail == nil {
		return nil // flows not wired (pure IdP mode) — no-op
	}
	raw, selector, verifierHash := newSplitToken()
	if err := s.Recovery.Issue(ctx, u.ID, purpose, selector, verifierHash, ttl, ip, ua); err != nil {
		return err
	}
	link := s.recoveryLink(purpose, raw)
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	if purpose == repos.PurposeVerifyEmail {
		return s.Mail.SendVerification(sctx, u.Email, link)
	}
	return s.Mail.SendPasswordReset(sctx, u.Email, link)
}

// recoveryLink builds the WEBSITE link the email carries; the site's page
// POSTs the token back to this API.
func (s *Service) recoveryLink(purpose, raw string) string {
	base := strings.TrimRight(s.AppBaseURL, "/")
	path := "/verify-email"
	if purpose == repos.PurposePasswordRest {
		path = "/reset-password"
	}
	if base == "" {
		// No website configured (pure desktop deployments): expose the raw token
		// through the log mailer for ops-driven flows.
		return "token://" + purpose + "/" + raw
	}
	return fmt.Sprintf("%s%s?token=%s", base, path, raw)
}

// cooldownLocked guards email-send loops per (purpose, email): Redis SET NX EX.
// Fail-open on Redis loss (ephemeral-state posture, alarm logged).
func (s *Service) cooldownLocked(ctx context.Context, purpose, email string) bool {
	if s.Redis == nil || s.ResendCooldown <= 0 {
		return false
	}
	ok, err := s.Redis.SetNX(ctx, "auth:cooldown:"+purpose+":"+email, "1", s.ResendCooldown).Result()
	if err != nil {
		slog.WarnContext(ctx, "auth: cooldown check failed (fail-open)", "error", err)
		return false
	}
	return !ok
}

// hasLocalPassword reports whether local password reset applies (IdP-managed
// identities must recover through their provider, never here).
func (s *Service) hasLocalPassword(ctx context.Context, u *domain.User) bool {
	h, err := s.Users.PasswordHash(ctx, u.ID)
	return err == nil && h != ""
}

// validEmail is a deliberate RFC-lite check: exactly one @, non-empty local
// part and domain, domain contains a dot, no whitespace. Deep validation is
// the verification email's job (the address is proven by delivery, not syntax).
func validEmail(s string) bool {
	if s == "" || len(s) > 320 || strings.ContainsAny(s, " \t\r\n") {
		return false
	}
	at := strings.IndexByte(s, '@')
	if at <= 0 || at == len(s)-1 {
		return false
	}
	if strings.ContainsRune(s[at+1:], '@') {
		return false
	}
	domain := s[at+1:]
	return strings.IndexByte(domain, '.') > 0 && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}

// storeMapError indirection keeps the seam over store.MapDBError swappable.
var storeMapError = func(err error) *domain.Error { return store.MapDBError(err) }
