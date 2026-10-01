// Package repos contains PostgreSQL repositories. Every tenant-scoped query
// takes tenantID and filters on it — this is the API-layer tenant isolation
// backbone. All queries use explicit column lists (no SELECT *).
package repos

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// UsersRepo persists users.
type UsersRepo struct{ Pool *pgxpool.Pool }

func NewUsers(p *pgxpool.Pool) *UsersRepo { return &UsersRepo{Pool: p} }

const userCols = `id, email, display_name, status, is_platform_admin, auth_provider, email_verified, created_at, updated_at`

func scanUser(row pgx.Row) (*domain.User, error) {
	u := &domain.User{}
	err := row.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Status, &u.IsPlatformAdmin, &u.AuthProvider, &u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	return u, err
}

func (r *UsersRepo) ByEmail(ctx context.Context, email string) (*domain.User, error) {
	u, err := scanUser(r.Pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE lower(email) = lower($1)`, email))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return u, err
}

func (r *UsersRepo) ByID(ctx context.Context, id string) (*domain.User, error) {
	u, err := scanUser(r.Pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE id = $1`, id))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return u, err
}

// ByExternalSubject resolves an IdP-managed identity.
func (r *UsersRepo) ByExternalSubject(ctx context.Context, provider, subject string) (*domain.User, error) {
	u, err := scanUser(r.Pool.QueryRow(ctx,
		`SELECT `+userCols+` FROM users WHERE auth_provider = $1 AND external_subject = $2`,
		provider, subject))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return u, err
}

func (r *UsersRepo) Create(ctx context.Context, u *domain.User, passwordHash *string) error {
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO users (id, email, display_name, password_hash, status, is_platform_admin, auth_provider, external_subject, email_verified)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		u.ID, u.Email, u.DisplayName, passwordHash, u.Status, u.IsPlatformAdmin, u.AuthProvider, "", u.EmailVerified)
	return err
}

// SetEmailVerified flips the verification flag (recovery flow).
func (r *UsersRepo) SetEmailVerified(ctx context.Context, userID string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1`, userID)
	return err
}

func (r *UsersRepo) TouchLogin(ctx context.Context, id string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1`, id)
	return err
}

// PasswordHash loads the stored bcrypt hash for login verification (auth
// service seam; COALESCE keeps the SQL a single row even for IdP-only users).
func (r *UsersRepo) PasswordHash(ctx context.Context, userID string) (string, error) {
	var h string
	err := r.Pool.QueryRow(ctx,
		`SELECT COALESCE(password_hash, '') FROM users WHERE id = $1`, userID).Scan(&h)
	return h, err
}

func (r *UsersRepo) UpdatePasswordHash(ctx context.Context, id string, hash string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, id, hash)
	return err
}

// TenantsRepo persists tenants and memberships.
type TenantsRepo struct{ Pool *pgxpool.Pool }

func NewTenants(p *pgxpool.Pool) *TenantsRepo { return &TenantsRepo{Pool: p} }

func (r *TenantsRepo) ByID(ctx context.Context, id string) (*domain.Tenant, error) {
	t := &domain.Tenant{}
	err := r.Pool.QueryRow(ctx,
		`SELECT id, slug, name, status FROM tenants WHERE id = $1`, id).
		Scan(&t.ID, &t.Slug, &t.Name, &t.Status)
	if store.IsNotFound(err) {
		return nil, nil
	}
	return t, err
}

func (r *TenantsRepo) Membership(ctx context.Context, tenantID, userID string) (*domain.Membership, error) {
	m := &domain.Membership{}
	err := r.Pool.QueryRow(ctx, `
                SELECT tenant_id, user_id, role, status FROM tenant_members
                WHERE tenant_id = $1 AND user_id = $2`, tenantID, userID).
		Scan(&m.TenantID, &m.UserID, &m.Role, &m.Status)
	if store.IsNotFound(err) {
		return nil, nil
	}
	return m, err
}

// Memberships lists the active memberships of a user (tenant resolution for
// token claims refresh).
func (r *TenantsRepo) Memberships(ctx context.Context, userID string) ([]domain.Membership, error) {
	rows, err := r.Pool.Query(ctx, `
                SELECT tenant_id, user_id, role, status FROM tenant_members
                WHERE user_id = $1 AND status = 'active'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Membership
	for rows.Next() {
		var m domain.Membership
		if err := rows.Scan(&m.TenantID, &m.UserID, &m.Role, &m.Status); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *TenantsRepo) CreateTenant(ctx context.Context, t *domain.Tenant) error {
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO tenants (id, slug, name, status) VALUES ($1, $2, $3, $4)`,
		t.ID, t.Slug, t.Name, t.Status)
	return err
}

func (r *TenantsRepo) AddMember(ctx context.Context, m *domain.Membership) error {
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO tenant_members (tenant_id, user_id, role, status) VALUES ($1, $2, $3, $4)
                ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
		m.TenantID, m.UserID, m.Role, m.Status)
	return err
}

// SubscriptionsRepo reads the effective subscription + plan of a tenant.
type SubscriptionsRepo struct{ Pool *pgxpool.Pool }

func NewSubscriptions(p *pgxpool.Pool) *SubscriptionsRepo {
	return &SubscriptionsRepo{Pool: p}
}

func (r *SubscriptionsRepo) Effective(ctx context.Context, tenantID string) (*domain.Subscription, error) {
	s := &domain.Subscription{}
	var limits []byte
	var models []byte
	err := r.Pool.QueryRow(ctx, `
                SELECT sub.id, sub.tenant_id, sub.plan_id, sub.status,
                       sub.current_period_start, sub.current_period_end,
                       pl.id, pl.code, pl.name, pl.limits, pl.models
                FROM subscriptions sub
                JOIN plans pl ON pl.id = sub.plan_id
                WHERE sub.tenant_id = $1
                  AND sub.status IN ('trialing','active','past_due')
                ORDER BY sub.status = 'past_due' ASC, sub.created_at DESC
                LIMIT 1`, tenantID).
		Scan(&s.ID, &s.TenantID, &s.PlanID, &s.Status,
			&s.CurrentPeriodStart, &s.CurrentPeriodEnd,
			&s.Plan.ID, &s.Plan.Code, &s.Plan.Name, &limits, &models)
	if store.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// limits/models are JSONB; lenient decode — plan data is operator-authored.
	if len(limits) > 2 {
		_ = jsonUnmarshal(limits, &s.Plan.Limits)
	}
	if len(models) > 2 {
		_ = jsonUnmarshal(models, &s.Plan.Models)
	}
	return s, nil
}

// EntitlementsRepo reads tenant entitlement overrides.
type EntitlementsRepo struct{ Pool *pgxpool.Pool }

func NewEntitlements(p *pgxpool.Pool) *EntitlementsRepo {
	return &EntitlementsRepo{Pool: p}
}

// ModelsAllowlist merges plan models + entitlement overrides (key
// models.allow). Returns nil when unrestricted is not determinable.
func (r *EntitlementsRepo) ModelsAllowlist(ctx context.Context, tenantID string, planModels []string) ([]string, bool, error) {
	var raw []byte
	err := r.Pool.QueryRow(ctx, `
                SELECT value FROM entitlements
                WHERE tenant_id = $1 AND key = 'models.allow'
                  AND (expires_at IS NULL OR expires_at > now())`, tenantID).
		Scan(&raw)
	if store.IsNotFound(err) {
		if len(planModels) == 0 {
			return nil, false, nil // unrestricted
		}
		return planModels, true, nil
	}
	if err != nil {
		return nil, false, err
	}
	var models []string
	if err := jsonUnmarshal(raw, &models); err != nil {
		return planModels, len(planModels) > 0, nil
	}
	if len(models) == 0 {
		return nil, false, nil // empty override = unrestricted
	}
	return models, true, nil
}
