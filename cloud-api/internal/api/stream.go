package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/observability"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// handleSessionStream: GET /v1/agent/sessions/{session_id}/stream (WebSocket)
//
// Auth: Authorization header (preferred). Query ?access_token= is accepted
// only when explicitly enabled (browser transports cannot set headers during
// upgrade) — flagged as a security trade-off, default off.
//
// The handler authenticates, resolves the session, enforces the per-user WS
// connection quota, upgrades, then runs the transport pumps. All business
// dispatch flows through agent.WSHandler.
func (a *API) handleSessionStream(w http.ResponseWriter, r *http.Request) {
	token := bearerOf(r)
	if token == "" && a.cfg.WSAllowQueryToken {
		token = strings.TrimSpace(r.URL.Query().Get("access_token"))
	}
	if token == "" {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}

	// Verify + resolve (auth middleware equivalent for the upgrade path).
	vctx, cancel := context.WithTimeout(r.Context(), a.cfg.AuthTimeout)
	claims, err := a.authMW.Verifier.Verify(vctx, token)
	cancel()
	if err != nil {
		writeError(w, r, classifyTokenErr(err))
		return
	}
	if a.cfg.Auth.RevocationCheck && a.authSvc != nil {
		if a.authSvc.IsBlacklisted(r.Context(), claims.TokenID) {
			writeError(w, r, domain.ErrTokenRevoked())
			return
		}
	}
	idn, err := a.authMW.Resolver.Resolve(r.Context(), claims.Subject, claims.TenantID)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	if reason := idn.CanRun(); reason != "" && reason != "SUBSCRIPTION_INACTIVE" {
		writeError(w, r, domain.ErrForbidden("Account state does not permit this request."))
		return
	}

	sessionID := r.PathValue("session_id")
	if bad := validateSessionID(sessionID); bad != "" {
		writeError(w, r, domain.ErrValidation(bad))
		return
	}
	// NOTE: derr (not err): the session service returns *domain.Error, and
	// reusing the earlier `error`-typed variable would turn a nil
	// *domain.Error into a typed-nil interface (non-nil!) — the classic
	// Go interface-nil trap.
	sess, derr := a.sessions.Get(r.Context(), idn, sessionID)
	if derr != nil || sess == nil {
		// 404 for both absent and foreign sessions — no probing.
		writeError(w, r, domain.ErrSessionNotFound())
		return
	}

	// Per-user WS quota (Redis; fail-open).
	if a.lim != nil && a.cfg.Rate.WSConnectionsPerUser > 0 {
		if !a.lim.Acquire(r.Context(), wsConnKey(idn.Tenant.ID, idn.User.ID),
			a.cfg.Rate.WSConnectionsPerUser, 24*time.Hour) {
			if a.metrics != nil {
				a.metrics.RateLimited.Add(r.Context(), 1, observability.Attr("scope", "ws_connections"))
			}
			writeError(w, r, domain.ErrWSConnLimit())
			return
		}
		// Release MUST survive request-context cancellation: the deferred
		// call runs after Serve() returns (client gone). A hijacked
		// connection's request context is not canceled on disconnect
		// today (verified empirically — audit finding 2), but detaching
		// makes the quota release immune to any future middleware,
		// framework or deadline change canceling it: go-redis drops the
		// DECR on a pre-canceled context and the counter would leak for
		// the full 24 h TTL.
		defer a.lim.Release(context.WithoutCancel(r.Context()), wsConnKey(idn.Tenant.ID, idn.User.ID), 24*time.Hour)
	}

	// Session liveness refresh on attach.
	a.sessions.Touch(r.Context(), idn.Tenant.ID, sessionID)

	conn, err := a.upgrader.Upgrade(w, r, idn.Tenant.ID, idn.User.ID, sessionID)
	if err != nil {
		// Upgrade failures are transport-level; nothing sensitive to leak.
		return
	}

	// Heartbeat re-authorization (2026-09-19 audit, cluster B: WS
	// connections outlived revocation). The connection is re-checked on
	// every heartbeat tick: a logged-out (blacklisted) jti or a token past
	// its expiry (+ a small reconnect grace) closes the socket with 1008
	// POLICY_VIOLATION. The desktop reconnects with a refreshed token.
	conn.SetAuthGuard(func() error {
		if a.cfg.Auth.RevocationCheck && a.authSvc != nil {
			if a.authSvc.IsBlacklisted(context.Background(), claims.TokenID) {
				return fmt.Errorf("token revoked")
			}
		}
		if time.Now().After(claims.ExpiresAt.Add(wsReconnectGrace)) {
			return fmt.Errorf("token expired")
		}
		return nil
	})

	handler := agent.NewWSHandler(a.runs, a.sessions, idn, sessionID)
	// WS connections are not tied to the HTTP request: pumps run on a fresh
	// root context; lifecycle ends via close frames / shutdown watcher.
	conn.Serve(context.Background(), handler)
}

// wsReconnectGrace is how long past token expiry a live WS connection may
// finish its current work before the heartbeat guard closes it — long enough
// that a client whose refresh ran late is not cut mid-run, short enough that
// no connection meaningfully outlives its credential.
const wsReconnectGrace = 30 * time.Second

func wsConnKey(tenantID, userID string) string {
	return "rl:ws:" + tenantID + ":" + userID
}

func validateSessionID(s string) string {
	if s == "" || len(s) > 64 {
		return "invalid session id"
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.'
		if !ok {
			return "invalid session id"
		}
	}
	return ""
}

func bearerOf(r *http.Request) string {
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

// classifyTokenErr maps token-verification failures to the domain model
// (shared classification logic with the auth middleware).
func classifyTokenErr(err error) *domain.Error {
	var tc auth.ErrTokenClass
	if e, ok := err.(auth.ErrTokenClass); ok {
		tc = e
	} else if err != nil {
		return domain.ErrUnauthorized(err)
	}
	switch tc.Kind {
	case "expired":
		return domain.ErrTokenExpired()
	case "revoked":
		return domain.ErrTokenRevoked()
	default:
		return domain.ErrUnauthorized(err)
	}
}
