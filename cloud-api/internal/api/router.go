// Package api assembles the HTTP surface: route table, JSON encoding,
// auth-wrapped handlers and the SSE stream transport. Handlers are thin: they
// decode, delegate to services, and encode — business rules never live here.
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/bifrost"
	"github.com/mash-cloud/mash-api/internal/config"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/llm"
	"github.com/mash-cloud/mash-api/internal/middleware"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/payment"
	"github.com/mash-cloud/mash-api/internal/ratelimit"
	"github.com/mash-cloud/mash-api/internal/store"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// API holds the handler dependencies.
type API struct {
	cfg      *config.Config
	authSvc  *auth.Service
	authMW   auth.Middleware
	proxy    *llm.Proxy
	usage    *repos.LLMCallsRepo
	pg       *store.Postgres
	redis    *store.Redis
	bifrost  *bifrost.Client
	lim      *ratelimit.Limiter
	metrics  *observability.Metrics
	otel     *observability.OTel
	payments *payment.Service
}

// New builds the API.
func New(
	cfg *config.Config,
	authSvc *auth.Service,
	authMW auth.Middleware,
	proxy *llm.Proxy,
	usage *repos.LLMCallsRepo,
	pg *store.Postgres,
	rd *store.Redis,
	bf *bifrost.Client,
	lim *ratelimit.Limiter,
	metrics *observability.Metrics,
	otel *observability.OTel,
	payments *payment.Service,
) *API {
	return &API{
		cfg: cfg, authSvc: authSvc, authMW: authMW, proxy: proxy,
		usage: usage, pg: pg, redis: rd, bifrost: bf, lim: lim,
		metrics: metrics, otel: otel, payments: payments,
	}
}

// Router builds the full route table (Go 1.22+ pattern routing).
//
// Surface (14 routes + health/metrics):
//
//	POST /v1/auth/refresh               rotate the desktop token pair
//	POST /v1/auth/logout                revoke one refresh token
//	POST /v1/auth/logout-all            revoke every session (lost device)
//	GET  /v1/auth/oauth/google          begin "Continue with Google" (302)
//	GET  /v1/auth/oauth/google/callback finish OAuth → web success page
//	POST /v1/auth/web/session           grant → short web access token
//	POST /v1/auth/desktop/code          (authed) mint single-use mcode
//	POST /v1/auth/desktop/exchange      mcode → full desktop TokenPair
//	GET  /v1/me                         identity + plan + quota position
//	GET  /v1/config                     client integration config
//	POST /v1/chat/completions           THE LLM endpoint (SSE tunnel to Bifrost)
//	GET  /v1/usage                      usage aggregation window
//	POST /v1/payments/*                 credit top-ups (Razorpay)
func (a *API) Router() http.Handler {
	mux := http.NewServeMux()

	// Health (unauthenticated, cheap — never tied to LLM availability).
	mux.HandleFunc("GET /health/live", a.handleLiveness)
	mux.HandleFunc("GET /health/ready", a.handleReadiness)
	if a.cfg.OTel.Prometheus && a.otel != nil && a.otel.PromHandler != nil {
		mux.Handle("GET /metrics", a.otel.PromHandler)
	}

	// Auth (Google OAuth is the only identity provider).
	mux.HandleFunc("POST /v1/auth/refresh", a.handleRefresh)
	mux.Handle("POST /v1/auth/logout", a.authMW.Require(http.HandlerFunc(a.handleLogout)))
	mux.Handle("POST /v1/auth/logout-all", a.authMW.Require(http.HandlerFunc(a.handleLogoutAll)))

	// Google OAuth + web-to-desktop handshake. The OAuth pair mounts only
	// when the provider is fully configured (main.go leaves Service.Google
	// nil otherwise); the JSON endpoints require the local signer.
	if a.authSvc != nil && a.authSvc.Google != nil {
		mux.HandleFunc("GET /v1/auth/oauth/google", a.handleGoogleOAuthBegin)
		mux.HandleFunc("GET /v1/auth/oauth/google/callback", a.handleGoogleOAuthCallback)
	}
	if a.authSvc != nil && a.authSvc.Signer != nil {
		mux.HandleFunc("POST /v1/auth/web/session", a.handleWebSession)
		mux.Handle("POST /v1/auth/desktop/code", a.authMW.Require(http.HandlerFunc(a.handleDesktopCode)))
		mux.HandleFunc("POST /v1/auth/desktop/exchange", a.handleDesktopExchange)
	}

	// Identity & client config.
	mux.Handle("GET /v1/me", a.authMW.Require(http.HandlerFunc(a.handleMe)))
	mux.Handle("GET /v1/config", a.authMW.Require(http.HandlerFunc(a.handleClientConfig)))

	// The LLM endpoint: OpenAI-compatible tunnel to the private Bifrost
	// gateway (agent runtime lives on the desktop; this is its model access).
	mux.Handle("POST /v1/chat/completions", a.authMW.Require(http.HandlerFunc(a.handleChatCompletions)))

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
	return strings.HasSuffix(p, "/chat/completions")
}

func routeLabel(r *http.Request) string {
	p := r.URL.Path
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

func jsonErrText(err error) string {
	if err == error(errTrailingJSON{}) {
		return "trailing content after the JSON body"
	}
	return err.Error()
}
