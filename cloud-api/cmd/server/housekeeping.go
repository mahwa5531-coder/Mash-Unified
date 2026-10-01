package main

import (
	"context"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/agent"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/store"
	"github.com/nexau-cloud/nexau-api/internal/store/repos"
)

// housekeepingDeps bundles the sweeper's collaborators.
type housekeepingDeps struct {
	sessions       *repos.SessionsRepo
	runs           *repos.RunsRepo
	refresh        *repos.RefreshTokensRepo
	recovery       *repos.RecoveryTokensRepo
	pg             *store.Postgres
	metrics        *observability.Metrics
	mgr            *agent.Manager
	stuckAfter     time.Duration
	sessionIdleTTL time.Duration
	// unverifiedRetention bounds how long unverified local accounts live
	// before the sweep purges them (pre-hijacking hygiene, 2026-09-19
	// audit finding 3). 0 disables the purge.
	unverifiedRetention time.Duration
}

// startHousekeeping launches the periodic maintenance loop: idle-session
// expiry, orphaned-run recovery, refresh-token retention, and the metrics
// sampler (pool saturation, gauge export). One goroutine, one lifecycle,
// stopped via context; work is short-bounded per tick.
func startHousekeeping(ctx context.Context, d housekeepingDeps, logger *slog.Logger) *housekeeper {
	h := &housekeeper{deps: d, logger: logger}
	h.wg.Add(1)
	go h.loop(ctx)
	return h
}

type housekeeper struct {
	deps   housekeepingDeps
	logger *slog.Logger
	wg     sync.WaitGroup
}

// loop runs the sweep every minute (cheap queries, indexed).
func (h *housekeeper) loop(ctx context.Context) {
	defer h.wg.Done()
	ticker := time.NewTicker(time.Minute)
	sample := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer sample.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-sample.C:
			h.guard("metrics", func() { h.sampleMetrics(ctx) })
		case <-ticker.C:
			h.guard("sweep", func() { h.sweep(ctx) })
		}
	}
}

// guard runs one housekeeping unit behind a panic barrier (2026-09-18
// post-mortem audit): this loop is detached and periodic — an unrecovered
// panic would crash the process, and even a silent death would stop idle-run
// reaping and slot reconciliation for the pod's remaining lifetime. A failed
// unit is logged; the next tick runs as normal.
func (h *housekeeper) guard(unit string, fn func()) {
	defer func() {
		if rec := recover(); rec != nil {
			observability.LogError("housekeeping panic contained",
				"unit", unit, "panic", rec, "stack", string(debug.Stack()))
		}
	}()
	fn()
}

func (h *housekeeper) sweep(ctx context.Context) {
	d := h.deps

	// Idle sessions → closed. Two equivalent guards: the sliding idle
	// deadline (extended on every touch) and the last_seen horizon.
	sctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	idleBefore := time.Now().Add(-d.sessionIdleTTL)
	if n, err := d.sessions.ExpireIdle(sctx, idleBefore); err != nil {
		observability.LogWarn("housekeeping: session expiry failed", "error", err)
	} else if n > 0 {
		observability.LogInfo("housekeeping: sessions expired", "count", n)
	}
	cancel()

	// Orphaned runs (instance crash): older than the maximum possible stream
	// lifetime + grace → failed with ORPHANED_RUN. The same pass returns the
	// (tenant, user) owners whose Redis concurrency counters must be reset to
	// PostgreSQL truth — both owners of still-running runs (drift correction)
	// and owners of the reaped rows (leaked slots fall to the new truth
	// instead of persisting until the slot TTL; audit finding 4).
	rctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	owners, reaped, err := d.runs.ReapAndListSlotOwners(rctx, time.Now().Add(-d.stuckAfter))
	if err != nil {
		observability.LogWarn("housekeeping: run recovery failed", "error", err)
	} else {
		if reaped > 0 {
			observability.LogInfo("housekeeping: orphaned runs recovered", "count", reaped)
		}
		if d.mgr != nil {
			for _, o := range owners {
				d.mgr.ReconcileSlots(rctx, o.TenantID, o.UserID, o.TenantRunning, o.UserRunning)
			}
			if len(owners) > 0 {
				observability.LogDebug("housekeeping: concurrency slots reconciled",
					"owners", len(owners))
			}
		}
	}
	cancel()

	// Refresh-token retention (90 days past expiry/revocation).
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	if n, err := d.refresh.SweepExpired(tctx, 90*24*time.Hour); err != nil {
		observability.LogWarn("housekeeping: refresh sweep failed", "error", err)
	} else if n > 100 {
		observability.LogInfo("housekeeping: refresh tokens purged", "count", n)
	}
	cancel()

	// Recovery-token retention (7 days past expiry/consumption).
	if d.recovery != nil {
		rctx, rcancel := context.WithTimeout(ctx, 30*time.Second)
		if n, err := d.recovery.SweepExpired(rctx, 7*24*time.Hour); err != nil {
			observability.LogWarn("housekeeping: recovery sweep failed", "error", err)
		} else if n > 100 {
			observability.LogInfo("housekeeping: recovery tokens purged", "count", n)
		}
		rcancel()
	}

	// Unverified-account purge (pre-hijacking hygiene): bounds the
	// lifetime of attacker-seeded husk accounts. Data-safe by
	// construction — the SQL only touches run-less unverified accounts.
	if d.recovery != nil && d.unverifiedRetention > 0 {
		pctx, pcancel := context.WithTimeout(ctx, 30*time.Second)
		if n, err := d.recovery.PurgeUnverifiedAccounts(pctx, d.unverifiedRetention); err != nil {
			observability.LogWarn("housekeeping: unverified-account purge failed", "error", err)
		} else if n > 0 {
			observability.LogInfo("housekeeping: unverified accounts purged", "count", n)
		}
		pcancel()
	}
}

func (h *housekeeper) sampleMetrics(ctx context.Context) {
	if h.deps.pg == nil || h.deps.metrics == nil {
		return
	}
	stat := h.deps.pg.Stats()
	if stat != nil && stat.MaxConns() > 0 {
		h.deps.metrics.PoolSaturation.Set(int64(float64(stat.AcquiredConns()) / float64(stat.MaxConns()) * 100))
	}
	h.deps.metrics.PoolSaturation.Observe(ctx)
	if h.deps.mgr != nil {
		h.deps.metrics.ActiveStreams.Set(int64(h.deps.mgr.ActiveCount()))
	}
	h.deps.metrics.ActiveStreams.Observe(ctx)
	h.deps.metrics.ActiveRequests.Observe(ctx)
	h.deps.metrics.ActiveWSConnections.Observe(ctx)
	h.deps.metrics.MeterQueueDepth.Observe(ctx)
}

// stop ends the loop and waits for the current tick to finish.
func (h *housekeeper) stop() {
	h.wg.Wait()
}
