package repos

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/ids"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// RecoveryTokensRepo implements single-use recovery tokens (email verification,
// password reset) using the split-token construction:
//
//	selector  — random, indexed, the lookup half;
//	verifier  — random, NEVER stored raw; only sha256(verifier) is persisted.
//
// Lookup and verification happen in ONE atomic UPDATE (selector equality AND
// token_hash equality AND used_at IS NULL AND expires_at > now()), so:
//   - concurrent double-spend of one token: exactly one UPDATE wins;
//   - a database leak yields selectors + hashes, not usable tokens;
//   - expired / used / unknown tokens are indistinguishable to callers
//     (generic ErrRecoveryInvalid — no oracle for probing).
//
// Issuing a token supersedes (consumes) all previous live tokens of the same
// purpose for the user: newest-wins, one live token per purpose.
type RecoveryTokensRepo struct{ Pool *pgxpool.Pool }

func NewRecoveryTokens(p *pgxpool.Pool) *RecoveryTokensRepo {
	return &RecoveryTokensRepo{Pool: p}
}

// Recovery purposes (token namespaces; a token of one purpose can never be
// replayed against the other).
const (
	PurposeVerifyEmail  = "verify_email"
	PurposePasswordRest = "password_reset"
)

// ErrRecoveryInvalid is the generic dead-token signal (unknown, expired, used
// or superseded). No status detail is exposed.
var ErrRecoveryInvalid = errors.New("recovery token invalid")

// ErrEmailTaken marks a duplicate signup (unique lower(email) violation).
var ErrEmailTaken = errors.New("email already registered")

// Issue stores a new split token for (user, purpose), superseding any live
// tokens of the same purpose. selector + tokenHash come from the auth layer
// (which keeps the raw token; the database never sees it).
func (r *RecoveryTokensRepo) Issue(ctx context.Context, userID, purpose, selector, tokenHash string, ttl time.Duration, ip, ua string) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Newest-wins: consume previous live tokens of this purpose.
	if _, err := tx.Exec(ctx, `
                UPDATE auth_recovery_tokens SET used_at = now()
                WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
		userID, purpose); err != nil {
		return err
	}
	// Row id is generated here (art_<ulid>): the DDL has no default and the
	// auth layer only mints the split token (selector + verifier hash).
	if _, err := tx.Exec(ctx, `
                INSERT INTO auth_recovery_tokens
                        (id, user_id, purpose, selector, token_hash, expires_at, request_ip, user_agent)
                VALUES ($1, $2, $3, $4, $5, now() + $6::interval, $7, $8)`,
		ids.New("art"), userID, purpose, selector, tokenHash, ttl.String(),
		nullIfEmpty(ip), nullIfEmpty(ua)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApplyVerification atomically consumes a verify_email token and flips the
// user's email_verified flag in the same transaction. already=true means the
// account was already verified (idempotent UX path; the token is still burned).
func (r *RecoveryTokensRepo) ApplyVerification(ctx context.Context, selector, tokenHash string) (userID string, already bool, err error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `
                UPDATE auth_recovery_tokens SET used_at = now()
                WHERE selector = $1
                  AND purpose = 'verify_email'
                  AND token_hash = $2
                  AND used_at IS NULL
                  AND expires_at > now()
                RETURNING user_id`, selector, tokenHash).Scan(&userID); err != nil {
		if store.IsNotFound(err) {
			return "", false, ErrRecoveryInvalid
		}
		return "", false, err
	}

	// Flip the flag only when not already set (RETURNING distinguishes).
	var flipped bool
	err = tx.QueryRow(ctx, `
                UPDATE users SET email_verified = TRUE, updated_at = now()
                WHERE id = $1 AND NOT email_verified
                RETURNING TRUE`, userID).Scan(&flipped)
	if err != nil {
		if store.IsNotFound(err) {
			return "", false, ErrRecoveryInvalid
		}
		return "", false, err
	}
	return userID, !flipped, tx.Commit(ctx)
}

// ResetPassword atomically: consumes the password_reset token, writes the new
// bcrypt hash, flips email_verified (receiving the single-use reset link IS
// proof of mailbox control — the pre-hijacking escape hatch: it lets the
// legitimate owner of an unverified seeded account take it over before any
// OAuth identity may link), and revokes EVERY live refresh token family of
// the user (OWASP: a reset is a "log out everywhere" event). All-or-nothing:
// on any failure the token is NOT burned.
func (r *RecoveryTokensRepo) ResetPassword(ctx context.Context, selector, tokenHash, newHash string) (userID string, revoked int64, err error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return "", 0, err
	}
	defer tx.Rollback(ctx)

	if err := tx.QueryRow(ctx, `
                UPDATE auth_recovery_tokens SET used_at = now()
                WHERE selector = $1
                  AND purpose = 'password_reset'
                  AND token_hash = $2
                  AND used_at IS NULL
                  AND expires_at > now()
                RETURNING user_id`, selector, tokenHash).Scan(&userID); err != nil {
		if store.IsNotFound(err) {
			return "", 0, ErrRecoveryInvalid
		}
		return "", 0, err
	}

	ct, err := tx.Exec(ctx, `
                UPDATE users
                SET password_hash = $2,
                    email_verified = TRUE,
                    updated_at = now()
                WHERE id = $1`,
		userID, newHash)
	if err != nil {
		return "", 0, err
	}
	if ct.RowsAffected() == 0 {
		return "", 0, ErrRecoveryInvalid
	}

	rtCT, err := tx.Exec(ctx, `
                UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'password_reset'
                WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	if err != nil {
		return "", 0, err
	}
	return userID, rtCT.RowsAffected(), tx.Commit(ctx)
}

// SweepExpired deletes consumed/expired rows past the retention horizon.
func (r *RecoveryTokensRepo) SweepExpired(ctx context.Context, retainFor time.Duration) (int64, error) {
	ct, err := r.Pool.Exec(ctx, `
                DELETE FROM auth_recovery_tokens
                WHERE expires_at < now() - $1::interval
                   OR used_at < now() - $1::interval`, retainFor.String())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// PurgeUnverifiedAccounts deletes unverified LOCAL accounts older than the
// retention horizon — but ONLY accounts that never produced a run (data
// safety: deployments running with RequireVerified=false allow unverified
// logins; an account with usage history is real and is never touched).
// Their now-member-less personal tenants are removed by the same pass.
//
// Why this exists (2026-09-19 audit, finding 3): an attacker can seed
// victim@example.com with their own password; the pre-hijacking link-gate
// refuses OAuth linking onto the unverified row, and this purge bounds how
// long the seeded husk (and its tenant/subscription rows) lives.
func (r *RecoveryTokensRepo) PurgeUnverifiedAccounts(ctx context.Context, olderThan time.Duration) (int64, error) {
	if olderThan <= 0 {
		return 0, nil // disabled by configuration
	}
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
                DELETE FROM users u
                WHERE u.email_verified = FALSE
                  AND COALESCE(u.auth_provider, 'local') <> 'google'
                  AND u.created_at < now() - $1::interval
                  AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.user_id = u.id)`,
		olderThan.String())
	if err != nil {
		return 0, err
	}
	purged := ct.RowsAffected()

	// Orphaned tenants: the user cascade above removed their only member.
	// Member-less tenants are unreachable regardless of origin — generic
	// hygiene for any tenant that outlived its last membership.
	if _, err := tx.Exec(ctx, `
                DELETE FROM tenants t
                WHERE t.created_at < now() - $1::interval
                  AND NOT EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id = t.id)`,
		olderThan.String()); err != nil {
		return 0, err
	}
	return purged, tx.Commit(ctx)
}

// ---- signup (account creation) ------------------------------------------------

// CreateAccount provisions a self-serve signup in ONE transaction:
// user (unverified, local auth) + personal tenant + owner membership + a
// trialing subscription on the seeded 'free' plan (when present).
// Duplicate email (case-insensitive) → ErrEmailTaken; the whole transaction
// rolls back (no orphan tenant rows).
func (r *RecoveryTokensRepo) CreateAccount(ctx context.Context, email, displayName, passwordHash, userID, tenantID string) error {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
                INSERT INTO users (id, email, display_name, password_hash, status, auth_provider, email_verified)
                VALUES ($1, $2, $3, $4, 'active', 'local', FALSE)`,
		userID, email, displayName, passwordHash); err != nil {
		if store.IsUniqueViolation(err) {
			return ErrEmailTaken
		}
		return err
	}

	// Personal tenant: slug from the email local part + short random suffix
	// (slug is UNIQUE); name falls back to the display name or email local part.
	local := email
	if i := strings.IndexByte(local, '@'); i > 0 {
		local = local[:i]
	}
	slug := slugify(local) + "-" + shortRand(4)
	name := displayName
	if name == "" {
		name = local
	}
	if _, err := tx.Exec(ctx, `
                INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
		tenantID, slug, name); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
                INSERT INTO tenant_members (tenant_id, user_id, role, status)
                VALUES ($1, $2, 'owner', 'active')`, tenantID, userID); err != nil {
		return err
	}

	// Trial subscription on the seeded free plan — soft (skipped when the
	// operator removed the plan; entitlement then gates as SUBSCRIPTION_INACTIVE).
	if _, err := tx.Exec(ctx, `
                INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
                SELECT $1, $2, id, 'trialing', now(), now() + interval '30 days'
                FROM plans WHERE id = 'pln_free'`,
		"sub_"+shortRand(20), tenantID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IsEmailTaken reports a duplicate-signup signal.
func IsEmailTaken(err error) bool { return errors.Is(err, ErrEmailTaken) }

// slugify keeps [a-z0-9], collapsing everything else to single dashes.
func slugify(s string) string {
	var b strings.Builder
	lastDash := true // suppress leading dash
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "tenant"
	}
	return out
}

// shortRand returns n random hex characters (crypto/rand).
func shortRand(n int) string {
	b := make([]byte, (n+1)/2)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is unrecoverable; fall back to a time-based value
		// rather than a deterministic slug collision.
		return (hex.EncodeToString([]byte(time.Now().String())) + "0000000000000000")[:n]
	}
	return hex.EncodeToString(b)[:n]
}

// AsDomain maps recovery-repo errors onto the client error model.
func AsDomain(err error) *domain.Error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrRecoveryInvalid) {
		return domain.ErrInvalidRecoveryToken()
	}
	if IsEmailTaken(err) {
		return domain.ErrEmailTaken()
	}
	return store.MapDBError(err)
}
