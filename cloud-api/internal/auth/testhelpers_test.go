package auth

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

func newReqWithAuth(header string) *http.Request {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		r.Header.Set("Authorization", header)
	}
	return r
}

// signRaw mints a token without a `sub` claim (contract violation probe).
func signRaw(t *testing.T, s *LocalSigner) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss": testIssuer, "aud": testAud,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
		"jti": "jti_x", "tid": "ten_1",
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	out, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signRaw: %v", err)
	}
	return out
}

type memUser struct {
	u      domain.User
	pwHash string
}

type memUsers struct {
	mu   sync.Mutex
	byID map[string]*memUser
	byEm map[string]*memUser
}

func newMemUsers() *memUsers {
	return &memUsers{byID: map[string]*memUser{}, byEm: map[string]*memUser{}}
}

func (m *memUsers) ByEmail(_ context.Context, email string) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mu, ok := m.byEm[strings.ToLower(email)]; ok {
		u := mu.u
		return &u, nil
	}
	return nil, nil
}

func (m *memUsers) ByID(_ context.Context, id string) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mu, ok := m.byID[id]; ok {
		u := mu.u
		return &u, nil
	}
	return nil, nil
}

func (m *memUsers) TouchLogin(_ context.Context, id string) error { return nil }

type memTenant struct {
	tenantID string
	role     string
}

type memTenants struct {
	mu     sync.Mutex
	byUser map[string][]memTenant
}

func (m *memTenants) ByID(_ context.Context, _ string) (*domain.Tenant, error) {
	return &domain.Tenant{ID: "ten_1", Slug: "personal", Name: "Personal", Status: "active"}, nil
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

type memRefreshToken struct {
	rt      repos.RefreshToken
	revoked bool
}

type memRefresh struct {
	mu     sync.Mutex
	tokens map[string]*memRefreshToken
}

func newMemRefresh() *memRefresh { return &memRefresh{tokens: map[string]*memRefreshToken{}} }

func (m *memRefresh) Issue(_ context.Context, t *repos.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tokens[t.TokenHash] = &memRefreshToken{rt: *t}
	return nil
}

func (m *memRefresh) Consume(_ context.Context, tokenHash string) (*repos.RefreshToken, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tokens[tokenHash]
	if !ok {
		return nil, false, nil
	}
	if t.revoked {
		return nil, false, repos.ReuseSignal("revoked")
	}
	if t.rt.UsedAt != nil {
		return nil, false, repos.ReuseSignal("used")
	}
	now := time.Now()
	t.rt.UsedAt = &now
	cp := t.rt
	return &cp, true, nil
}

func (m *memRefresh) ByHash(_ context.Context, tokenHash string) (*repos.RefreshToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tokens[tokenHash]; ok {
		cp := t.rt
		return &cp, nil
	}
	return nil, nil
}

func (m *memRefresh) RevokeFamily(_ context.Context, familyID, reason string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	for _, t := range m.tokens {
		if t.rt.FamilyID == familyID && !t.revoked {
			t.revoked = true
			n++
		}
	}
	return n, nil
}

func (m *memRefresh) RevokeUser(_ context.Context, userID, reason string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	for _, t := range m.tokens {
		if t.rt.UserID == userID && !t.revoked {
			t.revoked = true
			n++
		}
	}
	return n, nil
}

func (m *memRefresh) LinkReplacement(_ context.Context, oldID, newID string) error { return nil }
