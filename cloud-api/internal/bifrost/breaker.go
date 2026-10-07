package bifrost

// breaker.go — upstream circuit breaker for the Bifrost gateway path.
//
// Failure model (what the breaker protects against):
// the GATEWAY dying or stalling — connection failures, dial timeouts,
// 5xx/408 statuses, mid-stream termination. Provider-level quality issues
// (4xx validation, 429 throttling, in-band BifrostError payloads riding a
// healthy 200 SSE stream) prove the gateway is alive and are recorded as
// successes; the breaker must not trip on them.
//
// States:
//
//	CLOSED     — traffic flows. Two independent trip conditions:
//	              (a) >= ConsecutiveFailures hard failures back-to-back
//	              (b) failure rate over the last WindowSize outcomes
//	                  >= FailureRate once at least MinSamples exist
//	OPEN       — all calls fast-fail with UPSTREAM_CIRCUIT_OPEN (503 +
//	              retry_after_ms). Cooldown grows exponentially per
//	              repeated trip, capped at OpenMax. Results of calls that
//	              were already in flight when the trip happened are
//	              ignored (they belong to the batch that caused it).
//	HALF-OPEN  — after the cooldown elapses, up to HalfOpenProbes
//	              concurrent probes are admitted; everything else still
//	              fast-fails. First probe success closes the circuit
//	              (all counters reset, cooldown backoff resets); a probe
//	              failure re-opens it with grown cooldown. If the probe
//	              window itself elapses without resolution, a fresh probe
//	              generation is admitted — forward progress is guaranteed
//	              even with hung probes (which are themselves bounded by
//	              the stream watchdogs and duration caps).
//
// Concurrency: one mutex; the critical sections are a handful of integer
// operations — negligible next to the network I/O they guard. State is
// per-process (per replica): each replica opens and recovers independently,
// which is the standard deployment shape for in-process breakers.
//
// Observability: mash_bifrost_breaker_state gauge (0 closed, 1 half-open,
// 2 open), mash_bifrost_breaker_trips_total{reason} and
// mash_bifrost_breaker_rejected_total{state} counters. The state is also
// surfaced through GET /health/ready (informational, never readiness-gating).

import (
	"context"
	"sync"
	"time"

	"github.com/mash-cloud/mash-api/internal/observability"
)

type cbState int32

const (
	cbClosed cbState = iota
	cbHalfOpen
	cbOpen
)

// CircuitBreakerConfig configures the upstream circuit breaker. The zero
// value is DISABLED — production defaults come from config.Load; tests and
// the validation harness set explicit values.
type CircuitBreakerConfig struct {
	Enabled             bool          // master switch
	ConsecutiveFailures int           // trip after N consecutive hard failures
	WindowSize          int           // sliding window (last N outcomes) for the rate trip
	MinSamples          int           // minimum window samples before the rate trip applies
	FailureRate         float64       // trip when failures/samples >= rate (0..1]
	OpenBase            time.Duration // first open cooldown
	OpenMax             time.Duration // cooldown cap across repeated trips
	HalfOpenProbes      int           // concurrent probes admitted in half-open
}

// Deployment defaults (env-overridable in config.Load).
const (
	cbDefaultConsecutive = 10
	cbDefaultWindow      = 60
	cbDefaultMinSamples  = 30
	cbDefaultRate        = 0.60
	cbDefaultOpenBase    = 30 * time.Second
	cbDefaultOpenMax     = 5 * time.Minute
	cbDefaultProbes      = 3
)

// withDefaults fills zero/negative fields with deployment defaults. It does
// not enable a disabled breaker.
func (c CircuitBreakerConfig) withDefaults() CircuitBreakerConfig {
	if c.ConsecutiveFailures <= 0 {
		c.ConsecutiveFailures = cbDefaultConsecutive
	}
	if c.WindowSize <= 0 {
		c.WindowSize = cbDefaultWindow
	}
	if c.MinSamples <= 0 {
		c.MinSamples = cbDefaultMinSamples
	}
	if c.FailureRate <= 0 || c.FailureRate > 1 {
		c.FailureRate = cbDefaultRate
	}
	if c.OpenBase <= 0 {
		c.OpenBase = cbDefaultOpenBase
	}
	if c.OpenMax < c.OpenBase {
		c.OpenMax = cbDefaultOpenMax
	}
	if c.HalfOpenProbes <= 0 {
		c.HalfOpenProbes = cbDefaultProbes
	}
	return c
}

// circuitBreaker is safe for concurrent use.
type circuitBreaker struct {
	mu        sync.Mutex
	cfg       CircuitBreakerConfig
	state     cbState
	consec    int // consecutive hard failures (closed state)
	ring      []bool
	ringN     int // filled slots
	ringF     int // failures inside the ring
	ringIdx   int // next write slot
	openUntil time.Time
	trips     int // consecutive trips without a successful close (backoff growth)
	probes    int // in-flight half-open probes
	now       func() time.Time

	metrics *observability.Metrics
}

func newCircuitBreaker(cfg CircuitBreakerConfig, m *observability.Metrics) *circuitBreaker {
	if !cfg.Enabled {
		return &circuitBreaker{cfg: cfg, state: cbClosed, now: time.Now, metrics: m}
	}
	cfg = cfg.withDefaults()
	cb := &circuitBreaker{
		cfg: cfg, state: cbClosed, now: time.Now, metrics: m,
		ring: make([]bool, cfg.WindowSize),
	}
	cb.observeState()
	return cb
}

// allow reports whether a call may proceed. When denied it returns the
// cooldown hint for the caller's Retry-After.
func (cb *circuitBreaker) allow() (bool, time.Duration) {
	if cb == nil || !cb.cfg.Enabled {
		return true, 0
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case cbClosed:
		return true, 0

	case cbOpen:
		now := cb.now()
		if now.Before(cb.openUntil) {
			return false, cb.openUntil.Sub(now)
		}
		// Cooldown elapsed: half-open. This caller becomes the first probe
		// of a fresh generation with its own bounded probe window.
		cb.setStateLocked(cbHalfOpen)
		cb.probes = 1
		cb.openUntil = now.Add(cb.probeWindow())
		return true, 0

	default: // half-open
		now := cb.now()
		if now.After(cb.openUntil) {
			// Probe window elapsed without resolution (hung probes are
			// bounded by stream watchdogs; do not stall recovery).
			cb.probes = 0
			cb.openUntil = now.Add(cb.probeWindow())
		}
		if cb.probes < cb.cfg.HalfOpenProbes {
			cb.probes++
			return true, 0
		}
		rem := time.Duration(0)
		if r := cb.openUntil.Sub(now); r > 0 {
			rem = r
		}
		return false, rem
	}
}

// recordStatus folds an upstream HTTP status into the breaker: 5xx and 408
// are gateway faults; every other 4xx proves the gateway is alive.
func (cb *circuitBreaker) recordStatus(status int) {
	if status >= 500 || status == 408 {
		cb.recordFailure()
		return
	}
	cb.recordSuccess()
}

func (cb *circuitBreaker) recordFailure() {
	if cb == nil || !cb.cfg.Enabled {
		return
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case cbClosed:
		cb.consec++
		cb.pushRingLocked(true)
		if cb.consec >= cb.cfg.ConsecutiveFailures {
			cb.tripLocked("consecutive")
			return
		}
		if cb.ringN >= cb.cfg.MinSamples &&
			float64(cb.ringF) >= cb.cfg.FailureRate*float64(cb.ringN) {
			cb.tripLocked("rate")
		}
	case cbHalfOpen:
		cb.probes = maxZero(cb.probes - 1)
		cb.tripLocked("half_open_probe")
	}
	// cbOpen: late result of an in-flight call that predates the trip —
	// it belongs to the batch that caused it. Ignore.
}

func (cb *circuitBreaker) recordSuccess() {
	if cb == nil || !cb.cfg.Enabled {
		return
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case cbClosed:
		cb.consec = 0
		cb.pushRingLocked(false)
	case cbHalfOpen:
		cb.probes = maxZero(cb.probes - 1)
		cb.closeLocked()
	}
	// cbOpen: same as recordFailure — pre-trip in-flight call. Ignore.
}

// stateName is the ops-facing state string ("disabled" when off).
func (cb *circuitBreaker) stateName() string {
	if cb == nil || !cb.cfg.Enabled {
		return "disabled"
	}
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.state.String()
}

func (s cbState) String() string {
	switch s {
	case cbClosed:
		return "closed"
	case cbHalfOpen:
		return "half_open"
	default:
		return "open"
	}
}

// --- internals ---------------------------------------------------------------

// probeWindow bounds how long a half-open generation may run without
// resolution before a fresh one is admitted.
func (cb *circuitBreaker) probeWindow() time.Duration {
	return cb.cfg.OpenBase
}

// cooldownFor computes the open cooldown for trip number n (1-based):
// OpenBase doubling per repeated trip, saturating at OpenMax.
func (cb *circuitBreaker) cooldownFor(trips int) time.Duration {
	d := cb.cfg.OpenBase
	for i := 1; i < trips; i++ {
		if d >= cb.cfg.OpenMax || d > cb.cfg.OpenMax/2 {
			return cb.cfg.OpenMax
		}
		d *= 2
	}
	if d > cb.cfg.OpenMax {
		return cb.cfg.OpenMax
	}
	return d
}

func (cb *circuitBreaker) tripLocked(reason string) {
	cb.state = cbOpen
	cb.trips++
	cb.openUntil = cb.now().Add(cb.cooldownFor(cb.trips))
	cb.consec = 0
	cb.probes = 0
	cb.clearRingLocked()
	if cb.metrics != nil {
		cb.metrics.BifrostBreakerTrips.Add(context.Background(), 1,
			observability.Attr("reason", reason))
	}
	cb.observeStateLocked()
}

func (cb *circuitBreaker) closeLocked() {
	cb.state = cbClosed
	cb.trips = 0 // backoff resets after a proven recovery
	cb.consec = 0
	cb.probes = 0
	cb.clearRingLocked()
	cb.observeStateLocked()
}

func (cb *circuitBreaker) setStateLocked(s cbState) {
	cb.state = s
	cb.observeStateLocked()
}

func (cb *circuitBreaker) pushRingLocked(failed bool) {
	if len(cb.ring) == 0 {
		return
	}
	if cb.ringN == len(cb.ring) {
		// Ring full: evict the oldest verdict.
		if cb.ring[cb.ringIdx] {
			cb.ringF--
		}
	} else {
		cb.ringN++
	}
	cb.ring[cb.ringIdx] = failed
	if failed {
		cb.ringF++
	}
	cb.ringIdx = (cb.ringIdx + 1) % len(cb.ring)
}

func (cb *circuitBreaker) clearRingLocked() {
	cb.ringN, cb.ringF, cb.ringIdx = 0, 0, 0
	for i := range cb.ring {
		cb.ring[i] = false
	}
}

// observeState publishes the gauge (0 closed, 1 half-open, 2 open).
func (cb *circuitBreaker) observeState() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.observeStateLocked()
}

func (cb *circuitBreaker) observeStateLocked() {
	if cb.metrics == nil {
		return
	}
	cb.metrics.BifrostBreakerState.Set(int64(cb.state))
}

// noteRejected counts one fast-fail rejection.
func (cb *circuitBreaker) noteRejected() {
	if cb == nil || cb.metrics == nil {
		return
	}
	cb.metrics.BifrostBreakerRejected.Add(context.Background(), 1,
		observability.Attr("state", cb.stateName()))
}

func maxZero(n int) int {
	if n < 0 {
		return 0
	}
	return n
}
