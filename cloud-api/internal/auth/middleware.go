package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

type ctxKey int

const (
	ctxIdentity ctxKey = iota
	ctxClaims
)

// WithClaims stores the raw verified claims in the request context.
func WithClaims(ctx context.Context, c *Claims) context.Context {
	return context.WithValue(ctx, ctxClaims, c)
}

// WithIdentity stores the resolved identity in the request context.
func WithIdentity(ctx context.Context, id *Identity) context.Context {
	return context.WithValue(ctx, ctxIdentity, id)
}

// FromIdentity extracts the identity (nil when absent).
func FromIdentity(ctx context.Context) *Identity {
	id, _ := ctx.Value(ctxIdentity).(*Identity)
	return id
}

// FromClaims extracts the raw claims (nil when absent).
func FromClaims(ctx context.Context) *Claims {
	c, _ := ctx.Value(ctxClaims).(*Claims)
	return c
}

// Resolver resolves verified subject claims into the authoritative
// Identity. Implemented by IdentityResolver; stubbed in tests.
type Resolver interface {
	Resolve(ctx context.Context, userID, tenantID string) (*Identity, error)
}

// Middleware dependencies.
type Middleware struct {
	Verifier        Verifier
	Resolver        Resolver
	Service         *Service
	AuthTimeout     time.Duration
	RevocationCheck bool
}

// Require authenticates the request: Bearer token → claims → identity.
// It enforces server-side resolution of user/tenant/subscription state and
// fails closed on infrastructure errors.
func (m Middleware) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			writeDomainError(w, domain.ErrUnauthorized(nil), r)
			return
		}

		vctx, cancel := context.WithTimeout(r.Context(), m.AuthTimeout)
		claims, err := m.Verifier.Verify(vctx, token)
		cancel()
		if err != nil {
			writeDomainError(w, classifyToDomain(err), r)
			return
		}

		if m.RevocationCheck && m.Service != nil {
			if m.Service.IsBlacklisted(r.Context(), claims.TokenID) {
				writeDomainError(w, domain.ErrTokenRevoked(), r)
				return
			}
		}

		id, err := m.Resolver.Resolve(r.Context(), claims.Subject, claims.TenantID)
		if err != nil {
			writeDomainError(w, domain.AsError(err), r)
			return
		}

		// Account/tenant/subscription state gate.
		if reason := id.CanRun(); reason != "" && reason != "SUBSCRIPTION_INACTIVE" {
			writeDomainError(w, domain.ErrForbidden("Account state does not permit this request."), r)
			return
		}

		ctx := WithIdentity(WithClaims(r.Context(), claims), id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// bearerToken extracts the Authorization: Bearer value, tolerating whitespace
// case and rejecting clearly malformed headers.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	tok := strings.TrimSpace(parts[1])
	if len(tok) > 8192 || strings.ContainsAny(tok, " \t\r\n") {
		return ""
	}
	return tok
}

func classifyToDomain(err error) *domain.Error {
	var tc ErrTokenClass
	if asErrTokenClass(err, &tc) {
		switch tc.Kind {
		case "expired":
			return domain.ErrTokenExpired()
		case "revoked":
			return domain.ErrTokenRevoked()
		default:
			return domain.ErrUnauthorized(err)
		}
	}
	return domain.ErrUnauthorized(err)
}

func asErrTokenClass(err error, target *ErrTokenClass) bool {
	if e, ok := err.(ErrTokenClass); ok {
		*target = e
		return true
	}
	return false
}

func writeDomainError(w http.ResponseWriter, de *domain.Error, r *http.Request) {
	if de.HTTP >= 500 {
		// internal details to logs only; the writer adds request ids upstream
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(de.HTTP)
	writeJSON(w, map[string]any{"error": de.ClientJSON()})
}

func writeJSON(w http.ResponseWriter, v any) {
	_ = json.NewEncoder(w).Encode(v)
}
