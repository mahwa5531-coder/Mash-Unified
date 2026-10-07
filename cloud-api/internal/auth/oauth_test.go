package auth

// Google OAuth + web session: unit coverage over the REAL provider (fake
// Google endpoints), REAL Redis semantics (miniredis, including the Lua
// GETDEL consume) and the service race/retry logic (fake OAuth store with the
// same atomicity arbitration as the SQL).

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// ---- fake Google ---------------------------------------------------------------

type fakeGoogle struct {
	srv     *httptest.Server
	key     *rsa.PrivateKey
	kid     string
	tokURL  string
	jwksURL string

	mu         sync.Mutex
	codes      map[string]bool // issued codes
	exchanges  int
	idClaimsFn func() jwt.MapClaims // override per-test
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa keygen: %v", err)
	}
	fg := &fakeGoogle{key: key, kid: "test-key-1", codes: map[string]bool{}}
	fg.idClaimsFn = func() jwt.MapClaims {
		return jwt.MapClaims{
			"iss":            "https://accounts.google.com",
			"aud":            "test-client-id",
			"sub":            "google-sub-1234567890",
			"email":          "guser@example.test",
			"email_verified": true,
			"name":           "G Test User",
			"picture":        "https://lh3.example.test/a.jpg",
			"iat":            time.Now().Unix(),
			"exp":            time.Now().Add(time.Hour).Unix(),
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(400)
			return
		}
		if r.Form.Get("client_id") != "test-client-id" || r.Form.Get("client_secret") != "test-client-secret" {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_client"})
			return
		}
		code := r.Form.Get("code")
		fg.mu.Lock()
		_, known := fg.codes[code]
		fg.codes[code] = true
		fg.exchanges++
		fg.mu.Unlock()
		if !known {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, fg.idClaimsFn())
		tok.Header["kid"] = fg.kid
		idTok, err := tok.SignedString(fg.key)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id_token": idTok, "access_token": "ignored"})
	})
	mux.HandleFunc("GET /certs", func(w http.ResponseWriter, r *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(fg.key.PublicKey.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(fg.key.PublicKey.E)).Bytes())
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{"kty": "RSA", "kid": fg.kid, "alg": "RS256", "use": "sig", "n": n, "e": e}},
		})
	})
	fg.srv = httptest.NewServer(mux)
	t.Cleanup(fg.srv.Close)
	fg.tokURL = fg.srv.URL + "/token"
	fg.jwksURL = fg.srv.URL + "/certs"
	return fg
}

// forgeToken signs an ID token with a DIFFERENT key than the served JWKS.
func (fg *fakeGoogle) forgeToken(t *testing.T, mutate func(jwt.MapClaims)) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa keygen: %v", err)
	}
	claims := fg.idClaimsFn()
	if mutate != nil {
		mutate(claims)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = fg.kid
	out, err := tok.SignedString(key)
	if err != nil {
		t.Fatalf("forge: %v", err)
	}
	return out
}

// code mints a fake authorization code the /token endpoint will accept.
func (fg *fakeGoogle) code() string {
	c := "gcode_" + randomHex(16)
	fg.mu.Lock()
	fg.codes[c] = false
	fg.mu.Unlock()
	return c
}

// ---- fake OAuth/devices stores --------------------------------------------------

type fakeOAuthStore struct {
	mu        sync.Mutex
	bySub     map[string]*domain.User
	byEmail   map[string]*domain.User
	subByUser map[string]string // userID → external subject (mirror of the SQL column)
	subCalls  atomic.Int64
	// users/tenants mirror the SQL's side effects: provision/link must be
	// visible through the same seams the service reads.
	users   *memUsers
	tenants *memTenants
	// scripted failure for race tests: first N calls per sub return race
	failFirst map[string]int
}

func newFakeOAuthStore(users *memUsers, tenants *memTenants) *fakeOAuthStore {
	return &fakeOAuthStore{bySub: map[string]*domain.User{}, byEmail: map[string]*domain.User{}, subByUser: map[string]string{}, users: users, tenants: tenants, failFirst: map[string]int{}}
}

// publish mirrors the SQL row landing in the users table.
func (f *fakeOAuthStore) publish(u *domain.User) {
	if f.users == nil {
		return
	}
	f.users.byID[u.ID] = &memUser{u: *u}
	f.users.byEm[u.Email] = f.users.byID[u.ID]
}

func (f *fakeOAuthStore) FindOrCreateGoogleUser(_ context.Context, sub, email, name, avatar string) (*domain.User, error) {
	f.subCalls.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failFirst[sub] > 0 {
		f.failFirst[sub]--
		return nil, repos.ErrOAuthSubjectRace
	}
	if u, ok := f.bySub[sub]; ok {
		u.AvatarURL = avatar // login: profile refresh from the current token
		return u, nil        // case 1: login
	}
	if u, ok := f.byEmail[strings.ToLower(email)]; ok {
		if linked, has := f.subByUser[u.ID]; has && linked != sub {
			return nil, repos.ErrIdentityConflict
		}
		// Google-only: an email match without a matching subject is a conflict;
		// there are no local accounts to link onto.
		return nil, repos.ErrIdentityConflict
	}
	u := &domain.User{
		ID: "usr_" + randomHex(8), Email: strings.ToLower(email), DisplayName: name,
		AvatarURL: avatar, Status: "active", AuthProvider: "google", EmailVerified: true,
	}
	f.bySub[sub] = u
	f.byEmail[strings.ToLower(email)] = u
	f.subByUser[u.ID] = sub
	if f.tenants != nil { // provision step: personal tenant + owner membership
		tenID := "ten_" + randomHex(8)
		f.tenants.byUser[u.ID] = []memTenant{{tenantID: tenID, role: "owner"}}
	}
	f.publish(u)
	return u, nil // case 2: provision
}

type fakeDevices struct {
	mu    sync.Mutex
	calls []string
}

func (f *fakeDevices) UpsertDevice(_ context.Context, userID, deviceID, name, platform string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, userID+"/"+name+"/"+platform)
	return "dev_" + randomHex(8), nil
}

// ---- the service under test -------------------------------------------------------

type oauthTestEnv struct {
	svc     *Service
	mr      *miniredis.Miniredis
	rdb     *redis.Client
	fg      *fakeGoogle
	users   *memUsers
	tenants *memTenants
	oauth   *fakeOAuthStore
	devices *fakeDevices
}

func newOAuthTestEnv(t *testing.T) *oauthTestEnv {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	fg := newFakeGoogle(t)
	users := newMemUsers()
	tenants := &memTenants{byUser: map[string][]memTenant{}}
	env := &oauthTestEnv{mr: mr, rdb: rdb, fg: fg, users: users, tenants: tenants,
		oauth: newFakeOAuthStore(users, tenants), devices: &fakeDevices{}}

	env.svc = &Service{
		Users:       users,
		Tenants:     tenants,
		RefreshRepo: newMemRefresh(),
		Redis:       rdb,
		Signer:      NewLocalSigner(testSecret, testIssuer, testAud, 0, time.Hour),
		AccessTTL:   time.Hour, RefreshTTL: 24 * time.Hour,

		Google: NewGoogleProvider("test-client-id", "test-client-secret",
			"https://api.example.test/v1/auth/oauth/google/callback",
			"https://accounts.google.example/auth", fg.tokURL, fg.jwksURL, nil, fg.srv.Client()),
		OAuth:   env.oauth,
		Devices: env.devices,
	}
	return env
}

// runOAuth drives begin→(fake google)→finish with a faithful tx cookie.
func (env *oauthTestEnv) runOAuth(t *testing.T, sub, email string) (*domain.User, string, error) {
	t.Helper()
	ctx := context.Background()

	redirect, _, tx, err := env.svc.BeginGoogleOAuth(ctx)
	if err != nil {
		return nil, "", err
	}
	if !strings.HasPrefix(redirect, "https://accounts.google.example/auth?") {
		t.Fatalf("redirect to unexpected place: %s", redirect)
	}

	env.fg.mu.Lock()
	env.fg.idClaimsFn = func() jwt.MapClaims {
		return jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "test-client-id",
			"sub": sub, "email": email, "email_verified": true,
			"name": "O Auth", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		}
	}
	env.fg.mu.Unlock()

	return env.svc.FinishGoogleOAuth(ctx, env.fg.code(), extractQueryParam(t, redirect, "state"), tx)
}

func extractQueryParam(t *testing.T, rawURL, key string) string {
	t.Helper()
	i := strings.Index(rawURL, key+"=")
	if i < 0 {
		t.Fatalf("param %s missing in %s", key, rawURL)
	}
	rest := rawURL[i+len(key)+1:]
	if j := strings.IndexByte(rest, '&'); j >= 0 {
		rest = rest[:j]
	}
	return rest
}

// ---- tests ------------------------------------------------------------------------

func TestGoogleAuthCodeURL(t *testing.T) {
	g := NewGoogleProvider("cid", "csecret", "https://api.x.test/cb", "https://auth.example/auth", "https://tok.example/token", "https://jwks.example/certs", nil, nil)
	url := g.AuthCodeURL("thestate")
	for _, want := range []string{
		"client_id=cid", "redirect_uri=", "response_type=code",
		"scope=openid+email+profile", "state=thestate", "prompt=select_account",
	} {
		if !strings.Contains(url, want) {
			t.Fatalf("auth url missing %q: %s", want, url)
		}
	}
}

func TestGoogleExchangeHappyPath(t *testing.T) {
	env := newOAuthTestEnv(t)
	ctx := context.Background()

	ident, err := env.svc.Google.Exchange(ctx, env.fg.code())
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if ident.Sub == "" || ident.Email != "guser@example.test" || !ident.EmailVerified || ident.Name == "" {
		t.Fatalf("identity: %+v", ident)
	}
}

func TestGoogleExchangeRejectsForgedSignature(t *testing.T) {
	env := newOAuthTestEnv(t)
	// A token signed by a key NOT in the served JWKS must be rejected.
	forged := env.fg.forgeToken(t, nil)
	if _, err := env.svc.Google.verifyIDToken(context.Background(), forged); err == nil {
		t.Fatal("forged signature accepted")
	} else if de := domain.AsError(err); de.Code != "OAUTH_PROVIDER_ERROR" {
		t.Fatalf("expected OAUTH_PROVIDER_ERROR, got %s", de.Code)
	}
}

func TestGoogleExchangeRejectsBadAudienceIssuerExpiry(t *testing.T) {
	env := newOAuthTestEnv(t)
	cases := []struct {
		name    string
		mutate  func(jwt.MapClaims)
		wantErr string
	}{
		{"wrong audience", func(c jwt.MapClaims) { c["aud"] = "someone-else" }, "audience"},
		{"wrong issuer", func(c jwt.MapClaims) { c["iss"] = "https://evil.example" }, "issuer"},
		{"expired", func(c jwt.MapClaims) { c["exp"] = time.Now().Add(-time.Hour).Unix() }, "token"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tok := env.fg.forgeToken(t, tc.mutate)
			// sign with the REAL key (so only the mutated claim fails): re-sign manually
			claims := env.fg.idClaimsFn()
			tc.mutate(claims)
			tk := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
			tk.Header["kid"] = env.fg.kid
			signed, err := tk.SignedString(env.fg.key)
			if err != nil {
				t.Fatalf("sign: %v", err)
			}
			if _, err := env.svc.Google.verifyIDToken(context.Background(), signed); err == nil {
				t.Fatalf("%s: accepted", tc.name)
			}
			_ = tok
		})
	}
}

func TestOAuthStateLifecycle(t *testing.T) {
	env := newOAuthTestEnv(t)
	env.svc.WebGrantTTL = 5 * time.Minute
	env.svc.OAuthStateTTL = 10 * time.Minute
	env.svc.WebSessionTTL = 15 * time.Minute
	ctx := context.Background()

	// Happy path: begin (capturing state+tx) → fake Google → finish. The user
	// is provisioned and a grant comes back.
	redirect, state, tx, err := env.svc.BeginGoogleOAuth(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	env.fg.mu.Lock()
	env.fg.idClaimsFn = func() jwt.MapClaims {
		return jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "test-client-id",
			"sub": "sub-a", "email": "a@example.test", "email_verified": true,
			"name": "A User", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	}
	env.fg.mu.Unlock()
	code1 := env.fg.code()
	if state2 := extractQueryParam(t, redirect, "state"); state2 != state {
		t.Fatalf("state mismatch %q vs %q", state2, state)
	}
	u, grant, err := env.svc.FinishGoogleOAuth(ctx, code1, state, tx)
	if err != nil {
		t.Fatalf("oauth journey: %v", err)
	}
	if u == nil || u.AuthProvider != "google" || !u.EmailVerified {
		t.Fatalf("user: %+v", u)
	}
	if !strings.HasPrefix(grant, "wgrant_") || len(grant) != len("wgrant_")+64 {
		t.Fatalf("grant shape: %q", grant)
	}

	// State replay: the SAME state with a fresh code and the right tx is dead.
	if _, _, err := env.svc.FinishGoogleOAuth(ctx, env.fg.code(), state, tx); err == nil {
		t.Fatal("state replay accepted")
	} else if de := domain.AsError(err); de.Code != "OAUTH_STATE_INVALID" {
		t.Fatalf("replay code: %s", de.Code)
	}

	// Wrong tx cookie → state error even with a valid fresh state.
	redirect, _, tx, err = env.svc.BeginGoogleOAuth(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, _, err := env.svc.FinishGoogleOAuth(ctx, env.fg.code(), extractQueryParam(t, redirect, "state"), tx+"dead"); err == nil {
		t.Fatal("mismatched tx accepted")
	} else if de := domain.AsError(err); de.Code != "OAUTH_STATE_INVALID" {
		t.Fatalf("tx code: %s", de.Code)
	}

	// Missing tx cookie (browser blocked it) → same generic error.
	redirect, _, _, err = env.svc.BeginGoogleOAuth(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, _, err := env.svc.FinishGoogleOAuth(ctx, env.fg.code(), extractQueryParam(t, redirect, "state"), ""); err == nil {
		t.Fatal("missing tx accepted")
	}

	// State expiry → same generic error.
	env.svc.OAuthStateTTL = 50 * time.Millisecond
	redirect, _, _, err = env.svc.BeginGoogleOAuth(ctx)
	if err != nil {
		t.Fatalf("begin2: %v", err)
	}
	env.mr.FastForward(100 * time.Millisecond)
	if _, _, err := env.svc.FinishGoogleOAuth(ctx, env.fg.code(), extractQueryParam(t, redirect, "state"), ""); err == nil {
		t.Fatal("expired state accepted")
	}
}

func TestOAuthUnverifiedProviderEmailRejected(t *testing.T) {
	env := newOAuthTestEnv(t)
	env.fg.mu.Lock()
	env.fg.idClaimsFn = func() jwt.MapClaims {
		return jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "test-client-id",
			"sub": "sub-b", "email": "b@example.test", "email_verified": false,
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	}
	env.fg.mu.Unlock()

	redirect, _, tx, err := env.svc.BeginGoogleOAuth(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, _, err := env.svc.FinishGoogleOAuth(context.Background(), env.fg.code(), extractQueryParam(t, redirect, "state"), tx); err == nil {
		t.Fatal("unverified email accepted")
	} else if de := domain.AsError(err); de.Code != "OAUTH_EMAIL_UNVERIFIED" {
		t.Fatalf("code: %s", de.Code)
	}
	if len(env.oauth.bySub) != 0 {
		t.Fatal("user created from unverified email")
	}
}

func TestOAuthRaceRetriesConverge(t *testing.T) {
	env := newOAuthTestEnv(t)
	// First two resolutions "lose the insert race", then the winner exists.
	env.oauth.mu.Lock()
	env.oauth.failFirst["sub-race"] = 2
	env.oauth.mu.Unlock()

	u, err := env.svc.resolveGoogleUser(context.Background(), &GoogleIdentity{Sub: "sub-race", Email: "race@example.test", EmailVerified: true, Name: "Race"})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if u == nil || u.AuthProvider != "google" {
		t.Fatalf("user: %+v", u)
	}
	if env.oauth.subCalls.Load() != 3 {
		t.Fatalf("expected 3 attempts, got %d", env.oauth.subCalls.Load())
	}

	// Identity conflict is terminal, not retried.
	env.oauth.byEmail["conflict@example.test"] = &domain.User{ID: "usr_c", Email: "conflict@example.test", AuthProvider: "google"}
	env.oauth.subByUser["usr_c"] = "other-sub"
	if _, err := env.svc.resolveGoogleUser(context.Background(), &GoogleIdentity{Sub: "sub-new", Email: "conflict@example.test", EmailVerified: true}); err == nil {
		t.Fatal("conflict accepted")
	} else if de := domain.AsError(err); de.Code != "IDENTITY_CONFLICT" {
		t.Fatalf("code: %s", de.Code)
	}
}

func TestExchangeWebGrant(t *testing.T) {
	env := newOAuthTestEnv(t)
	env.svc.WebSessionTTL = 5 * time.Minute
	env.svc.WebGrantTTL = 5 * time.Minute
	ctx := context.Background()

	u, grant, err := env.runOAuth(t, "sub-w", "w@example.test")
	if err != nil {
		t.Fatalf("oauth: %v", err)
	}
	ws, err := env.svc.ExchangeWebGrant(ctx, grant)
	if err != nil {
		t.Fatalf("web session: %v", err)
	}
	if ws.User.ID != u.ID || ws.ExpiresIn != 300 || ws.AccessToken == "" {
		t.Fatalf("session: %+v", ws)
	}
	// The token must verify and carry the web user's claims.
	claims, err := env.svc.Signer.Verify(ctx, ws.AccessToken)
	if err != nil {
		t.Fatalf("web token verify: %v", err)
	}
	if claims.Subject != u.ID {
		t.Fatalf("claims sub: %+v", claims)
	}
	// Grant replay fails.
	if _, err := env.svc.ExchangeWebGrant(ctx, grant); err == nil {
		t.Fatal("grant replay accepted")
	}
}

// memRefresh/memUsers/memTenants fakes are shared with signup_test.go (same
// package) — no redefinition here.

// silence unused warnings for fmt/err helpers used conditionally by cases.
var _ = fmt.Sprintf
var _ = errors.New

// TestGoogleCustomIssuerConfigured proves the issuer allowlist is deployment
// config, not code: a fake OAuth server issuing tokens under its OWN issuer
// (the exact situation of pointing NEXAU_AUTH_GOOGLE_*_URL at a test server)
// is accepted when the issuer is configured and rejected when it is not.
func TestGoogleCustomIssuerConfigured(t *testing.T) {
	env := newOAuthTestEnv(t)
	const customIss = "https://oauth.test.mash.local"

	// The provider the deployment would build from env: endpoints at the
	// fake, issuer list containing the fake's issuer.
	custom := NewGoogleProvider("test-client-id", "test-client-secret",
		"https://api.example.test/v1/auth/oauth/google/callback",
		"https://accounts.google.example/auth", env.fg.tokURL, env.fg.jwksURL,
		[]string{customIss}, env.fg.srv.Client())

	forge := func(iss string) string {
		claims := env.fg.idClaimsFn()
		claims["iss"] = iss
		tk := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tk.Header["kid"] = env.fg.kid
		signed, err := tk.SignedString(env.fg.key)
		if err != nil {
			t.Fatalf("sign: %v", err)
		}
		return signed
	}

	// Accepted when configured.
	if _, err := custom.verifyIDToken(context.Background(), forge(customIss)); err != nil {
		t.Fatalf("custom issuer must be accepted when configured: %v", err)
	}
	// Rejected with default issuers (the old hardcoded-map behavior).
	if _, err := env.svc.Google.verifyIDToken(context.Background(), forge(customIss)); err == nil {
		t.Fatal("custom issuer must be rejected by the default (Google-only) allowlist")
	}
	// Google's issuer still rejected by the custom-only deployment.
	if _, err := custom.verifyIDToken(context.Background(), forge("https://accounts.google.com")); err == nil {
		t.Fatal("unconfigured Google issuer must be rejected by the custom allowlist")
	}
}
