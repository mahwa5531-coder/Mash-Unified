package auth

// Google OAuth 2.0 / OIDC ("Continue with Google") and the web half of the
// web-to-desktop handshake.
//
// Flow (RFC 6749 authorization-code, server-side confidential client):
//
//      browser → GET /v1/auth/oauth/google        state + tx cookie set (Redis, TTL)
//      browser → Google consent → callback        state consumed, tx verified,
//                                                   code exchanged, ID token verified
//           API → 302 WebSuccessURL?grant=wgrant_  single-use web grant (Redis, TTL)
//      web JS → POST /v1/auth/web/session {grant}  → short web access token
//                                                          (NO refresh token — the
//                                                           browser is not a vault)
//
// Security properties:
//   - state: 32-byte CSPRNG, single-use (atomic GETDEL), TTL-bounded, and
//     bound to a same-site tx cookie set on the begin hop (login-CSRF defense:
//     a state stolen into another browser fails the cookie match).
//   - ID tokens are verified against Google's JWKS (RS256 only, iss+aud+exp);
//     access tokens from the token endpoint are never parsed (we only trust
//     the ID token delivered over our direct TLS connection to Google).
//   - emails that Google has not verified never create accounts.
//   - no token of any kind ever appears in a URL, a referrer, or a log line;
//     only single-use short-TTL opaque codes (grant/mcode) cross the browser.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// OAuthStore provisions OAuth identities (implemented by repos.OAuthUsersRepo).
type OAuthStore interface {
	// FindOrCreateGoogleUser resolves the identity per the documented cases
	// (login / provision) with race arbitration.
	FindOrCreateGoogleUser(ctx context.Context, sub, email, displayName, avatarURL string) (*domain.User, error)
}

// DevicesStore registers desktop devices (implemented by repos.DevicesRepo).
type DevicesStore interface {
	UpsertDevice(ctx context.Context, userID, deviceID, name, platform string) (string, error)
}

// GoogleIdentity is the verified OIDC identity.
type GoogleIdentity struct {
	Sub           string
	Email         string
	EmailVerified bool
	Name          string
	Picture       string
}

// GoogleProvider is the OAuth client. Zero value is unusable; NewGoogleProvider
// validates. Endpoint URLs are injectable for tests and air-gapped installs.
type GoogleProvider struct {
	clientID     string
	clientSecret string
	redirectURI  string
	authURL      string
	tokenURL     string
	jwksURL      string
	issuers      map[string]bool // accepted ID-token `iss` values (config-driven)
	hc           httpClient
	keys         *googleKeys
}

// defaultGoogleIssuers are Google's two documented forms (no scheme / with
// scheme). A deployment pointing the endpoints at a test or proxy OAuth
// server overrides this list via NEXAU_AUTH_GOOGLE_ISSUERS — the issuer check
// is a security boundary, so it is explicit configuration, never inferred
// from the endpoint URLs.
var defaultGoogleIssuers = []string{"accounts.google.com", "https://accounts.google.com"}

// NewGoogleProvider builds the provider (hc nil → http.DefaultClient).
// issuers nil/empty → Google's documented forms.
func NewGoogleProvider(clientID, clientSecret, redirectURI, authURL, tokenURL, jwksURL string, issuers []string, hc httpClient) *GoogleProvider {
	if hc == nil {
		hc = http.DefaultClient
	}
	if len(issuers) == 0 {
		issuers = defaultGoogleIssuers
	}
	m := make(map[string]bool, len(issuers))
	for _, s := range issuers {
		if s = strings.TrimSpace(s); s != "" {
			m[s] = true
		}
	}
	return &GoogleProvider{
		clientID: clientID, clientSecret: clientSecret, redirectURI: redirectURI,
		authURL: authURL, tokenURL: tokenURL, jwksURL: jwksURL,
		issuers: m, hc: hc, keys: &googleKeys{url: jwksURL, hc: hc},
	}
}

// AuthCodeURL renders the consent-screen redirect (top-level navigation).
func (g *GoogleProvider) AuthCodeURL(state string) string {
	q := url.Values{}
	q.Set("client_id", g.clientID)
	q.Set("redirect_uri", g.redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", "openid email profile")
	q.Set("state", state)
	q.Set("access_type", "online")
	q.Set("prompt", "select_account")
	return g.authURL + "?" + q.Encode()
}

// Exchange trades the authorization code at Google's token endpoint and
// verifies the returned ID token. Only the ID token is trusted (it is
// delivered over our own TLS connection; the access_token is ignored).
func (g *GoogleProvider) Exchange(ctx context.Context, code string) (*GoogleIdentity, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", g.clientID)
	form.Set("client_secret", g.clientSecret)
	form.Set("redirect_uri", g.redirectURI)
	form.Set("grant_type", "authorization_code")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, domain.ErrInternal(err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	resp, err := g.hc.Do(req)
	if err != nil {
		return nil, domain.ErrOAuthProvider(err)
	}
	defer func() { _, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)); _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, domain.ErrOAuthProvider(fmt.Errorf("token endpoint: status %d", resp.StatusCode))
	}
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tok); err != nil {
		return nil, domain.ErrOAuthProvider(fmt.Errorf("token endpoint decode: %w", err))
	}
	if tok.IDToken == "" {
		return nil, domain.ErrOAuthProvider(errors.New("token endpoint returned no id_token"))
	}
	return g.verifyIDToken(ctx, tok.IDToken)
}

// googleIssuersAre reports whether the ID token's issuer is one this
// deployment accepts (Google's documented forms by default; overridden via
// NEXAU_AUTH_GOOGLE_ISSUERS when the endpoints point at a test/fake server).
func (g *GoogleProvider) issuerAccepted(iss string) bool {
	return g.issuers[iss]
}

// verifyIDToken checks RS256 signature against Google's JWKS and validates
// iss / aud / exp; then extracts the identity claims.
func (g *GoogleProvider) verifyIDToken(ctx context.Context, raw string) (*GoogleIdentity, error) {
	var body struct {
		jwt.RegisteredClaims
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	parsed, err := jwt.ParseWithClaims(raw, &body, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected alg %v", t.Header["alg"])
		}
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("id token has no kid")
		}
		return g.keys.key(ctx, kid)
	}, jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second))
	if err != nil {
		return nil, domain.ErrOAuthProvider(fmt.Errorf("id token verify: %w", err))
	}
	if !parsed.Valid {
		return nil, domain.ErrOAuthProvider(errors.New("id token invalid"))
	}
	if !g.issuerAccepted(body.Issuer) {
		return nil, domain.ErrOAuthProvider(fmt.Errorf("id token issuer %q", body.Issuer))
	}
	if len(body.Audience) == 0 || body.Audience[0] != g.clientID {
		return nil, domain.ErrOAuthProvider(errors.New("id token audience mismatch"))
	}
	if body.Subject == "" || body.Email == "" {
		return nil, domain.ErrOAuthProvider(errors.New("id token missing sub/email"))
	}
	return &GoogleIdentity{
		Sub: body.Subject, Email: strings.ToLower(strings.TrimSpace(body.Email)),
		EmailVerified: body.EmailVerified, Name: body.Name, Picture: body.Picture,
	}, nil
}

// googleKeys is a minimal JWKS cache for Google's RSA keys (mirror of
// JWKSVerifier's key resolution, RS256-only, min-refresh throttled).
type googleKeys struct {
	url     string
	hc      httpClient
	mu      sync.RWMutex
	keys    map[string]any
	lastTry time.Time
}

const googleKeysMinRefresh = time.Minute

func (k *googleKeys) key(ctx context.Context, kid string) (any, error) {
	k.mu.RLock()
	key, ok := k.keys[kid]
	k.mu.RUnlock()
	if ok {
		return key, nil
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if key, ok := k.keys[kid]; ok {
		return key, nil
	}
	if time.Since(k.lastTry) < googleKeysMinRefresh {
		return nil, fmt.Errorf("unknown kid %q (refresh throttled)", kid)
	}
	k.lastTry = time.Now()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := k.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jwks fetch: %w", err)
	}
	defer func() { _, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)); _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks fetch: status %d", resp.StatusCode)
	}
	var set struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("jwks decode: %w", err)
	}
	next := make(map[string]any, len(set.Keys))
	for _, j := range set.Keys {
		pub, err := j.publicKey()
		if err != nil {
			continue
		}
		if j.Kid != "" && j.Kty == "RSA" {
			next[j.Kid] = pub
		}
	}
	k.keys = next
	if key, ok := k.keys[kid]; ok {
		return key, nil
	}
	return nil, fmt.Errorf("unknown kid %q", kid)
}

// ---------------------------------------------------------------------------
// Service methods: state, web grant, lookup
// ---------------------------------------------------------------------------

// oauthTx is the Redis-stored state record (bound to the tx cookie).
type oauthTx struct {
	Tx        string `json:"tx"`
	CreatedAt int64  `json:"created_at"`
}

// webGrant is the Redis-stored grant payload.
type webGrant struct {
	UserID   string `json:"user_id"`
	TenantID string `json:"tenant_id"`
}

// WebSession is the browser-side response: a short access token and the
// identity context. Deliberately carries NO refresh token.
type WebSession struct {
	AccessToken string     `json:"access_token"`
	TokenType   string     `json:"token_type"`
	ExpiresIn   int64      `json:"expires_in"`
	User        UserInfo   `json:"user"`
	Tenant      TenantInfo `json:"tenant,omitempty"`
}

// BeginGoogleOAuth mints the anti-CSRF state, binds it to a fresh tx secret
// (the handler sets the matching cookie) and returns the consent URL.
func (s *Service) BeginGoogleOAuth(ctx context.Context) (redirectURL, state, tx string, err error) {
	if s.Google == nil || s.OAuth == nil {
		return "", "", "", domain.ErrOAuthDisabled()
	}
	state = randomHex(32)
	tx = randomHex(32)
	rec, _ := json.Marshal(oauthTx{Tx: tx, CreatedAt: time.Now().Unix()})
	if err := s.Redis.Set(ctx, "auth:oauth:state:"+state, rec, s.OAuthStateTTL).Err(); err != nil {
		return "", "", "", domain.ErrDependencyUnavailable("redis")
	}
	return s.Google.AuthCodeURL(state), state, tx, nil
}

// FinishGoogleOAuth consumes the state (single-use), verifies the tx cookie,
// exchanges the code, resolves the user and mints the web grant.
func (s *Service) FinishGoogleOAuth(ctx context.Context, code, state, txCookie string) (*domain.User, string, error) {
	if s.Google == nil || s.OAuth == nil {
		return nil, "", domain.ErrOAuthDisabled()
	}
	if state == "" || len(state) > 128 || code == "" || len(code) > 2048 {
		return nil, "", domain.ErrOAuthState()
	}
	raw, ok := consumeOneTime(ctx, s.Redis, "auth:oauth:state:"+state)
	if !ok {
		return nil, "", domain.ErrOAuthState()
	}
	var st oauthTx
	if err := json.Unmarshal([]byte(raw), &st); err != nil || st.Tx == "" || st.Tx != txCookie {
		// Expired/unknown/tampered state OR a tx cookie from a different flow
		// (login-CSRF attempt) — one generic error, no oracle.
		return nil, "", domain.ErrOAuthState()
	}

	ident, err := s.Google.Exchange(ctx, code)
	if err != nil {
		return nil, "", err
	}
	if !ident.EmailVerified {
		return nil, "", domain.ErrOAuthEmailUnverified()
	}
	if !validEmail(ident.Email) {
		return nil, "", domain.ErrOAuthProvider(errors.New("provider returned an invalid email"))
	}

	u, err := s.resolveGoogleUser(ctx, ident)
	if err != nil {
		return nil, "", err
	}

	// Resolve the tenant for the grant (first active membership).
	tenantID, _, err := s.resolveTenant(ctx, u.ID)
	if err != nil {
		return nil, "", err
	}

	grant := "wgrant_" + randomHex(32)
	rec, _ := json.Marshal(webGrant{UserID: u.ID, TenantID: tenantID})
	if err := s.Redis.Set(ctx, "auth:web:grant:"+grant, rec, s.WebGrantTTL).Err(); err != nil {
		return nil, "", domain.ErrDependencyUnavailable("redis")
	}
	return u, grant, nil
}

// resolveGoogleUser applies the documented cases with race retries
// (login / provision).
func (s *Service) resolveGoogleUser(ctx context.Context, ident *GoogleIdentity) (*domain.User, error) {
	name := ident.Name
	if len(name) > 128 {
		name = name[:128]
	}
	avatar := ident.Picture
	if len(avatar) > 2048 {
		avatar = avatar[:2048]
	}
	for attempt := 0; attempt < 3; attempt++ {
		u, err := s.OAuth.FindOrCreateGoogleUser(ctx, ident.Sub, ident.Email, name, avatar)
		if err == nil {
			return u, nil
		}
		if errors.Is(err, repos.ErrOAuthSubjectRace) || repos.IsEmailTaken(err) {
			continue // the winner committed; re-run resolves to the login case
		}
		if errors.Is(err, repos.ErrIdentityConflict) {
			return nil, domain.ErrIdentityConflict()
		}
		return nil, repos.AsDomain(err)
	}
	return nil, domain.ErrInternal(errors.New("oauth resolution did not converge"))
}

// resolveTenant picks the first active membership (login parity).
func (s *Service) resolveTenant(ctx context.Context, userID string) (string, string, error) {
	ms, err := s.Tenants.Memberships(ctx, userID)
	if err != nil {
		return "", "", storeMapError(err)
	}
	if len(ms) == 0 {
		return "", "", domain.ErrForbidden("user has no active tenant membership")
	}
	return ms[0].TenantID, ms[0].Role, nil
}

// ExchangeWebGrant consumes the single-use grant and mints the short web
// session. The browser never receives a refresh token.
func (s *Service) ExchangeWebGrant(ctx context.Context, grant string) (*WebSession, error) {
	if grant == "" || len(grant) > 128 || !strings.HasPrefix(grant, "wgrant_") {
		return nil, domain.ErrDesktopCode()
	}
	raw, ok := consumeOneTime(ctx, s.Redis, "auth:web:grant:"+grant)
	if !ok {
		return nil, domain.ErrDesktopCode()
	}
	var g webGrant
	if err := json.Unmarshal([]byte(raw), &g); err != nil || g.UserID == "" {
		return nil, domain.ErrDesktopCode()
	}
	u, err := s.Users.ByID(ctx, g.UserID)
	if err != nil {
		return nil, storeMapError(err)
	}
	if u == nil || u.Status != "active" {
		return nil, domain.ErrUnauthorized(errors.New("account not active"))
	}

	tenantID := g.TenantID
	role := ""
	if tenantID != "" {
		if m, err := s.Tenants.Membership(ctx, tenantID, u.ID); err == nil && m != nil && m.Status == "active" {
			role = m.Role
		}
	}
	if role == "" {
		if tenantID, role, err = s.resolveTenant(ctx, u.ID); err != nil {
			return nil, err
		}
	}

	if s.Signer == nil {
		return nil, &domain.Error{Code: "UNSUPPORTED_AUTH_MODE", Message: "This deployment mints no access tokens; use your identity provider.", HTTP: http.StatusNotImplemented}
	}
	access, err := s.Signer.SignWithTTL(u.ID, tenantID, role, "", ids.New("jti"), time.Now(), s.WebSessionTTL)
	if err != nil {
		return nil, domain.ErrInternal(err)
	}

	ws := &WebSession{
		AccessToken: access, TokenType: "Bearer",
		ExpiresIn: int64(s.WebSessionTTL.Seconds()),
		User: UserInfo{ID: u.ID, Email: u.Email, DisplayName: u.DisplayName, Status: u.Status,
			IsPlatformAdmin: u.IsPlatformAdmin, EmailVerified: u.EmailVerified},
	}
	if tenantID != "" {
		if t, _ := s.Tenants.ByID(ctx, tenantID); t != nil {
			ws.Tenant = TenantInfo{ID: t.ID, Slug: t.Slug, Name: t.Name, Status: t.Status}
		}
	}
	return ws, nil
}

// randomHex returns n random bytes hex-encoded (2n chars, crypto/rand).
func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failure is unrecoverable for a security boundary; panic
		// is the honest response (same posture as key generation elsewhere).
		slog.Error("auth: crypto/rand failed", "error", err)
		panic("auth: crypto/rand unavailable")
	}
	return hex.EncodeToString(b)
}
