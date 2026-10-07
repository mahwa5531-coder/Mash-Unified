// Package config loads and validates the externalized configuration of the
// MASh Cloud API. Every tunable that affects production behavior lives here;
// secrets are never defaulted to real values and never committed.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-resolved runtime configuration. It is immutable after
// Load returns; all sharing is by value-copy of small structs.
type Config struct {
	// HTTP server
	HTTPAddr          string        // NEXAU_HTTP_ADDR (default ":8080")
	ShutdownGrace     time.Duration // NEXAU_SHUTDOWN_GRACE (default 30s)
	MaxHeaderBytes    int           // NEXAU_MAX_HEADER_BYTES (default 16KB)
	MaxConcurrentReqs int           // in-flight requests bound (default 8192)
	AllowedOrigins    []string      // CORS origin allow-list (default none)
	TrustProxyHeaders bool          // honor X-Forwarded-For (default true)

	// Request limits
	MaxBodyBytes int64 // NEXAU_MAX_BODY_BYTES (default 2 MiB)
	MaxMessages  int   // default 256
	MaxTools     int   // default 128
	MaxModelLen  int   // default 256

	// Timeouts (separate concepts, never one global)
	WriteTimeout       time.Duration // HTTP write timeout (0 = none; streams manage own)
	ReadHeaderTimeout  time.Duration // default 10s
	IdleTimeout        time.Duration // default 120s
	AuthTimeout        time.Duration // auth verification budget (default 3s)
	DBTimeout          time.Duration // single statement budget (default 5s)
	RedisTimeout       time.Duration // single command budget (default 500ms)
	StreamIdleTimeout  time.Duration // no upstream chunk → abort (default 300s, Bifrost parity)
	StreamMaxDuration  time.Duration // hard cap of one stream (default 15m)
	BifrostDialTimeout time.Duration // default 10s
	BifrostTLSTimeout  time.Duration // default 10s
	BifrostHeaderTO    time.Duration // response header wait (default 60s)
	BifrostReqTimeout  time.Duration // non-stream LLM call cap (default 120s)

	// SSE stream transport
	StreamWriteDeadline     time.Duration // per-event client write deadline (default 10s)
	StreamHeartbeatInterval time.Duration // SSE comment keepalive period (default 15s)

	// Authentication (Google OAuth only; tokens minted locally)
	Auth AuthConfig

	// Quota reservation (in-flight window claims; see llm.ReserveConfig)
	Quota QuotaConfig

	// Payments (prepaid credit top-ups via Razorpay; docs/PAYMENT-GATEWAY.md)
	Payments PaymentConfig

	// Bifrost
	Bifrost BifrostConfig

	// PostgreSQL
	DatabaseURL       string
	DBMaxConns        int32         // default = 4 * CPUs, min 8
	DBMinConns        int32         // default 4
	DBMaxConnLifetime time.Duration // default 30m
	DBHealthTimeout   time.Duration // default 2s

	// Redis
	RedisURL      string
	RedisPoolSize int // default = 4 * CPUs, min 8

	// Rate limiting
	Rate RateLimitConfig

	// Metering
	Meter MeterConfig

	// Token accounting (normalization weights cache TTL; the weights
	// themselves live in the token_normalization table).
	NormCacheTTL time.Duration // default 30s

	// Observability
	Log  LogConfig
	OTel OTelConfig
}

// AuthConfig controls token issuance/verification and the Google OAuth +
// web-to-desktop handshake.
type AuthConfig struct {
	Issuer          string        // expected `iss` (default https://auth.mash.cloud)
	Audience        string        // expected `aud` (default mash-cloud-api)
	HS256Secret     string        // ≥32 bytes enforced
	HS256SecretFile string        // optional path; takes precedence (secret-manager friendly)
	AccessTokenTTL  time.Duration // default 15m
	RefreshTokenTTL time.Duration // default 30d
	DeviceTokenTTL  time.Duration // default 100d
	Leeway          time.Duration // clock skew tolerance (default 30s)
	RevocationCheck bool          // check jti blacklist in Redis (default true)

	// Google OAuth 2.0 / OIDC ("Continue with Google" on the web login).
	// Enabled iff ClientID+Secret+RedirectURL are all set.
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string // registered in Google Cloud Console, exact match
	// Endpoint overrides (defaults are Google's production URLs; tests and
	// air-gapped deployments point them at fakes/proxies).
	GoogleAuthURL  string
	GoogleTokenURL string
	GoogleJWKSURL  string
	// Accepted ID-token issuers. Defaults are Google's two documented forms;
	// a deployment pointing the endpoints at a test/fake OAuth server MUST
	// set this to that server's issuer or every login fails — the issuer
	// check is a security boundary, so it is explicit config, never
	// inferred from the endpoint URLs.
	GoogleIssuers []string

	// Web-to-desktop handshake (60-second single-use exchange codes).
	WebSuccessURL     string        // post-OAuth redirect target (receives ?grant=...)
	WebLoginURL       string        // OAuth error redirect target (receives ?error=...)
	WebSessionTTL     time.Duration // short web access token (default 15m, no refresh)
	WebGrantTTL       time.Duration // single-use web grant code (default 5m)
	OAuthStateTTL     time.Duration // OAuth state lifetime (default 10m)
	DesktopCodeTTL    time.Duration // single-use mcode lifetime (default 60s)
	OAuthCookieSecure bool          // Secure attribute on the OAuth tx cookie (default true)

	// Handshake throttle budgets (15-minute per-IP windows except where noted).
	MaxWebSessionPerIP      int // POST /v1/auth/web/session (default 60)
	MaxDesktopExchangePerIP int // POST /v1/auth/desktop/exchange (default 60)
	MaxDesktopCodePerMin    int // POST /v1/auth/desktop/code per user per minute (default 30)
	MaxRefreshPerIP         int // POST /v1/auth/refresh (rotation + PG writes, default 60)
	MaxOAuthPerIP           int // GET  /v1/auth/oauth/google{,/callback} (Redis state, default 60)
}

// QuotaConfig bounds the in-flight token reservation that closes the
// concurrent-overshoot race in the rolling plan windows (5h / weekly).
// Usage rows land in PostgreSQL only at call completion; without a claim,
// N parallel admits each see the same position and can collectively exceed
// the window. Every admitted call reserves an estimate, atomically, until
// its usage row lands.
type QuotaConfig struct {
	ReserveEnabled     bool          // NEXAU_QUOTA_RESERVE_ENABLED (default true)
	ReserveMinTokens   int64         // per-call floor (default 1024)
	ReserveMaxTokens   int64         // per-call ceiling (default 32768)
	ReserveDefaultOut  int64         // output budget when the request declares none (default 4096)
	ReserveTTL         time.Duration // crash backstop; must exceed StreamMaxDuration (default 30m)
	ReserveSettleDelay time.Duration // release delay covering the metering flush lag (default 2s)
}

// BifrostConfig is the upstream gateway connection.
type BifrostConfig struct {
	BaseURL             string // e.g. http://bifrost:8080
	APIKey              string // cloud-side credential; never logged, never returned
	APIKeyFile          string // optional path; takes precedence (secret-file friendly)
	HealthURL           string // default {BaseURL}/health
	MaxIdleConns        int
	MaxIdleConnsPerHost int
	MaxConnsPerHost     int
	IdleConnTimeout     time.Duration
	DisableHTTP2        bool
	MaxRetries          int           // pre-first-byte retries (default 2)
	RetryMinBackoff     time.Duration // default 100ms
	RetryMaxBackoff     time.Duration // default 2s

	// Upstream circuit breaker (NEXAU_BIFROST_CB_* env knobs; defaults
	// below). Failures counted: network errors, 5xx, 408, mid-stream
	// gateway faults. Not counted: 4xx/429 (gateway alive), in-band
	// provider errors, client cancellations.
	CBEnabled        bool          // default true
	CBConsecutive    int           // trip after N consecutive failures (default 10)
	CBWindow         int           // rate window: last N outcomes (default 60)
	CBMinSamples     int           // rate trip needs >= N samples (default 30)
	CBFailureRate    float64       // rate trip at >= fraction failures (default 0.60)
	CBOpenBase       time.Duration // first open cooldown (default 30s)
	CBOpenMax        time.Duration // cooldown cap over repeated trips (default 5m)
	CBHalfOpenProbes int           // concurrent half-open probes (default 3)
}

// RateLimitConfig holds distributed limiter dimensions. Zero value of a limit
// disables that dimension.
type RateLimitConfig struct {
	RequestsPerMinuteUser    int64         // default 600
	RequestsPerMinuteTenant  int64         // default 6000
	ConcurrentRequestsUser   int64         // default 16
	ConcurrentRequestsTenant int64         // default 256
	IPRequestsPerMinute      int64         // default 1200 (auth + create endpoints)
	FailOpen                 bool          // default true (availability with alarm)
	SlotTimeout              time.Duration // how long a stale concurrent slot self-expires (default 30m)
}

// MeterConfig bounds the async usage recorder.
type MeterConfig struct {
	QueueSize     int           // bounded queue (default 16384)
	BatchSize     int           // flush batch (default 128)
	FlushInterval time.Duration // default 500ms
	RetryMax      int           // per-batch retries on DB failure (default 3)
}

// LogConfig is structured logging.
type LogConfig struct {
	Level      string // debug|info|warn|error (default info)
	Format     string // json|text (default json)
	RedactKeys []string
}

// PaymentConfig wires the payment gateway module.
type PaymentConfig struct {
	Provider string // disabled | mock | razorpay

	RazorpayKeyID         string
	RazorpayKeySecret     string
	RazorpayWebhookSecret string
	RazorpayAPIBase       string // "" → razorpay.DefaultBaseURL

	// CatalogJSON optionally overrides the built-in credit packs.
	CatalogJSON string

	// MockAutoCapture: in mock mode, provider orders capture themselves
	// after this delay (dev UX: the flow completes without any external
	// trigger; 0 = manual via tests only).
	MockAutoCapture time.Duration

	OrderTTL        time.Duration // pending order expiry
	SweepInterval   time.Duration // background sweeper cadence
	HistoryLimit    int
	CheckoutPerUser int // checkout requests / user / hour
	WebhookPerIP    int // webhook posts / IP / min
}

// OTelConfig is tracing/metrics export.
type OTelConfig struct {
	ServiceName    string
	TraceEndpoint  string // OTLP/HTTP endpoint; empty disables
	TraceInsecure  bool
	TraceRatio     float64
	MetricEndpoint string // OTLP/HTTP metrics endpoint; empty disables
	MetricInsecure bool
	Prometheus     bool // serve /metrics (default true)
}

// Load builds the configuration from the environment, applies defaults and
// validates invariants. It returns an error listing every problem at once so
// operators see the full picture on a bad deploy.
func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:          envStr("NEXAU_HTTP_ADDR", ":8080"),
		ShutdownGrace:     envDur("NEXAU_SHUTDOWN_GRACE", 30*time.Second),
		MaxHeaderBytes:    envInt("NEXAU_MAX_HEADER_BYTES", 16*1024),
		MaxConcurrentReqs: envInt("NEXAU_MAX_CONCURRENT_REQUESTS", 8192),
		AllowedOrigins:    envList("NEXAU_ALLOWED_ORIGINS"),
		TrustProxyHeaders: envBool("NEXAU_TRUST_PROXY_HEADERS", true),

		MaxBodyBytes: envInt64("NEXAU_MAX_BODY_BYTES", 2<<20),
		MaxMessages:  envInt("NEXAU_MAX_MESSAGES", 256),
		MaxTools:     envInt("NEXAU_MAX_TOOLS", 128),
		MaxModelLen:  envInt("NEXAU_MAX_MODEL_LEN", 256),

		ReadHeaderTimeout:       envDur("NEXAU_READ_HEADER_TIMEOUT", 10*time.Second),
		IdleTimeout:             envDur("NEXAU_IDLE_TIMEOUT", 120*time.Second),
		AuthTimeout:             envDur("NEXAU_AUTH_TIMEOUT", 3*time.Second),
		DBTimeout:               envDur("NEXAU_DB_TIMEOUT", 5*time.Second),
		RedisTimeout:            envDur("NEXAU_REDIS_TIMEOUT", 500*time.Millisecond),
		StreamIdleTimeout:       envDur("NEXAU_STREAM_IDLE_TIMEOUT", 300*time.Second),
		StreamMaxDuration:       envDur("NEXAU_STREAM_MAX_DURATION", 15*time.Minute),
		BifrostDialTimeout:      envDur("NEXAU_BIFROST_DIAL_TIMEOUT", 10*time.Second),
		BifrostTLSTimeout:       envDur("NEXAU_BIFROST_TLS_TIMEOUT", 10*time.Second),
		BifrostHeaderTO:         envDur("NEXAU_BIFROST_HEADER_TIMEOUT", 60*time.Second),
		BifrostReqTimeout:       envDur("NEXAU_BIFROST_REQUEST_TIMEOUT", 120*time.Second),
		StreamWriteDeadline:     envDur("NEXAU_STREAM_WRITE_DEADLINE", 10*time.Second),
		StreamHeartbeatInterval: envDur("NEXAU_STREAM_HEARTBEAT_INTERVAL", 15*time.Second),

		DatabaseURL:       os.Getenv("NEXAU_DATABASE_URL"),
		RedisURL:          os.Getenv("NEXAU_REDIS_URL"),
		DBMaxConnLifetime: envDur("NEXAU_DB_CONN_LIFETIME", 30*time.Minute),
		DBHealthTimeout:   envDur("NEXAU_DB_HEALTH_TIMEOUT", 2*time.Second),
	}

	cpus := runtimeNumCPU()
	c.DBMaxConns = int32(envInt("NEXAU_DB_MAX_CONNS", max(8, 4*cpus)))
	c.DBMinConns = int32(envInt("NEXAU_DB_MIN_CONNS", 4))
	c.RedisPoolSize = max(8, 4*cpus)

	// Auth
	c.Auth = AuthConfig{
		Issuer:          envStr("NEXAU_AUTH_ISSUER", "https://auth.mash.cloud"),
		Audience:        envStr("NEXAU_AUTH_AUDIENCE", "mash-cloud-api"),
		HS256Secret:     os.Getenv("NEXAU_AUTH_HS256_SECRET"),
		AccessTokenTTL:  envDur("NEXAU_AUTH_ACCESS_TOKEN_TTL", 15*time.Minute),
		RefreshTokenTTL: envDur("NEXAU_AUTH_REFRESH_TOKEN_TTL", 30*24*time.Hour),
		DeviceTokenTTL:  envDur("NEXAU_AUTH_DEVICE_TOKEN_TTL", 100*24*time.Hour),
		Leeway:          envDur("NEXAU_AUTH_LEEWAY", 30*time.Second),
		RevocationCheck: envBool("NEXAU_AUTH_REVOCATION_CHECK", true),

		GoogleClientID:     os.Getenv("NEXAU_AUTH_GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("NEXAU_AUTH_GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:  os.Getenv("NEXAU_AUTH_GOOGLE_REDIRECT_URL"),
		GoogleAuthURL:      envStr("NEXAU_AUTH_GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
		GoogleTokenURL:     envStr("NEXAU_AUTH_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
		GoogleJWKSURL:      envStr("NEXAU_AUTH_GOOGLE_JWKS_URL", "https://www.googleapis.com/oauth2/v3/certs"),
		GoogleIssuers:      envListDefault("NEXAU_AUTH_GOOGLE_ISSUERS", []string{"accounts.google.com", "https://accounts.google.com"}),

		WebSuccessURL:     strings.TrimRight(os.Getenv("NEXAU_AUTH_WEB_SUCCESS_URL"), "/"),
		WebLoginURL:       strings.TrimRight(os.Getenv("NEXAU_AUTH_WEB_LOGIN_URL"), "/"),
		WebSessionTTL:     envDur("NEXAU_AUTH_WEB_SESSION_TTL", 15*time.Minute),
		WebGrantTTL:       envDur("NEXAU_AUTH_WEB_GRANT_TTL", 5*time.Minute),
		OAuthStateTTL:     envDur("NEXAU_AUTH_OAUTH_STATE_TTL", 10*time.Minute),
		DesktopCodeTTL:    envDur("NEXAU_AUTH_DESKTOP_CODE_TTL", 60*time.Second),
		OAuthCookieSecure: envBool("NEXAU_AUTH_OAUTH_COOKIE_SECURE", true),

		MaxWebSessionPerIP:      envInt("NEXAU_AUTH_WEB_SESSION_PER_IP", 60),
		MaxDesktopExchangePerIP: envInt("NEXAU_AUTH_DESKTOP_EXCHANGE_PER_IP", 60),
		MaxDesktopCodePerMin:    envInt("NEXAU_AUTH_DESKTOP_CODE_PER_MIN", 30),
		MaxRefreshPerIP:         envInt("NEXAU_AUTH_REFRESH_PER_IP", 60),
		MaxOAuthPerIP:           envInt("NEXAU_AUTH_OAUTH_PER_IP", 60),
	}

	// Secret-file override for the HS256 key (mirrors BIFROST_API_KEY_FILE):
	// Docker/k8s secret mounts beat env vars on the filesystem boundary.
	if f := os.Getenv("NEXAU_AUTH_HS256_SECRET_FILE"); f != "" {
		b, err := os.ReadFile(f)
		if err != nil {
			return nil, fmt.Errorf("config: read AUTH_HS256_SECRET_FILE: %w", err)
		}
		if s := strings.TrimSpace(string(b)); s != "" {
			c.Auth.HS256Secret = s
		}
	}

	// Payments (docs/PAYMENT-GATEWAY.md §11 — env key reference)
	c.Payments = PaymentConfig{
		Provider:              strings.ToLower(envStr("NEXAU_PAYMENT_PROVIDER", "disabled")),
		RazorpayKeyID:         os.Getenv("NEXAU_RAZORPAY_KEY_ID"),
		RazorpayKeySecret:     os.Getenv("NEXAU_RAZORPAY_KEY_SECRET"),
		RazorpayWebhookSecret: os.Getenv("NEXAU_RAZORPAY_WEBHOOK_SECRET"),
		RazorpayAPIBase:       strings.TrimRight(os.Getenv("NEXAU_RAZORPAY_API_BASE"), "/"),
		CatalogJSON:           os.Getenv("NEXAU_PAYMENT_CATALOG_JSON"),
		OrderTTL:              envDur("NEXAU_PAYMENT_ORDER_TTL", 15*time.Minute),
		SweepInterval:         envDur("NEXAU_PAYMENT_SWEEP_INTERVAL", time.Minute),
		HistoryLimit:          envInt("NEXAU_PAYMENT_HISTORY_LIMIT", 50),
		MockAutoCapture:       envDur("NEXAU_PAYMENT_MOCK_AUTOCAPTURE", 3*time.Second),
		CheckoutPerUser:       envInt("NEXAU_PAYMENT_CHECKOUT_PER_USER", 20),
		WebhookPerIP:          envInt("NEXAU_PAYMENT_WEBHOOK_PER_IP", 120),
	}

	// Bifrost
	c.Bifrost = BifrostConfig{
		BaseURL:             strings.TrimRight(os.Getenv("NEXAU_BIFROST_URL"), "/"),
		APIKey:              os.Getenv("NEXAU_BIFROST_API_KEY"),
		APIKeyFile:          os.Getenv("NEXAU_BIFROST_API_KEY_FILE"),
		MaxIdleConns:        envInt("NEXAU_BIFROST_MAX_IDLE_CONNS", 512),
		MaxIdleConnsPerHost: envInt("NEXAU_BIFROST_MAX_IDLE_CONNS_PER_HOST", 256),
		MaxConnsPerHost:     envInt("NEXAU_BIFROST_MAX_CONNS_PER_HOST", 0), // 0 = unlimited
		IdleConnTimeout:     envDur("NEXAU_BIFROST_IDLE_CONN_TIMEOUT", 90*time.Second),
		DisableHTTP2:        envBool("NEXAU_BIFROST_DISABLE_HTTP2", false),
		MaxRetries:          envInt("NEXAU_BIFROST_MAX_RETRIES", 2),
		RetryMinBackoff:     envDur("NEXAU_BIFROST_RETRY_MIN_BACKOFF", 100*time.Millisecond),
		RetryMaxBackoff:     envDur("NEXAU_BIFROST_RETRY_MAX_BACKOFF", 2*time.Second),

		CBEnabled:        envBool("NEXAU_BIFROST_CB_ENABLED", true),
		CBConsecutive:    envInt("NEXAU_BIFROST_CB_CONSECUTIVE", 10),
		CBWindow:         envInt("NEXAU_BIFROST_CB_WINDOW", 60),
		CBMinSamples:     envInt("NEXAU_BIFROST_CB_MIN_SAMPLES", 30),
		CBFailureRate:    envFloat("NEXAU_BIFROST_CB_FAILURE_RATE", 0.60),
		CBOpenBase:       envDur("NEXAU_BIFROST_CB_OPEN_BASE", 30*time.Second),
		CBOpenMax:        envDur("NEXAU_BIFROST_CB_OPEN_MAX", 5*time.Minute),
		CBHalfOpenProbes: envInt("NEXAU_BIFROST_CB_HALFOPEN_PROBES", 3),
	}
	if c.Bifrost.BaseURL != "" {
		c.Bifrost.HealthURL = c.Bifrost.BaseURL + "/health"
		if v := os.Getenv("NEXAU_BIFROST_HEALTH_URL"); v != "" {
			c.Bifrost.HealthURL = v
		}
	}
	if c.Bifrost.APIKeyFile != "" {
		b, err := os.ReadFile(c.Bifrost.APIKeyFile)
		if err != nil {
			return nil, fmt.Errorf("config: read BIFROST_API_KEY_FILE: %w", err)
		}
		c.Bifrost.APIKey = strings.TrimSpace(string(b))
	}

	// Rate limits
	c.Rate = RateLimitConfig{
		RequestsPerMinuteUser:    envInt64("NEXAU_RATE_REQ_PER_MIN_USER", 600),
		RequestsPerMinuteTenant:  envInt64("NEXAU_RATE_REQ_PER_MIN_TENANT", 6000),
		ConcurrentRequestsUser:   envInt64("NEXAU_RATE_CONCURRENT_REQS_USER", 16),
		ConcurrentRequestsTenant: envInt64("NEXAU_RATE_CONCURRENT_REQS_TENANT", 256),
		IPRequestsPerMinute:      envInt64("NEXAU_RATE_REQ_PER_MIN_IP", 1200),
		FailOpen:                 envBool("NEXAU_RATE_FAIL_OPEN", true),
		SlotTimeout:              envDur("NEXAU_RATE_CONCURRENCY_TIMEOUT", 30*time.Minute),
	}

	// Metering
	c.Meter = MeterConfig{
		QueueSize:     envInt("NEXAU_METER_QUEUE_SIZE", 16384),
		BatchSize:     envInt("NEXAU_METER_BATCH_SIZE", 128),
		FlushInterval: envDur("NEXAU_METER_FLUSH_INTERVAL", 500*time.Millisecond),
		RetryMax:      envInt("NEXAU_METER_RETRY_MAX", 3),
	}

	// Token accounting: how long a normalization-rules read stays fresh
	// (UPDATE token_normalization ... takes effect within this TTL).
	c.NormCacheTTL = envDur("NEXAU_NORM_CACHE_TTL", 30*time.Second)

	// Quota reservation (in-flight window claims)
	c.Quota = QuotaConfig{
		ReserveEnabled:     envBool("NEXAU_QUOTA_RESERVE_ENABLED", true),
		ReserveMinTokens:   envInt64("NEXAU_QUOTA_RESERVE_MIN_TOKENS", 1024),
		ReserveMaxTokens:   envInt64("NEXAU_QUOTA_RESERVE_MAX_TOKENS", 32768),
		ReserveDefaultOut:  envInt64("NEXAU_QUOTA_RESERVE_DEFAULT_OUT_TOKENS", 4096),
		ReserveTTL:         envDur("NEXAU_QUOTA_RESERVE_TTL", 30*time.Minute),
		ReserveSettleDelay: envDur("NEXAU_QUOTA_RESERVE_SETTLE_DELAY", 2*time.Second),
	}

	// Logging
	c.Log = LogConfig{
		Level:      strings.ToLower(envStr("NEXAU_LOG_LEVEL", "info")),
		Format:     strings.ToLower(envStr("NEXAU_LOG_FORMAT", "json")),
		RedactKeys: envList("NEXAU_LOG_REDACT_KEYS"),
	}

	// OTel
	c.OTel = OTelConfig{
		ServiceName:    envStr("NEXAU_OTEL_SERVICE_NAME", "mash-cloud-api"),
		TraceEndpoint:  os.Getenv("NEXAU_OTEL_TRACE_ENDPOINT"),
		TraceInsecure:  envBool("NEXAU_OTEL_TRACE_INSECURE", false),
		TraceRatio:     envFloat("NEXAU_OTEL_TRACE_RATIO", 1.0),
		MetricEndpoint: os.Getenv("NEXAU_OTEL_METRIC_ENDPOINT"),
		MetricInsecure: envBool("NEXAU_OTEL_METRIC_INSECURE", false),
		Prometheus:     envBool("NEXAU_OTEL_PROMETHEUS", true),
	}

	if err := c.validate(); err != nil {
		return nil, err
	}
	return c, nil
}

// validate enforces hard invariants. Violations are deployment blockers.
func (c *Config) validate() error {
	var errs []string

	if c.DatabaseURL == "" {
		errs = append(errs, "NEXAU_DATABASE_URL is required")
	}
	if c.RedisURL == "" {
		errs = append(errs, "NEXAU_REDIS_URL is required")
	}
	if c.Bifrost.BaseURL == "" {
		errs = append(errs, "NEXAU_BIFROST_URL is required")
	}
	if len(c.Auth.HS256Secret) < 32 {
		errs = append(errs, "NEXAU_AUTH_HS256_SECRET must be ≥32 bytes")
	}

	switch c.Log.Level {
	case "debug", "info", "warn", "error":
	default:
		errs = append(errs, fmt.Sprintf("NEXAU_LOG_LEVEL invalid: %q", c.Log.Level))
	}
	switch c.Log.Format {
	case "json", "text":
	default:
		errs = append(errs, fmt.Sprintf("NEXAU_LOG_FORMAT invalid: %q", c.Log.Format))
	}

	// Payments: fail fast listing EVERY missing key (a payments deploy with
	// half its secrets must boot nowhere — docs/PAYMENT-GATEWAY.md §11).
	switch c.Payments.Provider {
	case "":
		c.Payments.Provider = "disabled"
	case "disabled", "mock":
		// no secrets required (mock uses fixed dev values)
	case "razorpay":
		if c.Payments.RazorpayKeyID == "" {
			errs = append(errs, "NEXAU_RAZORPAY_KEY_ID is required when NEXAU_PAYMENT_PROVIDER=razorpay")
		}
		if c.Payments.RazorpayKeySecret == "" {
			errs = append(errs, "NEXAU_RAZORPAY_KEY_SECRET is required when NEXAU_PAYMENT_PROVIDER=razorpay")
		}
		if c.Payments.RazorpayWebhookSecret == "" {
			errs = append(errs, "NEXAU_RAZORPAY_WEBHOOK_SECRET is required when NEXAU_PAYMENT_PROVIDER=razorpay")
		}
		if !strings.HasPrefix(c.Payments.RazorpayKeyID, "rzp_") {
			errs = append(errs, "NEXAU_RAZORPAY_KEY_ID should look like rzp_test_… or rzp_live_… (Razorpay Dashboard → API Keys)")
		}
	default:
		errs = append(errs, fmt.Sprintf("NEXAU_PAYMENT_PROVIDER must be disabled|mock|razorpay, got %q", c.Payments.Provider))
	}
	if c.Payments.OrderTTL < time.Minute {
		errs = append(errs, "NEXAU_PAYMENT_ORDER_TTL must be ≥1m")
	}
	if c.Payments.SweepInterval < 5*time.Second {
		errs = append(errs, "NEXAU_PAYMENT_SWEEP_INTERVAL must be ≥5s")
	}

	if c.OTel.TraceRatio < 0 || c.OTel.TraceRatio > 1 {
		errs = append(errs, "NEXAU_OTEL_TRACE_RATIO must be within [0,1]")
	}
	if c.Meter.QueueSize < 64 {
		errs = append(errs, "NEXAU_METER_QUEUE_SIZE must be ≥64")
	}
	if c.Meter.BatchSize < 1 {
		errs = append(errs, "NEXAU_METER_BATCH_SIZE must be ≥1")
	}
	if c.StreamIdleTimeout < 5*time.Second {
		errs = append(errs, "NEXAU_STREAM_IDLE_TIMEOUT must be ≥5s")
	}
	if c.StreamMaxDuration <= c.StreamIdleTimeout {
		errs = append(errs, "NEXAU_STREAM_MAX_DURATION must exceed STREAM_IDLE_TIMEOUT")
	}
	if c.BifrostReqTimeout < 5*time.Second {
		errs = append(errs, "NEXAU_BIFROST_REQUEST_TIMEOUT must be ≥5s")
	}
	if c.StreamHeartbeatInterval < time.Second {
		errs = append(errs, "NEXAU_STREAM_HEARTBEAT_INTERVAL must be ≥1s")
	}
	if c.StreamWriteDeadline < time.Second {
		errs = append(errs, "NEXAU_STREAM_WRITE_DEADLINE must be ≥1s")
	}
	if c.Auth.AccessTokenTTL < time.Minute {
		errs = append(errs, "NEXAU_AUTH_ACCESS_TOKEN_TTL must be ≥1m")
	}
	if c.DBMaxConns < c.DBMinConns {
		errs = append(errs, "NEXAU_DB_MAX_CONNS must be ≥ MIN_CONNS")
	}
	if c.Rate.SlotTimeout < time.Minute {
		errs = append(errs, "NEXAU_RATE_CONCURRENCY_TIMEOUT must be ≥1m")
	}

	// Google OAuth wiring sanity (only meaningful when fully configured).
	googleOn := c.Auth.GoogleClientID != "" && c.Auth.GoogleClientSecret != "" && c.Auth.GoogleRedirectURL != ""
	if googleOn {
		if c.Auth.WebSuccessURL == "" {
			errs = append(errs, "NEXAU_AUTH_WEB_SUCCESS_URL is required when Google sign-in is enabled")
		}
	}
	if c.Auth.DesktopCodeTTL < 10*time.Second || c.Auth.DesktopCodeTTL > 10*time.Minute {
		errs = append(errs, "NEXAU_AUTH_DESKTOP_CODE_TTL must be within [10s,10m]")
	}
	if c.Auth.WebSessionTTL < time.Minute || c.Auth.WebSessionTTL > time.Hour {
		errs = append(errs, "NEXAU_AUTH_WEB_SESSION_TTL must be within [1m,1h]")
	}
	if c.Auth.WebGrantTTL < time.Minute || c.Auth.WebGrantTTL > 15*time.Minute {
		errs = append(errs, "NEXAU_AUTH_WEB_GRANT_TTL must be within [1m,15m]")
	}
	if c.Auth.OAuthStateTTL < time.Minute || c.Auth.OAuthStateTTL > time.Hour {
		errs = append(errs, "NEXAU_AUTH_OAUTH_STATE_TTL must be within [1m,1h]")
	}

	// URL-shape validation: every connection URL is env-driven (operators
	// repoint them between prod/staging/test WITHOUT code changes), so a
	// typo must fail at BOOT with the exact key named — not at first
	// request with a confusing transport error.
	for _, u := range []struct{ key, val string }{
		{"NEXAU_AUTH_GOOGLE_AUTH_URL", c.Auth.GoogleAuthURL},
		{"NEXAU_AUTH_GOOGLE_TOKEN_URL", c.Auth.GoogleTokenURL},
		{"NEXAU_AUTH_GOOGLE_JWKS_URL", c.Auth.GoogleJWKSURL},
		{"NEXAU_AUTH_GOOGLE_REDIRECT_URL", c.Auth.GoogleRedirectURL},
		{"NEXAU_AUTH_WEB_SUCCESS_URL", c.Auth.WebSuccessURL},
		{"NEXAU_AUTH_WEB_LOGIN_URL", c.Auth.WebLoginURL},
		{"NEXAU_BIFROST_URL", c.Bifrost.BaseURL},
		{"NEXAU_BIFROST_HEALTH_URL", c.Bifrost.HealthURL},
		{"NEXAU_RAZORPAY_API_BASE", c.Payments.RazorpayAPIBase},
		{"NEXAU_OTEL_TRACE_ENDPOINT", c.OTel.TraceEndpoint},
		{"NEXAU_OTEL_METRIC_ENDPOINT", c.OTel.MetricEndpoint},
	} {
		if u.val != "" && !validHTTPURL(u.val) {
			errs = append(errs, fmt.Sprintf("%s must be an absolute http(s) URL, got %q", u.key, u.val))
		}
	}

	// Google issuers: trimmed, de-duplicated, bounded (the map is probed
	// per login; a runaway list is a misconfiguration).
	if iss := normalizeIssuers(c.Auth.GoogleIssuers); len(iss) > 0 {
		c.Auth.GoogleIssuers = iss
	} else {
		errs = append(errs, "NEXAU_AUTH_GOOGLE_ISSUERS must list at least one issuer")
	}

	// Quota reservation bounds.
	if c.Quota.ReserveEnabled {
		if c.Quota.ReserveMaxTokens < c.Quota.ReserveMinTokens {
			errs = append(errs, "NEXAU_QUOTA_RESERVE_MAX_TOKENS must be ≥ MIN_TOKENS")
		}
		if c.Quota.ReserveMinTokens < 1 {
			errs = append(errs, "NEXAU_QUOTA_RESERVE_MIN_TOKENS must be ≥1")
		}
		if c.Quota.ReserveTTL <= c.StreamMaxDuration {
			errs = append(errs, "NEXAU_QUOTA_RESERVE_TTL must exceed NEXAU_STREAM_MAX_DURATION (crash backstop)")
		}
		if c.Quota.ReserveSettleDelay < 0 {
			errs = append(errs, "NEXAU_QUOTA_RESERVE_SETTLE_DELAY must be ≥0")
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("config validation failed:\n  - %s", strings.Join(errs, "\n  - "))
	}
	return nil
}

// --- env helpers (no external dependency) ---

func envStr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func envInt64(key string, def int64) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return def
	}
	return n
}

func envFloat(key string, def float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return def
	}
	return f
}

func envBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "":
		return def
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func envDur(key string, def time.Duration) time.Duration {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return def
	}
	return d
}

func envList(key string) []string {
	return envListDefault(key, nil)
}

// envListDefault reads a comma-separated list, falling back to def when unset
// or empty. A list-type knob with production defaults (e.g. Google issuers).
func envListDefault(key string, def []string) []string {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func runtimeNumCPU() int {
	n, err := strconv.Atoi(os.Getenv("GOMAXPROCS"))
	if err == nil && n > 0 {
		return n
	}
	if n := os.Getenv("NEXAU_CPU_COUNT"); n != "" {
		if v, err := strconv.Atoi(n); err == nil && v > 0 {
			return v
		}
	}
	return runtime.NumCPU()
}

// ErrNoAuthPath is a sentinel used by main.go to warn (not fail) when no
// Google OAuth is configured — no client could ever log in.
var ErrNoAuthPath = errors.New("config: google oauth not configured")

// validHTTPURL reports whether s parses as an absolute http/https URL with a
// host. Boot-time shape check for every env-driven connection URL — catches
// typos ("api.razorpay.com/v1" without a scheme) before they become runtime
// transport mysteries.
func validHTTPURL(s string) bool {
	u, err := url.Parse(s)
	if err != nil {
		return false
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// normalizeIssuers trims, de-duplicates and bounds the accepted issuer list.
func normalizeIssuers(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		if len(out) >= 8 {
			break
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
