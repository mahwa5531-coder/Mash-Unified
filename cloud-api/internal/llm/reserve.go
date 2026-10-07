package llm

// In-flight window reservation: the correctness half of the rolling-window
// quota gate. The DB check (admit) reads the authoritative position; this file
// makes in-flight calls VISIBLE to that check by claiming an estimate of each
// call's token cost atomically in Redis until the call's usage row is about to
// land in PostgreSQL.
//
// Lifecycle of one reservation:
//
//      admit (last gate)   ReserveWindows: 5h claim + weekly claim (atomic
//                          Lua vs remaining budget; all-or-nothing with
//                          rollback of the 5h claim on weekly denial)
//      call runs           reservation held (TTL backstop: a crashed holder
//                          keeps the budget claimed until expiry — the
//                          conservative direction)
//      record (any exit)   settleReservation: failed calls (no usage) release
//                          immediately; completed calls release after
//                          SettleDelay, covering the async metering flush so
//                          the budget is never simultaneously invisible in
//                          both stores.
//
// Posture: fail-open on Redis loss (mirrors the window gate and every other
// limiter dimension — the quota gate is a plan-abuse bound, not a security
// boundary).

import (
	"context"
	"encoding/json"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/domain"
)

// reservation is one admitted call's budget claim.
type reservation struct {
	entries []reserveEntry
}

type reserveEntry struct {
	key    string
	amount int64
}

// ReservationKey5h / ReservationKeyWeekly are the per-tenant reservation
// counters in Redis (exported so /v1/me can render the same effective position
// the gate enforces).
func ReservationKey5h(tenantID string) string     { return "q:res:5h:" + tenantID }
func ReservationKeyWeekly(tenantID string) string { return "q:res:w:" + tenantID }

// checkWindows enforces the hard DB position (completed usage only). The
// reservation covers what the DB cannot see yet.
func (p *Proxy) checkWindows(ctx context.Context, idn *auth.Identity, pos *domain.WindowUsage) *domain.Error {
	if q := idn.Limits.Window5hTokens; q > 0 && pos.Used5h >= q {
		return p.windowBlocked(ctx, idn, "5h", 5*time.Hour, q, pos.Used5h)
	}
	if q := idn.Limits.WindowWeeklyTokens; q > 0 && pos.UsedWeekly >= q {
		return p.windowBlocked(ctx, idn, "weekly", 7*24*time.Hour, q, pos.UsedWeekly)
	}
	return nil
}

// reserveWindows claims the estimate against both windows' remaining budgets.
// All-or-nothing: a weekly denial rolls back the 5h claim so the budget does
// not leak to a call that was never admitted.
func (p *Proxy) reserveWindows(ctx context.Context, idn *auth.Identity, req *Request, pos *domain.WindowUsage) (*reservation, *domain.Error) {
	est := p.estimateTokens(req)
	var res reservation

	if q := idn.Limits.Window5hTokens; q > 0 {
		key := ReservationKey5h(idn.Tenant.ID)
		o := p.Limiter.Reserve(ctx, key, est, q-pos.Used5h, p.Reserve.TTL)
		if !o.Allowed {
			return nil, p.reservationBlocked(ctx, idn, "5h", 5*time.Hour, q, pos.Used5h, o.Total)
		}
		res.entries = append(res.entries, reserveEntry{key: key, amount: est})
	}
	if q := idn.Limits.WindowWeeklyTokens; q > 0 {
		key := ReservationKeyWeekly(idn.Tenant.ID)
		o := p.Limiter.Reserve(ctx, key, est, q-pos.UsedWeekly, p.Reserve.TTL)
		if !o.Allowed {
			// Roll back the 5h claim.
			for _, e := range res.entries {
				p.Limiter.ReleaseReservation(context.WithoutCancel(ctx), e.key, e.amount, p.Reserve.TTL)
			}
			return nil, p.reservationBlocked(ctx, idn, "weekly", 7*24*time.Hour, q, pos.UsedWeekly, o.Total)
		}
		res.entries = append(res.entries, reserveEntry{key: key, amount: est})
	}
	return &res, nil
}

// reservationBlocked renders the reservation denial. The effective position is
// used + reserved (the denied call adds nothing) — when that is still below
// quota, the window is not exhausted, the remaining budget is merely claimed
// by in-flight calls: the client should retry shortly, not wait out the
// window. The payload says which via in_flight=true and the effective used
// figure, so the desktop can distinguish the two cases.
func (p *Proxy) reservationBlocked(ctx context.Context, idn *auth.Identity, window string, d time.Duration, quota, used int64, reserved int64) *domain.Error {
	effective := used + reserved
	de := domain.ErrWindowQuotaExceeded(window, quota, effective, nil).
		WithDetail("reserved_tokens", reserved).
		WithDetail("in_flight", true)
	// resets_at is only meaningful when the completed usage itself has reached
	// the quota (the window truly binds). Pure reservation pressure releases
	// as soon as in-flight calls settle — seconds, not hours — so no resets_at
	// is reported there and the client retries shortly instead of scheduling
	// around a recovery instant that would be a lie.
	if effective >= quota && p.Usage != nil {
		if t, err := p.Usage.WindowRecovery(ctx, idn.Tenant.ID, d, quota, effective); err == nil && t != nil {
			de = de.WithDetail("resets_at", t.UTC().Format(time.RFC3339))
		}
	}
	return de
}

// estimateTokens bounds what one call may cost: a rough input estimate (the
// chars/4 heuristic over the serialized messages) plus the client-declared
// output budget (max_completion_tokens / max_tokens, else the deployment
// default), clamped to [MinTokens, MaxTokens]. The ceiling keeps one huge
// request from starving the tenant's whole window; the floor keeps tiny
// requests from racing past the quota en masse. Estimates do not need to be
// exact — their job is bounding CONCURRENT overshoot; per-call accuracy is the
// metering system's job.
func (p *Proxy) estimateTokens(req *Request) int64 {
	out := p.Reserve.DefaultOut
	if req.MaxCompletionTokens != nil && *req.MaxCompletionTokens > 0 {
		out = *req.MaxCompletionTokens
	} else if req.MaxTokens != nil && *req.MaxTokens > 0 {
		out = *req.MaxTokens
	}
	var in int64
	if blob, err := json.Marshal(req.Messages); err == nil {
		in = int64(len(blob) / 4)
	}
	est := in + out
	if est < p.Reserve.MinTokens {
		est = p.Reserve.MinTokens
	}
	if est > p.Reserve.MaxTokens {
		est = p.Reserve.MaxTokens
	}
	if est < 0 {
		est = 0
	}
	return est
}

// settleReservation returns a settled call's budget to the pool. Calls that
// produced no usage (failed before any token was metered) release immediately.
// Calls with usage release after SettleDelay: the authoritative row is still
// inside the async metering pipeline, and an immediate release would open a
// window in which the tokens are visible neither in Redis nor in PostgreSQL —
// the next admit could re-spend them. The delay (default 2s ≈ 4x the flush
// interval) covers the pipeline; a crash before the delayed release self-heals
// via the TTL backstop (the budget stays claimed until expiry — conservative).
func (p *Proxy) settleReservation(res *reservation, hasUsage bool) {
	if res == nil || p.Limiter == nil {
		return
	}
	delay := time.Duration(0)
	if hasUsage {
		delay = p.Reserve.SettleDelay
	}
	for _, e := range res.entries {
		entry := e
		release := func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			p.Limiter.ReleaseReservation(ctx, entry.key, entry.amount, p.Reserve.TTL)
		}
		if delay <= 0 {
			release()
			continue
		}
		time.AfterFunc(delay, release)
	}
}
