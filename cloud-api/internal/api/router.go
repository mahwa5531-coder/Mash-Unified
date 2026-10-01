// Package api assembles the HTTP surface: route table, JSON encoding,
// auth-wrapped handlers and the stream transports. Handlers are thin: they
// decode, delegate to services, and encode — business rules never live here.
package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/config"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/metering"
	"github.com/nexau-cloud/nexau-api/internal/middleware"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/payment"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/store"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// API holds the handler dependencies.
type API struct {
	cfg      *config.Config
	authSvc  *auth.Service
	authMW   auth.Middleware
	sessions *agent.SessionService
	runs     *agent.Service
	usage    *repos.UsageRepo
	pg       *store.Postgres
	redis    *store.Redis
	bifrost  *bifrost.Client
	meter    *metering.Recorder
	lim      *ratelimit.Limiter
	metrics  *observability.Metrics
	otel     *observability.OTel
	payments *payment.Service
	upgrader *streaming.Upgrader
}

// New builds the API.
func New(
	cfg *config.Config,
	authSvc *auth.Service,
	authMW auth.Middleware,
	sessions *agent.SessionService,
	runs *agent.Service,
	usage *repos.UsageRepo,
	pg *store.Postgres,
	rd *store.Redis,
	bf *bifrost.Client,
	meter *metering.Recorder,
	lim *ratelimit.Limiter,
	metrics *observability.Metrics,
	otel *observability.OTel,
	payments *payment.Service,
) *API {
	return &API{
		cfg: cfg, authSvc: authSvc, authMW: authMW, sessions: sessions, runs: runs,
		usage: usage, pg: pg, redis: rd, bifrost: bf, meter: meter, lim: lim,
		metrics: metrics, otel: otel, payments: payments,
		upgrader: streaming.NewUpgrader(streaming.WSConfig{
			HeartbeatInterval: cfg.WSHeartbeatInterval,
			WriteWait:         cfg.WSWriteWait,
			MaxMessageSize:    cfg.WSMaxMessageSize,
			SendQueue:         cfg.WSSendQueue,
			SlowConsumerGrace: cfg.WSSlowConsumerGrace,
			IdleTimeout:       cfg.WSIdleTimeout,
		}, cfg.AllowedOrigins, metrics),
	}
}

// ShutdownWS closes all live WebSocket connections (graceful shutdown).
func (a *API) ShutdownWS() {
	if a.upgrader != nil {
		a.upgrader.Shutdown()
	}
}

// Router builds the full route table (Go 1.22+ pattern routing).
func (a *API) Router() http.Handler {
	mux := http.NewServeMux()

	// Health (unauthenticated, cheap — never tied to LLM availability).
	mux.HandleFunc("GET /health/live", a.handleLiveness)
	mux.HandleFunc("GET /health/ready", a.handleReadiness)
	if a.cfg.OTel.Prometheus && a.otel != nil && a.otel.PromHandler != nil {
		mux.Handle("GET /metrics", a.otel.PromHandler)
	}

	// Auth.
	mux.HandleFunc("POST /v1/auth/refresh", a.handleRefresh)
	if a.cfg.Auth.LoginEnabled {
		mux.HandleFunc("POST /v1/auth/login", a.handleLogin)
	}
	mux.Handle("POST /v1/auth/logout", a.authMW.Require(http.HandlerFunc(a.handleLogout)))

	// Signup & account recovery (local mode only; jwks deployments manage
	// identities at the IdP — config validation force-disables this).
	if a.cfg.Auth.SignupEnabled {
		mux.HandleFunc("POST /v1/auth/register", a.handleRegister)
		mux.HandleFunc("POST /v1/auth/email/verify", a.handleVerifyEmail)
		mux.HandleFunc("POST /v1/auth/email/resend", a.handleResendVerification)
		mux.HandleFunc("POST /v1/auth/password/forgot", a.handleForgotPassword)
		mux.HandleFunc("POST /v1/auth/password/reset", a.handleResetPassword)
		mux.Handle("POST /v1/auth/password/change", a.authMW.Require(http.HandlerFunc(a.handleChangePassword)))
	}

	// Google OAuth + web-to-desktop handshake. The OAuth pair mounts only
	// when the provider is fully configured (main.go leaves Service.Google
	// nil otherwise); the JSON endpoints require a local signer (jwks-only
	// deployments mint nothing to exchange).
	if a.authSvc != nil && a.authSvc.Google != nil {
		mux.HandleFunc("GET /v1/auth/oauth/google", a.handleGoogleOAuthBegin)
		mux.HandleFunc("GET /v1/auth/oauth/google/callback", a.handleGoogleOAuthCallback)
	}
	if a.authSvc != nil && a.authSvc.Signer != nil {
		mux.HandleFunc("POST /v1/auth/lookup", a.handleAuthLookup)
		mux.HandleFunc("POST /v1/auth/web/session", a.handleWebSession)
		mux.Handle("POST /v1/auth/desktop/code", a.authMW.Require(http.HandlerFunc(a.handleDesktopCode)))
		mux.HandleFunc("POST /v1/auth/desktop/exchange", a.handleDesktopExchange)
	}

	// Identity & client config.
	mux.Handle("GET /v1/me", a.authMW.Require(http.HandlerFunc(a.handleMe)))
	mux.Handle("GET /v1/config", a.authMW.Require(http.HandlerFunc(a.handleClientConfig)))

	// Sessions.
	mux.Handle("POST /v1/agent/sessions", a.authMW.Require(http.HandlerFunc(a.handleCreateSession)))
	mux.Handle("GET /v1/agent/sessions/{session_id}", a.authMW.Require(http.HandlerFunc(a.handleGetSession)))
	mux.Handle("DELETE /v1/agent/sessions/{session_id}", a.authMW.Require(http.HandlerFunc(a.handleCloseSession)))

	// Runs.
	mux.Handle("POST /v1/agent/sessions/{session_id}/runs", a.authMW.Require(http.HandlerFunc(a.handleCreateRun)))
	mux.Handle("GET /v1/agent/runs/{run_id}", a.authMW.Require(http.HandlerFunc(a.handleGetRun)))
	mux.Handle("POST /v1/agent/runs/{run_id}/cancel", a.authMW.Require(http.HandlerFunc(a.handleCancelRun)))
	mux.HandleFunc("GET /v1/agent/sessions/{session_id}/stream", a.handleSessionStream)

	// Raw OpenAI-compatible surface (implicit session).
	mux.Handle("POST /v1/agent/chat/completions", a.authMW.Require(http.HandlerFunc(a.handleChatCompletions)))

	// Usage.
	mux.Handle("GET /v1/usage", a.authMW.Require(http.HandlerFunc(a.handleUsage)))

	// Payments (credit top-ups). Routes mount regardless of provider
	// mode: disabled deployments answer 503 PAYMENTS_DISABLED, keeping
	// the client contract stable across deployments.
	mux.HandleFunc("POST /v1/payments/webhook", a.handlePaymentWebhook)
	mux.Handle("GET /v1/payments/catalog", a.authMW.Require(http.HandlerFunc(a.handlePaymentCatalog)))
	mux.Handle("POST /v1/payments/checkout", a.authMW.Require(http.HandlerFunc(a.handlePaymentCheckout)))
	mux.Handle("POST /v1/payments/confirm", a.authMW.Require(http.HandlerFunc(a.handlePaymentConfirm)))
	mux.Handle("GET /v1/payments/orders/{order_id}", a.authMW.Require(http.HandlerFunc(a.handlePaymentOrder)))
	mux.Handle("GET /v1/payments/history", a.authMW.Require(http.HandlerFunc(a.handlePaymentHistory)))
	mux.Handle("GET /v1/payments/balance", a.authMW.Require(http.HandlerFunc(a.handlePaymentBalance)))

	return a.wrapMux(mux)
}

// wrapMux adds the 404 fallback and the access-log + metrics shell.
func (a *API) wrapMux(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &respStatus{ResponseWriter: w, status: http.StatusOK}

		defer func() {
			dur := time.Since(start)
			if a.metrics != nil {
				a.metrics.HTTPRequests.Add(r.Context(), 1,
					observability.Attr("method", r.Method),
					observability.Attr("status", strconv.Itoa(sw.status)),
					observability.Attr("route", routeLabel(r)))
				a.metrics.HTTPDurationMS.Record(r.Context(), dur.Milliseconds(),
					observability.Attr("route", routeLabel(r)))
			}
			if !isStreamPath(r.URL.Path) {
				middleware.RequestLog(r, sw.status, dur)
			}
		}()

		if _, pattern := mux.Handler(r); pattern == "" {
			// Write through the status-capturing wrapper: 404s must be
			// logged and metered as 404s, not as the default 200.
			writeError(sw, r, domain.ErrNotFound("route"))
			return
		}
		mux.ServeHTTP(sw, r)
	})
}

func isStreamPath(p string) bool {
	return strings.HasSuffix(p, "/runs") || strings.HasSuffix(p, "/stream") ||
		strings.HasSuffix(p, "/chat/completions")
}

func routeLabel(r *http.Request) string {
	p := r.URL.Path
	parts := strings.Split(p, "/")
	for i, part := range parts {
		if strings.HasPrefix(part, "sess_") || strings.HasPrefix(part, "run_") {
			parts[i] = "{id}"
		}
	}
	p = strings.Join(parts, "/")
	if len(p) > 72 {
		p = p[:72]
	}
	return r.Method + " " + p
}

// --- shared plumbing --------------------------------------------------------

type respStatus struct {
	http.ResponseWriter
	status int
}

func (w *respStatus) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *respStatus) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack passes the connection through for WebSocket upgrades: the wrapper
// must be transparent, or the upgrade 500s.
func (w *respStatus) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("respStatus: underlying writer is not a hijacker")
	}
	return hj.Hijack()
}

// Unwrap lets http.ResponseController (SSE write deadlines) reach the real
// connection through this wrapper.
func (w *respStatus) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeOK(w http.ResponseWriter, v any) { writeJSON(w, http.StatusOK, v) }

func writeError(w http.ResponseWriter, r *http.Request, de *domain.Error) {
	middleware.WriteDomainError(w, r, de)
}

type errTrailingJSON struct{}

func (errTrailingJSON) Error() string { return "trailing JSON content" }

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err == nil {
		return errTrailingJSON{}
	}
	return nil
}
