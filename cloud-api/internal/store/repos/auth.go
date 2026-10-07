package repos

import (
	"context"
	"database/sql"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mash-cloud/mash-api/internal/store"
)

// RefreshTokensRepo implements opaque refresh tokens with rotation and
// family-based reuse detection (RFC 6819 §5.2.2.3):
//   - tokens are stored hash-only (SHA-256),
//   - each rotation records replaced_by,
//   - presenting a consumed token revokes the entire family (theft signal).
type RefreshTokensRepo struct{ Pool *pgxpool.Pool }

func NewRefreshTokens(p *pgxpool.Pool) *RefreshTokensRepo {
	return &RefreshTokensRepo{Pool: p}
}

// RefreshToken is the persisted record.
type RefreshToken struct {
	ID            string
	UserID        string
	TenantID      string
	DeviceID      string
	FamilyID      string
	TokenHash     string
	ExpiresAt     time.Time
	CreatedAt     time.Time
	UsedAt        *time.Time
	RevokedAt     *time.Time
	RevokedReason string
	ReplacedBy    string
	UserAgent     string
}

// refreshTokenCols is the canonical column list for refresh_tokens reads.
// tenant_id / device_id / revoked_reason / replaced_by are ALL nullable in
// the DDL; the struct carries them as empty-string (real-Postgres E2E
// 2026-09-23: scanning NULL device_id into the plain string field failed
// and every refresh of a non-OAuth login died with a raw 500).
const refreshTokenCols = `id, user_id, tenant_id, device_id, family_id, token_hash,
        expires_at, created_at, used_at, revoked_at, revoked_reason, replaced_by, user_agent`

// scanRefreshToken reads one row in refreshTokenCols order, tolerating NULLs.
func scanRefreshToken(row pgx.Row, t *RefreshToken) error {
	var tenantID, deviceID, reason, replaced sql.NullString
	err := row.Scan(&t.ID, &t.UserID, &tenantID, &deviceID, &t.FamilyID,
		&t.TokenHash, &t.ExpiresAt, &t.CreatedAt, &t.UsedAt, &t.RevokedAt,
		&reason, &replaced, &t.UserAgent)
	if err != nil {
		return err
	}
	t.TenantID, t.DeviceID = tenantID.String, deviceID.String
	t.RevokedReason, t.ReplacedBy = reason.String, replaced.String
	return nil
}

// Consume atomically claims a refresh token for rotation. Returns:
//   - token, claimed=true, err=nil → proceed to rotate
//   - token, claimed=false, err=nil → token was already used → REUSE SIGNAL
//   - err → not found / expired / revoked
func (r *RefreshTokensRepo) Consume(ctx context.Context, tokenHash string) (*RefreshToken, bool, error) {
	t := &RefreshToken{}
	err := scanRefreshToken(r.Pool.QueryRow(ctx, `
                UPDATE refresh_tokens SET used_at = now()
                WHERE token_hash = $1
                  AND revoked_at IS NULL
                  AND used_at IS NULL
                  AND expires_at > now()
                RETURNING `+refreshTokenCols,
		tokenHash), t)
	if err != nil {
		if store.IsNotFound(err) {
			// Distinguish "exists but dead" from "never existed" for the reuse path.
			var status string
			err2 := r.Pool.QueryRow(ctx, `
                                SELECT CASE
                                        WHEN revoked_at IS NOT NULL THEN 'revoked'
                                        WHEN used_at IS NOT NULL     THEN 'used'
                                        WHEN expires_at <= now()     THEN 'expired'
                                        ELSE 'missing' END
                                FROM refresh_tokens WHERE token_hash = $1`, tokenHash).Scan(&status)
			if err2 == nil && status != "missing" {
				return nil, false, errReuseSignal{status: status}
			}
			return nil, false, nil
		}
		return nil, false, err
	}
	return t, true, nil
}

// errReuseSignal marks a presented-but-dead token: possible theft.
type errReuseSignal struct{ status string }

func (e errReuseSignal) Error() string {
	return "refresh token reuse detected (token " + e.status + ")"
}

// IsReuseSignal reports whether Consume flagged a dead-token presentation.
func IsReuseSignal(err error) bool {
	_, ok := err.(errReuseSignal)
	return ok
}

// ReuseSignal constructs a dead-token presentation error (storage-fake seam
// for the service-level rotation/reuse tests: signup_test.go, validation/signup_test.go).
func ReuseSignal(status string) error { return errReuseSignal{status: status} }

// ReuseStatus extracts the dead-token state if err is a reuse signal.
func ReuseStatus(err error) (string, bool) {
	if e, ok := err.(errReuseSignal); ok {
		return e.status, true
	}
	return "", false
}

// ByHash loads a refresh token row in ANY state (reuse forensics).
func (r *RefreshTokensRepo) ByHash(ctx context.Context, tokenHash string) (*RefreshToken, error) {
	t := &RefreshToken{}
	err := scanRefreshToken(r.Pool.QueryRow(ctx, `
                SELECT `+refreshTokenCols+`
                FROM refresh_tokens WHERE token_hash = $1`, tokenHash), t)
	if store.IsNotFound(err) {
		return nil, nil
	}
	return t, err
}

// RevokeFamily revokes every token in a family — invoked on reuse detection.
func (r *RefreshTokensRepo) RevokeFamily(ctx context.Context, familyID, reason string) (int64, error) {
	ct, err := r.Pool.Exec(ctx, `
                UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
                WHERE family_id = $1 AND revoked_at IS NULL`, familyID, reason)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// Issue creates a fresh token; familyID carries the lineage (new family for
// fresh logins, existing family for rotations).
func (r *RefreshTokensRepo) Issue(ctx context.Context, t *RefreshToken) error {
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO refresh_tokens (id, user_id, tenant_id, device_id, family_id,
                        token_hash, expires_at, user_agent)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		t.ID, t.UserID, nullString(t.TenantID), nullString(t.DeviceID), t.FamilyID,
		t.TokenHash, t.ExpiresAt, t.UserAgent)
	return err
}

// LinkReplacement marks old → new (family audit trail).
func (r *RefreshTokensRepo) LinkReplacement(ctx context.Context, oldID, newID string) error {
	_, err := r.Pool.Exec(ctx, `
                UPDATE refresh_tokens SET replaced_by = $2, revoked_at = now(), revoked_reason = 'rotation'
                WHERE id = $1`, oldID, newID)
	return err
}

// RevokeUser revokes all of a user's live tokens (logout-all / admin action).
func (r *RefreshTokensRepo) RevokeUser(ctx context.Context, userID, reason string) (int64, error) {
	ct, err := r.Pool.Exec(ctx, `
                UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = $2
                WHERE user_id = $1 AND revoked_at IS NULL`, userID, reason)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// SweepExpired deletes expired+revoked rows older than retention (housekeeping).
func (r *RefreshTokensRepo) SweepExpired(ctx context.Context, retainFor time.Duration) (int64, error) {
	ct, err := r.Pool.Exec(ctx, `
                DELETE FROM refresh_tokens
                WHERE expires_at < now() - $1::interval
                   OR revoked_at < now() - $1::interval`, retainFor.String())
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}
