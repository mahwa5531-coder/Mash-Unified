// Package ratelimit implements distributed rate limiting on Redis. All limits
// are enforced with atomic Lua scripts so that N API instances behind one load
// balancer share a single, consistent view. The limiter applies to logical
// requests (run creation, auth calls), never to individual stream frames.
//
// Posture: fail-open by configuration. When Redis is unreachable, requests are
// allowed (availability over strictness) and a fail-open counter is incremented
// so the incident is visible. Authorization never fails open — that is a
// PostgreSQL concern, fail-closed upstream.
package ratelimit

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/store"
)

// Verdict is the outcome of a limit check.
type Verdict struct {
	Allowed    bool
	Limit      int64
	Remaining  int64
	RetryAfter time.Duration // >0 when denied (sliding-window: full window minus head age)
}

// Limiter is safe for concurrent use.
type Limiter struct {
	rdb      redis.UniversalClient
	failOpen bool
	metrics  *observability.Metrics
}

func New(rdb redis.UniversalClient, failOpen bool, metrics *observability.Metrics) *Limiter {
	return &Limiter{rdb: rdb, failOpen: failOpen, metrics: metrics}
}

// --- sliding window ---------------------------------------------------------

// slidingWindowLua admits one request iff the number of events within the
// trailing window is below the limit. ZSET member is the unique request id.
// KEYS[1]=zset  ARGV: now_ms, window_ms, limit, member
var slidingWindowLua = redis.NewScript(`
local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local count = redis.call('ZCARD', KEYS[1])
if count < tonumber(ARGV[3]) then
        redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
        redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) + 1000)
        return {1, count + 1}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local retry = tonumber(ARGV[2])
if oldest[2] then
        -- Remaining time until the oldest (head) entry leaves the window:
        --   window - (now - oldest)
        -- NOT now - oldest (that is the entry's AGE — the exact inversion
        -- that told throttled clients to wait ~the full window when 1s
        -- remained and to retry immediately when ~the whole window
        -- remained; audit finding 3).
        local age = tonumber(ARGV[1]) - tonumber(oldest[2])
        retry = tonumber(ARGV[2]) - age + 1
        if retry < 1 then retry = 1 end
        -- Clock-skew guard (multi-instance now_ms): never advertise more
        -- than the window itself.
        if retry > tonumber(ARGV[2]) then retry = tonumber(ARGV[2]) end
end
return {0, count, retry}
`)

// Allow checks one scope. key must already be namespaced by the caller.
func (l *Limiter) Allow(ctx context.Context, key string, limit int64, window time.Duration, member string) Verdict {
	if limit <= 0 {
		return Verdict{Allowed: true} // dimension disabled
	}
	now := time.Now()
	res, err := slidingWindowLua.Run(ctx, l.rdb, []string{key},
		now.UnixMilli(), window.Milliseconds(), limit, member).Result()
	if err != nil {
		return l.degraded()
	}
	return parseVerdict(res)
}

// AllowAll checks multiple scopes in ONE Redis round trip (pipelined scripts).
// The strictest denial wins. Each scope is independent (user, tenant, ip…).
type Scope struct {
	Key    string
	Limit  int64
	Window time.Duration
}

func (l *Limiter) AllowAll(ctx context.Context, member string, scopes ...Scope) Verdict {
	verdict, needLoad := l.allowAll(ctx, member, scopes)
	if needLoad {
		// Pipelined EVALSHA cannot fall back to EVAL (errors surface only
		// after Exec), so the script is loaded explicitly and the batch retried.
		if err := slidingWindowLua.Load(ctx, l.rdb).Err(); err == nil {
			verdict, _ = l.allowAll(ctx, member, scopes)
		}
	}
	return verdict
}

func (l *Limiter) allowAll(ctx context.Context, member string, scopes []Scope) (Verdict, bool) {
	active := make([]Scope, 0, len(scopes))
	for _, s := range scopes {
		if s.Limit > 0 && s.Key != "" {
			active = append(active, s)
		}
	}
	if len(active) == 0 {
		return Verdict{Allowed: true}, false
	}

	now := time.Now().UnixMilli()
	pipe := l.rdb.Pipeline()
	cmds := make([]*redis.Cmd, 0, len(active))
	for _, s := range active {
		cmds = append(cmds, slidingWindowLua.Run(ctx, pipe, []string{s.Key},
			now, s.Window.Milliseconds(), s.Limit, member))
	}
	if _, err := pipe.Exec(ctx); err != nil && !isScriptCmdErr(cmds) {
		return l.degraded(), false
	}

	verdict := Verdict{Allowed: true}
	needLoad := false
	for i, cmd := range cmds {
		res, err := cmd.Result()
		if err != nil {
			if isNoScriptErr(err) {
				needLoad = true
				continue
			}
			if isRedisDownErr(err) {
				return l.degraded(), false
			}
			continue // single-scope script fault: be lenient on that scope
		}
		v := parseVerdict(res)
		if !v.Allowed {
			v.Limit = active[i].Limit
			verdict = v
			break
		}
		if v.Remaining < verdict.Remaining || i == 0 {
			verdict.Remaining = v.Remaining
		}
	}
	return verdict, needLoad
}

// isNoScriptErr detects the NOSCRIPT server reply (pipeline path).
func isNoScriptErr(err error) bool {
	return err != nil && strings.HasPrefix(err.Error(), "NOSCRIPT")
}

// isScriptCmdErr reports whether any pipelined command already carried its own
// error (script-level, not connection-level) — Exec returns the first error.
func isScriptCmdErr(cmds []*redis.Cmd) bool {
	for _, c := range cmds {
		if c.Err() != nil {
			return true
		}
	}
	return false
}

func isRedisDownErr(err error) bool { return store.IsRedisDown(err) }

func parseVerdict(res any) Verdict {
	arr, ok := res.([]any)
	if !ok || len(arr) == 0 {
		return Verdict{Allowed: true}
	}
	allowed, _ := arr[0].(int64)
	v := Verdict{Allowed: allowed == 1}
	if len(arr) > 1 {
		if n, ok := arr[1].(int64); ok {
			v.Remaining = n
		}
	}
	if len(arr) > 2 {
		if ms, ok := arr[2].(int64); ok && ms > 0 {
			v.RetryAfter = time.Duration(ms) * time.Millisecond
		}
	}
	return v
}

// degraded is the fail-open verdict (metric + alarm).
func (l *Limiter) degraded() Verdict {
	if l.metrics != nil {
		l.metrics.RateLimitFailOpen.Add(context.Background(), 1)
	}
	if l.failOpen {
		return Verdict{Allowed: true}
	}
	return Verdict{Allowed: false, RetryAfter: time.Second}
}

// countLua prunes and reports the window count WITHOUT admitting.
// KEYS[1]=zset  ARGV: now_ms, window_ms
var countLua = redis.NewScript(`
local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
return redis.call('ZCARD', KEYS[1])
`)

// hitLua records one event without any admission check (failure counting).
// KEYS[1]=zset  ARGV: now_ms, window_ms, member
var hitLua = redis.NewScript(`
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) + 1000)
return 1
`)

// admitLua atomically prunes the window, enforces the budget, and records
// the event in ONE round-trip. Replaces the old Count-read + Hit-write pair,
// which was a check-then-act race: a concurrent burst from one source could
// all read the pre-burst count and pass a budget un-counted (proven in
// real-infra E2E 2026-09-23: 60 concurrent signups sailed through a 30/15m
// per-IP budget). A limited request is NOT recorded — identical semantics
// to the sequential pair.
// KEYS[1]=zset  ARGV: now_ms, window_ms, member, budget
// Returns 1 = admitted (recorded), 0 = over budget (not recorded).
var admitLua = redis.NewScript(`
local cutoff = tonumber(ARGV[1]) - tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)
local n = redis.call('ZCARD', KEYS[1])
if n >= tonumber(ARGV[4]) then
        return 0
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) + 1000)
return 1
`)

// Admit atomically checks a counting-window budget and records the event
// when admitted. member MUST be unique per call (collision = undercount).
// Fail-open on Redis loss, mirroring Count's degradation.
func (l *Limiter) Admit(ctx context.Context, key string, window time.Duration, budget int, member string) bool {
	if budget <= 0 {
		return true
	}
	v, err := admitLua.Run(ctx, l.rdb, []string{key},
		time.Now().UnixMilli(), window.Milliseconds(), member, budget).Int64()
	if err != nil {
		if l.metrics != nil {
			l.metrics.RateLimitFailOpen.Add(ctx, 1)
		}
		return true
	}
	return v == 1
}

// Count reports the events currently inside the window (no admission).
func (l *Limiter) Count(ctx context.Context, key string, window time.Duration) int64 {
	n, err := countLua.Run(ctx, l.rdb, []string{key},
		time.Now().UnixMilli(), window.Milliseconds()).Int64()
	if err != nil {
		return 0 // fail-open
	}
	return n
}

// Hit records one event (e.g. a failed login) in the window.
func (l *Limiter) Hit(ctx context.Context, key string, window time.Duration, member string) {
	_, _ = hitLua.Run(ctx, l.rdb, []string{key},
		time.Now().UnixMilli(), window.Milliseconds(), member).Result()
}

// --- concurrency slots ------------------------------------------------------

// acquireLua claims a concurrency slot iff below the limit. The TTL is the
// crash-recovery backstop: a slot held by a dead instance self-expires.
// KEYS[1]=counter  ARGV: limit, ttl_ms
var acquireLua = redis.NewScript(`
local cur = redis.call('GET', KEYS[1])
if cur and tonumber(cur) >= tonumber(ARGV[1]) then
        return 0
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`)

// releaseLua returns a slot, floored at zero.
// KEYS[1]=counter  ARGV: ttl_ms
var releaseLua = redis.NewScript(`
local cur = redis.call('GET', KEYS[1])
if not cur or tonumber(cur) <= 0 then
        return 0
end
local v = redis.call('DECR', KEYS[1])
if v < 0 then
        redis.call('SET', KEYS[1], 0)
        v = 0
end
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
return v
`)

// Acquire claims a concurrency slot (bounded in-flight runs).
func (l *Limiter) Acquire(ctx context.Context, key string, limit int64, ttl time.Duration) bool {
	if limit <= 0 {
		return true // dimension disabled
	}
	res, err := acquireLua.Run(ctx, l.rdb, []string{key}, limit, ttl.Milliseconds()).Int()
	if err != nil {
		return l.degraded().Allowed
	}
	return res == 1
}

// Release returns a slot. Best-effort: failures only skew the counter until the
// TTL backstop or reconciliation corrects it.
func (l *Limiter) Release(ctx context.Context, key string, ttl time.Duration) {
	if l.rdb == nil {
		return
	}
	_, _ = releaseLua.Run(ctx, l.rdb, []string{key}, ttl.Milliseconds()).Int()
}

// Reconcile resets a counter to the authoritative value (PostgreSQL count).
// Called by the background sweeper to erase leaked slots.
func (l *Limiter) Reconcile(ctx context.Context, key string, value int64, ttl time.Duration) {
	_, _ = l.rdb.Set(ctx, key, strconv.FormatInt(value, 10), ttl).Result()
}

// --- token-window reservation ------------------------------------------------
//
// The rolling plan windows (5h / weekly) are metered from llm_calls rows,
// which exist only AFTER a call completes. Two admits that pass the window
// check concurrently therefore both see the same pre-call position and can
// collectively overshoot the window (audit: N in-flight calls are invisible
// for their entire duration — up to StreamMaxDuration). The reservation
// closes that gap: every admitted call atomically reserves an estimate of
// its token cost against the REMAINING window budget, and settles the
// reservation when its usage row is about to land. Fail-open on Redis loss
// (same availability posture as every other limiter dimension).

// reserveLua atomically adds amount to the reservation counter iff the result
// stays within the remaining budget (ceiling). Returns {ok, total}: on success
// total is the new reserved sum; on denial it is the UNCHANGED current sum,
// which is what the caller adds to the DB usage to report the effective
// position.
// KEYS[1]=counter  ARGV: amount, ceiling, ttl_ms
var reserveLua = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur + tonumber(ARGV[1]) > tonumber(ARGV[2]) then
        return {0, cur}
end
local v = redis.call('INCRBY', KEYS[1], tonumber(ARGV[1]))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]))
return {1, v}
`)

// releaseReservationLua returns amount to the pool, floored at zero. The
// counter is deleted at zero (no key churn for idle tenants).
// KEYS[1]=counter  ARGV: amount, ttl_ms
var releaseReservationLua = redis.NewScript(`
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local v = cur - tonumber(ARGV[1])
if v <= 0 then
        redis.call('DEL', KEYS[1])
        return 0
end
redis.call('SET', KEYS[1], v)
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
return v
`)

// ReserveOutcome is the result of a reservation attempt.
type ReserveOutcome struct {
	Allowed bool
	Total   int64 // reserved AFTER the attempt (denied: the unchanged current)
	Wanted  int64 // the amount this call tried to reserve
}

// Reserve atomically reserves amount tokens under ceiling (the remaining
// window budget: quota − used). The check-and-increment is one Lua script:
// concurrent admits cannot both spend the same remaining budget. Fail-open on
// Redis loss (allowed, unreserved — counted in the fail-open metric).
func (l *Limiter) Reserve(ctx context.Context, key string, amount, ceiling int64, ttl time.Duration) ReserveOutcome {
	if amount < 0 {
		amount = 0
	}
	if ceiling < 0 {
		ceiling = 0
	}
	if amount == 0 {
		return ReserveOutcome{Allowed: true, Total: l.reserved(ctx, key)}
	}
	res, err := reserveLua.Run(ctx, l.rdb, []string{key},
		amount, ceiling, ttl.Milliseconds()).Slice()
	if err != nil {
		if l.metrics != nil {
			l.metrics.RateLimitFailOpen.Add(ctx, 1)
		}
		if l.failOpen {
			return ReserveOutcome{Allowed: true, Wanted: amount}
		}
		return ReserveOutcome{Allowed: false, Wanted: amount}
	}
	if len(res) < 2 {
		return ReserveOutcome{Allowed: true, Wanted: amount}
	}
	ok, _ := res[0].(int64)
	total, _ := res[1].(int64)
	return ReserveOutcome{Allowed: ok == 1, Total: total, Wanted: amount}
}

// ReleaseReservation returns amount tokens to the pool (call settled).
// Best-effort: a lost release self-heals via the TTL backstop, which keeps the
// reservation counted until it expires — the conservative direction (the
// window can under-admit briefly, never over-admit).
func (l *Limiter) ReleaseReservation(ctx context.Context, key string, amount int64, ttl time.Duration) {
	if l.rdb == nil || amount <= 0 {
		return
	}
	_, _ = releaseReservationLua.Run(ctx, l.rdb, []string{key},
		amount, ttl.Milliseconds()).Int()
}

// Reserved reports the currently-reserved amount for a key (0 on miss/error —
// display-side only, never an enforcement input by itself).
func (l *Limiter) Reserved(ctx context.Context, key string) int64 {
	return l.reserved(ctx, key)
}

func (l *Limiter) reserved(ctx context.Context, key string) int64 {
	v, err := l.rdb.Get(ctx, key).Int64()
	if err != nil {
		return 0
	}
	return v
}

// --- client IP extraction ---------------------------------------------------

// The limiter itself is transport-agnostic; keys are composed by callers.
