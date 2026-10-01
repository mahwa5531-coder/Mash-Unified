// Package observability provides structured logging, OpenTelemetry tracing and
// metric instruments. It is initialized once in main and consumed everywhere.
package observability

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// OTel bundles the initialized telemetry primitives.
type OTel struct {
	Tracer      trace.Tracer
	Meter       metric.Meter
	PromHandler http.Handler // served at /metrics when enabled
	shutdownFns []func(context.Context) error
}

// LogOTelConfig is the subset of config consumed here (avoids import cycle).
type LogOTelConfig struct {
	Log            LogConfig
	ServiceName    string
	TraceEndpoint  string
	TraceInsecure  bool
	TraceRatio     float64
	MetricEndpoint string
	MetricInsecure bool
	Prometheus     bool
}

type LogConfig struct {
	Level      string
	Format     string
	RedactKeys []string
	// AllowKeys exempts keys from the BUILT-IN deny-list only (never from
	// the operator's RedactKeys). Sole intended use: NEXAU_MAIL_LOG_LINKS
	// — without it, the deny-list's "link" entry deadlocks the documented
	// dev opt-in and log-mode deployments can never complete signup
	// verification (found in real-Postgres E2E, 2026-09-23).
	AllowKeys []string
}

var globalOTelBundle = &atomic.Pointer[OTel]{}

// Get returns the process-wide telemetry bundle (nil-safe).
func Get() *OTel { return globalOTelBundle.Load() }

// Setup configures logging, tracing and metrics. Telemetry failures are
// non-fatal and degrade to no-op providers: observability must never block
// production traffic.
func Setup(ctx context.Context, cfg LogOTelConfig) (*OTel, *slog.Logger, error) {
	logger := newLogger(cfg.Log)
	// Default logger: package-level Log* shorthands and third-party libraries
	// (go-redis, pgx) emit through the same structured, redacted handler.
	slog.SetDefault(logger)

	otelBundle := &OTel{
		Tracer: otel.GetTracerProvider().Tracer("nexau-cloud-api"),
		Meter:  otel.GetMeterProvider().Meter("nexau-cloud-api"),
	}

	res, err := sdkresource.Merge(
		sdkresource.Default(),
		sdkresource.NewWithAttributes(semconv.SchemaURL,
			semconv.ServiceName(cfg.ServiceName),
		),
	)
	if err != nil {
		logger.Warn("otel resource merge failed", "error", err)
		res = sdkresource.Default()
	}

	// Tracing: OTLP/HTTP if configured, else no-op.
	if cfg.TraceEndpoint != "" {
		opts := []otlptracehttp.Option{otlptracehttp.WithEndpointURL(cfg.TraceEndpoint)}
		if cfg.TraceInsecure {
			opts = append(opts, otlptracehttp.WithInsecure())
		}
		exp, err := otlptracehttp.New(ctx, opts...)
		if err != nil {
			logger.Error("otlp trace exporter init failed; tracing disabled", "error", err)
		} else {
			tp := sdktrace.NewTracerProvider(
				sdktrace.WithBatcher(exp),
				sdktrace.WithResource(res),
				sdktrace.WithSampler(sdktrace.TraceIDRatioBased(cfg.TraceRatio)),
			)
			otel.SetTracerProvider(tp)
			otelBundle.Tracer = tp.Tracer("nexau-cloud-api")
			otelBundle.shutdownFns = append(otelBundle.shutdownFns, tp.Shutdown)
		}
	}

	// Metrics: Prometheus (pull, /metrics) and/or OTLP (push).
	var readers []sdkmetric.Reader
	if cfg.Prometheus {
		reg := prometheus.NewRegistry()
		prom, err := otelprom.New(otelprom.WithRegisterer(reg))
		if err == nil {
			readers = append(readers, prom)
			otelBundle.PromHandler = promhttp.HandlerFor(reg, promhttp.HandlerOpts{
				ErrorHandling: promhttp.HTTPErrorOnError,
			})
		} else {
			logger.Error("prometheus exporter init failed", "error", err)
		}
	}
	if cfg.MetricEndpoint != "" {
		mopts := []otlpmetrichttp.Option{otlpmetrichttp.WithEndpointURL(cfg.MetricEndpoint)}
		if cfg.MetricInsecure {
			mopts = append(mopts, otlpmetrichttp.WithInsecure())
		}
		exp, err := otlpmetrichttp.New(ctx, mopts...)
		if err != nil {
			logger.Error("otlp metric exporter init failed", "error", err)
		} else {
			readers = append(readers, sdkmetric.NewPeriodicReader(exp,
				sdkmetric.WithInterval(15*time.Second)))
		}
	}
	if len(readers) > 0 {
		opts := []sdkmetric.Option{sdkmetric.WithResource(res)}
		for _, rd := range readers {
			opts = append(opts, sdkmetric.WithReader(rd))
		}
		mp := sdkmetric.NewMeterProvider(opts...)
		otel.SetMeterProvider(mp)
		otelBundle.Meter = mp.Meter("nexau-cloud-api")
		otelBundle.shutdownFns = append(otelBundle.shutdownFns, mp.Shutdown)
	}

	globalOTelBundle.Store(otelBundle)
	return otelBundle, logger, nil
}

// Shutdown flushes telemetry within the given context deadline.
func (o *OTel) Shutdown(ctx context.Context) {
	if o == nil {
		return
	}
	var wg sync.WaitGroup
	for _, fn := range o.shutdownFns {
		wg.Add(1)
		go func(fn func(context.Context) error) {
			defer wg.Done()
			if err := fn(ctx); err != nil {
				slog.Warn("otel shutdown error", "error", err)
			}
		}(fn)
	}
	wg.Wait()
}

func newLogger(cfg LogConfig) *slog.Logger {
	lvl := slog.LevelInfo
	switch strings.ToLower(cfg.Level) {
	case "debug":
		lvl = slog.LevelDebug
	case "info":
		lvl = slog.LevelInfo
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	}
	opts := &slog.HandlerOptions{
		Level: lvl,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			return redactAttr(cfg.RedactKeys, cfg.AllowKeys, a)
		},
	}
	var h slog.Handler
	if strings.EqualFold(cfg.Format, "text") {
		h = slog.NewTextHandler(os.Stdout, opts)
	} else {
		h = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(h)
}

// redactAttr hard-redacts sensitive keys regardless of log level. Content
// fields (message text) are also redacted: the cloud never logs customer
// content by default.
// Precedence: the operator's RedactKeys first (supreme), then the explicit
// AllowKeys exemption (built-in deny-list only), then the built-in deny
// list. "link" is on the deny list because every emailed recovery link
// carries a single-use credential inside it (2026-09-19 audit, finding 2:
// the LogMailer's link attribute bypassed the token deny-list); it is
// releasable ONLY through the documented MAIL_LOG_LINKS opt-in.
func redactAttr(keys, allow []string, a slog.Attr) slog.Attr {
	name := a.Key
	for _, k := range keys {
		if strings.EqualFold(k, name) {
			return slog.String(name, "[REDACTED]")
		}
	}
	for _, k := range allow {
		if strings.EqualFold(k, name) {
			return a
		}
	}
	// Built-in deny list: credentials and content never appear in logs.
	switch strings.ToLower(name) {
	case "authorization", "api_key", "apikey", "password", "secret", "token",
		"access_token", "refresh_token", "cookie", "set-cookie",
		"x-api-key", "x-bifrost-api-key", "bearer", "credential", "link",
		"messages", "content", "tools", "prompt", "delta", "arguments",
		"tool_arguments", "body", "response_body":
		return slog.String(name, "[REDACTED]")
	}
	return a
}

// Package-level log shorthands. They emit through slog's default logger, which
// main sets to the configured structured logger; if that never happened they
// degrade to the stdlib default — logs are never dropped silently.
func LogDebug(msg string, args ...any) { slog.Debug(msg, args...) }
func LogInfo(msg string, args ...any)  { slog.Info(msg, args...) }
func LogWarn(msg string, args ...any)  { slog.Warn(msg, args...) }
func LogError(msg string, args ...any) { slog.Error(msg, args...) }
