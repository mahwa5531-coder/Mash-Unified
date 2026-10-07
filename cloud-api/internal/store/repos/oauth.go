package repos

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/store"
)

// OAuthUsersRepo provisions Google OAuth identities ("Continue with Google"
// on the web login). Two resolution cases, arbitrated by the unique indexes
// so concurrent callbacks for the same subject converge on one user row
// exactly once:
//
//  1. subject known (auth_provider='google' AND external_subject=sub) → login
//     (profile fields refresh from the current ID token: avatar_url, and
//     display_name only while it is still empty)
//  2. nobody known → provision (user + personal tenant + owner membership +
//     trialing subscription, one transaction)
//
// An email match with a DIFFERENT Google subject is ErrIdentityConflict:
// the mailbox belongs to another identity and is never auto-re-linked (the
// identity anchor is the Google sub, never the email).
//
// Race arbitration:
//   - concurrent case-2 for the same subject → uq_users_external_subject
//     rejects the loser → ErrOAuthSubjectRace → the caller re-runs and lands
//     in case 1;
//   - concurrent case-2 for the same email   → uq_users_email_lower rejects
//     the loser → ErrEmailTaken → the caller re-runs and lands in the
//     conflict check.
type OAuthUsersRepo struct{ Pool *pgxpool.Pool }

func NewOAuthUsers(p *pgxpool.Pool) *OAuthUsersRepo { return &OAuthUsersRepo{Pool: p} }

// ErrOAuthSubjectRace marks the lost side of a concurrent same-subject
// provision (transient by construction: the retry finds case 1).
var ErrOAuthSubjectRace = errors.New("oauth subject provision race")

// ErrIdentityConflict marks an email already linked to a different Google
// subject (never auto-re-linked; the user must sign in the original way).
var ErrIdentityConflict = errors.New("identity conflict")

// FindOrCreateGoogleUser resolves one verified Google identity per the cases
// above and returns the (possibly just-created) user.
func (r *OAuthUsersRepo) FindOrCreateGoogleUser(ctx context.Context, sub, email, displayName, avatarURL string) (*domain.User, error) {
	// Case 1: the Google subject is already known → login + profile refresh.
	if u, err := r.bySubject(ctx, sub); err != nil || u != nil {
		if u != nil {
			if err := r.refreshProfile(ctx, u.ID, displayName, avatarURL); err != nil {
				return u, nil // profile refresh is best-effort; the login stands
			}
		}
		return u, err
	}

	// Email conflict check: the mailbox belongs to a different identity.
	var existingSubject string
	err := r.Pool.QueryRow(ctx,
		`SELECT external_subject FROM users WHERE lower(email) = lower($1)`, email).
		Scan(&existingSubject)
	switch {
	case err == nil:
		if existingSubject != sub {
			return nil, ErrIdentityConflict
		}
		// Same subject reachable by email: re-run case 1 (row committed between
		// the two queries — concurrent callback race).
		return r.bySubject(ctx, sub)
	case !store.IsNotFound(err):
		return nil, err
	}

	// Case 2: provision atomically.
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	userID, tenantID := ids.UserID(), ids.TenantID()
	if _, err := tx.Exec(ctx, `
		INSERT INTO users (id, email, display_name, avatar_url, status, auth_provider, external_subject, email_verified)
		VALUES ($1, $2, $3, $4, 'active', 'google', $5, TRUE)`,
		userID, email, displayName, avatarURL, sub); err != nil {
		if store.IsUniqueViolation(err) {
			// Same-subject race → the winner exists now (case 1).
			if r.subjectExists(ctx, sub) {
				return nil, ErrOAuthSubjectRace
			}
			return nil, ErrEmailTaken
		}
		return nil, err
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
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO tenant_members (tenant_id, user_id, role, status)
		VALUES ($1, $2, 'owner', 'active')`, tenantID, userID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end)
		SELECT $1, $2, id, 'trialing', now(), now() + interval '30 days'
		FROM plans WHERE id = 'pln_free'`,
		"sub_"+shortRand(20), tenantID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET last_login_at = now() WHERE id = $1`, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &domain.User{
		ID: userID, Email: email, DisplayName: displayName, AvatarURL: avatarURL,
		Status: "active", AuthProvider: "google", ExternalSubject: sub,
		EmailVerified: true,
	}, nil
}

// refreshProfile updates the Google-sourced profile fields on login.
// avatar_url refreshes unconditionally (Google rotates picture URLs);
// display_name only fills an empty value (the user may have personalized it
// locally... there is no local profile editor yet, but the rule is cheap).
func (r *OAuthUsersRepo) refreshProfile(ctx context.Context, userID, displayName, avatarURL string) error {
	_, err := r.Pool.Exec(ctx, `
		UPDATE users SET
			avatar_url = $2,
			display_name = CASE WHEN display_name = '' THEN $3 ELSE display_name END,
			last_login_at = now(),
			updated_at = now()
		WHERE id = $1`, userID, avatarURL, displayName)
	return err
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

// ---- helpers ------------------------------------------------------------------

// slugify produces a tenant-slug-safe rendering of an email local part.
func slugify(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '_' || r == '-' || r == '+':
			// collapse to '-'
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "user"
	}
	if len(out) > 32 {
		out = out[:32]
	}
	return out
}

// shortRand returns n random bytes, base64 (URL) encoded.
func shortRand(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ---- devices ------------------------------------------------------------------

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
