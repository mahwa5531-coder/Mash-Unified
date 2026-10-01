package validation

// §42 — Google OAuth + web-to-desktop handshake.
//
// HTTP-level coverage over the REAL router, REAL auth middleware, REAL
// service pipeline and a faithful FAKE Google (authorization redirects,
// token endpoint, JWKS). Storage seams are in-memory fakes with the same
// atomicity semantics as the SQL. This file proves the wire contract:
// redirect chain, cookie binding, single-use semantics on every code,
// dual-channel exchange (exactly one winner), enumeration surfaces, rate
// limits, token-leak absence and the full browser→desktop journey.

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
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

// ---- fake Google (auth redirect + token + JWKS) --------------------------------

type v42Google struct {
	srv *httptest.Server

	mu        sync.Mutex
	key       *rsa.PrivateKey
	kid       string
	codes     map[string]bool
	claimsFn  func() jwt.MapClaims
	signWrong bool // sign with a foreign key (forgery probe)
}

func newV42Google(t *testing.T, apiBase string) *v42Google {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa: %v", err)
	}
	g := &v42Google{key: key, kid: "v42-key-1", codes: map[string]bool{}}
	g.claimsFn = func() jwt.MapClaims {
		return jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "v42-client-id",
			"sub": "v42-sub-default", "email": "g@nexau.test", "email_verified": true,
			"name": "V Forty Two", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		}
	}
	mux := http.NewServeMux()

	// The consent screen: validates the request and redirects back with code+state.
	mux.HandleFunc("GET /o/oauth2/v2/auth", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("client_id") != "v42-client-id" || q.Get("response_type") != "code" ||
			q.Get("state") == "" || q.Get("redirect_uri") == "" ||
			!strings.Contains(q.Get("scope"), "openid") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		cb := q.Get("redirect_uri")
		if !strings.HasPrefix(cb, apiBase) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		code := "gcode_" + fmt.Sprintf("%032x", time.Now().UnixNano())
		g.mu.Lock()
		g.codes[code] = false
		g.mu.Unlock()
		sep := "?"
		if strings.Contains(cb, "?") {
			sep = "&"
		}
		http.Redirect(w, r, cb+sep+url.Values{"code": {code}, "state": {q.Get("state")}}.Encode(), http.StatusFound)
	})

	// The token endpoint: strict client credentials + single-use codes.
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.Form.Get("client_id") != "v42-client-id" || r.Form.Get("client_secret") != "v42-client-secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		code := r.Form.Get("code")
		g.mu.Lock()
		issued, ok := g.codes[code]
		g.codes[code] = true
		wrong := g.signWrong
		g.mu.Unlock()
		if !ok || issued {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
			return
		}
		var signingKey any = g.key
		if wrong {
			foreign, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				w.WriteHeader(500)
				return
			}
			signingKey = foreign
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, g.claimsFn())
		tok.Header["kid"] = g.kid
		signed, err := tok.SignedString(signingKey)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id_token": signed, "access_token": "opaque", "token_type": "Bearer"})
	})

	// The JWKS endpoint.
	mux.HandleFunc("GET /oauth2/v3/certs", func(w http.ResponseWriter, r *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(g.key.PublicKey.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(g.key.PublicKey.E)).Bytes())
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{"kty": "RSA", "kid": g.kid, "alg": "RS256", "use": "sig", "n": n, "e": e}},
		})
	})

	g.srv = httptest.NewServer(mux)
	t.Cleanup(g.srv.Close)
	return g
}

func (g *v42Google) setClaims(fn func() jwt.MapClaims) {
	g.mu.Lock()
	g.claimsFn = fn
	g.mu.Unlock()
}
func (g *v42Google) setSignWrong(v bool) {
	g.mu.Lock()
	g.signWrong = v
	g.mu.Unlock()
}

// ---- storage fakes (atomicity mirrors of the OAuth SQL) ------------------------

type v42OAuthStore struct {
	mu        sync.Mutex
	bySub     map[string]*domain.User
	byEmail   map[string]*domain.User
	subByUser map[string]string
	users     *v41Users
	provs     atomic.Int64
}

func (f *v42OAuthStore) FindOrCreateGoogleUser(_ context.Context, sub, email, name string) (*domain.User, repos.OAuthOutcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if u, ok := f.bySub[sub]; ok {
		return u, repos.OAuthLoggedIn, nil // login
	}
	// Case 2 must see users registered through the shared store (SQL: one table).
	existing, ok := f.byEmail[strings.ToLower(email)]
	if !ok {
		f.users.mu.Lock()
		if u, ok2 := f.users.byEm[strings.ToLower(email)]; ok2 {
			existing = &u.User // pointer INTO the store: mutations persist
			ok = true
		}
		f.users.mu.Unlock()
	}
	if ok {
		u := existing
		if linked, has := f.subByUser[u.ID]; has && linked != sub {
			return u, 0, fmt.Errorf("identity conflict")
		}
		if !u.EmailVerified {
			// Mirrors the repo's anti-pre-hijacking gate: no OAuth
			// identity links onto an unverified local account.
			return nil, 0, repos.ErrOAuthAccountUnverified
		}
		u.AuthProvider = "google"
		u.EmailVerified = true
		if u.DisplayName == "" {
			u.DisplayName = name
		}
		f.subByUser[u.ID] = sub
		f.bySub[sub] = u
		return u, repos.OAuthLinked, nil // link
	}
	u := &domain.User{
		ID: "usr_" + fmt.Sprintf("%012x", f.provs.Add(1)), Email: strings.ToLower(email),
		DisplayName: name, Status: "active", AuthProvider: "google", EmailVerified: true,
	}
	f.bySub[sub] = u
	f.byEmail[strings.ToLower(email)] = u
	f.subByUser[u.ID] = sub
	f.users.mu.Lock()
	f.users.byID[u.ID] = &v41User{User: *u}
	f.users.byEm[u.Email] = f.users.byID[u.ID]
	f.users.mu.Unlock()
	f.provs.Add(0)
	return u, repos.OAuthProvisioned, nil // provision
}

type v42Devices struct {
	mu    sync.Mutex
	calls []string
}

func (d *v42Devices) UpsertDevice(_ context.Context, userID, deviceID, name, platform string) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls = append(d.calls, userID+"|"+name+"|"+platform)
	return "dev_" + fmt.Sprintf("%08x", len(d.calls)), nil
}

// ---- the stack -------------------------------------------------------------------

type v42Opts struct {
	lookupPerIP          int
	webSessionPerIP      int
	desktopExchangePerIP int
	desktopCodePerMin    int
	oauthPerIP           int // GET /v1/auth/oauth/google{,/callback} per-IP budget (0 = off; §45)
	desktopTTL           time.Duration
	webSessionTTL        time.Duration
	signup               bool
}

type v42Stack struct {
	srv      *http.Server // bare API server on a pre-bound listener
	apiBase  string
	google   *v42Google
	users    *v41Users
	oauth    *v42OAuthStore
	devices  *v42Devices
	rdb      *redis.Client
	mr       *miniredis.Miniredis
	success  *httptest.Server // fake web success page (captures ?grant=)
	lastPath atomic.Value     // string

	// Signup & recovery collaborators (§45 pre-hijacking journeys).
	recovery *v41Recovery
	mail     *v41Mailer
}

func newV42Stack(t *testing.T, o v42Opts) *v42Stack {
	t.Helper()

	st := &v42Stack{}

	// Fake web success page: records the grant and answers 200.
	success := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		st.lastPath.Store(r.URL.RawQuery)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("signed in"))
	}))
	t.Cleanup(success.Close)

	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	// Bind the API listener FIRST so the fake Google (redirect_uri validation)
	// and the OAuth client (callback URL) agree on the real base URL.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	apiBase := "http://" + ln.Addr().String()

	google := newV42Google(t, apiBase)
	users := &v41Users{byID: map[string]*v41User{}, byEm: map[string]*v41User{}}
	oauth := &v42OAuthStore{bySub: map[string]*domain.User{}, byEmail: map[string]*domain.User{}, subByUser: map[string]string{}, users: users}
	devices := &v42Devices{}

	signer := auth.NewLocalSigner(testSecret, "https://auth.nexau.test", "nexau-v42", 0, time.Hour)
	if o.webSessionTTL == 0 {
		o.webSessionTTL = 15 * time.Minute
	}
	if o.desktopTTL == 0 {
		o.desktopTTL = 60 * time.Second
	}
	recovery := &v41Recovery{bySel: map[string]*v41Token{}, users: users}
	mail := &v41Mailer{}
	svc := &auth.Service{
		Users:       users,
		Tenants:     v41Tenants{},
		RefreshRepo: &v41Refresh{byHash: map[string]*v41RefreshToken{}},
		Redis:       rdb,
		Signer:      signer,
		AccessTTL:   time.Hour, RefreshTTL: 24 * time.Hour,

		Registrar:         &v41Registrar{users: users}, // signup surface (link-flow tests)
		Recovery:          recovery,
		Mail:              mail,
		RequireVerified:   true,
		VerifyTTL:         time.Hour,
		ResetTTL:          30 * time.Minute,
		ResendCooldown:    time.Minute,
		MinPasswordLength: 8,
		AppBaseURL:        "https://app.nexau.test",

		Google: auth.NewGoogleProvider("v42-client-id", "v42-client-secret",
			apiBase+"/v1/auth/oauth/google/callback",
			google.srv.URL+"/o/oauth2/v2/auth", google.srv.URL+"/token", google.srv.URL+"/oauth2/v3/certs",
			google.srv.Client()),
		OAuth:          oauth,
		Devices:        devices,
		WebSessionTTL:  o.webSessionTTL,
		WebGrantTTL:    5 * time.Minute,
		OAuthStateTTL:  10 * time.Minute,
		DesktopCodeTTL: o.desktopTTL,
	}

	authMW := auth.Middleware{Verifier: signer, Resolver: &v41Resolver{users: users}, Service: svc, AuthTimeout: 2 * time.Second, RevocationCheck: true}

	cfg := &config.Config{
		MaxBodyBytes: 1 << 20, MaxMessages: 16, MaxTools: 8, MaxModelLen: 64,
		AuthTimeout: 2 * time.Second,
		Auth: config.AuthConfig{
			Mode: "local", LoginEnabled: true, SignupEnabled: o.signup,
			Issuer: "https://auth.nexau.test", Audience: "nexau-v42",
			WebSuccessURL:     success.URL,
			WebLoginURL:       success.URL + "/login",
			OAuthCookieSecure: false, // httptest runs plain http

			MaxLookupPerIP:          o.lookupPerIP,
			MaxWebSessionPerIP:      o.webSessionPerIP,
			MaxDesktopExchangePerIP: o.desktopExchangePerIP,
			MaxDesktopCodePerMin:    o.desktopCodePerMin,
			MaxOAuthPerIP:           o.oauthPerIP,
		},
		Rate:           config.RateLimitConfig{RunConcurrencyTimeout: time.Minute},
		IdempotencyTTL: time.Hour,
		SessionIdleTTL: time.Hour,
	}

	metrics := observability.NewMetrics()
	limiter := ratelimit.New(rdb, true, metrics)
	apiH := api.New(cfg, svc, authMW, nil, nil, nil, nil, nil, nil, nil, limiter, metrics, nil, nil)
	chain := middleware.Chain(middleware.Options{MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: 64}, metrics)

	srv := &http.Server{Handler: chain(apiH.Router())}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	st.srv, st.apiBase, st.google, st.users, st.oauth = srv, apiBase, google, users, oauth
	st.devices, st.rdb, st.mr, st.success = devices, rdb, mr, success
	st.recovery, st.mail = recovery, mail
	return st
}

// browser returns a redirect-following client with a tx-cookie jar.
func (s *v42Stack) browser(t *testing.T) *http.Client {
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("jar: %v", err)
	}
	return &http.Client{Jar: jar, Timeout: 10 * time.Second}
}

// oauthJourney drives the full browser OAuth flow for (sub,email) and returns
// the grant from the success page's URL — read from THIS journey's final
// request (never the shared recorder, which races under concurrency).
func (s *v42Stack) oauthJourney(t *testing.T, sub, email string) string {
	t.Helper()
	s.google.setClaims(func() jwt.MapClaims {
		return jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "v42-client-id",
			"sub": sub, "email": email, "email_verified": true, "name": "Journey User",
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
		}
	})
	c := s.browser(t)
	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("journey: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != 200 || !strings.Contains(string(body), "signed in") {
		t.Fatalf("journey landed wrong: %d %s (final %s)", resp.StatusCode, body, resp.Request.URL)
	}
	grant := resp.Request.URL.Query().Get("grant")
	if !strings.HasPrefix(grant, "wgrant_") {
		t.Fatalf("no grant on final url: %s", resp.Request.URL)
	}
	return grant
}

func (s *v42Stack) post(t *testing.T, path string, body any, bearer string) (int, map[string]any, http.Header, string) {
	t.Helper()
	blob, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, s.apiBase+path, bytes.NewReader(blob))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out, resp.Header, string(raw)
}

// ---- §42 tests ---------------------------------------------------------------------

// TestV42_01_GoogleOAuthFullJourney: browser → Google → success page → web
// session token → desktop code → desktop exchange → the pair works on /v1/me
// and rotates on refresh. The complete 4-screen contract over the wire.
func TestV42_01_GoogleOAuthFullJourney(t *testing.T) {
	s := newV42Stack(t, v42Opts{})

	grant := s.oauthJourney(t, "v42-sub-1", "one@nexau.test")

	// Screen 3: web page exchanges the grant for a short session.
	code, body, _, raw := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	if code != 200 {
		t.Fatalf("web session: %d %s", code, raw)
	}
	webTok, _ := body["access_token"].(string)
	if webTok == "" {
		t.Fatalf("web session body: %s", raw)
	}
	if _, has := body["refresh_token"]; has {
		t.Fatal("web session returned a refresh token to the browser")
	}
	if exp, _ := body["expires_in"].(float64); exp != 900 {
		t.Fatalf("web session ttl: %v", body["expires_in"])
	}
	if u, _ := body["user"].(map[string]any); u["email"] != "one@nexau.test" {
		t.Fatalf("web session user: %v", body["user"])
	}

	// The web token authorizes the desktop-code mint.
	code, body, _, raw = s.post(t, "/v1/auth/desktop/code", map[string]string{}, webTok)
	if code != 200 {
		t.Fatalf("desktop code: %d %s", code, raw)
	}
	mcode, _ := body["code"].(string)
	if !strings.HasPrefix(mcode, "mcode_") || len(mcode) != 70 {
		t.Fatalf("mcode shape: %q", mcode)
	}
	if exp, _ := body["expires_in"].(float64); exp != 60 {
		t.Fatalf("mcode ttl: %v", body["expires_in"])
	}

	// The desktop (deep-link channel) exchanges it for a full pair.
	code, body, _, raw = s.post(t, "/v1/auth/desktop/exchange", map[string]string{
		"code": mcode, "device_name": "Rama Windows PC", "platform": "windows",
	}, "")
	if code != 200 {
		t.Fatalf("exchange: %d %s", code, raw)
	}
	access, _ := body["access_token"].(string)
	refresh, _ := body["refresh_token"].(string)
	if access == "" || refresh == "" {
		t.Fatalf("pair: %s", raw)
	}
	if u, _ := body["user"].(map[string]any); u["email"] != "one@nexau.test" {
		t.Fatalf("exchange user: %v", body["user"])
	}

	// The pair authenticates /v1/me.
	req, _ := http.NewRequest(http.MethodGet, s.apiBase+"/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("me: %v", err)
	}
	defer resp.Body.Close()
	var me map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&me)
	if resp.StatusCode != 200 {
		t.Fatalf("me: %d %v", resp.StatusCode, me)
	}

	// The refresh token rotates (the desktop's sliding refresher).
	code, body, _, raw = s.post(t, "/v1/auth/refresh", map[string]string{"refresh_token": refresh}, "")
	if code != 200 || body["access_token"] == nil {
		t.Fatalf("refresh: %d %s", code, raw)
	}

	// A device row was registered.
	if len(s.devices.calls) != 1 {
		t.Fatalf("device rows: %v", s.devices.calls)
	}
}

// TestV42_02_OAuthStateTampered: a state modified between begin and callback
// is rejected and the browser lands on the web login page with an error code.
func TestV42_02_OAuthStateTampered(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	c := s.browser(t)

	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	resp.Body.Close()
	// (landed on Google consent → redirected back → success already?) No:
	// the fake consent redirects with the REAL state; tamper instead by
	// hitting the callback directly with a mangled state.
	tampered := "deadbeef" + strings.Repeat("0", 56)
	req, _ := http.NewRequest(http.MethodGet, s.apiBase+"/v1/auth/oauth/google/callback?code=whatever&state="+tampered, nil)
	resp2, err := c.Do(req)
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	resp2.Body.Close()
	if resp2.Request == nil || !strings.Contains(resp2.Request.URL.String(), "/login?error=OAUTH_STATE_INVALID") {
		t.Fatalf("tampered state did not route to login error page: %v", resp2.Request.URL)
	}
}

// TestV42_03_OAuthMissingTxCookie: the callback without the tx cookie
// (browser blocked it / cross-site injection) fails with the generic error.
func TestV42_03_OAuthMissingTxCookie(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	c := s.browser(t)

	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	resp.Body.Close()

	// Replay the callback URL WITHOUT the jar (no cookie).
	s.google.setClaims(func() jwt.MapClaims {
		return jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "v42-client-id",
			"sub": "v42-sub-3", "email": "three@nexau.test", "email_verified": true,
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	})
	code := "gcode_" + fmt.Sprintf("%032x", time.Now().UnixNano())
	s.google.mu.Lock()
	s.google.codes[code] = false
	state := ""
	s.google.mu.Unlock()
	// extract the state of the last begin from the redirect chain is complex;
	// instead drive a fresh begin WITHOUT following (no cookie storage).
	req, _ := http.NewRequest(http.MethodGet, s.apiBase+"/v1/auth/oauth/google", nil)
	noJar := &http.Client{CheckRedirect: func(r *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	r1, err := noJar.Do(req)
	if err != nil {
		t.Fatalf("begin nojar: %v", err)
	}
	r1.Body.Close()
	googleURL := r1.Header.Get("Location")
	u, _ := url.Parse(googleURL)
	state = u.Query().Get("state")
	_ = state

	// Have Google issue a code for this state manually, then callback cookieless.
	s.google.mu.Lock()
	s.google.codes[code] = false
	s.google.mu.Unlock()
	cb := s.apiBase + "/v1/auth/oauth/google/callback?code=" + code + "&state=" + state
	r2, err := noJar.Get(cb)
	if err != nil {
		t.Fatalf("callback nojar: %v", err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusFound || !strings.Contains(r2.Header.Get("Location"), "error=OAUTH_STATE_INVALID") {
		t.Fatalf("cookieless callback: %d %s", r2.StatusCode, r2.Header.Get("Location"))
	}
}

// TestV42_04_OAuthForgedIDToken: an ID token signed by a key absent from the
// served JWKS is rejected; no user is created.
func TestV42_04_OAuthForgedIDToken(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	s.google.setSignWrong(true)

	c := s.browser(t)
	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("journey: %v", err)
	}
	resp.Body.Close()
	if resp.Request == nil || !strings.Contains(resp.Request.URL.String(), "error=OAUTH_PROVIDER_ERROR") {
		t.Fatalf("forged token not rejected: %v", resp.Request.URL)
	}
	if n := len(s.users.byID); n != 0 {
		t.Fatalf("user created from forged token: %d", n)
	}
}

// TestV42_05_OAuthUnverifiedEmail: Google-asserted but unverified emails
// never create accounts.
func TestV42_05_OAuthUnverifiedEmail(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	s.google.setClaims(func() jwt.MapClaims {
		return jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "v42-client-id",
			"sub": "v42-sub-5", "email": "unverified@nexau.test", "email_verified": false,
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix()}
	})
	c := s.browser(t)
	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("journey: %v", err)
	}
	resp.Body.Close()
	if resp.Request == nil || !strings.Contains(resp.Request.URL.String(), "error=OAUTH_EMAIL_UNVERIFIED") {
		t.Fatalf("unverified email not rejected: %v", resp.Request.URL)
	}
}

// TestV42_06_DesktopCodeDualChannelSingleWinner: both delivery channels
// (deep link and localhost loopback) race the same code over real HTTP;
// exactly one exchange succeeds.
func TestV42_06_DesktopCodeDualChannelSingleWinner(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	grant := s.oauthJourney(t, "v42-sub-6", "six@nexau.test")

	_, body, _, raw := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	if code, _ := body["access_token"].(string); code == "" {
		t.Fatalf("web session: %s", raw)
	}
	webTok := body["access_token"].(string)
	_, body, _, raw = s.post(t, "/v1/auth/desktop/code", map[string]string{}, webTok)
	mcode, _ := body["code"].(string)
	if mcode == "" {
		t.Fatalf("code: %s", raw)
	}

	const n = 6
	var wg sync.WaitGroup
	res := make([]int, n)
	resBody := make([]map[string]any, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res[i], resBody[i], _, _ = s.post(t, "/v1/auth/desktop/exchange", map[string]string{
				"code": mcode, "device_name": "PC", "platform": "windows",
			}, "")
		}(i)
	}
	wg.Wait()

	wins, dead := 0, 0
	for i := 0; i < n; i++ {
		switch {
		case res[i] == 200 && resBody[i]["access_token"] != nil:
			wins++
		case res[i] == 400 && errCode(t, resBody[i]) == "INVALID_OR_EXPIRED_CODE":
			dead++
		default:
			t.Fatalf("unexpected result: %d %v", res[i], resBody[i])
		}
	}
	if wins != 1 || dead != n-1 {
		t.Fatalf("wins=%d dead=%d want 1/%d", wins, dead, n-1)
	}
}

// TestV42_07_DesktopCodeExpiry: codes past their TTL are dead.
func TestV42_07_DesktopCodeExpiry(t *testing.T) {
	s := newV42Stack(t, v42Opts{desktopTTL: 120 * time.Millisecond})
	grant := s.oauthJourney(t, "v42-sub-7", "seven@nexau.test")

	_, body, _, raw := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	if raw == "" {
		t.Fatal("web session failed")
	}
	webTok := body["access_token"].(string)
	_, body, _, _ = s.post(t, "/v1/auth/desktop/code", map[string]string{}, webTok)
	mcode := body["code"].(string)

	s.mr.FastForward(300 * time.Millisecond)
	code, out, _, _ := s.post(t, "/v1/auth/desktop/exchange", map[string]string{"code": mcode, "platform": "windows"}, "")
	if code != 400 || errCode(t, out) != "INVALID_OR_EXPIRED_CODE" {
		t.Fatalf("expired code: %d %v", code, out)
	}
}

// TestV42_08_LookupMatrix: the login screen's email step.
func TestV42_08_LookupMatrix(t *testing.T) {
	s := newV42Stack(t, v42Opts{signup: true})

	// Unknown account.
	code, body, _, _ := s.post(t, "/v1/auth/lookup", map[string]string{"email": "ghost@nexau.test"}, "")
	if code != 200 || body["exists"] != false {
		t.Fatalf("unknown: %d %v", code, body)
	}

	// Local (registered with password) account.
	s.post(t, "/v1/auth/register", map[string]string{"email": "local@nexau.test", "password": "correct-horse-9"}, "")
	code, body, _, _ = s.post(t, "/v1/auth/lookup", map[string]string{"email": "LOCAL@nexau.test"}, "")
	if code != 200 || body["exists"] != true || body["auth_provider"] != "local" {
		t.Fatalf("local: %d %v", code, body)
	}

	// Google account (OAuth-provisioned).
	s.oauthJourney(t, "v42-sub-8", "googler@nexau.test")
	code, body, _, _ = s.post(t, "/v1/auth/lookup", map[string]string{"email": "googler@nexau.test"}, "")
	if code != 200 || body["exists"] != true || body["auth_provider"] != "google" {
		t.Fatalf("google: %d %v", code, body)
	}

	// Invalid input.
	code, body, _, _ = s.post(t, "/v1/auth/lookup", map[string]string{"email": "not-an-email"}, "")
	if code != 400 {
		t.Fatalf("invalid: %d %v", code, body)
	}
}

// TestV42_09_HandshakeRateLimits: every public handshake surface throttles
// per IP with Retry-After, counted on ANY request.
func TestV42_09_HandshakeRateLimits(t *testing.T) {
	s := newV42Stack(t, v42Opts{lookupPerIP: 3, desktopExchangePerIP: 3, desktopCodePerMin: 2})

	for i := 0; i < 3; i++ {
		code, _, _, _ := s.post(t, "/v1/auth/lookup", map[string]string{"email": "x@nexau.test"}, "")
		if code != 200 {
			t.Fatalf("lookup %d: %d", i, code)
		}
	}
	code, body, hdr, _ := s.post(t, "/v1/auth/lookup", map[string]string{"email": "x@nexau.test"}, "")
	if code != 429 || errCode(t, body) != "RATE_LIMITED" || hdr.Get("Retry-After") == "" {
		t.Fatalf("lookup limit: %d %v ra=%q", code, body, hdr.Get("Retry-After"))
	}

	for i := 0; i < 3; i++ {
		code, _, _, _ = s.post(t, "/v1/auth/desktop/exchange", map[string]string{"code": "mcode_" + strings.Repeat("0", 64), "platform": "windows"}, "")
		if code != 400 {
			t.Fatalf("exchange %d: %d", i, code)
		}
	}
	code, body, hdr, _ = s.post(t, "/v1/auth/desktop/exchange", map[string]string{"code": "mcode_" + strings.Repeat("0", 64), "platform": "windows"}, "")
	if code != 429 || hdr.Get("Retry-After") == "" {
		t.Fatalf("exchange limit: %d %v", code, body)
	}

	// Per-user code mint limit (needs a valid web token).
	grant := s.oauthJourney(t, "v42-sub-9", "nine@nexau.test")
	_, body, _, _ = s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	webTok := body["access_token"].(string)
	for i := 0; i < 2; i++ {
		code, _, _, _ = s.post(t, "/v1/auth/desktop/code", map[string]string{}, webTok)
		if code != 200 {
			t.Fatalf("mint %d: %d", i, code)
		}
	}
	code, body, hdr, _ = s.post(t, "/v1/auth/desktop/code", map[string]string{}, webTok)
	if code != 429 || errCode(t, body) != "RATE_LIMITED" || hdr.Get("Retry-After") == "" {
		t.Fatalf("mint limit: %d %v", code, body)
	}
}

// TestV42_10_LinkLocalAccount: an existing password account is linked (not
// duplicated) by Google sign-in with the same email; the password keeps
// working on the desktop login surface.
func TestV42_10_LinkLocalAccount(t *testing.T) {
	s := newV42Stack(t, v42Opts{signup: true, lookupPerIP: 1000})

	code, _, _, raw := s.post(t, "/v1/auth/register", map[string]string{"email": "link@nexau.test", "password": "staple-battery-7"}, "")
	if code != 201 {
		t.Fatalf("register: %d %s", code, raw)
	}

	// Verify the email first (RequireVerified gate would block password login).
	vlink := s.users.byEm["link@nexau.test"]
	// Direct store flip (the emailed token path is covered in §41).
	s.users.mu.Lock()
	vlink.EmailVerified = true
	s.users.mu.Unlock()

	grant := s.oauthJourney(t, "v42-sub-10", "link@nexau.test")

	// The same email still resolves to ONE user, now google-providered.
	if len(s.users.byID) != 1 {
		t.Fatalf("user duplicated by link: %d", len(s.users.byID))
	}
	code, body, _, _ := s.post(t, "/v1/auth/lookup", map[string]string{"email": "link@nexau.test"}, "")
	if code != 200 || body["auth_provider"] != "google" {
		t.Fatalf("lookup after link: %v", body)
	}

	// The grant works and reports the linked user.
	_, wb, _, _ := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	if u, _ := wb["user"].(map[string]any); u["email"] != "link@nexau.test" {
		t.Fatalf("linked user: %v", wb["user"])
	}

	// The desktop password login still works (dual-mode identity).
	// (bcrypt fixture: the register path stored a real hash; the fake login
	// compares against it through the real service.)
	code, body, _, raw = s.post(t, "/v1/auth/login", map[string]string{"email": "link@nexau.test", "password": "staple-battery-7"}, "")
	if code != 200 || body["access_token"] == nil {
		t.Fatalf("password after link: %d %s", code, raw)
	}
}

// TestV42_11_TokenLeakScan: no long-lived token or mcode appears in any URL
// or Location header across the whole flow; the browser only ever sees
// single-use grants and the short web token.
func TestV42_11_TokenLeakScan(t *testing.T) {
	s := newV42Stack(t, v42Opts{})

	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		loc := r.URL.String()
		for _, banned := range []string{"access_token", "refresh_token", "mcode_"} {
			if strings.Contains(loc, banned) {
				t.Fatalf("token leak in redirect: %s", loc)
			}
		}
		if len(via) >= 10 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}}
	resp, err := c.Get(s.apiBase + "/v1/auth/oauth/google")
	if err != nil {
		t.Fatalf("journey: %v", err)
	}
	resp.Body.Close()

	last, _ := s.lastPath.Load().(string)
	q, _ := url.ParseQuery(last)
	grant := q.Get("grant")
	if !strings.HasPrefix(grant, "wgrant_") {
		t.Fatalf("no grant: %q", last)
	}

	// The web session response contains the access token ONLY in the JSON
	// body (not headers), and no refresh token at all.
	code, body, hdr, raw := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	if code != 200 {
		t.Fatalf("web session: %s", raw)
	}
	if strings.Contains(raw, "refresh_token") {
		t.Fatal("refresh token in web session response")
	}
	for k := range hdr {
		if strings.Contains(strings.ToLower(k), "authorization") {
			t.Fatalf("authorization header leaked: %s", k)
		}
	}
	_ = body
}

// TestV42_12_ConcurrentSameSubjectProvision: N parallel OAuth journeys for
// the same Google subject converge on exactly one user; every journey gets
// a usable grant.
func TestV42_12_ConcurrentSameSubjectProvision(t *testing.T) {
	s := newV42Stack(t, v42Opts{})

	const n = 6
	grants := make([]string, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			grants[i] = s.oauthJourney(t, "v42-sub-12", "race@nexau.test")
			if grants[i] == "" {
				errs[i] = fmt.Errorf("no grant")
			}
		}(i)
	}
	wg.Wait()
	for i, e := range errs {
		if e != nil {
			t.Fatalf("journey %d: %v", i, e)
		}
	}
	// Exactly one user, exactly one device-less provision, and every grant
	// still exchanges into a valid web session.
	s.oauth.mu.Lock()
	nUsers := len(s.users.byID)
	s.oauth.mu.Unlock()
	if nUsers != 1 {
		t.Fatalf("users after race: %d", nUsers)
	}
	for i, g := range grants {
		code, body, _, _ := s.post(t, "/v1/auth/web/session", map[string]string{"grant": g}, "")
		if code != 200 || body["access_token"] == nil {
			t.Fatalf("grant %d unusable: %d %v", i, code, body)
		}
	}
}

// TestV42_13_DesktopCodeRequiresAuth: the mint endpoint is authenticated.
func TestV42_13_DesktopCodeRequiresAuth(t *testing.T) {
	s := newV42Stack(t, v42Opts{})
	code, body, _, _ := s.post(t, "/v1/auth/desktop/code", map[string]string{}, "")
	if code != 401 || errCode(t, body) != "UNAUTHORIZED" {
		t.Fatalf("unauthenticated mint: %d %v", code, body)
	}
	code, body, _, _ = s.post(t, "/v1/auth/desktop/code", map[string]string{}, "garbage-token")
	if code != 401 {
		t.Fatalf("garbage bearer: %d %v", code, body)
	}
}

// TestV42_14_WebSessionShape: the browser token is short-lived by
// construction (exp−iat == WebSessionTTL).
func TestV42_14_WebSessionShape(t *testing.T) {
	s := newV42Stack(t, v42Opts{webSessionTTL: 7 * time.Minute})
	grant := s.oauthJourney(t, "v42-sub-14", "fourteen@nexau.test")

	_, body, _, raw := s.post(t, "/v1/auth/web/session", map[string]string{"grant": grant}, "")
	tok, _ := body["access_token"].(string)
	if tok == "" {
		t.Fatalf("web session: %s", raw)
	}
	// Decode (unverified) to check the claims shape.
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("token shape: %d parts", len(parts))
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("payload: %v", err)
	}
	var claims struct {
		Exp int64  `json:"exp"`
		Iat int64  `json:"iat"`
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		t.Fatalf("claims: %v", err)
	}
	if claims.Exp-claims.Iat != int64((7 * time.Minute).Seconds()) {
		t.Fatalf("web token lifetime: %d", claims.Exp-claims.Iat)
	}
	if claims.Sub == "" {
		t.Fatal("web token has no subject")
	}
}
