package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestLimiter(t *testing.T, failOpen bool) (*Limiter, *miniredis.Miniredis) {
	t.Helper()
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(rdb, failOpen, nil), mr
}

func TestSlidingWindowAllowsUpToLimit(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	const limit = 3
	for i := 0; i < limit; i++ {
		v := l.Allow(ctx, "k", limit, time.Minute, member(i))
		if !v.Allowed {
			t.Fatalf("request %d must be allowed", i)
		}
	}
	if v := l.Allow(ctx, "k", limit, time.Minute, "m_extra"); v.Allowed {
		t.Fatal("request beyond the limit must be denied")
	}
}

func TestSlidingWindowDenialCarriesRetryAfter(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	for i := 0; i < 2; i++ {
		l.Allow(ctx, "k2", 2, time.Minute, member(i))
	}
	v := l.Allow(ctx, "k2", 2, time.Minute, "m")
	if v.Allowed {
		t.Fatal("must deny")
	}
	if v.RetryAfter <= 0 || v.RetryAfter > time.Minute {
		t.Fatalf("retry-after within the window: %v", v.RetryAfter)
	}
}

// TestSlidingWindowRetryAfterDirection guards audit finding 3: the denial
// Retry-After must be the REMAINING time until the oldest in-window entry
// expires (window − age), never the entry's age. The inverted formula told
// throttled clients to wait ~the full window when 1 s remained and to retry
// almost immediately when ~the whole window remained.
func TestSlidingWindowRetryAfterDirection(t *testing.T) {
	l, mr := newTestLimiter(t, true)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	ctx := context.Background()

	// Case A: the in-window entry is 59 s old → it expires in ~1 s. A
	// correct limiter advertises ~1 s.
	kA := "rl:proof:direction:a"
	if err := rdb.ZAdd(ctx, kA, redis.Z{
		Score: float64(time.Now().UnixMilli() - 59_000), Member: "seed_59s_old",
	}).Err(); err != nil {
		t.Fatal(err)
	}
	v := l.Allow(ctx, kA, 1, time.Minute, "req_new")
	if v.Allowed {
		t.Fatal("case A: must deny (window full)")
	}
	if v.RetryAfter > 3*time.Second {
		t.Fatalf("case A: RetryAfter=%v, want ~1s (oldest expires in 1s)", v.RetryAfter)
	}

	// Case B: the in-window entry is 1 s old → it expires in ~59 s. A
	// correct limiter advertises ~59 s.
	kB := "rl:proof:direction:b"
	if err := rdb.ZAdd(ctx, kB, redis.Z{
		Score: float64(time.Now().UnixMilli() - 1_000), Member: "seed_1s_old",
	}).Err(); err != nil {
		t.Fatal(err)
	}
	v = l.Allow(ctx, kB, 1, time.Minute, "req_new")
	if v.Allowed {
		t.Fatal("case B: must deny (window full)")
	}
	if v.RetryAfter < 55*time.Second {
		t.Fatalf("case B: RetryAfter=%v, want ~59s (oldest expires in 59s)", v.RetryAfter)
	}
}

func TestSlidingWindowExpires(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	// The window is computed from the CLIENT clock (ARGV), so real time must
	// pass for expiry — a short window and sleep keep the test fast.
	l.Allow(ctx, "k3", 1, 40*time.Millisecond, "m1")
	if v := l.Allow(ctx, "k3", 1, 40*time.Millisecond, "m2"); v.Allowed {
		t.Fatal("second request in window must be denied")
	}
	time.Sleep(60 * time.Millisecond)
	if v := l.Allow(ctx, "k3", 1, 40*time.Millisecond, "m3"); !v.Allowed {
		t.Fatal("window expiry must re-allow")
	}
}

func TestZeroLimitDisablesDimension(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	v := l.Allow(context.Background(), "k", 0, time.Minute, "m")
	if !v.Allowed {
		t.Fatal("limit 0 = disabled")
	}
}

func TestAllowAllStrictestWins(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	// User scope: 10; tenant scope: 1.
	v := l.AllowAll(ctx, "m0",
		Scope{Key: "u1", Limit: 10, Window: time.Minute},
		Scope{Key: "t1", Limit: 1, Window: time.Minute},
	)
	if !v.Allowed {
		t.Fatal("first request passes all scopes")
	}
	v = l.AllowAll(ctx, "m1",
		Scope{Key: "u1", Limit: 10, Window: time.Minute},
		Scope{Key: "t1", Limit: 1, Window: time.Minute},
	)
	if v.Allowed {
		t.Fatal("tenant scope (limit 1) must deny the second request")
	}
}

func TestConcurrencyAcquireRelease(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	if !l.Acquire(ctx, "conc", 2, time.Minute) {
		t.Fatal("first slot")
	}
	if !l.Acquire(ctx, "conc", 2, time.Minute) {
		t.Fatal("second slot")
	}
	if l.Acquire(ctx, "conc", 2, time.Minute) {
		t.Fatal("third slot must fail")
	}
	l.Release(ctx, "conc", time.Minute)
	if !l.Acquire(ctx, "conc", 2, time.Minute) {
		t.Fatal("released slot is claimable again")
	}
}

func TestConcurrencySlotExpires(t *testing.T) {
	l, mr := newTestLimiter(t, true)
	ctx := context.Background()
	if !l.Acquire(ctx, "conc2", 1, 60*time.Millisecond) {
		t.Fatal("slot")
	}
	// Never released (owner crash): TTL backstop reclaims it.
	mr.FastForward(80 * time.Millisecond)
	if !l.Acquire(ctx, "conc2", 1, 60*time.Millisecond) {
		t.Fatal("expired slot must be reclaimable")
	}
}

func TestReleaseFloor(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	l.Release(ctx, "never-acquired", time.Minute) // must not go negative
	if !l.Acquire(ctx, "never-acquired", 1, time.Minute) {
		t.Fatal("floor must keep the counter usable")
	}
}

func TestReconcileResetsCounter(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		l.Acquire(ctx, "r", 5, time.Minute)
	}
	l.Reconcile(ctx, "r", 1, time.Minute) // PG truth: only 1 running
	if !l.Acquire(ctx, "r", 2, time.Minute) {
		t.Fatal("counter 1 with limit 2 must admit one more run")
	}
	if l.Acquire(ctx, "r", 2, time.Minute) {
		t.Fatal("counter 2 with limit 2 must deny")
	}
}

func TestFailOpenOnRedisDown(t *testing.T) {
	l, mr := newTestLimiter(t, true)
	mr.Close() // Redis dies
	v := l.Allow(context.Background(), "k", 1, time.Minute, "m")
	if !v.Allowed {
		t.Fatal("fail-open must allow when Redis is down")
	}
}

func TestFailClosedOnRedisDown(t *testing.T) {
	l, mr := newTestLimiter(t, false)
	mr.Close()
	v := l.Allow(context.Background(), "k", 1, time.Minute, "m")
	if v.Allowed {
		t.Fatal("fail-closed must deny when Redis is down")
	}
}

func TestCountAndHit(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	if n := l.Count(ctx, "throttle", time.Minute); n != 0 {
		t.Fatalf("initial count: %d", n)
	}
	l.Hit(ctx, "throttle", time.Minute, "a")
	l.Hit(ctx, "throttle", time.Minute, "b")
	if n := l.Count(ctx, "throttle", time.Minute); n != 2 {
		t.Fatalf("count after hits: %d", n)
	}
	// Count must NOT admit.
	if n := l.Count(ctx, "throttle", time.Minute); n != 2 {
		t.Fatalf("count must not grow: %d", n)
	}
}

func member(i int) string {
	if i == 0 {
		return "m0"
	}
	return "m" + time.Now().Format("150405") + string(rune('a'+i))
}

// --- token-window reservation -------------------------------------------------

func TestReserveWithinCeiling(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	// Remaining budget 100: two reserves of 60 must not BOTH fit (the
	// exact race the reservation exists to close).
	if o := l.Reserve(ctx, "q", 60, 100, time.Minute); !o.Allowed {
		t.Fatalf("first reserve must fit: %+v", o)
	}
	if o := l.Reserve(ctx, "q", 60, 100, time.Minute); o.Allowed {
		t.Fatal("second reserve of 60 over a 100 ceiling with 60 held must be denied")
	}
	if o := l.Reserve(ctx, "q", 40, 100, time.Minute); !o.Allowed {
		t.Fatalf("exact remainder must fit: %+v", o)
	}
	if got := l.Reserved(ctx, "q"); got != 100 {
		t.Fatalf("reserved = %d, want 100", got)
	}
}

func TestReserveDenialReportsCurrentSum(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	l.Reserve(ctx, "q2", 30, 100, time.Minute)
	o := l.Reserve(ctx, "q2", 80, 100, time.Minute) // would total 110 > 100
	if o.Allowed {
		t.Fatal("must deny")
	}
	if o.Total != 30 {
		t.Fatalf("denied outcome must report the unchanged current sum 30, got %d", o.Total)
	}
}

func TestReserveReleaseCycle(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	l.Reserve(ctx, "q3", 50, 100, time.Minute)
	l.ReleaseReservation(ctx, "q3", 50, time.Minute)
	if got := l.Reserved(ctx, "q3"); got != 0 {
		t.Fatalf("reserved after release = %d, want 0", got)
	}
	// Release below zero floors at zero and deletes the key.
	l.ReleaseReservation(ctx, "q3", 999, time.Minute)
	if got := l.Reserved(ctx, "q3"); got != 0 {
		t.Fatalf("floored release = %d, want 0", got)
	}
	// Budget is spendable again after settle.
	if o := l.Reserve(ctx, "q3", 100, 100, time.Minute); !o.Allowed {
		t.Fatalf("full budget must be available after settle: %+v", o)
	}
}

func TestReserveExpiryBackstop(t *testing.T) {
	l, mr := newTestLimiter(t, true)
	ctx := context.Background()
	l.Reserve(ctx, "q4", 50, 100, 50*time.Millisecond)
	mr.FastForward(100 * time.Millisecond)
	if got := l.Reserved(ctx, "q4"); got != 0 {
		t.Fatalf("reservation must self-expire (crash backstop), got %d", got)
	}
	if o := l.Reserve(ctx, "q4", 100, 100, time.Minute); !o.Allowed {
		t.Fatalf("expired reservation must not hold budget: %+v", o)
	}
}

func TestReserveFailOpenAndClosed(t *testing.T) {
	ctx := context.Background()
	l1, mr1 := newTestLimiter(t, true)
	mr1.Close()
	if o := l1.Reserve(ctx, "q5", 50, 100, time.Minute); !o.Allowed {
		t.Fatal("fail-open limiter must allow (unreserved) when Redis is down")
	}
	l2, mr2 := newTestLimiter(t, false)
	mr2.Close()
	if o := l2.Reserve(ctx, "q5", 50, 100, time.Minute); o.Allowed {
		t.Fatal("fail-closed limiter must deny when Redis is down")
	}
}

func TestReserveZeroAmount(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()
	if o := l.Reserve(ctx, "q6", 0, 0, time.Minute); !o.Allowed {
		t.Fatal("zero amount is a no-op allow")
	}
}
