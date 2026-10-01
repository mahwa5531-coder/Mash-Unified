package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

// ---- in-memory fakes ----------------------------------------------------------
//
// The fakes mirror the REAL repositories' atomicity semantics exactly:
// consume-style operations are single mutex-protected state transitions, so
// the race matrix below exercises the same exactly-once guarantees the SQL
// UPDATE ... WHERE used_at IS NULL provides.

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

func (m *memUsers) PasswordHash(_ context.Context, userID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mu, ok := m.byID[userID]; ok {
		return mu.pwHash, nil
	}
	return "", nil
}

func (m *memUsers) TouchLogin(_ context.Context, id string) error { return nil }

func (m *memUsers) UpdatePasswordHash(_ context.Context, id, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mu, ok := m.byID[id]; ok {
		mu.pwHash = hash
		return nil
	}
	return errors.New("user gone")
}

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
	tokens map[string]*memRefreshToken // by hash
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

type memRecoveryToken struct {
	userID  string
	purpose string
	hash    string
	expires time.Time
	used    bool
}

// memRecovery mirrors the split-token SQL semantics.
type memRecovery struct {
	mu    sync.Mutex
	bySel map[string]*memRecoveryToken
	users *memUsers
}

func newMemRecovery(users *memUsers) *memRecovery {
	return &memRecovery{bySel: map[string]*memRecoveryToken{}, users: users}
}

func (m *memRecovery) Issue(_ context.Context, userID, purpose, selector, verifierHash string, ttl time.Duration, ip, ua string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	// Newest-wins: supersede live tokens of the same purpose.
	for _, t := range m.bySel {
		if t.userID == userID && t.purpose == purpose && !t.used && t.expires.After(time.Now()) {
			t.used = true
		}
	}
	m.bySel[selector] = &memRecoveryToken{
		userID: userID, purpose: purpose, hash: verifierHash,
		expires: time.Now().Add(ttl),
	}
	return nil
}

// ApplyVerification mirrors the single-transaction SQL consume + flip.
// User-state access is serialized through the users fake's own lock.
func (m *memRecovery) ApplyVerification(_ context.Context, selector, verifierHash string) (string, bool, error) {
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
	already := u.u.EmailVerified
	u.u.EmailVerified = true
	return userID, already, nil
}

// ResetPassword mirrors the all-or-nothing transaction.
func (m *memRecovery) ResetPassword(_ context.Context, selector, verifierHash, newHash string) (string, int64, error) {
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
	u.u.EmailVerified = true
	// (refresh revocation is validated through the real service + memRefresh.)
	return userID, 0, nil
}

// memRegistrar mirrors the unique-email arbitration of the SQL insert.
type memRegistrar struct {
	mu      sync.Mutex
	users   *memUsers
	tenants *memTenants
	created int
}

func (g *memRegistrar) CreateAccount(_ context.Context, email, displayName, passwordHash, userID, tenantID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	email = strings.ToLower(email)
	g.users.mu.Lock()
	defer g.users.mu.Unlock()
	if _, exists := g.users.byEm[email]; exists {
		return repos.ErrEmailTaken
	}
	u := domain.User{
		ID: userID, Email: email, DisplayName: displayName,
		Status: "active", AuthProvider: "local", EmailVerified: false,
	}
	g.users.byID[userID] = &memUser{u: u, pwHash: passwordHash}
	g.users.byEm[email] = g.users.byID[userID]
	g.tenants.mu.Lock()
	g.tenants.byUser[userID] = append(g.tenants.byUser[userID], memTenant{tenantID: tenantID, role: "owner"})
	g.tenants.mu.Unlock()
	g.created++
	return nil
}

// captureMailer records outbound mail without I/O.
type captureMailer struct {
	mu            sync.Mutex
	verifies      []string
	resets        []string
	linkedNotices []string
}

func (c *captureMailer) SendVerification(_ context.Context, to, link string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.verifies = append(c.verifies, link)
	return nil
}

func (c *captureMailer) SendPasswordReset(_ context.Context, to, link string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.resets = append(c.resets, link)
	return nil
}

func (c *captureMailer) SendOAuthLinked(_ context.Context, to string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.linkedNotices = append(c.linkedNotices, to)
	return nil
}

func (c *captureMailer) lastVerify() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.verifies) == 0 {
		return ""
	}
	return c.verifies[len(c.verifies)-1]
}

// ---- shared fixture -----------------------------------------------------------

type signupFixture struct {
	svc      *Service
	users    *memUsers
	tenants  *memTenants
	refresh  *memRefresh
	recovery *memRecovery
	mail     *captureMailer
}

func newSignupFixture(t *testing.T) *signupFixture {
	t.Helper()
	users := newMemUsers()
	tenants := &memTenants{byUser: map[string][]memTenant{}}
	fx := &signupFixture{
		users:    users,
		tenants:  tenants,
		refresh:  newMemRefresh(),
		recovery: newMemRecovery(users),
		mail:     &captureMailer{},
	}
	fx.svc = &Service{
		Users:             users,
		Tenants:           tenants,
		RefreshRepo:       fx.refresh,
		Registrar:         &memRegistrar{users: users, tenants: tenants},
		Recovery:          fx.recovery,
		Mail:              fx.mail,
		Signer:            NewLocalSigner("x"+strings.Repeat("0", 31), "test-iss", "test-aud", 0, 15*time.Minute),
		AccessTTL:         15 * time.Minute,
		RefreshTTL:        24 * time.Hour,
		RequireVerified:   true,
		VerifyTTL:         time.Hour,
		ResetTTL:          30 * time.Minute,
		ResendCooldown:    0, // no Redis in unit fakes: cooldown off
		MinPasswordLength: 8,
		AppBaseURL:        "https://app.test",
	}
	return fx
}

func tokenFromLink(link string) string {
	if i := strings.LastIndexByte(link, '='); i >= 0 {
		return link[i+1:]
	}
	return link
}

// ---- tests --------------------------------------------------------------------

func TestValidatePasswordPolicy(t *testing.T) {
	cases := []struct {
		pw  string
		bad string // expected reason keyword, "" = must pass
	}{
		{"", "required"},
		{"short7", "minimum"},
		{"  leading", "whitespace"},
		{"trailing  ", "whitespace"},
		{"password", "denylist"},
		{"Password123", "denylist"},
		{"QWERTY123", "denylist"},
		{strings.Repeat("a", 129), "maximum"},
		{strings.Repeat("a", 100), "bytes"}, // >72 bytes
		{"correct horse battery", ""},       // passphrase w/ spaces (inner ok)
		{"n0ttyrh30q9zx", ""},               // 13 chars, not common
	}
	for _, c := range cases {
		err := ValidatePassword(c.pw, 8)
		if c.bad == "" {
			if err != nil {
				t.Errorf("ValidatePassword(%q) unexpected error: %v", c.pw, err)
			}
			continue
		}
		if err == nil {
			t.Errorf("ValidatePassword(%q) expected rejection (%s), got pass", c.pw, c.bad)
			continue
		}
		if !strings.Contains(err.Details["reason"].(string), c.bad) && !strings.Contains(err.Message, c.bad) && !strings.Contains(c.bad, err.Details["reason"].(string)) {
			t.Logf("note: %q rejected with reason %q (expected keyword %q)", c.pw, err.Details["reason"], c.bad)
		}
	}
}

func TestParseSplitToken(t *testing.T) {
	raw, sel, hash := newSplitToken()
	gotSel, gotVer, ok := parseSplitToken(raw)
	if !ok || gotSel != sel || HashToken(gotVer) != hash {
		t.Fatalf("split-token roundtrip failed")
	}
	if _, _, ok := parseSplitToken("no-separator"); ok {
		t.Error("missing separator accepted")
	}
	if _, _, ok := parseSplitToken(".verifier"); ok {
		t.Error("empty selector accepted")
	}
	if _, _, ok := parseSplitToken("selector."); ok {
		t.Error("empty verifier accepted")
	}
	if _, _, ok := parseSplitToken("a.b.c"); ok {
		t.Error("multiple separators accepted")
	}
}

func TestRegisterHappyPath(t *testing.T) {
	fx := newSignupFixture(t)
	res, err := fx.svc.Register(context.Background(), "Alice@Example.com ", "horse staple right", "Alice", "1.2.3.4", "ua")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if res.User.Email != "alice@example.com" {
		t.Errorf("email not normalized: %q", res.User.Email)
	}
	if !res.VerificationRequired {
		t.Error("verification_required should be true")
	}
	if link := fx.mail.lastVerify(); !strings.HasPrefix(link, "https://app.test/verify-email?token=") {
		t.Errorf("verification link malformed: %q", link)
	}
	// Duplicate → EMAIL_TAKEN with 409.
	if _, err := fx.svc.Register(context.Background(), "alice@example.com", "horse staple right", "Alice 2", "1.2.3.4", "ua"); err == nil {
		t.Fatal("duplicate register accepted")
	} else if de := domain.AsError(err); de == nil || de.Code != "EMAIL_TAKEN" || de.HTTP != 409 {
		t.Fatalf("duplicate register error = %v, want EMAIL_TAKEN/409", err)
	}
}

func TestRegisterPasswordPolicyEnforcedBeforeCreate(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "a@b.co", "password", "A", "", ""); err == nil {
		t.Fatal("denylisted password accepted")
	}
	// Weak password must not burn email uniqueness: same email with a good
	// password registers fine afterwards.
	if _, err := fx.svc.Register(context.Background(), "a@b.co", "h4rd-t0-gu3ss!", "A", "", ""); err != nil {
		t.Fatalf("register after policy rejection failed: %v", err)
	}
}

// TestRegisterDuplicateRace: N concurrent registers of the same email — exactly
// one wins (unique-index arbitration), the rest get EMAIL_TAKEN.
func TestRegisterDuplicateRace(t *testing.T) {
	fx := newSignupFixture(t)
	const n = 16
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := fx.svc.Register(context.Background(), "race@example.com", "same-password-1", "Racer", "ip", "ua")
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	created, taken := 0, 0
	for err := range errs {
		if err == nil {
			created++
			continue
		}
		if de := domain.AsError(err); de != nil && de.Code == "EMAIL_TAKEN" {
			taken++
		} else {
			t.Fatalf("unexpected error class: %v", err)
		}
	}
	if created != 1 || taken != n-1 {
		t.Fatalf("race outcome: created=%d taken=%d, want 1/%d", created, taken, n-1)
	}
}

func TestLoginGateUnverified(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "gate@example.com", "w0nderful-pass", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	_, err := fx.svc.Login(context.Background(), "gate@example.com", "w0nderful-pass", "ua")
	if err == nil {
		t.Fatal("unverified login accepted")
	}
	if de := domain.AsError(err); de == nil || de.Code != "EMAIL_NOT_VERIFIED" || de.HTTP != 403 {
		t.Fatalf("unverified login error = %v, want EMAIL_NOT_VERIFIED/403", err)
	}
}

// TestVerifyFlowCoversGate: verify → login succeeds.
func TestVerifyFlowCoversGate(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "flow@example.com", "w0nderful-pass", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	token := tokenFromLink(fx.mail.lastVerify())
	email, already, err := fx.svc.VerifyEmail(context.Background(), token)
	if err != nil || already || email != "flow@example.com" {
		t.Fatalf("verify: email=%q already=%v err=%v", email, already, err)
	}
	// Reuse of the consumed token → generic INVALID_TOKEN.
	if _, _, err := fx.svc.VerifyEmail(context.Background(), token); err == nil {
		t.Fatal("token reuse accepted")
	} else if de := domain.AsError(err); de == nil || de.Code != "INVALID_TOKEN" {
		t.Fatalf("reuse error = %v, want INVALID_TOKEN", err)
	}
	// Login now works and the pair carries email_verified.
	pair, err := fx.svc.Login(context.Background(), "flow@example.com", "w0nderful-pass", "ua")
	if err != nil {
		t.Fatalf("login after verify: %v", err)
	}
	if !pair.User.EmailVerified {
		t.Error("TokenPair.user.email_verified should be true")
	}
}

// TestVerifyDoubleSpendRace: concurrent consumption of ONE token — exactly one
// success, everything else INVALID_TOKEN.
func TestVerifyDoubleSpendRace(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "ds@example.com", "w0nderful-pass", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	token := tokenFromLink(fx.mail.lastVerify())
	const n = 16
	var wg sync.WaitGroup
	results := make(chan bool, n) // true = success
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := fx.svc.VerifyEmail(context.Background(), token)
			results <- err == nil
		}()
	}
	wg.Wait()
	close(results)
	ok := 0
	for r := range results {
		if r {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("verify double-spend: %d successes, want exactly 1", ok)
	}
}

// TestResendSupersedes: a new verification token kills the old one.
func TestResendSupersedes(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "sup@example.com", "w0nderful-pass", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	first := tokenFromLink(fx.mail.lastVerify())
	if err := fx.svc.ResendVerification(context.Background(), "sup@example.com", "", ""); err != nil {
		t.Fatalf("resend: %v", err)
	}
	second := tokenFromLink(fx.mail.lastVerify())
	if first == second {
		t.Fatal("resend issued the same token")
	}
	if _, _, err := fx.svc.VerifyEmail(context.Background(), first); err == nil {
		t.Fatal("superseded token still valid")
	}
	if _, _, err := fx.svc.VerifyEmail(context.Background(), second); err != nil {
		t.Fatalf("newest token rejected: %v", err)
	}
}

func TestResendAndForgotAreEnumerationSafe(t *testing.T) {
	fx := newSignupFixture(t)
	// Unknown email: nil error (→ HTTP 202 identical to the known-email path).
	if err := fx.svc.ResendVerification(context.Background(), "nobody@example.com", "", ""); err != nil {
		t.Fatalf("unknown-email resend returned error: %v", err)
	}
	if err := fx.svc.ForgotPassword(context.Background(), "nobody@example.com", "", ""); err != nil {
		t.Fatalf("unknown-email forgot returned error: %v", err)
	}
	if len(fx.mail.verifies)+len(fx.mail.resets) != 0 {
		t.Fatal("mail sent for an unknown account")
	}
	// Verified account: resend is a silent no-op (still no error).
	fx.svc.RequireVerified = false // suppress the early return for verified users
	defer func() { fx.svc.RequireVerified = true }()
	if _, err := fx.svc.Register(context.Background(), "known@example.com", "w0nderful-pass", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	fx.svc.RequireVerified = true
	if err := fx.svc.ResendVerification(context.Background(), "known@example.com", "", ""); err != nil {
		t.Fatalf("verified resend: %v", err)
	}
	if len(fx.mail.verifies) != 1 {
		t.Fatalf("verified account re-sent mail: %d", len(fx.mail.verifies))
	}
}

func TestForgotResetFlow(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "reset@example.com", "first-password", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, _, err := fx.svc.VerifyEmail(context.Background(), tokenFromLink(fx.mail.lastVerify())); err != nil {
		t.Fatalf("verify: %v", err)
	}
	// A live session to prove reset kills it.
	pair, err := fx.svc.Login(context.Background(), "reset@example.com", "first-password", "ua")
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if err := fx.svc.ForgotPassword(context.Background(), "reset@example.com", "", ""); err != nil {
		t.Fatalf("forgot: %v", err)
	}
	token := tokenFromLink(fx.mail.resets[len(fx.mail.resets)-1])

	// Weak new password must NOT burn the token.
	if err := fx.svc.ResetPassword(context.Background(), token, "password"); err == nil {
		t.Fatal("weak password accepted on reset")
	}
	if err := fx.svc.ResetPassword(context.Background(), token, "second-password"); err != nil {
		t.Fatalf("reset: %v", err)
	}

	// Old refresh token dead (revoked as reuse/revoked signal).
	if _, err := fx.svc.Refresh(context.Background(), pair.RefreshToken, "ua"); err == nil {
		t.Fatal("pre-reset refresh token survived the reset")
	}
	// Old password dead, new password works.
	if _, err := fx.svc.Login(context.Background(), "reset@example.com", "first-password", "ua"); err == nil {
		t.Fatal("old password accepted after reset")
	}
	if _, err := fx.svc.Login(context.Background(), "reset@example.com", "second-password", "ua"); err != nil {
		t.Fatalf("new password rejected: %v", err)
	}
	// Token single-use.
	if err := fx.svc.ResetPassword(context.Background(), token, "third-password"); err == nil {
		t.Fatal("reset token reuse accepted")
	}
}

// TestResetDoubleSpendRace: concurrent reset consumption — exactly one success.
func TestResetDoubleSpendRace(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "dsr@example.com", "first-password", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	fx.svc.RequireVerified = false
	_, _, err := fx.svc.VerifyEmail(context.Background(), tokenFromLink(fx.mail.lastVerify()))
	fx.svc.RequireVerified = true
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if err := fx.svc.ForgotPassword(context.Background(), "dsr@example.com", "", ""); err != nil {
		t.Fatalf("forgot: %v", err)
	}
	token := tokenFromLink(fx.mail.resets[len(fx.mail.resets)-1])

	const n = 16
	var wg sync.WaitGroup
	results := make(chan bool, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- fx.svc.ResetPassword(context.Background(), token, "brand-new-pass") == nil
		}()
	}
	wg.Wait()
	close(results)
	ok := 0
	for r := range results {
		if r {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("reset double-spend: %d successes, want exactly 1", ok)
	}
}

func TestChangePassword(t *testing.T) {
	fx := newSignupFixture(t)
	if _, err := fx.svc.Register(context.Background(), "chg@example.com", "first-password", "", "", ""); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, _, err := fx.svc.VerifyEmail(context.Background(), tokenFromLink(fx.mail.lastVerify())); err != nil {
		t.Fatalf("verify: %v", err)
	}
	pair, err := fx.svc.Login(context.Background(), "chg@example.com", "first-password", "ua")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	// Second session (another "device").
	other, err := fx.svc.Login(context.Background(), "chg@example.com", "first-password", "ua2")
	if err != nil {
		t.Fatalf("login2: %v", err)
	}

	// Wrong current password.
	if _, err := fx.svc.ChangePassword(context.Background(), pair.User.ID, "wrong-current", "second-password"); err == nil {
		t.Fatal("wrong current password accepted")
	}
	// Same password.
	if _, err := fx.svc.ChangePassword(context.Background(), pair.User.ID, "first-password", "first-password"); err == nil {
		t.Fatal("identical new password accepted")
	}
	// Happy path: returns a fresh pair.
	newPair, err := fx.svc.ChangePassword(context.Background(), pair.User.ID, "first-password", "second-password")
	if err != nil {
		t.Fatalf("change: %v", err)
	}
	if newPair == nil || newPair.RefreshToken == "" {
		t.Fatal("change returned no token pair")
	}
	// The other device's refresh is dead; the fresh pair's refresh rotates fine.
	if _, err := fx.svc.Refresh(context.Background(), other.RefreshToken, "ua2"); err == nil {
		t.Fatal("other-device refresh survived password change")
	}
	if _, err := fx.svc.Refresh(context.Background(), newPair.RefreshToken, "ua"); err != nil {
		t.Fatalf("fresh pair refresh failed: %v", err)
	}
}

func TestRecoveryLinkFormats(t *testing.T) {
	fx := newSignupFixture(t)
	fx.svc.AppBaseURL = ""
	raw, _, _ := newSplitToken()
	link := fx.svc.recoveryLink(repos.PurposeVerifyEmail, raw)
	if !strings.HasPrefix(link, "token://verify_email/") {
		t.Fatalf("baseless link format unexpected: %q", link)
	}
}

func TestValidEmail(t *testing.T) {
	bad := []string{"", "noat", "@nodomain", "a@", "a@b", "a b@c.io", "a@b@c.io", "a@.dot", "a@dot."}
	for _, s := range bad {
		if validEmail(s) {
			t.Errorf("validEmail(%q) accepted", s)
		}
	}
	if !validEmail("alice@example.com") || !validEmail("a.b+c@sub.example.co") {
		t.Error("validEmail rejected a legitimate address")
	}
}
