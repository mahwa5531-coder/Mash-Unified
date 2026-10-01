package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

// IdentityResolver turns verified claims into the full server-authoritative
// Identity (user, tenant, membership, subscription, entitlements). Results
// are cached in Redis for a short TTL to keep the hot path off PostgreSQL;
// PostgreSQL remains the source of truth and the cache is fail-through.
type IdentityResolver struct {
	Users    *repos.UsersRepo
	Tenants  *repos.TenantsRepo
	Subs     *repos.SubscriptionsRepo
	Ents     *repos.EntitlementsRepo
	Redis    redis.UniversalClient
	CacheTTL time.Duration
}

const identityCachePrefix = "auth:identity:"

// Resolve is fail-closed: storage failures return 503-class domain errors.
func (r *IdentityResolver) Resolve(ctx context.Context, userID, tenantID string) (*Identity, error) {
	if tenantID == "" {
		// No tenant in token: resolve the first active membership.
		ms, err := r.Tenants.Memberships(ctx, userID)
		if err != nil {
			return nil, store.MapDBError(err)
		}
		if len(ms) == 0 {
			return nil, domain.ErrForbidden("user has no active tenant membership")
		}
		tenantID = ms[0].TenantID
	}

	// 1. Cache lookup (best-effort; Redis down → straight to PostgreSQL).
	if r.Redis != nil {
		if blob, err := r.Redis.Get(ctx, identityCacheKey(userID, tenantID)).Bytes(); err == nil {
			var id Identity
			if json.Unmarshal(blob, &id) == nil && id.User.ID == userID && id.Tenant.ID == tenantID {
				return &id, nil
			}
		}
	}

	// 2. Authoritative load.
	id, err := r.load(ctx, userID, tenantID)
	if err != nil {
		return nil, err
	}

	// 3. Cache fill (best-effort, short TTL bounds staleness).
	if r.Redis != nil {
		if blob, err := json.Marshal(id); err == nil {
			r.Redis.Set(ctx, identityCacheKey(userID, tenantID), blob, r.CacheTTL)
		}
	}
	return id, nil
}

func (r *IdentityResolver) load(ctx context.Context, userID, tenantID string) (*Identity, error) {
	u, err := r.Users.ByID(ctx, userID)
	if err != nil {
		return nil, store.MapDBError(err)
	}
	if u == nil {
		return nil, domain.ErrUnauthorized(errors.New("user not found"))
	}

	t, err := r.Tenants.ByID(ctx, tenantID)
	if err != nil {
		return nil, store.MapDBError(err)
	}
	if t == nil {
		return nil, domain.ErrForbidden("tenant not found")
	}

	m, err := r.Tenants.Membership(ctx, tenantID, userID)
	if err != nil {
		return nil, store.MapDBError(err)
	}
	if m == nil {
		return nil, domain.ErrForbidden("no membership in tenant")
	}

	id := &Identity{
		User: UserInfo{
			ID: u.ID, Email: u.Email, DisplayName: u.DisplayName,
			Status: u.Status, IsPlatformAdmin: u.IsPlatformAdmin,
			EmailVerified: u.EmailVerified,
		},
		Tenant:     TenantInfo{ID: t.ID, Slug: t.Slug, Name: t.Name, Status: t.Status},
		Membership: MembershipInfo{Role: m.Role, Status: m.Status},
	}

	sub, err := r.Subs.Effective(ctx, tenantID)
	if err != nil {
		return nil, store.MapDBError(err)
	}
	if sub != nil {
		id.SubscriptionStatus = sub.Status
		id.Limits = Limits{
			RequestsPerMinuteUser:   sub.Plan.Limits.RequestsPerMinuteUser,
			RequestsPerMinuteTenant: sub.Plan.Limits.RequestsPerMinuteTenant,
			ConcurrentRunsUser:      sub.Plan.Limits.ConcurrentRunsUser,
			ConcurrentRunsTenant:    sub.Plan.Limits.ConcurrentRunsTenant,
			MaxRequestBytes:         sub.Plan.Limits.MaxRequestBytes,
			MonthlyTokenQuota:       sub.Plan.Limits.MonthlyTokenQuota,
		}
	}

	models, restricted, err := r.Ents.ModelsAllowlist(ctx, tenantID, subPlanModels(sub))
	if err != nil {
		return nil, store.MapDBError(err)
	}
	id.Models = models
	id.Restricted = restricted
	return id, nil
}

func subPlanModels(sub *domain.Subscription) []string {
	if sub == nil {
		return nil
	}
	return sub.Plan.Models
}

func identityCacheKey(userID, tenantID string) string {
	return fmt.Sprintf("%s%s:%s", identityCachePrefix, userID, tenantID)
}

// Invalidate drops the cached identity (called on logout / admin changes).
func (r *IdentityResolver) Invalidate(ctx context.Context, userID, tenantID string) {
	if r.Redis == nil {
		return
	}
	r.Redis.Del(ctx, identityCacheKey(userID, tenantID))
}

// BumpVersion is a no-op placeholder for future cache-versioning; TTL bounds
// staleness to CacheTTL today.
func (r *IdentityResolver) BumpVersion(ctx context.Context, userID string) {}
