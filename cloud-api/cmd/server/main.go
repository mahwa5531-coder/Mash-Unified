// Command server runs the MASh Cloud API: the thin cloud layer between the
// MASh desktop runtime and the Bifrost LLM gateway.
//
// Responsibilities (and nothing else): Google-OAuth identity, subscriptions
// and quotas, credit top-ups (Razorpay), and the LLM tunnel
// (POST /v1/chat/completions → Bifrost, SSE). The agent runtime — sessions,
// transcripts, tools, files, execution — lives entirely on the desktop.
//
// Boot order (fail fast, in dependency order): config → observability →
// PostgreSQL (migrations) → Redis → auth → rate limiting → metering →
// Bifrost client → LLM proxy → payments → HTTP.
//
// Shutdown order: stop accepting → drain the usage metering queue → flush
// telemetry → close Redis → close PostgreSQL → exit.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mash-cloud/mash-api/internal/api"
	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/bifrost"
	"github.com/mash-cloud/mash-api/internal/config"
	"github.com/mash-cloud/mash-api/internal/llm"
	"github.com/mash-cloud/mash-api/internal/metering"
	"github.com/mash-cloud/mash-api/internal/middleware"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/payment"
	"github.com/mash-cloud/mash-api/internal/payment/razorpay"
	"github.com/mash-cloud/mash-api/internal/ratelimit"
	"github.com/mash-cloud/mash-api/internal/store"
	"github.com/mash-cloud/mash-api/internal/store/repos"
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
	otel, logger, err := observability.Setup(context.Background(), observability.LogOTelConfig{
		Log: observability.LogConfig{
			Level: cfg.Log.Level, Format: cfg.Log.Format, RedactKeys: cfg.Log.RedactKeys,
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
	logger.Info("mash-cloud-api starting",
		"addr", cfg.HTTPAddr, "bifrost", cfg.Bifrost.BaseURL)

	// Google-only posture guard: without Google OAuth configured, no client
	// can ever obtain a token. That is almost certainly a misconfiguration —
	// say so loudly instead of serving 401s in silence. (Not a hard error:
	// signer-only deployments that mint tokens out-of-band, such as test
	// harnesses, are legal.)
	if cfg.Auth.GoogleClientID == "" {
		logger.Warn("google sign-in is not configured (NEXAU_AUTH_GOOGLE_*) - " +
			"no client can log in. This is only valid for test harnesses.")
	}

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
	calls := repos.NewLLMCalls(pg.Pool)

	// 6. Auth: local HS256 signer/verifier + identity resolver + Google OAuth.
	signer := auth.NewLocalSigner(cfg.Auth.HS256Secret, cfg.Auth.Issuer, cfg.Auth.Audience,
		cfg.Auth.Leeway, cfg.Auth.AccessTokenTTL)
	resolver := &auth.IdentityResolver{
		Users: users, Tenants: tenants, Subs: subs, Ents: ents,
		Redis: rd.Client, CacheTTL: 30 * time.Second,
	}

	// Google OAuth ("Continue with Google") — mounted only when fully
	// configured; endpoint URLs injectable for tests and proxies.
	var google *auth.GoogleProvider
	var oauthStore auth.OAuthStore
	var devices auth.DevicesStore
	if cfg.Auth.GoogleClientID != "" && cfg.Auth.GoogleClientSecret != "" && cfg.Auth.GoogleRedirectURL != "" {
		google = auth.NewGoogleProvider(
			cfg.Auth.GoogleClientID, cfg.Auth.GoogleClientSecret, cfg.Auth.GoogleRedirectURL,
			cfg.Auth.GoogleAuthURL, cfg.Auth.GoogleTokenURL, cfg.Auth.GoogleJWKSURL,
			cfg.Auth.GoogleIssuers, nil)
		oauthStore = repos.NewOAuthUsers(pg.Pool)
		devices = repos.NewDevices(pg.Pool)
		logger.Info("google sign-in enabled", "redirect", cfg.Auth.GoogleRedirectURL,
			"issuers", len(cfg.Auth.GoogleIssuers))
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
		Verifier: signer, Resolver: resolver, Service: authSvc,
		AuthTimeout: cfg.AuthTimeout, RevocationCheck: cfg.Auth.RevocationCheck,
	}

	// 7. Distributed rate limiting.
	limiter := ratelimit.New(rd.Client, cfg.Rate.FailOpen, metrics)

	// 8. Metering (async, bounded, exactly-once via llm_calls.call_id).
	meter := metering.New(calls, metering.Config{
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

	// 10. The LLM proxy (the tunnel service behind POST /v1/chat/completions).
	//      Token accounting weights come from the token_normalization table
	//      (hot-changeable via SQL; docs/TABLES.md) through a short-TTL cache.
	proxy := &llm.Proxy{
		Bifrost: bf, Meter: meter, Limiter: limiter, Usage: calls, Metrics: metrics,
		Norm: llm.NewRuleCache(repos.NewNormalization(pg.Pool), cfg.NormCacheTTL),
		Limits: llm.Limits{
			MaxMessages: cfg.MaxMessages, MaxTools: cfg.MaxTools, MaxModelLen: cfg.MaxModelLen,
		},
		Rate: llm.RateRules{
			RPMUser: cfg.Rate.RequestsPerMinuteUser, RPMTenant: cfg.Rate.RequestsPerMinuteTenant,
			ConcUser: cfg.Rate.ConcurrentRequestsUser, ConcTenant: cfg.Rate.ConcurrentRequestsTenant,
		},
		Timing: llm.Timing{
			IdleTimeout: cfg.StreamIdleTimeout, MaxDuration: cfg.StreamMaxDuration,
			NonStreamTimeout: cfg.BifrostReqTimeout,
		},
		SlotTTL: cfg.Rate.SlotTimeout,
		Reserve: llm.ReserveConfig{
			Enabled:     cfg.Quota.ReserveEnabled,
			MinTokens:   cfg.Quota.ReserveMinTokens,
			MaxTokens:   cfg.Quota.ReserveMaxTokens,
			DefaultOut:  cfg.Quota.ReserveDefaultOut,
			TTL:         cfg.Quota.ReserveTTL,
			SettleDelay: cfg.Quota.ReserveSettleDelay,
		},
	}

	// 11. Payments (prepaid credit top-ups; docs/PAYMENT-GATEWAY.md).
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

	// 12. HTTP surface.
	apiHandler := api.New(cfg, authSvc, authMW, proxy, calls, pg, rd, bf, limiter, metrics, otel, paySvc)

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

	// 13. Background housekeeping + metrics sampler.
	hk := startHousekeeping(rootCtx, housekeepingDeps{
		refresh: refresh,
		pg:      pg, metrics: metrics,
		proxy: proxy,
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

	// 14a. Stop accepting new connections. In-flight LLM streams observe the
	// client side of the connection closing only after this returns.
	_ = srv.Shutdown(shutdownCtx)

	// 14b. Drain the usage metering queue (bounded by the remaining grace):
	// the last completed calls' llm_calls rows must land.
	meter.Close(time.Until(deadlineOf(shutdownCtx)))

	// 14c. Flush telemetry.
	otel.Shutdown(shutdownCtx)

	// 14d-14e. Close Redis, then PostgreSQL (deferred above).
	logger.Info("shutdown complete")
	return nil
}

func deadlineOf(ctx context.Context) time.Time {
	dl, ok := ctx.Deadline()
	if !ok {
		return time.Now().Add(30 * time.Second)
	}
	return dl
}
