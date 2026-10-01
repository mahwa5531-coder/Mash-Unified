package repos

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/ids"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// OAuthUsersRepo provisions and links OAuth identities ("Continue with
// Google" on the web login). Three resolution cases, all arbitrated by the
// unique indexes so concurrent callbacks for the same subject converge on one
// user row exactly once:
//
//  1. subject known   (auth_provider='google' AND external_subject=sub) → login
//  2. email known     (VERIFIED account with a password)              → link
//  3. nobody known                                                      → provision
//     (user + personal tenant + owner membership + trialing subscription,
//     one transaction — mirrors CreateAccount's atomic shape)
//
// ANTI PRE-HIJACKING (2026-09-19 audit, finding 3): case 2 links ONLY onto an
// account whose email address was already VERIFIED. An unverified local
// account with the same email may be attacker-seeded (attacker registers
// victim@example.com with their own password; the verification mail goes to
// the real victim and is ignored) — auto-linking a Google identity onto it
// handed the attacker a persistent backdoor while the victim believed Google
// owned the account. Unverified matches return ErrOAuthAccountUnverified: the
// email owner must first prove mailbox control (email verification, or a
// password reset — which flips the flag) before linking.
//
// Race arbitration:
//   - concurrent case-3 for the same subject  → uq_users_external_subject
//     rejects the loser → ErrOAuthSubjectRace → the caller re-runs and lands
//     in case 1;
//   - concurrent case-3 for the same email    → uq_users_email_lower rejects
//     the loser → ErrEmailTaken → the caller re-runs and lands in case 2;
//   - case 2 onto an email already bound to a DIFFERENT Google subject →
//     ErrIdentityConflict (operator-visible, never silently re-linked).
type OAuthUsersRepo struct{ Pool *pgxpool.Pool }

func NewOAuthUsers(p *pgxpool.Pool) *OAuthUsersRepo { return &OAuthUsersRepo{Pool: p} }

// ErrOAuthSubjectRace marks the lost side of a concurrent same-subject
// provision (transient by construction: the retry finds case 1).
var ErrOAuthSubjectRace = errors.New("oauth subject provision race")

// ErrIdentityConflict marks an email already linked to a different external
// subject (never auto-re-linked; the user must sign in the original way).
var ErrIdentityConflict = errors.New("identity conflict")

// ErrOAuthAccountUnverified marks the pre-hijacking defense: the email match
// is an UNVERIFIED local account, so the link is refused until the mailbox is
// proven (verification or password reset).
var ErrOAuthAccountUnverified = errors.New("oauth target account unverified")

// OAuthOutcome distinguishes what FindOrCreateGoogleUser did — the service
// layer uses it to send the link notification only on an actual link.
type OAuthOutcome int

const (
	OAuthLoggedIn    OAuthOutcome = iota // case 1: known subject, plain sign-in
	OAuthLinked                          // case 2: Google identity linked to a password account
	OAuthProvisioned                     // case 3: fresh account created
)

// FindOrCreateGoogleUser resolves one verified Google identity per the three
// cases above and returns the (possibly just-created) user plus the outcome.
// displayName refreshes an empty display_name on login/link (Google is the
// source of truth for the profile name).
func (r *OAuthUsersRepo) FindOrCreateGoogleUser(ctx context.Context, sub, email, displayName string) (*domain.User, OAuthOutcome, error) {
	// Case 1: the Google subject is already known → login.
	if u, err := r.bySubject(ctx, sub); err != nil || u != nil {
		return u, OAuthLoggedIn, err
	}

	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)

	// Serialize concurrent resolvers of the same subject/email inside the
	// transaction: the SELECTs below take row locks when they match.
	// Case 2: same email, another provider → link the Google identity.
	var id, existingSubject string
	var hasSubject, emailVerified bool
	err = tx.QueryRow(ctx, `
                SELECT id,
                       external_subject IS NOT NULL AND external_subject <> '' AS has_subject,
                       COALESCE(external_subject, ''),
                       email_verified
                FROM users WHERE lower(email) = lower($1) FOR UPDATE`, email).
		Scan(&id, &hasSubject, &existingSubject, &emailVerified)
	switch {
	case err == nil:
		if hasSubject && existingSubject != sub {
			// A different Google identity owns this email.
			return nil, 0, ErrIdentityConflict
		}
		if !emailVerified {
			// Pre-hijacking defense: the local account with this
			// email never proved mailbox control — refuse the link.
			return nil, 0, ErrOAuthAccountUnverified
		}
		if _, err := tx.Exec(ctx, `
                        UPDATE users SET
                                auth_provider = 'google',
                                external_subject = $2,
                                email_verified = TRUE,
                                display_name = CASE WHEN display_name = '' THEN $3 ELSE display_name END,
                                updated_at = now()
                        WHERE id = $1`, id, sub, displayName); err != nil {
			return nil, 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, id); err != nil {
			return nil, 0, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, 0, err
		}
		u, err := r.bySubject(ctx, sub)
		return u, OAuthLinked, err

	case store.IsNotFound(err):
		// Case 3: provision atomically.

	default:
		return nil, 0, err
	}

	userID, tenantID := ids.UserID(), ids.TenantID()
	if _, err := tx.Exec(ctx, `
                INSERT INTO users (id, email, display_name, password_hash, status, auth_provider, external_subject, email_verified)
                VALUES ($1, $2, $3, NULL, 'active', 'google', $4, TRUE)`,
		userID, email, displayName, sub); err != nil {
		if store.IsUniqueViolation(err) {
			// Same-subject race → the winner exists now (case 1).
			// Same-email race → case 2 on retry.
			if r.subjectExists(ctx, sub) {
				return nil, 0, ErrOAuthSubjectRace
			}
			return nil, 0, ErrEmailTaken
		}
		return nil, 0, err
	}

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
		return nil, 0, err
	}
	if _, err := tx.Exec(ctx, `
                INSERT INTO tenant_members (tenant_id, user_id, role, status)
                VALUES ($1, $2, 'owner', 'active')`, tenantID, userID); err != nil {
		return nil, 0, err
	}
	if _, err := tx.Exec(ctx, `
                INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
                SELECT $1, $2, id, 'trialing', now(), now() + interval '30 days'
                FROM plans WHERE id = 'pln_free'`,
		"sub_"+shortRand(20), tenantID); err != nil {
		return nil, 0, err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, userID); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return &domain.User{
		ID: userID, Email: email, DisplayName: displayName, Status: "active",
		AuthProvider: "google", EmailVerified: true,
	}, OAuthProvisioned, nil
}

// bySubject loads a Google-linked user.
func (r *OAuthUsersRepo) bySubject(ctx context.Context, sub string) (*domain.User, error) {
	u, err := scanUser(r.Pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE auth_provider = 'google' AND external_subject = $1`, sub))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return u, err
}

func (r *OAuthUsersRepo) subjectExists(ctx context.Context, sub string) bool {
	var one int
	err := r.Pool.QueryRow(ctx,
		`SELECT 1 FROM users WHERE auth_provider = 'google' AND external_subject = $1`, sub).Scan(&one)
	return err == nil
}

// ---- devices -------------------------------------------------------------------

// DevicesRepo registers desktop devices on handshake exchange.
type DevicesRepo struct{ Pool *pgxpool.Pool }

func NewDevices(p *pgxpool.Pool) *DevicesRepo { return &DevicesRepo{Pool: p} }

// UpsertDevice registers or refreshes a device row. When deviceID is empty
// (first sign-in on this machine) a new row is created. A deviceID that does
// not exist or belongs to a DIFFERENT user is ignored (a client-supplied id
// is untrusted input; minting a fresh row is the safe failure mode).
func (r *DevicesRepo) UpsertDevice(ctx context.Context, userID, deviceID, name, platform string) (string, error) {
	if deviceID != "" {
		var owner string
		err := r.Pool.QueryRow(ctx, `SELECT user_id FROM devices WHERE id = $1`, deviceID).Scan(&owner)
		if err == nil && owner == userID {
			_, err := r.Pool.Exec(ctx, `
                                UPDATE devices SET name = $3, platform = $4, last_seen_at = now()
                                WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
				deviceID, userID, name, platform)
			if err != nil {
				return "", err
			}
			return deviceID, nil
		}
		if err != nil && !store.IsNotFound(err) {
			return "", err
		}
		// Unknown or foreign id → fall through to a fresh device row.
	}
	id := ids.DeviceID()
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO devices (id, user_id, name, platform) VALUES ($1, $2, $3, $4)`,
		id, userID, name, platform)
	if err != nil {
		return "", err
	}
	return id, nil
}
