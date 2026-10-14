package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/store"
	"github.com/mash-cloud/mash-api/internal/store/repos"
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
			ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, AvatarURL: u.AvatarURL,
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

	// FREE-PLAN DEFAULT: a tenant without an effective (paid, unexpired)
	// subscription is not plan-less-and-unbounded — it falls back to the
	// 'free' plan's limits + model allowlist. Plans only: Free is what you
	// are until you buy Pro; expiry returns you here automatically.
	var planLimits domain.PlanLimits
	var planInfo PlanInfo
	var planModels []string
	if sub != nil {
		id.SubscriptionStatus = sub.Status
		planInfo = PlanInfo{ID: sub.Plan.ID, Code: sub.Plan.Code, Name: sub.Plan.Name}
		planLimits = sub.Plan.Limits
		planModels = sub.Plan.Models
	} else if fp, ferr := r.Subs.PlanByCode(ctx, "free"); ferr == nil && fp != nil {
		id.SubscriptionStatus = "active" // ponytail: perpetual free fallback is active, matching /v1/me and auditlive specs
		planInfo = PlanInfo{ID: fp.ID, Code: fp.Code, Name: fp.Name}
		planLimits = fp.Limits
		planModels = fp.Models
	} else if ferr != nil {
		return nil, store.MapDBError(ferr)
	}
	if planInfo.Code != "" {
		id.Plan = planInfo
		id.Limits = Limits{
			RequestsPerMinuteUser:    planLimits.RequestsPerMinuteUser,
			RequestsPerMinuteTenant:  planLimits.RequestsPerMinuteTenant,
			ConcurrentRequestsUser:   planLimits.ConcurrentRequestsUser,
			ConcurrentRequestsTenant: planLimits.ConcurrentRequestsTenant,
			MaxRequestBytes:          planLimits.MaxRequestBytes,
			Window5hTokens:           planLimits.Window5hTokens,
			WindowWeeklyTokens:       planLimits.WindowWeeklyTokens,
		}
	}

	models, restricted, err := r.Ents.ModelsAllowlist(ctx, tenantID, planModels)
	if err != nil {
		return nil, store.MapDBError(err)
	}
	id.Models = models
	id.Restricted = restricted
	return id, nil
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
