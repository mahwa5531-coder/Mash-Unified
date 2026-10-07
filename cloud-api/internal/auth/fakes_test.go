package auth

// In-memory storage fakes for the service seams (UsersStore, TenantsStore,
// RefreshStore). They mirror the SQL semantics that matter to the flows under
// test: atomic single-consume for refresh tokens, active-membership
// resolution for tenant context.

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// ---- users ---------------------------------------------------------------------

type memUser struct {
	u domain.User
}

type memUsers struct {
	mu   sync.Mutex
	byID map[string]*memUser
	byEm map[string]*memUser
}

func newMemUsers() *memUsers {
	return &memUsers{byID: map[string]*memUser{}, byEm: map[string]*memUser{}}
}

func (m *memUsers) ByID(_ context.Context, id string) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byID[id]; ok {
		u2 := u.u
		return &u2, nil
	}
	return nil, nil
}

func (m *memUsers) TouchLogin(_ context.Context, id string) error {
	return nil // not asserted in these tests
}

// ---- tenants -------------------------------------------------------------------

type memTenant struct {
	tenantID string
	role     string
}

type memTenants struct {
	mu     sync.Mutex
	byUser map[string][]memTenant
}

func (m *memTenants) ByID(_ context.Context, _ string) (*domain.Tenant, error) {
	return &domain.Tenant{ID: "ten_1", Slug: "ten-1", Name: "Ten One", Status: "active"}, nil
}

func (m *memTenants) Membership(_ context.Context, tenantID, userID string) (*domain.Membership, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.byUser[userID] {
		if t.tenantID == tenantID {
			return &domain.Membership{TenantID: tenantID, UserID: userID, Role: t.role, Status: "active"}, nil
		}
	}
	return nil, nil
}

func (m *memTenants) Memberships(_ context.Context, userID string) ([]domain.Membership, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []domain.Membership
	for _, t := range m.byUser[userID] {
		out = append(out, domain.Membership{TenantID: t.tenantID, UserID: userID, Role: t.role, Status: "active"})
	}
	return out, nil
}

// ---- refresh tokens -------------------------------------------------------------

var errMemRevoked = errors.New("mem: token revoked or used")

type memRefreshToken struct {
	rt       repos.RefreshToken
	consumed bool
}

type memRefresh struct {
	mu   sync.Mutex
	byID map[string]*memRefreshToken
}

func newMemRefresh() *memRefresh {
	return &memRefresh{byID: map[string]*memRefreshToken{}}
}

func (m *memRefresh) Issue(_ context.Context, rt *repos.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byID[rt.ID] = &memRefreshToken{rt: *rt}
	return nil
}

// Consume atomically marks a live token used and returns it (SQL UPDATE …
// WHERE used_at IS NULL AND revoked_at IS NULL parity).
func (m *memRefresh) Consume(_ context.Context, tokenHash string) (*repos.RefreshToken, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.byID {
		if t.rt.TokenHash != tokenHash {
			continue
		}
		if t.rt.UsedAt != nil || t.rt.RevokedAt != nil {
			return &t.rt, false, errMemRevoked
		}
		now := time.Now()
		t.rt.UsedAt = &now
		t.consumed = true
		return &t.rt, true, nil
	}
	return nil, false, errMemRevoked
}

func (m *memRefresh) ByHash(_ context.Context, tokenHash string) (*repos.RefreshToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.byID {
		if t.rt.TokenHash == tokenHash {
			return &t.rt, nil
		}
	}
	return nil, errMemRevoked
}

func (m *memRefresh) RevokeFamily(_ context.Context, familyID, _ string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	now := time.Now()
	for _, t := range m.byID {
		if t.rt.FamilyID == familyID && t.rt.RevokedAt == nil {
			t.rt.RevokedAt = &now
			t.rt.RevokedReason = "reuse"
			n++
		}
	}
	return n, nil
}

func (m *memRefresh) RevokeUser(_ context.Context, userID, _ string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	now := time.Now()
	for _, t := range m.byID {
		if t.rt.UserID == userID && t.rt.RevokedAt == nil {
			t.rt.RevokedAt = &now
			t.rt.RevokedReason = "logout_all"
			n++
		}
	}
	return n, nil
}

func (m *memRefresh) LinkReplacement(_ context.Context, oldID, newID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.byID[oldID]; ok && t.rt.RevokedAt == nil {
		now := time.Now()
		t.rt.RevokedAt = &now
		t.rt.RevokedReason = "rotation"
		t.rt.ReplacedBy = newID
	}
	return nil
}

// seedMembership wires a user to a tenant (test setup helper).
func (m *memTenants) seedMembership(userID, tenantID, role string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byUser[userID] = append(m.byUser[userID], memTenant{tenantID: tenantID, role: role})
}

var _ = strings.ToLower
