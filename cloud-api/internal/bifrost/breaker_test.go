package bifrost

// breaker_test.go — exhaustive coverage of the upstream circuit breaker:
// state transitions, both trip modes, cooldown backoff growth and cap,
// half-open probe admission, recovery, failure-classification semantics at
// the client level (which HTTP outcomes count), fast-fail zero-network
// behavior, cancellation neutrality, and concurrent hammering under -race.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// newTestBreaker builds a breaker with a controllable clock.
func newTestBreaker(mut func(*CircuitBreakerConfig)) (*circuitBreaker, *fakeClock) {
	cfg := CircuitBreakerConfig{Enabled: true}
	if mut != nil {
		mut(&cfg)
	}
	cb := newCircuitBreaker(cfg, nil)
	fc := &fakeClock{t: time.Unix(1700000000, 0)}
	cb.now = fc.Now
	return cb, fc
}

type fakeClock struct{ t time.Time }

func (f *fakeClock) Now() time.Time          { return f.t }
func (f *fakeClock) Advance(d time.Duration) { f.t = f.t.Add(d) }

// ---------------------------------------------------------------- states ---

func TestCB_DisabledNeverOpens(t *testing.T) {
	cb := newCircuitBreaker(CircuitBreakerConfig{}, nil)
	for i := 0; i < 1000; i++ {
		cb.recordFailure()
	}
	if ok, _ := cb.allow(); !ok {
		t.Fatal("disabled breaker must never deny")
	}
	if got := cb.stateName(); got != "disabled" {
		t.Fatalf("state = %q, want disabled", got)
	}
}

func TestCB_ConsecutiveTripAndFastFail(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) { c.ConsecutiveFailures = 3 })

	cb.recordFailure()
	cb.recordFailure()
	if ok, _ := cb.allow(); !ok {
		t.Fatal("two failures must not trip a threshold-3 breaker")
	}
	cb.recordFailure() // third consecutive failure trips
	if ok, ra := cb.allow(); ok {
		t.Fatal("third consecutive failure must open the breaker")
	} else if ra != 30*time.Second {
		t.Fatalf("retry hint = %v, want the 30s base cooldown", ra)
	}
	if got := cb.stateName(); got != "open" {
		t.Fatalf("state = %q, want open", got)
	}
}

func TestCB_SuccessResetsConsecutive(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) { c.ConsecutiveFailures = 3 })

	cb.recordFailure()
	cb.recordFailure()
	cb.recordSuccess() // gateway answered: streak broken
	cb.recordFailure()
	cb.recordFailure()
	if ok, _ := cb.allow(); !ok {
		t.Fatal("2+1+2 pattern must not trip a threshold-3 breaker")
	}
}

func TestCB_RateTrip(t *testing.T) {
	// Window 10, min samples 5, trip at >= 50% failure rate. The rate is
	// evaluated when failures arrive (a success never trips on the past).
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1000 // consecutive mode off
		c.WindowSize = 10
		c.MinSamples = 5
		c.FailureRate = 0.5
	})

	// 4 successes, then 3 failures: 7 samples, 43% — below the threshold.
	for i := 0; i < 4; i++ {
		cb.recordSuccess()
	}
	for i := 0; i < 3; i++ {
		cb.recordFailure()
	}
	if ok, _ := cb.allow(); !ok {
		t.Fatal("43% failure rate must not trip a 50% threshold")
	}
	// The 4th failure makes it 4/8 = 50% with 8 samples >= 5 → trip.
	cb.recordFailure()
	if ok, _ := cb.allow(); ok {
		t.Fatal("50% failure rate at 8 samples must trip")
	}
}

func TestCB_RateTripRespectsMinSamples(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1000
		c.WindowSize = 10
		c.MinSamples = 5
		c.FailureRate = 0.5
	})

	// 3 failures + 1 success: 75% rate but only 4 samples < 5 → closed.
	for i := 0; i < 3; i++ {
		cb.recordFailure()
	}
	cb.recordSuccess()
	if ok, _ := cb.allow(); !ok {
		t.Fatal("below MinSamples the rate trip must not apply")
	}
}

func TestCB_HalfOpenAfterCooldown(t *testing.T) {
	cb, fc := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1
		c.OpenBase = 30 * time.Second
	})

	cb.recordFailure() // trip
	fc.Advance(29 * time.Second)
	if ok, _ := cb.allow(); ok {
		t.Fatal("still inside cooldown: must deny")
	}
	fc.Advance(2 * time.Second) // cooldown elapsed
	if ok, _ := cb.allow(); !ok {
		t.Fatal("after cooldown the first probe must be admitted")
	}
	if got := cb.stateName(); got != "half_open" {
		t.Fatalf("state = %q, want half_open", got)
	}
}

func TestCB_HalfOpenProbeConcurrencyLimit(t *testing.T) {
	cb, fc := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1
		c.HalfOpenProbes = 2
	})

	cb.recordFailure()
	fc.Advance(time.Minute)

	admitted := 0
	for i := 0; i < 5; i++ {
		if ok, _ := cb.allow(); ok {
			admitted++
		}
	}
	if admitted != 2 {
		t.Fatalf("admitted %d probes, want exactly HalfOpenProbes=2", admitted)
	}
}

func TestCB_ProbeSuccessClosesAndResetsBackoff(t *testing.T) {
	cb, fc := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1
		c.OpenBase = 10 * time.Second
		c.OpenMax = time.Hour
	})

	cb.recordFailure() // trip #1 (cooldown 10s)
	fc.Advance(15 * time.Second)
	if ok, _ := cb.allow(); !ok {
		t.Fatal("probe must be admitted after cooldown")
	}
	cb.recordSuccess() // probe succeeded → close

	if got := cb.stateName(); got != "closed" {
		t.Fatalf("state = %q, want closed", got)
	}

	// A fresh outage must start from the BASE cooldown again (backoff reset).
	cb.recordFailure() // trip #2
	fc.Advance(9 * time.Second)
	if ok, _ := cb.allow(); ok {
		t.Fatal("must still be open inside the base cooldown after a clean recovery")
	}
	fc.Advance(2 * time.Second)
	if ok, _ := cb.allow(); !ok {
		t.Fatal("base cooldown elapsed: probe admitted")
	}
}

func TestCB_ProbeFailureReopensWithGrownCooldown(t *testing.T) {
	cb, fc := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1
		c.OpenBase = 10 * time.Second
		c.OpenMax = time.Hour
	})

	cb.recordFailure() // trip #1, cooldown 10s
	fc.Advance(11 * time.Second)
	if ok, _ := cb.allow(); !ok {
		t.Fatal("probe admission expected")
	}
	cb.recordFailure() // probe failed → re-open, cooldown doubled

	fc.Advance(15 * time.Second)
	if ok, _ := cb.allow(); ok {
		t.Fatal("doubled cooldown (20s) must still deny at t+15s")
	}
	fc.Advance(6 * time.Second)
	if ok, _ := cb.allow(); !ok {
		t.Fatal("probe admitted after the doubled cooldown")
	}
}

func TestCB_CooldownBackoffCap(t *testing.T) {
	cb, fc := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 1
		c.OpenBase = 10 * time.Second
		c.OpenMax = 40 * time.Second
	})

	want := []time.Duration{10 * time.Second, 20 * time.Second, 40 * time.Second, 40 * time.Second}
	for i, w := range want {
		cb.recordFailure() // trip (probe failure in half-open counts as re-trip)
		if got := cb.cooldownFor(cb.trips); got != w {
			t.Fatalf("trip %d cooldown = %v, want %v", i+1, got, w)
		}
		fc.Advance(w + time.Second)
		if ok, _ := cb.allow(); !ok {
			t.Fatalf("trip %d: probe must be admitted after its cooldown", i+1)
		}
	}
}

func TestCB_LateInFlightResultsIgnoredWhenOpen(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) { c.ConsecutiveFailures = 1 })

	cb.recordFailure() // trip
	// A call that was in flight before the trip now completes:
	cb.recordSuccess()
	cb.recordFailure()
	if got := cb.stateName(); got != "open" {
		t.Fatalf("late results must not move an open breaker (state=%q)", got)
	}
}

func TestCB_ZeroFieldsGetDefaults(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 0 // → default 10
		c.WindowSize = 0          // → default 60
		c.FailureRate = 0         // → default 0.60
		c.OpenBase = 0            // → default 30s
		c.HalfOpenProbes = 0      // → default 3
	})
	for i := 0; i < 9; i++ {
		cb.recordFailure()
	}
	if ok, _ := cb.allow(); !ok {
		t.Fatal("9 failures must not trip the default threshold of 10")
	}
	cb.recordFailure()
	if ok, _ := cb.allow(); ok {
		t.Fatal("10 consecutive failures must trip the default threshold")
	}
}

func TestCB_ConcurrentHammer(t *testing.T) {
	cb, _ := newTestBreaker(func(c *CircuitBreakerConfig) {
		c.ConsecutiveFailures = 25
		c.WindowSize = 128
		c.MinSamples = 50
		c.FailureRate = 0.9
		c.HalfOpenProbes = 4
	})

	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(seed int) {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				cb.allow()
				if (i+seed)%3 == 0 {
					cb.recordFailure()
				} else {
					cb.recordSuccess()
				}
			}
		}(g)
	}
	wg.Wait()
	// No deadlock, no panic; state must be one of the legal names.
	switch cb.stateName() {
	case "closed", "open", "half_open":
	default:
		t.Fatalf("illegal state %q", cb.stateName())
	}
}

// ----------------------------------------------------- client integration ---

// cbTestClient builds a client with a tuned breaker against a live httptest
// upstream that counts hits and returns the scripted status.
func cbTestClient(t *testing.T, status int, cbCfg CircuitBreakerConfig) (*Client, *int64) {
	t.Helper()
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, "{}")
	}))
	t.Cleanup(srv.Close)
	cfg := TransportConfig{
		BaseURL: srv.URL, MaxRetries: 0,
		ResponseHeaderTO: 2 * time.Second, DialTimeout: time.Second,
		CircuitBreaker: cbCfg,
	}
	return NewClient(cfg, nil), &hits
}

func cbErr(t *testing.T, err error) *domain.Error {
	t.Helper()
	de, ok := err.(*domain.Error)
	if !ok {
		t.Fatalf("error is %T, want *domain.Error", err)
	}
	return de
}

func TestCB_ClientFastFailSendsNoNetwork(t *testing.T) {
	c, hits := cbTestClient(t, 503, CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 2})

	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}

	// Two hard failures trip the breaker.
	for i := 0; i < 2; i++ {
		_, err := c.Completion(ctx, req)
		if err == nil {
			t.Fatal("503 upstream must fail the call")
		}
	}
	if n := atomic.LoadInt64(hits); n != 2 {
		t.Fatalf("hits = %d, want 2", n)
	}

	// Third call: fast-fail, ZERO network.
	_, err := c.Completion(ctx, req)
	if err == nil {
		t.Fatal("open breaker must fast-fail")
	}
	de := cbErr(t, err)
	if de.Code != "UPSTREAM_CIRCUIT_OPEN" {
		t.Fatalf("code = %q, want UPSTREAM_CIRCUIT_OPEN", de.Code)
	}
	if de.HTTP != http.StatusServiceUnavailable {
		t.Fatalf("http = %d, want 503", de.HTTP)
	}
	if de.Details["retryable"] != true {
		t.Fatalf("fast-fail must be retryable: %v", de.Details)
	}
	if ms, ok := de.Details["retry_after_ms"].(int64); !ok || ms <= 0 {
		t.Fatalf("retry_after_ms missing or invalid: %v", de.Details["retry_after_ms"])
	}
	if n := atomic.LoadInt64(hits); n != 2 {
		t.Fatalf("hits = %d after fast-fail, want 2 (no network allowed while open)", n)
	}
	if got := c.CircuitState(); got != "open" {
		t.Fatalf("CircuitState = %q, want open", got)
	}
}

func TestCB_Client4xxKeepsClosed(t *testing.T) {
	// 429/404/400: the gateway is ALIVE — must never trip.
	for _, status := range []int{400, 401, 404, 409, 429} {
		c, hits := cbTestClient(t, status, CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 2})
		ctx := context.Background()
		req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}
		for i := 0; i < 6; i++ {
			_, _ = c.Completion(ctx, req)
		}
		if got := c.CircuitState(); got != "closed" {
			t.Fatalf("status %d: state = %q, want closed", status, got)
		}
		if n := atomic.LoadInt64(hits); n != 6 {
			t.Fatalf("status %d: hits = %d, want 6 (no fast-fail while healthy)", status, n)
		}
	}
}

func TestCB_Client408CountsAsFailure(t *testing.T) {
	c, _ := cbTestClient(t, 408, CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 2})
	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}
	_, _ = c.Completion(ctx, req)
	_, _ = c.Completion(ctx, req)
	if got := c.CircuitState(); got != "open" {
		t.Fatalf("408 must count as a gateway failure (state=%s)", got)
	}
}

func TestCB_ClientRecoveryEndToEnd(t *testing.T) {
	// Real clock, short cooldown: outage → open → recover → closed.
	var status atomic.Int64
	status.Store(503)
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		s := int(status.Load())
		w.WriteHeader(s)
		if s == 200 {
			_, _ = io.WriteString(w, `{"id":"x","object":"chat.completion","created":1,"model":"m","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}]}`)
		} else {
			_, _ = io.WriteString(w, `{"event_id":"e","type":"error","is_bifrost_error":true,"status_code":503,"error":{"type":"gateway_error","code":"503","message":"down"}}`)
		}
	}))
	t.Cleanup(srv.Close)

	c := NewClient(TransportConfig{
		BaseURL: srv.URL, MaxRetries: 0,
		ResponseHeaderTO: 2 * time.Second, DialTimeout: time.Second,
		CircuitBreaker: CircuitBreakerConfig{
			Enabled: true, ConsecutiveFailures: 2,
			OpenBase: 150 * time.Millisecond, OpenMax: time.Second, HalfOpenProbes: 1,
		},
	}, nil)

	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}

	_, _ = c.Completion(ctx, req)
	_, _ = c.Completion(ctx, req)
	if got := c.CircuitState(); got != "open" {
		t.Fatalf("state = %q, want open after two 503s", got)
	}

	time.Sleep(200 * time.Millisecond) // cooldown elapses
	status.Store(200)                  // gateway recovered

	resp, err := c.Completion(ctx, req) // admitted as probe, succeeds
	if err != nil {
		t.Fatalf("recovery probe failed: %v", err)
	}
	if resp == nil || len(resp.Choices) != 1 {
		t.Fatalf("unexpected completion: %+v", resp)
	}
	if got := c.CircuitState(); got != "closed" {
		t.Fatalf("state = %q after successful probe, want closed", got)
	}

	// Fully healthy again: subsequent calls flow.
	for i := 0; i < 3; i++ {
		if _, err := c.Completion(ctx, req); err != nil {
			t.Fatalf("post-recovery call %d failed: %v", i, err)
		}
	}
	if got := c.CircuitState(); got != "closed" {
		t.Fatalf("state = %q, want closed", got)
	}
}

func TestCB_ClientStreamMidstreamDropCounts(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"id\":\"c1\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"a\"}}]}\n\n")
		flusher.Flush()
		time.Sleep(50 * time.Millisecond)
		// Hard termination without [DONE]: gateway fault.
		panic(io.EOF) // httptest: aborts the connection
	}))
	t.Cleanup(srv.Close)

	c := NewClient(TransportConfig{
		BaseURL: srv.URL, MaxRetries: 0,
		ResponseHeaderTO: 2 * time.Second, DialTimeout: time.Second,
		// Threshold 1: a single mid-stream termination must count as a gateway
		// fault. (Alternating header-success/drop with threshold>1 is the rate
		// trip's job — flapping gateways are caught by the window, not the streak.)
		CircuitBreaker: CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 1},
	}, nil)

	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}, Stream: true}

	// One stream: 200 headers (success recorded), then a hard drop mid-stream.
	rd, err := c.CompletionStream(ctx, req)
	if err != nil {
		t.Fatalf("stream open failed: %v", err)
	}
	for {
		_, _, done, err := rd.Next()
		if done || err != nil {
			break
		}
	}
	rd.Close()
	if got := c.CircuitState(); got != "open" {
		t.Fatalf("mid-stream drop must count as a gateway failure (state=%q)", got)
	}

	// Next stream call: fast-fail, no network.
	before := atomic.LoadInt64(&hits)
	_, err = c.CompletionStream(ctx, req)
	if err == nil {
		t.Fatal("open breaker must fast-fail the stream path")
	}
	if de := cbErr(t, err); de.Code != "UPSTREAM_CIRCUIT_OPEN" {
		t.Fatalf("code = %q", de.Code)
	}
	if n := atomic.LoadInt64(&hits); n != before {
		t.Fatalf("hits grew %d → %d while open", before, n)
	}
}

func TestCB_ClientCancellationNeverCounts(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&hits, 1)
		// Park until the client gives up, but bounded: the real gateway has
		// its own request timeouts (Go's transport does not always close the
		// conn on caller-side ctx cancel while awaiting response headers).
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	t.Cleanup(srv.Close)

	c := NewClient(TransportConfig{
		BaseURL: srv.URL, MaxRetries: 0,
		ResponseHeaderTO: 30 * time.Second, DialTimeout: 5 * time.Second,
		CircuitBreaker: CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 1},
	}, nil)

	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}

	// Ten client-abandoned calls must NOT trip a threshold-1 breaker.
	for i := 0; i < 10; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
		_, _ = c.Completion(ctx, req)
		cancel()
	}
	if got := c.CircuitState(); got != "closed" {
		t.Fatalf("client cancellations must be breaker-neutral (state=%q)", got)
	}
}

func TestCB_InBandProviderErrorKeepsClosed(t *testing.T) {
	// A 200 SSE stream carrying an in-band BifrostError: provider problem,
	// gateway alive → breaker stays closed.
	inBand := `{"id":"cmpl_x","object":"chat.completion.chunk","model":"openai/gpt-4o","type":"error","is_bifrost_error":true,"status_code":500,"error":{"type":"provider_error","code":"500","message":"provider exploded"}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: "+inBand+"\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	t.Cleanup(srv.Close)

	c := NewClient(TransportConfig{
		BaseURL: srv.URL, MaxRetries: 0,
		ResponseHeaderTO: 2 * time.Second, DialTimeout: time.Second,
		CircuitBreaker: CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 1},
	}, nil)

	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}, Stream: true}
	for i := 0; i < 3; i++ {
		rd, err := c.CompletionStream(context.Background(), req)
		if err != nil {
			t.Fatalf("stream %d open: %v", i, err)
		}
		for {
			_, _, done, err := rd.Next()
			if done || err != nil {
				break
			}
		}
		rd.Close()
	}
	if got := c.CircuitState(); got != "closed" {
		t.Fatalf("in-band provider errors must not trip the breaker (state=%q)", got)
	}
}

func TestCB_HealthBypassesBreaker(t *testing.T) {
	c, hits := cbTestClient(t, 503, CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 1})
	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}

	_, _ = c.Completion(ctx, req) // trip
	if got := c.CircuitState(); got != "open" {
		t.Fatalf("state = %q", got)
	}

	// Health probe still performs its request (it must not be fast-failed).
	_ = c.Health(ctx)
	if n := atomic.LoadInt64(hits); n != 2 {
		t.Fatalf("hits = %d, want 2 (health probe bypasses the breaker)", n)
	}
}

func TestCB_GateErrorIsDomainError(t *testing.T) {
	c, _ := cbTestClient(t, 503, CircuitBreakerConfig{Enabled: true, ConsecutiveFailures: 1})
	ctx := context.Background()
	req := &ChatRequest{Model: "openai/gpt-4o", Messages: []Message{{Role: "user"}}}

	_, _ = c.Completion(ctx, req)
	_, err := c.Completion(ctx, req)
	de := cbErr(t, err)

	var target *domain.Error
	if !errors.As(err, &target) {
		t.Fatal("gate error must satisfy errors.As(*domain.Error)")
	}
	if de.Details["circuit"] != "open" {
		t.Fatalf("circuit detail = %v", de.Details["circuit"])
	}
	// Message hygiene: no internal leakage.
	for _, banned := range []string{"bifrost", "127.0.0.1", "sk-", "goroutine"} {
		if contains(de.Message, banned) {
			t.Fatalf("message leaks %q", banned)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
