package observability

import (
	"context"
	"sync/atomic"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// ---------------------------------------------------------------------------
// Metric wrappers. Nil-safe on unconfigured telemetry: recording is a no-op,
// hot paths never pay for observability when it is disabled.
// ---------------------------------------------------------------------------

// Counter is a monotonic counter with optional attributes.
type Counter struct {
	c metric.Int64Counter
}

func NewCounter(name, desc string) *Counter {
	o := Get()
	if o == nil || o.Meter == nil {
		return &Counter{}
	}
	c, err := o.Meter.Int64Counter(name, metric.WithDescription(desc))
	if err != nil {
		return &Counter{}
	}
	return &Counter{c: c}
}

func (c *Counter) Add(ctx context.Context, n int64, attrs ...attribute.KeyValue) {
	if c == nil || c.c == nil {
		return
	}
	c.c.Add(ctx, n, metric.WithAttributes(attrs...))
}

// Histogram is a value distribution (latencies, sizes).
type Histogram struct {
	h metric.Int64Histogram
}

func NewHistogram(name, desc string, buckets ...float64) *Histogram {
	o := Get()
	if o == nil || o.Meter == nil {
		return &Histogram{}
	}
	opts := []metric.Int64HistogramOption{metric.WithDescription(desc)}
	if len(buckets) > 0 {
		opts = append(opts, metric.WithExplicitBucketBoundaries(buckets...))
	}
	h, err := o.Meter.Int64Histogram(name, opts...)
	if err != nil {
		return &Histogram{}
	}
	return &Histogram{h: h}
}

func (h *Histogram) Record(ctx context.Context, v int64, attrs ...attribute.KeyValue) {
	if h == nil || h.h == nil {
		return
	}
	h.h.Record(ctx, v, metric.WithAttributes(attrs...))
}

// Gauge is an up-down value backed by an observable gauge holding a pointer.
type Gauge struct {
	v atomic.Int64
	g metric.Int64Gauge
}

func NewGauge(name, desc string) *Gauge {
	gg := &Gauge{}
	o := Get()
	if o == nil || o.Meter == nil {
		return gg
	}
	g, err := o.Meter.Int64Gauge(name, metric.WithDescription(desc))
	if err != nil {
		return gg
	}
	gg.g = g
	return gg
}

func (g *Gauge) Set(v int64) {
	if g == nil {
		return
	}
	g.v.Store(v)
}

func (g *Gauge) Add(delta int64) int64 {
	if g == nil {
		return 0
	}
	return g.v.Add(delta)
}

// Observe pushes the current value into the metric pipeline. Call cheaply and
// periodically (e.g. from a sampler goroutine) — not per request.
func (g *Gauge) Observe(ctx context.Context) {
	if g == nil || g.g == nil {
		return
	}
	g.g.Record(ctx, g.v.Load())
}

// Attribute helpers keep call sites terse.
func Attr(k, v string) attribute.KeyValue { return attribute.String(k, v) }

// Metrics is the central instrument registry. Fields are nil-safe wrappers.
type Metrics struct {
	HTTPRequests           *Counter   // http.requests{route,status,method}
	HTTPDurationMS         *Histogram // http.duration_ms{route}
	ActiveRequests         *Gauge     // http.active_requests
	ActiveStreams          *Gauge     // stream.active
	EventsForwarded        *Counter   // stream.events_forwarded{type}
	CallsCompleted         *Counter   // llm.calls_completed{status}
	BifrostRequests        *Counter   // bifrost.requests{status}
	BifrostDurationMS      *Histogram // bifrost.duration_ms
	BifrostStreamEvents    *Counter   // bifrost.stream_chunks
	BifrostBreakerState    *Gauge     // bifrost.breaker_state (0 closed, 1 half-open, 2 open)
	BifrostBreakerTrips    *Counter   // bifrost.breaker_trips{reason}
	BifrostBreakerRejected *Counter   // bifrost.breaker_rejected{state}
	UsageTokensIn          *Counter   // usage.tokens_in{model}
	UsageTokensOut         *Counter   // usage.tokens_out{model}
	UsageDropped           *Counter   // usage.dropped{reason}
	RateLimited            *Counter   // ratelimit.rejected{scope}
	RateLimitFailOpen      *Counter   // ratelimit.fail_open
	QuotaGateFails         *Counter   // quota.gate_fails (usage-store failure, failed open)
	QuotaRejected          *Counter   // quota.rejected (WINDOW_QUOTA_EXCEEDED)
	IdempotencyHits        *Counter   // idempotency.hits{outcome}
	MeterQueueDepth        *Gauge     // meter.queue_depth
	MeterBatchLatencyMS    *Histogram // meter.batch_latency_ms
	RedisOps               *Counter   // redis.commands{op,status}
	PoolSaturation         *Gauge     // pg.pool_saturation_pct
	PaymentOrders          *Counter   // payment.orders{provider,event,status}
	PaymentCredits         *Counter   // payment.credits_applied{provider}
	PaymentWebhooks        *Counter   // payment.webhooks{outcome,event}
}

// NewMetrics builds all instruments from the global provider.
func NewMetrics() *Metrics {
	latencyBuckets := []float64{1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000}
	return &Metrics{
		HTTPRequests:           NewCounter("mash_http_requests_total", "HTTP requests by route/status/method"),
		HTTPDurationMS:         NewHistogram("mash_http_duration_ms", "HTTP request duration in ms", latencyBuckets...),
		ActiveRequests:         NewGauge("mash_http_active_requests", "In-flight HTTP requests"),
		ActiveStreams:          NewGauge("mash_stream_active", "Active LLM event streams"),
		EventsForwarded:        NewCounter("mash_stream_events_forwarded_total", "Events delivered to clients by type"),
		CallsCompleted:         NewCounter("mash_llm_calls_total", "LLM calls completed by status"),
		BifrostRequests:        NewCounter("mash_bifrost_requests_total", "Bifrost upstream requests by status"),
		BifrostDurationMS:      NewHistogram("mash_bifrost_duration_ms", "Bifrost upstream call duration in ms", latencyBuckets...),
		BifrostStreamEvents:    NewCounter("mash_bifrost_stream_chunks_total", "Bifrost SSE chunks consumed"),
		BifrostBreakerState:    NewGauge("mash_bifrost_breaker_state", "Bifrost circuit breaker state (0 closed, 1 half-open, 2 open)"),
		BifrostBreakerTrips:    NewCounter("mash_bifrost_breaker_trips_total", "Bifrost circuit breaker trips by reason"),
		BifrostBreakerRejected: NewCounter("mash_bifrost_breaker_rejected_total", "Bifrost calls fast-failed by the open circuit breaker"),
		UsageTokensIn:          NewCounter("mash_usage_input_tokens_total", "Authoritative input tokens metered"),
		UsageTokensOut:         NewCounter("mash_usage_output_tokens_total", "Authoritative output tokens metered"),
		UsageDropped:           NewCounter("mash_usage_dropped_total", "Usage records dropped by reason"),
		RateLimited:            NewCounter("mash_ratelimit_rejected_total", "Requests rejected by rate limiter"),
		RateLimitFailOpen:      NewCounter("mash_ratelimit_failopen_total", "Rate limiter fail-open events (Redis unavailable)"),
		QuotaGateFails:         NewCounter("mash_quota_gate_fails_total", "Window-quota gate usage-store failures (failed open)"),
		QuotaRejected:          NewCounter("mash_quota_rejected_total", "LLM calls rejected: rolling token window quota exceeded"),
		MeterQueueDepth:        NewGauge("mash_meter_queue_depth", "Usage recorder queue depth"),
		MeterBatchLatencyMS:    NewHistogram("mash_meter_batch_latency_ms", "Usage batch flush duration ms", latencyBuckets...),

		RedisOps:        NewCounter("mash_redis_commands_total", "Redis commands by op/status"),
		PoolSaturation:  NewGauge("mash_pg_pool_saturation_pct", "PostgreSQL pool saturation percentage"),
		PaymentOrders:   NewCounter("mash_payment_orders_total", "Payment orders by provider/event/status"),
		PaymentCredits:  NewCounter("mash_payment_credits_applied_total", "Credits minted by provider"),
		PaymentWebhooks: NewCounter("mash_payment_webhooks_total", "Webhook outcomes by event type"),
	}
}
