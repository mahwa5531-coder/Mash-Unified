package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Verifier turns a bearer token into verified Claims or a classified error.
type Verifier interface {
	Verify(ctx context.Context, token string) (*Claims, error)
}

// ErrTokenClass carries the classification of verification failures.
type ErrTokenClass struct {
	Kind string // "expired" | "malformed" | "signature" | "issuer" | "audience" | "revoked" | "unknown"
	Desc string
}

func (e ErrTokenClass) Error() string { return "token " + e.Kind + ": " + e.Desc }

func classifyVerifyErr(err error) ErrTokenClass {
	if err == nil {
		return ErrTokenClass{}
	}
	switch {
	case errors.Is(err, jwt.ErrTokenExpired):
		return ErrTokenClass{Kind: "expired", Desc: "token expired"}
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		return ErrTokenClass{Kind: "signature", Desc: "signature invalid"}
	case errors.Is(err, jwt.ErrTokenMalformed), errors.Is(err, jwt.ErrTokenUsedBeforeIssued):
		return ErrTokenClass{Kind: "malformed", Desc: "malformed or premature token"}
	default:
		return ErrTokenClass{Kind: "unknown", Desc: err.Error()}
	}
}

// keyFuncVerifier adapts a jwt.Keyfunc into a Claims-producing Verifier with
// strict registered-claim validation.
type keyFuncVerifier struct {
	keyfunc  jwt.Keyfunc
	issuer   string
	audience string
	leeway   time.Duration
}

func (v *keyFuncVerifier) Verify(ctx context.Context, token string) (*Claims, error) {
	if token == "" {
		return nil, ErrTokenClass{Kind: "malformed", Desc: "empty token"}
	}
	claims := &jwt.RegisteredClaims{}
	parsed, err := jwt.ParseWithClaims(token, claims, v.keyfunc,
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(v.issuer),
		jwt.WithAudience(v.audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(v.leeway),
	)
	if err != nil {
		return nil, classifyVerifyErr(err)
	}
	if !parsed.Valid {
		return nil, ErrTokenClass{Kind: "unknown", Desc: "token invalid"}
	}

	// Custom (non-registered) claims extraction.
	var body struct {
		jwt.RegisteredClaims
		TenantID string `json:"tid"`
		Role     string `json:"rol"`
		DeviceID string `json:"dev"`
	}
	if _, _, err := jwt.NewParser().ParseUnverified(token, &body); err != nil {
		return nil, ErrTokenClass{Kind: "malformed", Desc: "unparseable claims"}
	}

	c := &Claims{
		Subject:   body.Subject,
		TenantID:  body.TenantID,
		Role:      body.Role,
		DeviceID:  body.DeviceID,
		TokenID:   body.ID,
		Issuer:    body.Issuer,
		Audience:  v.audience,
		IssuedAt:  body.IssuedAt.Time,
		ExpiresAt: body.ExpiresAt.Time,
		Method:    "local",
	}
	if c.Subject == "" {
		return nil, ErrTokenClass{Kind: "malformed", Desc: "missing sub claim"}
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// Local HS256 signer/verifier — the only token authority in this deployment.
// Google is the identity provider (verified via its own JWKS in oauth.go);
// session tokens are minted and verified here.
// ---------------------------------------------------------------------------

// LocalSigner mints and verifies HS256 tokens.
type LocalSigner struct {
	secret   []byte
	issuer   string
	audience string
	leeway   time.Duration
	ttl      time.Duration
	kid      string
}

func NewLocalSigner(secret, issuer, audience string, leeway, ttl time.Duration) *LocalSigner {
	return &LocalSigner{
		secret: []byte(secret), issuer: issuer, audience: audience,
		leeway: leeway, ttl: ttl, kid: "mash-local-1",
	}
}

// Sign produces a signed access token.
func (s *LocalSigner) Sign(subject, tenantID, role, deviceID, jti string, now time.Time) (string, error) {
	return s.SignWithTTL(subject, tenantID, role, deviceID, jti, now, s.ttl)
}

// SignWithTTL mints a token with an explicit lifetime. The web-session flow
// uses it for short-lived (minutes) browser tokens that carry no refresh
// token; everything else goes through Sign.
func (s *LocalSigner) SignWithTTL(subject, tenantID, role, deviceID, jti string, now time.Time, ttl time.Duration) (string, error) {
	claims := jwt.MapClaims{
		"iss": s.issuer,
		"aud": s.audience,
		"sub": subject,
		"iat": now.Unix(),
		"exp": now.Add(ttl).Unix(),
		"jti": jti,
		"tid": tenantID,
		"rol": role,
	}
	if deviceID != "" {
		claims["dev"] = deviceID
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tok.Header["kid"] = s.kid
	return tok.SignedString(s.secret)
}

// Verify implements Verifier.
func (s *LocalSigner) Verify(ctx context.Context, token string) (*Claims, error) {
	v := &keyFuncVerifier{
		keyfunc: func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
			}
			return s.secret, nil
		},
		issuer:   s.issuer,
		audience: s.audience,
		leeway:   s.leeway,
	}
	return v.Verify(ctx, token)
}

// TTL reports the access-token lifetime (used for blacklist TTLs).
func (s *LocalSigner) TTL() time.Duration { return s.ttl }

// HashToken hashes an opaque refresh token for storage (SHA-256 → hex).
func HashToken(secret string) string {
	h := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(h[:])
}

// ---------------------------------------------------------------------------
// JWKS key parsing (shared with the Google provider's key cache in oauth.go)
// ---------------------------------------------------------------------------

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Use string `json:"use"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

func (k jwk) publicKey() (any, error) {
	switch k.Kty {
	case "RSA":
		n, err := decodeB64BigInt(k.N)
		if err != nil {
			return nil, err
		}
		e, err := decodeB64BigInt(k.E)
		if err != nil {
			return nil, err
		}
		if e.Int64() < 3 || e.Int64() > 1<<31 || !e.IsInt64() {
			return nil, errors.New("bad RSA exponent")
		}
		return &rsa.PublicKey{N: n, E: int(e.Int64())}, nil
	case "EC":
		var curve elliptic.Curve
		switch k.Crv {
		case "P-256":
			curve = elliptic.P256()
		case "P-384":
			curve = elliptic.P384()
		case "P-521":
			curve = elliptic.P521()
		default:
			return nil, fmt.Errorf("unsupported curve %q", k.Crv)
		}
		x, err := decodeB64BigInt(k.X)
		if err != nil {
			return nil, err
		}
		y, err := decodeB64BigInt(k.Y)
		if err != nil {
			return nil, err
		}
		return &ecdsa.PublicKey{Curve: curve, X: x, Y: y}, nil
	case "OKP":
		if k.Crv != "Ed25519" {
			return nil, fmt.Errorf("unsupported OKP curve %q", k.Crv)
		}
		raw, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, errors.New("bad Ed25519 key")
		}
		return ed25519.PublicKey(raw), nil
	default:
		return nil, fmt.Errorf("unsupported kty %q", k.Kty)
	}
}

func decodeB64BigInt(s string) (*big.Int, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(raw), nil
}

// httpClient is the transport seam shared by the Google provider.
type httpClient interface {
	Do(req *http.Request) (*http.Response, error)
}
