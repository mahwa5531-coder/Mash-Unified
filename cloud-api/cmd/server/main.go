// Command server runs the NexaU Cloud API: the secure, scalable control and
// model-access gateway between the NexAU desktop runtime and the Bifrost LLM
// gateway.
//
// Boot order (fail fast, in dependency order): config → observability →
// PostgreSQL (migrations) → Redis → auth → rate limiting/idempotency →
// metering → event bus → run manager → agent services → HTTP.
//
// Shutdown order (spec §34): stop accepting → close WebSockets (1001) →
// cancel in-flight runs (grace) → drain usage metering → flush telemetry →
// close Redis → close PostgreSQL → exit.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/api"
	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/config"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/metering"
	"github.com/nexau-cloud/nexau-api/internal/middleware"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/payment"
	"github.com/nexau-cloud/nexau-api/internal/payment/razorpay"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/store"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

func main() {
	if err := run(); err != nil {
		observability.LogError("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	// 1. Configuration (externalized; validation errors list every problem).
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// 2. Observability (logging, tracing, metrics). Degrades, never blocks.
	// The mail-link allow entry releases the deny-list's "link" key ONLY in
	// log-mode deployments that opt in via NEXAU_MAIL_LOG_LINKS — the knob
	// was dead otherwise (redaction beat the opt-in; E2E 2026-09-23).
	mailAllow := []string{}
	if cfg.Mail.Mode != "smtp" && cfg.Mail.LogLinks {
		mailAllow = []string{"link"}
	}
	otel, logger, err := observability.Setup(context.Background(), observability.LogOTelConfig{
		Log: observability.LogConfig{
			Level: cfg.Log.Level, Format: cfg.Log.Format, RedactKeys: cfg.Log.RedactKeys,
			AllowKeys: mailAllow,
		},
		ServiceName:    cfg.OTel.ServiceName,
		TraceEndpoint:  cfg.OTel.TraceEndpoint,
		TraceInsecure:  cfg.OTel.TraceInsecure,
		TraceRatio:     cfg.OTel.TraceRatio,
		MetricEndpoint: cfg.OTel.MetricEndpoint,
		MetricInsecure: cfg.OTel.MetricInsecure,
		Prometheus:     cfg.OTel.Prometheus,
	})
	if err != nil {
		return err
	}
	logger.Info("nexau-cloud-api starting",
		"addr", cfg.HTTPAddr, "auth_mode", cfg.Auth.Mode, "bifrost", cfg.Bifrost.BaseURL)

	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// 3. PostgreSQL (authoritative store) + migrations.
	pg, err := store.NewPostgres(rootCtx, cfg.DatabaseURL, cfg.DBMaxConns, cfg.DBMinConns, cfg.DBMaxConnLifetime, cfg.DBHealthTimeout)
	if err != nil {
		return err
	}
	defer pg.Close()
	if err := store.Migrate(rootCtx, pg); err != nil {
		return err
	}
	logger.Info("postgres ready", "max_conns", cfg.DBMaxConns)

	// 4. Redis (distributed fast state).
	rd, err := store.NewRedis(rootCtx, cfg.RedisURL, cfg.RedisPoolSize, cfg.RedisTimeout)
	if err != nil {
		return err
	}
	defer func() { _ = rd.Close() }()
	logger.Info("redis ready", "pool", cfg.RedisPoolSize)

	metrics := observability.NewMetrics()

	// 5. Repositories (all tenant-scoped).
	users := repos.NewUsers(pg.Pool)
	tenants := repos.NewTenants(pg.Pool)
	subs := repos.NewSubscriptions(pg.Pool)
	ents := repos.NewEntitlements(pg.Pool)
	refresh := repos.NewRefreshTokens(pg.Pool)
	sessionsRepo := repos.NewSessions(pg.Pool)
	runsRepo := repos.NewRuns(pg.Pool)
	usageRepo := repos.NewUsage(pg.Pool)

	// 6. Auth: verifier (local and/or JWKS) + resolver + service.
	verifier, signer, err := buildVerifier(cfg)
	if err != nil {
		return err
	}
	resolver := &auth.IdentityResolver{
		Users: users, Tenants: tenants, Subs: subs, Ents: ents,
		Redis: rd.Client, CacheTTL: 30 * time.Second,
	}

	// Google OAuth ("Continue with Google") — mounted only when fully
	// configured; endpoint URLs injectable for tests and proxies.
	var google *auth.GoogleProvider
	var oauthStore auth.OAuthStore
	var devices auth.DevicesStore
	if cfg.Auth.GoogleClientID != "" && cfg.Auth.GoogleClientSecret != "" && cfg.Auth.GoogleRedirectURL != "" && cfg.Auth.Mode == "local" {
		google = auth.NewGoogleProvider(
			cfg.Auth.GoogleClientID, cfg.Auth.GoogleClientSecret, cfg.Auth.GoogleRedirectURL,
			cfg.Auth.GoogleAuthURL, cfg.Auth.GoogleTokenURL, cfg.Auth.GoogleJWKSURL, nil)
		oauthUsers := repos.NewOAuthUsers(pg.Pool)
		oauthStore = oauthUsers
		devices = repos.NewDevices(pg.Pool)
		logger.Info("google sign-in enabled", "redirect", cfg.Auth.GoogleRedirectURL)
	}

	authSvc := &auth.Service{
		Users: users, Tenants: tenants,
		RefreshRepo: refresh, Redis: rd.Client,
		Signer:    signer,
		AccessTTL: cfg.Auth.AccessTokenTTL, RefreshTTL: cfg.Auth.RefreshTokenTTL,
		DeviceTTL:       cfg.Auth.DeviceTokenTTL,
		RevocationCheck: cfg.Auth.RevocationCheck,

		Google:         google,
		OAuth:          oauthStore,
		Devices:        devices,
		WebSessionTTL:  cfg.Auth.WebSessionTTL,
		WebGrantTTL:    cfg.Auth.WebGrantTTL,
		OAuthStateTTL:  cfg.Auth.OAuthStateTTL,
		DesktopCodeTTL: cfg.Auth.DesktopCodeTTL,
	}
	authMW := auth.Middleware{
		Verifier: verifier, Resolver: resolver, Service: authSvc,
		AuthTimeout: cfg.AuthTimeout, RevocationCheck: cfg.Auth.RevocationCheck,
	}

	// 7. Distributed rate limiting + idempotency.
	limiter := ratelimit.New(rd.Client, cfg.Rate.FailOpen, metrics)
	idem := idempotency.New(rd.Client, cfg.IdempotencyTTL)

	// 8. Metering (async, bounded, exactly-once).
	meter := metering.New(usageRepo, metering.Config{
		QueueSize: cfg.Meter.QueueSize, BatchSize: cfg.Meter.BatchSize,
		FlushInterval: cfg.Meter.FlushInterval, RetryMax: cfg.Meter.RetryMax,
	}, metrics)

	// 9. Bifrost client (shared transport, cloud-side credential only).
	bf := bifrost.NewClient(bifrost.TransportConfig{
		BaseURL: cfg.Bifrost.BaseURL, APIKey: cfg.Bifrost.APIKey,
		DialTimeout: cfg.BifrostDialTimeout, TLSTimeout: cfg.BifrostTLSTimeout,
		ResponseHeaderTO: cfg.BifrostHeaderTO, IdleConnTimeout: cfg.Bifrost.IdleConnTimeout,
		MaxIdleConns: cfg.Bifrost.MaxIdleConns, MaxIdleConnsPerHost: cfg.Bifrost.MaxIdleConnsPerHost,
		MaxConnsPerHost: cfg.Bifrost.MaxConnsPerHost, DisableHTTP2: cfg.Bifrost.DisableHTTP2,
		MaxRetries:      cfg.Bifrost.MaxRetries,
		RetryMinBackoff: cfg.Bifrost.RetryMinBackoff, RetryMaxBackoff: cfg.Bifrost.RetryMaxBackoff,
		CircuitBreaker: bifrost.CircuitBreakerConfig{
			Enabled: cfg.Bifrost.CBEnabled, ConsecutiveFailures: cfg.Bifrost.CBConsecutive,
			WindowSize: cfg.Bifrost.CBWindow, MinSamples: cfg.Bifrost.CBMinSamples,
			FailureRate: cfg.Bifrost.CBFailureRate, OpenBase: cfg.Bifrost.CBOpenBase,
			OpenMax: cfg.Bifrost.CBOpenMax, HalfOpenProbes: cfg.Bifrost.CBHalfOpenProbes,
		},
	}, metrics)

	// 10. Run manager + agent services.
	mgr := agent.NewManager(rd.Client, limiter, cfg.Rate.RunConcurrencyTimeout, metrics)
	runSvc := agent.NewService(agent.Config{
		Sessions: sessionsRepo, Runs: runsRepo, Bifrost: bf,
		Meter: meter, Idem: idem, Manager: mgr, Limiter: limiter,
		Limits: agent.Limits{
			MaxMessages: cfg.MaxMessages, MaxTools: cfg.MaxTools, MaxModelLen: cfg.MaxModelLen,
		},
		Rate: agent.RateRules{
			RPMUser: cfg.Rate.RequestsPerMinuteUser, RPMTenant: cfg.Rate.RequestsPerMinuteTenant,
			ConcUser: cfg.Rate.ConcurrentRunsUser, ConcTenant: cfg.Rate.ConcurrentRunsTenant,
			FailOpen: cfg.Rate.FailOpen,
		},
		Timing:       agent.StreamTiming{IdleTimeout: cfg.StreamIdleTimeout, MaxDuration: cfg.StreamMaxDuration},
		SetupTimeout: 15 * time.Second,
		Metrics:      metrics,
	})

	// 10b. Payments (prepaid credit top-ups; docs/PAYMENT-GATEWAY.md).
	// Provider modes: disabled (nil service, routes answer 503), mock
	// (dev/tests, fixed secrets, no network), razorpay (production).
	var paySvc *payment.Service
	var payProvider payment.Provider
	switch cfg.Payments.Provider {
	case "razorpay":
		payProvider = razorpay.New(razorpay.Config{
			KeyID: cfg.Payments.RazorpayKeyID, KeySecret: cfg.Payments.RazorpayKeySecret,
			WebhookSecret: cfg.Payments.RazorpayWebhookSecret,
			BaseURL:       cfg.Payments.RazorpayAPIBase,
		})
	case "mock":
		mock := payment.NewMockProvider()
		mock.AutoCapture = cfg.Payments.MockAutoCapture
		payProvider = mock
	}
	if payProvider != nil {
		payCatalog, err := payment.CatalogFromEnv(cfg.Payments.CatalogJSON)
		if err != nil {
			return err
		}
		payStore := repos.NewPayments(pg.Pool)
		paySvc = payment.New(payment.Config{
			Store: payStore, Provider: payProvider, Catalog: payCatalog,
			Limiter:  limiter,
			OrderTTL: cfg.Payments.OrderTTL, SweepInterval: cfg.Payments.SweepInterval,
			HistoryLimit:    cfg.Payments.HistoryLimit,
			CheckoutPerUser: cfg.Payments.CheckoutPerUser,
			WebhookPerIP:    cfg.Payments.WebhookPerIP,
			Metrics:         metrics,
		})
		paySvc.StartSweeper(rootCtx) // stops with rootCtx at shutdown
		logger.Info("payments enabled", "provider", cfg.Payments.Provider,
			"packs", len(paySvc.Packs()), "order_ttl", cfg.Payments.OrderTTL.String())
	}

	// 11. HTTP surface.
	apiHandler := api.New(cfg, authSvc, authMW, runSvc, usageRepo, pg, rd, bf, meter, limiter, metrics, otel, paySvc).WithSubscriptions(subs)

	chain := middleware.Chain(middleware.Options{
		MaxBodyBytes: cfg.MaxBodyBytes, MaxInFlight: cfg.MaxConcurrentReqs,
		AllowedOrigins: cfg.AllowedOrigins,
	}, metrics)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           chain(apiHandler.Router()),
		ReadHeaderTimeout: cfg.ReadHeaderTimeout,
		IdleTimeout:       cfg.IdleTimeout,
		WriteTimeout:      0, // streams manage their own write deadlines
		MaxHeaderBytes:    cfg.MaxHeaderBytes,
	}

	// 12. Background housekeeping + metrics sampler.
	hk := startHousekeeping(rootCtx, housekeepingDeps{
		sessions: sessionsRepo, runs: runsRepo, refresh: refresh,
		pg:       pg, metrics: metrics, mgr: mgr,
		stuckAfter:     cfg.StreamMaxDuration + 5*time.Minute,
		sessionIdleTTL: cfg.SessionIdleTTL,
	}, logger)
	defer hk.stop()

	// 14. Serve + graceful shutdown.
	errCh := make(chan error, 1)
	go func() {
		logger.Info("http listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-errCh:
		rootCancel()
		return err
	case sig := <-sigCh:
		logger.Info("shutdown signal received", "signal", sig.String())
		// Stop background work (housekeeping sweeps, samplers) NOW so the
		// deferred hk.stop() cannot add its own unbounded tail.
		rootCancel()
	}

	// Grace sequence: ONE total budget (NEXAU_SHUTDOWN_GRACE); every step
	// gets a slice of the remaining time — no step can extend shutdown
	// past the operator's window.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer shutdownCancel()
	deadline, _ := shutdownCtx.Deadline()
	remaining := func() time.Duration {
		r := time.Until(deadline)
		if r < 0 {
			r = 0
		}
		return r
	}

	// 14a. Stop accepting new connections.
	_ = srv.Shutdown(shutdownCtx)

	// 13b. Cancel remaining runs; producers finalize (usage, run rows).
	mgr.Shutdown(remaining())

	// 13c. Drain the usage metering queue (bounded by the remaining grace).
	meter.Close(remaining())

	// 13d. Flush telemetry.
	otel.Shutdown(shutdownCtx)

	// 13e-13f. Close Redis, then PostgreSQL (deferred above).
	logger.Info("shutdown complete")
	return nil
}

// buildVerifier assembles the token verifier per auth mode.
func buildVerifier(cfg *config.Config) (auth.Verifier, *auth.LocalSigner, error) {
	local := auth.NewLocalSigner(cfg.Auth.HS256Secret, cfg.Auth.Issuer, cfg.Auth.Audience,
		cfg.Auth.Leeway, cfg.Auth.AccessTokenTTL)
	jwks := auth.NewJWKSVerifier(cfg.Auth.JWKSURL, cfg.Auth.Issuer, cfg.Auth.Audience,
		cfg.Auth.JWKSRefresh, cfg.Auth.JWKSMinRefresh, cfg.Auth.Leeway, http.DefaultClient)
	switch cfg.Auth.Mode {
	case "local":
		return local, local, nil
	case "jwks":
		return jwks, nil, nil
	default:
		return nil, nil, errors.New("config: unsupported auth mode " + cfg.Auth.Mode)
	}
}
