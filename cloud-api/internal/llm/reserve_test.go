package llm

// In-flight window reservation tests: the concurrent-overshoot race in the
// rolling plan windows and its fix. The race (pre-fix): the window gate reads
// llm_calls (completed usage only); two admits in parallel each see the same
// position, both pass, both run — collective overshoot. The fix: every
// admitted call atomically reserves an estimate against the REMAINING budget,
// so the second concurrent admit is denied until the first settles.

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/bifrost"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ratelimit"
)

// fakeUsage pins the window position (the DB truth) for a test.
type fakeUsage struct {
	pos domain.WindowUsage
}

func (f *fakeUsage) WindowUsage(ctx context.Context, tenantID string) (*domain.WindowUsage, error) {
	c := f.pos
	return &c, nil
}

func (f *fakeUsage) WindowRecovery(ctx context.Context, tenantID string, window time.Duration, quota, used int64) (*time.Time, error) {
	return nil, nil
}

// testIdentity builds an active Free-like identity with the given windows.
func testIdentity(window5h, weekly int64) *auth.Identity {
	return &auth.Identity{
		User:               auth.UserInfo{ID: "usr_test", Status: "active", Email: "t@example.test"},
		Tenant:             auth.TenantInfo{ID: "tnt_test", Status: "active"},
		Membership:         auth.MembershipInfo{Role: "owner", Status: "active"},
		SubscriptionStatus: "active",
		Limits: auth.Limits{
			Window5hTokens:           window5h,
			WindowWeeklyTokens:       weekly,
			ConcurrentRequestsUser:   100,
			ConcurrentRequestsTenant: 100,
			RequestsPerMinuteUser:    1000,
			RequestsPerMinuteTenant:  1000,
		},
	}
}

func testMessages() []bifrost.Message {
	return []bifrost.Message{{Role: "user", Content: json.RawMessage(`"hello"`)}}
}

func testRequest(t *testing.T) *Request {
	t.Helper()
	return &Request{
		Model:    "openai/gpt-4o",
		Messages: testMessages(),
	}
}

// newTestProxy wires a proxy against miniredis with the given reserve config.
func newTestProxy(t *testing.T, usage *fakeUsage, reserve ReserveConfig) (*Proxy, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	lim := ratelimit.New(rdb, true, nil)
	p := &Proxy{
		Limiter: lim,
		Usage:   usage,
		Limits:  Limits{MaxMessages: 16, MaxTools: 8, MaxModelLen: 128},
		Rate:    RateRules{RPMUser: 1000, RPMTenant: 1000, ConcUser: 100, ConcTenant: 100},
		SlotTTL: time.Minute,
		Reserve: reserve,
	}
	return p, mr
}

// TestReservationBlocksConcurrentOvershoot is the headline proof: with the
// reservation on, two admits that each fit the window ALONE cannot both be
// admitted while the first is still in flight — the exact collective-overshoot
// race. With the reservation off (the pre-fix behavior), both sail through.
func TestReservationBlocksConcurrentOvershoot(t *testing.T) {
	quota := int64(10_000)
	// Force the estimate to 6_000 (clamp to [min, max]).
	reserve := ReserveConfig{
		Enabled: true, MinTokens: 6_000, MaxTokens: 6_000, DefaultOut: 6_000,
		TTL: time.Minute, SettleDelay: 50 * time.Millisecond,
	}

	t.Run("reservation on: second in-flight admit denied", func(t *testing.T) {
		used := &fakeUsage{pos: domain.WindowUsage{Used5h: 0, UsedWeekly: 0}}
		p, _ := newTestProxy(t, used, reserve)
		idn := testIdentity(quota, quota*10)
		ctx := context.Background()

		rel1, res1, de := p.admit(ctx, idn, testRequest(t))
		if de != nil {
			t.Fatalf("first admit: %v", de)
		}
		if res1 == nil {
			t.Fatal("first admit must carry a reservation")
		}
		defer rel1()

		_, _, de2 := p.admit(ctx, idn, testRequest(t))
		if de2 == nil {
			t.Fatal("second concurrent admit must be denied: 6k held + 6k wanted > 10k quota")
		}
		if de2.Code != "WINDOW_QUOTA_EXCEEDED" {
			t.Fatalf("denied code = %s, want WINDOW_QUOTA_EXCEEDED", de2.Code)
		}
		if de2.Details["in_flight"] != true {
			t.Fatalf("denial must carry in_flight=true, got %v", de2.Details["in_flight"])
		}
		if rt, _ := de2.Details["reserved_tokens"].(int64); rt != 6_000 {
			t.Fatalf("denial must report reserved_tokens=6000, got %v", de2.Details["reserved_tokens"])
		}
	})

	t.Run("reservation off: the pre-fix race (documented)", func(t *testing.T) {
		off := reserve
		off.Enabled = false
		used := &fakeUsage{pos: domain.WindowUsage{Used5h: 0, UsedWeekly: 0}}
		p, _ := newTestProxy(t, used, off)
		idn := testIdentity(quota, quota*10)
		ctx := context.Background()

		for i := 0; i < 3; i++ {
			rel, _, de := p.admit(ctx, idn, testRequest(t))
			if de != nil {
				t.Fatalf("admit %d with reservation disabled: %v", i, de)
			}
			defer rel()
		}
		// All three fit — 18k of estimates against a 10k window. This is the
		// collective overshoot the reservation exists to prevent.
	})
}

// TestReservationSettleReleasesBudget: settling a call returns its budget —
// failed calls (no usage) immediately, completed calls after the SettleDelay
// that covers the async metering flush.
func TestReservationSettleReleasesBudget(t *testing.T) {
	reserve := ReserveConfig{
		Enabled: true, MinTokens: 6_000, MaxTokens: 6_000, DefaultOut: 6_000,
		TTL: time.Minute, SettleDelay: 60 * time.Millisecond,
	}
	used := &fakeUsage{pos: domain.WindowUsage{Used5h: 0, UsedWeekly: 0}}
	p, _ := newTestProxy(t, used, reserve)
	idn := testIdentity(10_000, 100_000)
	ctx := context.Background()

	// Call 1 completes with usage → delayed release.
	_, res1, de := p.admit(ctx, idn, testRequest(t))
	if de != nil {
		t.Fatalf("admit 1: %v", de)
	}
	p.settleReservation(res1, true) // completed: usage will land in llm_calls
	if got := p.Limiter.Reserved(ctx, ReservationKey5h(idn.Tenant.ID)); got != 6_000 {
		t.Fatalf("reservation must be held through the metering lag, got %d", got)
	}
	time.Sleep(120 * time.Millisecond)
	if got := p.Limiter.Reserved(ctx, ReservationKey5h(idn.Tenant.ID)); got != 0 {
		t.Fatalf("reservation must release after SettleDelay, got %d", got)
	}

	// Call 2 fails without usage → immediate release.
	_, res2, de := p.admit(ctx, idn, testRequest(t))
	if de != nil {
		t.Fatalf("admit 2: %v", de)
	}
	p.settleReservation(res2, false)
	if got := p.Limiter.Reserved(ctx, ReservationKey5h(idn.Tenant.ID)); got != 0 {
		t.Fatalf("failed call must release immediately, got %d", got)
	}

	// Budget fully spendable again.
	if _, _, de := p.admit(ctx, idn, testRequest(t)); de != nil {
		t.Fatalf("admit 3 after settles: %v", de)
	}
}

// TestReservationRollsBack5hOnWeeklyDenial: a weekly denial must return the
// 5h claim to the pool (all-or-nothing).
func TestReservationRollsBack5hOnWeeklyDenial(t *testing.T) {
	reserve := ReserveConfig{
		Enabled: true, MinTokens: 6_000, MaxTokens: 6_000, DefaultOut: 6_000,
		TTL: time.Minute, SettleDelay: 0,
	}
	// 5h has room (10k), weekly does not (5k quota, 0 used → 5k remaining < 6k).
	used := &fakeUsage{pos: domain.WindowUsage{Used5h: 0, UsedWeekly: 0}}
	p, _ := newTestProxy(t, used, reserve)
	idn := testIdentity(10_000, 5_000)
	ctx := context.Background()

	rel, res, de := p.admit(ctx, idn, testRequest(t))
	if de == nil {
		rel()
		t.Fatal("admit must be denied on the weekly window")
	}
	if de.Details["window"] != "weekly" {
		t.Fatalf("denied window = %v, want weekly", de.Details["window"])
	}
	_ = res
	if got := p.Limiter.Reserved(ctx, ReservationKey5h(idn.Tenant.ID)); got != 0 {
		t.Fatalf("5h claim must be rolled back on weekly denial, got %d", got)
	}
}

// TestEstimateTokensBounds: floor, ceiling, and the declared output budget.
func TestEstimateTokensBounds(t *testing.T) {
	// DefaultOut small so the FLOOR is what binds for a tiny request.
	p := &Proxy{Reserve: ReserveConfig{MinTokens: 1_000, MaxTokens: 32_000, DefaultOut: 100}}
	small := &Request{Model: "openai/gpt-4o", Messages: testMessages()}
	if got := p.estimateTokens(small); got != p.Reserve.MinTokens {
		t.Fatalf("tiny request must floor at MinTokens, got %d", got)
	}

	mt := int64(9_000)
	capped := &Request{Model: "openai/gpt-4o", Messages: testMessages(), MaxTokens: &mt}
	if got := p.estimateTokens(capped); got < 9_000 {
		t.Fatalf("declared output budget must be respected (≥ max_tokens), got %d", got)
	}

	huge := int64(1 << 30)
	big := &Request{Model: "openai/gpt-4o", Messages: testMessages(), MaxTokens: &huge}
	if got := p.estimateTokens(big); got != p.Reserve.MaxTokens {
		t.Fatalf("estimate must ceiling at MaxTokens, got %d", got)
	}
}

// TestReservationFailOpenOnRedisLoss: with Redis down the reservation fails
// open (allowed, unreserved) — the same availability posture as every other
// limiter dimension.
func TestReservationFailOpenOnRedisLoss(t *testing.T) {
	reserve := ReserveConfig{
		Enabled: true, MinTokens: 6_000, MaxTokens: 6_000, DefaultOut: 6_000,
		TTL: time.Minute, SettleDelay: 0,
	}
	used := &fakeUsage{pos: domain.WindowUsage{}}
	p, mr := newTestProxy(t, used, reserve)
	mr.Close() // Redis dies
	idn := testIdentity(10_000, 100_000)

	rel, _, de := p.admit(context.Background(), idn, testRequest(t))
	if de != nil {
		t.Fatalf("fail-open: admit must be allowed when Redis is down: %v", de)
	}
	rel()
}

// TestReservationRespectsExhaustedWindow: when the DB position itself is over
// quota, the hard window check fires first (unchanged behavior).
func TestReservationRespectsExhaustedWindow(t *testing.T) {
	reserve := ReserveConfig{
		Enabled: true, MinTokens: 1_000, MaxTokens: 2_000, DefaultOut: 1_000,
		TTL: time.Minute, SettleDelay: 0,
	}
	// The completed position itself is at/over quota → the HARD window check
	// fires before any reservation is attempted (unchanged behavior).
	used := &fakeUsage{pos: domain.WindowUsage{Used5h: 10_500, UsedWeekly: 0}}
	p, _ := newTestProxy(t, used, reserve)
	idn := testIdentity(10_000, 100_000)

	_, _, de := p.admit(context.Background(), idn, testRequest(t))
	if de == nil {
		t.Fatal("must be denied on the hard window check")
	}
	if de.Details["in_flight"] != nil {
		t.Fatalf("hard denial must not carry in_flight, got %v", de.Details["in_flight"])
	}
}

// TestReservationConcurrentNoOvershoot: N goroutines admit simultaneously
// against a window that fits only k of them. The atomic reserve must admit
// EXACTLY k — the pre-fix race admitted all N (every admit read the same DB
// position). This is the overshoot proof under real parallelism.
func TestReservationConcurrentNoOvershoot(t *testing.T) {
	const quota = int64(30_000)
	const est = int64(6_000) // fits exactly 5 concurrent claims
	reserve := ReserveConfig{
		Enabled: true, MinTokens: est, MaxTokens: est, DefaultOut: est,
		TTL: time.Minute, SettleDelay: time.Hour, // hold claims for the test
	}
	used := &fakeUsage{pos: domain.WindowUsage{Used5h: 0, UsedWeekly: 0}}
	p, _ := newTestProxy(t, used, reserve)
	idn := testIdentity(quota, quota*100)
	ctx := context.Background()

	const n = 40
	var admitted atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			rel, _, de := p.admit(ctx, idn, testRequest(t))
			if de == nil {
				admitted.Add(1)
				_ = rel // hold the slot; the reservation outlives it anyway
			}
		}()
	}
	close(start)
	wg.Wait()

	if got := admitted.Load(); got != 5 {
		t.Fatalf("concurrent admits = %d, want exactly 5 (quota/estimate) — overshoot race is back", got)
	}
	if got := p.Limiter.Reserved(ctx, ReservationKey5h(idn.Tenant.ID)); got != 30_000 {
		t.Fatalf("reserved sum = %d, want 30000 (5 × 6000, exactly the quota)", got)
	}
}
