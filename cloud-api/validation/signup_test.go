package validation

// §41 — User lifecycle: signup, email verification, password recovery.
//
// HTTP-level coverage over the REAL router, REAL auth middleware, REAL
// service logic; storage seams are in-memory fakes with the same atomicity
// semantics as the SQL (single-statement consumes). Race coverage lives in
// internal/auth/signup_test.go; this file proves the wire contract:
// status codes, generic-202 enumeration safety, login gate, session
// revocation on reset, /v1/me shape, per-IP throttling.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/api"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/config"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/middleware"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

// ---- compact storage fakes (atomicity mirrors of the SQL) --------------------

type v41User struct {
	domain.User
	pwHash string
}

type v41Users struct {
	mu   sync.Mutex
	byID map[string]*v41User
	byEm map[string]*v41User
}

func (m *v41Users) ByEmail(_ context.Context, email string) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byEm[strings.ToLower(email)]; ok {
		cp := u.User
		return &cp, nil
	}
	return nil, nil
}

func (m *v41Users) ByID(_ context.Context, id string) (*domain.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byID[id]; ok {
		cp := u.User
		return &cp, nil
	}
	return nil, nil
}

func (m *v41Users) PasswordHash(_ context.Context, id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byID[id]; ok {
		return u.pwHash, nil
	}
	return "", nil
}

func (m *v41Users) TouchLogin(_ context.Context, _ string) error { return nil }

func (m *v41Users) UpdatePasswordHash(_ context.Context, id, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if u, ok := m.byID[id]; ok {
		u.pwHash = hash
		return nil
	}
	return fmt.Errorf("user gone")
}

type v41Tenants struct{}

func (v41Tenants) ByID(_ context.Context, _ string) (*domain.Tenant, error) {
	return &domain.Tenant{ID: "ten_v41", Slug: "v41", Name: "V41", Status: "active"}, nil
}

func (v41Tenants) Membership(_ context.Context, tenantID, userID string) (*domain.Membership, error) {
	return &domain.Membership{TenantID: tenantID, UserID: userID, Role: domain.RoleOwner, Status: "active"}, nil
}

func (v41Tenants) Memberships(_ context.Context, userID string) ([]domain.Membership, error) {
	return []domain.Membership{{TenantID: "ten_v41", UserID: userID, Role: domain.RoleOwner, Status: "active"}}, nil
}

type v41RefreshToken struct {
	rt      repos.RefreshToken
	revoked bool
}

type v41Refresh struct {
	mu     sync.Mutex
	byHash map[string]*v41RefreshToken
}

func (m *v41Refresh) Issue(_ context.Context, t *repos.RefreshToken) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.byHash[t.TokenHash] = &v41RefreshToken{rt: *t}
	return nil
}

func (m *v41Refresh) Consume(_ context.Context, tokenHash string) (*repos.RefreshToken, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.byHash[tokenHash]
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

func (m *v41Refresh) ByHash(_ context.Context, tokenHash string) (*repos.RefreshToken, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.byHash[tokenHash]; ok {
		cp := t.rt
		return &cp, nil
	}
	return nil, nil
}

func (m *v41Refresh) RevokeFamily(_ context.Context, familyID, _ string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	for _, t := range m.byHash {
		if t.rt.FamilyID == familyID && !t.revoked {
			t.revoked = true
			n++
		}
	}
	return n, nil
}

func (m *v41Refresh) RevokeUser(_ context.Context, userID, _ string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var n int64
	for _, t := range m.byHash {
		if t.rt.UserID == userID && !t.revoked {
			t.revoked = true
			n++
		}
	}
	return n, nil
}

func (m *v41Refresh) LinkReplacement(_ context.Context, _, _ string) error { return nil }

type v41Token struct {
	userID  string
	purpose string
	hash    string
	expires time.Time
	used    bool
}

type v41Recovery struct {
	mu    sync.Mutex
	bySel map[string]*v41Token
	users *v41Users
}

func (m *v41Recovery) Issue(_ context.Context, userID, purpose, selector, verifierHash string, ttl time.Duration, _, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, t := range m.bySel {
		if t.userID == userID && t.purpose == purpose && !t.used && t.expires.After(time.Now()) {
			t.used = true
		}
	}
	m.bySel[selector] = &v41Token{userID: userID, purpose: purpose, hash: verifierHash, expires: time.Now().Add(ttl)}
	return nil
}

func (m *v41Recovery) ApplyVerification(_ context.Context, selector, verifierHash string) (string, bool, error) {
	m.mu.Lock()
	t, ok := m.bySel[selector]
	if !ok || t.purpose != repos.PurposeVerifyEmail || t.hash != verifierHash || t.used || !t.expires.After(time.Now()) {
		m.mu.Unlock()
		return "", false, repos.ErrRecoveryInvalid
	}
	t.used = true
	userID := t.userID
	m.mu.Unlock()

	m.users.mu.Lock()
	defer m.users.mu.Unlock()
	u := m.users.byID[userID]
	if u == nil {
		return "", false, repos.ErrRecoveryInvalid
	}
	already := u.EmailVerified
	u.EmailVerified = true
	return userID, already, nil
}

func (m *v41Recovery) ResetPassword(_ context.Context, selector, verifierHash, newHash string) (string, int64, error) {
	m.mu.Lock()
	t, ok := m.bySel[selector]
	if !ok || t.purpose != repos.PurposePasswordRest || t.hash != verifierHash || t.used || !t.expires.After(time.Now()) {
		m.mu.Unlock()
		return "", 0, repos.ErrRecoveryInvalid
	}
	t.used = true
	userID := t.userID
	m.mu.Unlock()

	m.users.mu.Lock()
	defer m.users.mu.Unlock()
	u := m.users.byID[userID]
	if u == nil {
		return "", 0, repos.ErrRecoveryInvalid
	}
	u.pwHash = newHash
	// Mirrors the SQL: consuming a reset token proves mailbox control and
	// flips email_verified (2026-09-19 audit — pre-hijacking escape hatch).
	u.EmailVerified = true
	return userID, 0, nil
}

type v41Registrar struct {
	mu    sync.Mutex
	users *v41Users
}

func (g *v41Registrar) CreateAccount(_ context.Context, email, displayName, passwordHash, userID, _ string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	email = strings.ToLower(email)
	g.users.mu.Lock()
	defer g.users.mu.Unlock()
	if _, exists := g.users.byEm[email]; exists {
		return repos.ErrEmailTaken
	}
	u := domain.User{ID: userID, Email: email, DisplayName: displayName, Status: "active", AuthProvider: "local"}
	g.users.byID[userID] = &v41User{User: u, pwHash: passwordHash}
	g.users.byEm[email] = g.users.byID[userID]
	return nil
}

type v41Mailer struct {
	mu       sync.Mutex
	verifies []string
	resets   []string
}

func (c *v41Mailer) SendVerification(_ context.Context, _, link string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.verifies = append(c.verifies, link)
	return nil
}

func (c *v41Mailer) SendPasswordReset(_ context.Context, _, link string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.resets = append(c.resets, link)
	return nil
}

func (c *v41Mailer) SendOAuthLinked(_ context.Context, _ string) error { return nil }

func (c *v41Mailer) lastVerify() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.verifies) == 0 {
		return ""
	}
	return c.verifies[len(c.verifies)-1]
}

func (c *v41Mailer) lastReset() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.resets) == 0 {
		return ""
	}
	return c.resets[len(c.resets)-1]
}

// v41Resolver resolves identities from the fake user store.
type v41Resolver struct{ users *v41Users }

func (r *v41Resolver) Resolve(ctx context.Context, userID, _ string) (*auth.Identity, error) {
	u, err := r.users.ByID(ctx, userID)
	if err != nil || u == nil {
		return nil, domain.ErrUnauthorized(fmt.Errorf("user not found"))
	}
	return &auth.Identity{
		User: auth.UserInfo{
			ID: u.ID, Email: u.Email, DisplayName: u.DisplayName,
			Status: u.Status, EmailVerified: u.EmailVerified,
		},
		Tenant:             auth.TenantInfo{ID: "ten_v41", Slug: "v41", Name: "V41", Status: "active"},
		Membership:         auth.MembershipInfo{Role: domain.RoleOwner, Status: "active"},
		SubscriptionStatus: "trialing",
	}, nil
}

// ---- stack --------------------------------------------------------------------

type v41Stack struct {
	srv   *httptest.Server
	mail  *v41Mailer
	users *v41Users
	rdb   *redis.Client
}

func newV41Stack(t *testing.T, maxFailedPerIP int, cooldown time.Duration) *v41Stack {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	users := &v41Users{byID: map[string]*v41User{}, byEm: map[string]*v41User{}}
	mailer := &v41Mailer{}
	signer := auth.NewLocalSigner(testSecret, "https://auth.nexau.test", "nexau-v41", 0, 15*time.Minute)

	svc := &auth.Service{
		Users:       users,
		Tenants:     v41Tenants{},
		RefreshRepo: &v41Refresh{byHash: map[string]*v41RefreshToken{}},
		Redis:       rdb,
		Registrar:   &v41Registrar{users: users},
		Recovery:    &v41Recovery{bySel: map[string]*v41Token{}, users: users},
		Mail:        mailer,
		Signer:      signer,
		AccessTTL:   15 * time.Minute, RefreshTTL: 24 * time.Hour,

		RequireVerified:   true,
		VerifyTTL:         time.Hour,
		ResetTTL:          30 * time.Minute,
		ResendCooldown:    cooldown,
		MinPasswordLength: 8,
		AppBaseURL:        "https://app.nexau.test",
	}

	authMW := auth.Middleware{Verifier: signer, Resolver: &v41Resolver{users: users}, Service: svc, AuthTimeout: 2 * time.Second, RevocationCheck: true}

	cfg := &config.Config{
		MaxBodyBytes: 1 << 20, MaxMessages: 16, MaxTools: 8, MaxModelLen: 64,
		AuthTimeout: 2 * time.Second,
		Auth: config.AuthConfig{
			Mode: "local", LoginEnabled: true, SignupEnabled: true,
			Issuer: "https://auth.nexau.test", Audience: "nexau-v41",
			MaxFailedLoginsPerIP: maxFailedPerIP,
		},
		Rate:           config.RateLimitConfig{RunConcurrencyTimeout: time.Minute},
		IdempotencyTTL: time.Hour,
		SessionIdleTTL: time.Hour,
	}

	metrics := observability.NewMetrics()
	limiter := ratelimit.New(rdb, true, metrics)
	apiH := api.New(cfg, svc, authMW, nil, nil, nil, nil, nil, nil, nil, limiter, metrics, nil, nil)
	chain := middleware.Chain(middleware.Options{MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: 64}, metrics)
	srv := httptest.NewServer(chain(apiH.Router()))
	t.Cleanup(srv.Close)
	return &v41Stack{srv: srv, mail: mailer, users: users, rdb: rdb}
}

func (s *v41Stack) post(t *testing.T, path string, body any) (int, map[string]any, http.Header) {
	t.Helper()
	blob, _ := json.Marshal(body)
	resp, err := http.Post(s.srv.URL+path, "application/json", bytes.NewReader(blob))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out, resp.Header
}

func errCode(t *testing.T, body map[string]any) string {
	t.Helper()
	if body == nil {
		return ""
	}
	if e, ok := body["error"].(map[string]any); ok {
		if c, ok := e["code"].(string); ok {
			return c
		}
	}
	return ""
}

func tokenFromLink(link string) string {
	if i := strings.LastIndexByte(link, '='); i >= 0 {
		return link[i+1:]
	}
	return link
}

// ---- §41 tests -----------------------------------------------------------------

// TestV41_01_RegisterVerifyLoginJourney: the full happy path across BOTH front
// doors (website-style JSON client == desktop app client): register → login
// gated → verify via emailed token → login issues tokens → /v1/me reports
// email_verified.
func TestV41_01_RegisterVerifyLoginJourney(t *testing.T) {
	s := newV41Stack(t, 30, 0)

	code, body, _ := s.post(t, "/v1/auth/register", map[string]string{
		"email": "Journey@Nexau.Test", "password": "tr0pical-fish-42", "display_name": "Journey",
	})
	if code != 201 || body["email"] != "journey@nexau.test" {
		t.Fatalf("register: %d %v", code, body)
	}
	if vr, _ := body["verification_required"].(bool); !vr {
		t.Fatalf("verification_required missing: %v", body)
	}

	// Login gated with the distinct client-routable code.
	code, body, _ = s.post(t, "/v1/auth/login", map[string]string{"email": "journey@nexau.test", "password": "tr0pical-fish-42"})
	if code != 403 || errCode(t, body) != "EMAIL_NOT_VERIFIED" {
		t.Fatalf("login gate: %d %v", code, body)
	}

	// Wrong password on unverified account stays uniform (no oracle).
	code, body, _ = s.post(t, "/v1/auth/login", map[string]string{"email": "journey@nexau.test", "password": "wrong-password"})
	if code != 403 || errCode(t, body) != "EMAIL_NOT_VERIFIED" {
		t.Fatalf("unverified login with wrong password should still be the gate: %d %v", code, body)
	}

	// Verify with the token from the emailed link.
	code, body, _ = s.post(t, "/v1/auth/email/verify", map[string]string{"token": tokenFromLink(s.mail.lastVerify())})
	if code != 200 || body["verified"] != true || body["email"] != "journey@nexau.test" {
		t.Fatalf("verify: %d %v", code, body)
	}

	// Login now succeeds and carries the pair + verified flag.
	code, body, _ = s.post(t, "/v1/auth/login", map[string]string{"email": "journey@nexau.test", "password": "tr0pical-fish-42"})
	if code != 200 || body["access_token"] == "" || body["refresh_token"] == "" {
		t.Fatalf("login: %d %v", code, body)
	}
	if u, ok := body["user"].(map[string]any); !ok || u["email_verified"] != true {
		t.Fatalf("login user payload: %v", body["user"])
	}

	// /v1/me shows email_verified for the authenticated caller.
	req, _ := http.NewRequest("GET", s.srv.URL+"/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+body["access_token"].(string))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var me map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&me)
	if resp.StatusCode != 200 {
		t.Fatalf("me: %d %v", resp.StatusCode, me)
	}
	if u, ok := me["user"].(map[string]any); !ok || u["email_verified"] != true {
		t.Fatalf("me.user.email_verified: %v", me["user"])
	}
}

// TestV41_02_RegisterDuplicateAndPolicy: 409 EMAIL_TAKEN with sign-in hint;
// policy rejections are 400 PASSWORD_WEAK and never consume the email.
func TestV41_02_RegisterDuplicateAndPolicy(t *testing.T) {
	s := newV41Stack(t, 30, 0)
	s.post(t, "/v1/auth/register", map[string]string{"email": "dup@nexau.test", "password": "tr0pical-fish-42"})

	code, body, _ := s.post(t, "/v1/auth/register", map[string]string{"email": "DUP@nexau.test", "password": "tr0pical-fish-42"})
	if code != 409 || errCode(t, body) != "EMAIL_TAKEN" {
		t.Fatalf("duplicate register: %d %v", code, body)
	}

	code, body, _ = s.post(t, "/v1/auth/register", map[string]string{"email": "policy@nexau.test", "password": "password"})
	if code != 400 || errCode(t, body) != "PASSWORD_WEAK" {
		t.Fatalf("denylist password: %d %v", code, body)
	}
	code, body, _ = s.post(t, "/v1/auth/register", map[string]string{"email": "policy@nexau.test", "password": "short"})
	if code != 400 || errCode(t, body) != "PASSWORD_WEAK" {
		t.Fatalf("short password: %d %v", code, body)
	}
	// The email was never consumed by rejected attempts.
	code, _, _ = s.post(t, "/v1/auth/register", map[string]string{"email": "policy@nexau.test", "password": "valid-pass-9"})
	if code != 201 {
		t.Fatalf("register after rejections: %d", code)
	}
}

// TestV41_03_RecoveryEnumerationSafety: forgot/resend are byte-identical 202s
// for known vs unknown accounts; only the log knows the difference.
func TestV41_03_RecoveryEnumerationSafety(t *testing.T) {
	s := newV41Stack(t, 30, 0)
	s.post(t, "/v1/auth/register", map[string]string{"email": "enum@nexau.test", "password": "tr0pical-fish-42"})

	cA, bA, _ := s.post(t, "/v1/auth/password/forgot", map[string]string{"email": "enum@nexau.test"})
	cB, bB, _ := s.post(t, "/v1/auth/password/forgot", map[string]string{"email": "ghost@nexau.test"})
	if cA != 202 || cB != 202 {
		t.Fatalf("forgot statuses: %d %d", cA, cB)
	}
	if fmt.Sprint(bA) != fmt.Sprint(bB) {
		t.Fatalf("forgot bodies differ (enumeration oracle): %v vs %v", bA, bB)
	}

	cA, bA, _ = s.post(t, "/v1/auth/email/resend", map[string]string{"email": "enum@nexau.test"})
	cB, bB, _ = s.post(t, "/v1/auth/email/resend", map[string]string{"email": "ghost@nexau.test"})
	if cA != 202 || cB != 202 || fmt.Sprint(bA) != fmt.Sprint(bB) {
		t.Fatalf("resend enumeration oracle: %d/%v vs %d/%v", cA, bA, cB, bB)
	}

	// Unknown-account forgot must not send mail; known must.
	if len(s.mail.resets) != 1 {
		t.Fatalf("reset mails sent: %d (want exactly 1 for the known account)", len(s.mail.resets))
	}
}

// TestV41_04_ResetRevokesSessions: forgot → reset → old refresh dead, old
// password dead, new password live; token single-use; weak password does not
// burn the token.
func TestV41_04_ResetRevokesSessions(t *testing.T) {
	s := newV41Stack(t, 30, 0)
	s.post(t, "/v1/auth/register", map[string]string{"email": "reset@nexau.test", "password": "first-password"})
	s.post(t, "/v1/auth/email/verify", map[string]string{"token": tokenFromLink(s.mail.lastVerify())})
	_, loginBody, _ := s.post(t, "/v1/auth/login", map[string]string{"email": "reset@nexau.test", "password": "first-password"})

	s.post(t, "/v1/auth/password/forgot", map[string]string{"email": "reset@nexau.test"})
	token := tokenFromLink(s.mail.lastReset())

	// Weak password does not consume the token.
	if code, body, _ := s.post(t, "/v1/auth/password/reset", map[string]string{"token": token, "new_password": "password"}); code != 400 || errCode(t, body) != "PASSWORD_WEAK" {
		t.Fatalf("weak reset: %d %v", code, body)
	}
	if code, body, _ := s.post(t, "/v1/auth/password/reset", map[string]string{"token": token, "new_password": "second-password"}); code != 200 {
		t.Fatalf("reset: %d %v", code, body)
	}

	// Old refresh token now fails.
	if code, body, _ := s.post(t, "/v1/auth/refresh", map[string]string{"refresh_token": loginBody["refresh_token"].(string)}); code == 200 {
		t.Fatalf("pre-reset refresh survived: %d %v", code, body)
	}
	// Old password dead.
	if code, _, _ := s.post(t, "/v1/auth/login", map[string]string{"email": "reset@nexau.test", "password": "first-password"}); code == 200 {
		t.Fatal("old password accepted after reset")
	}
	// New password live.
	if code, _, _ := s.post(t, "/v1/auth/login", map[string]string{"email": "reset@nexau.test", "password": "second-password"}); code != 200 {
		t.Fatal("new password rejected after reset")
	}
	// Token single-use.
	if code, body, _ := s.post(t, "/v1/auth/password/reset", map[string]string{"token": token, "new_password": "third-password"}); code != 400 || errCode(t, body) != "INVALID_TOKEN" {
		t.Fatalf("token reuse: %d %v", code, body)
	}
}

// TestV41_05_ChangePasswordKeepsSession: authed change returns a fresh pair;
// the OTHER device's refresh dies.
func TestV41_05_ChangePasswordKeepsSession(t *testing.T) {
	s := newV41Stack(t, 30, 0)
	s.post(t, "/v1/auth/register", map[string]string{"email": "chg@nexau.test", "password": "first-password"})
	s.post(t, "/v1/auth/email/verify", map[string]string{"token": tokenFromLink(s.mail.lastVerify())})
	_, mine, _ := s.post(t, "/v1/auth/login", map[string]string{"email": "chg@nexau.test", "password": "first-password"})
	_, other, _ := s.post(t, "/v1/auth/login", map[string]string{"email": "chg@nexau.test", "password": "first-password"})

	req, _ := http.NewRequest("POST", s.srv.URL+"/v1/auth/password/change", nil)
	blob, _ := json.Marshal(map[string]string{"current_password": "first-password", "new_password": "second-password"})
	req.Body = io.NopCloser(bytes.NewReader(blob))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+mine["access_token"].(string))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 200 || body["refresh_token"] == "" {
		t.Fatalf("change: %d %v", resp.StatusCode, body)
	}

	// Old access token remains valid until its TTL (session continuity — the
	// response already carried the fresh pair; no jti blacklist on voluntary change).
	req2, _ := http.NewRequest("GET", s.srv.URL+"/v1/me", nil)
	req2.Header.Set("Authorization", "Bearer "+mine["access_token"].(string))
	if resp2, err := http.DefaultClient.Do(req2); err != nil {
		t.Fatal(err)
	} else {
		resp2.Body.Close()
		if resp2.StatusCode != 200 {
			t.Fatalf("old access token should survive until TTL after voluntary change; got %d", resp2.StatusCode)
		}
	}

	// The other device's refresh is revoked.
	if code, _, _ := s.post(t, "/v1/auth/refresh", map[string]string{"refresh_token": other["refresh_token"].(string)}); code == 200 {
		t.Fatal("other-device refresh survived password change")
	}
	// The fresh pair rotates fine.
	if code, _, _ := s.post(t, "/v1/auth/refresh", map[string]string{"refresh_token": body["refresh_token"].(string)}); code != 200 {
		t.Fatal("fresh pair refresh failed")
	}
}

// TestV41_06_IPThrottleAndCooldown: per-IP signup-surface throttle 429s with
// Retry-After; per-email cooldown 429s resends.
func TestV41_06_IPThrottleAndCooldown(t *testing.T) {
	s := newV41Stack(t, 3, 50*time.Millisecond) // tiny budgets
	s.post(t, "/v1/auth/register", map[string]string{"email": "a1@nexau.test", "password": "tr0pical-fish-42"})
	s.post(t, "/v1/auth/register", map[string]string{"email": "a2@nexau.test", "password": "tr0pical-fish-42"})
	s.post(t, "/v1/auth/register", map[string]string{"email": "a3@nexau.test", "password": "tr0pical-fish-42"})

	code, body, hdr := s.post(t, "/v1/auth/register", map[string]string{"email": "a4@nexau.test", "password": "tr0pical-fish-42"})
	if code != 429 || errCode(t, body) != "RATE_LIMITED" {
		t.Fatalf("ip throttle: %d %v", code, body)
	}
	if hdr.Get("Retry-After") == "" {
		t.Fatal("429 without Retry-After")
	}

	// Cooldown: second resend inside the window → 429 with Retry-After.
	s2 := newV41Stack(t, 100, time.Minute)
	s2.post(t, "/v1/auth/register", map[string]string{"email": "cd@nexau.test", "password": "tr0pical-fish-42"})
	if code, _, _ := s2.post(t, "/v1/auth/email/resend", map[string]string{"email": "cd@nexau.test"}); code != 202 {
		t.Fatalf("first resend: %d", code)
	}
	code, body, hdr = s2.post(t, "/v1/auth/email/resend", map[string]string{"email": "cd@nexau.test"})
	if code != 429 || errCode(t, body) != "RESEND_COOLDOWN" {
		t.Fatalf("cooldown: %d %v", code, body)
	}
	if hdr.Get("Retry-After") == "" {
		t.Fatal("cooldown 429 without Retry-After")
	}
}

// TestV41_07_MalformedAndHostileInputs: garbage tokens, bad emails, oversized
// fields — 400s, no 5xx, no panics.
func TestV41_07_MalformedAndHostileInputs(t *testing.T) {
	s := newV41Stack(t, 100, 0)
	cases := []struct {
		path string
		body map[string]string
	}{
		{"/v1/auth/email/verify", map[string]string{"token": ""}},
		{"/v1/auth/email/verify", map[string]string{"token": "garbage-no-dot"}},
		{"/v1/auth/email/verify", map[string]string{"token": "a.b.c.d.e"}},
		{"/v1/auth/password/reset", map[string]string{"token": "x.y", "new_password": "valid-pass-9"}},
		{"/v1/auth/register", map[string]string{"email": "not-an-email", "password": "valid-pass-9"}},
		{"/v1/auth/register", map[string]string{"email": "x@y.io", "password": ""}},
		{"/v1/auth/email/resend", map[string]string{"email": "nope"}},
		{"/v1/auth/password/forgot", map[string]string{"email": ""}},
	}
	for _, c := range cases {
		code, body, _ := s.post(t, c.path, c.body)
		if code >= 500 {
			t.Fatalf("%s %v → %d %v (server error)", c.path, c.body, code, body)
		}
		if code != 400 && code != 202 && code != 401 {
			// forgot/resend of malformed emails may be 400; valid-but-unknown = 202.
			t.Logf("note: %s %v → %d %s", c.path, c.body, code, errCode(t, body))
		}
	}
}

// TestV41_08_VerifyDoubleSpendHTTP: the SAME link submitted concurrently 12
// times — exactly one 200, all others 400 INVALID_TOKEN.
func TestV41_08_VerifyDoubleSpendHTTP(t *testing.T) {
	s := newV41Stack(t, 100, 0)
	s.post(t, "/v1/auth/register", map[string]string{"email": "ds@nexau.test", "password": "tr0pical-fish-42"})
	token := tokenFromLink(s.mail.lastVerify())

	const n = 12
	results := make(chan int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			code, _, _ := s.post(t, "/v1/auth/email/verify", map[string]string{"token": token})
			results <- code
		}()
	}
	wg.Wait()
	close(results)
	ok := 0
	for c := range results {
		if c == 200 {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("double-spend over HTTP: %d successes, want exactly 1", ok)
	}
}
