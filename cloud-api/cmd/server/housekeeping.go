package main

import (
	"context"
	"log/slog"
	"runtime/debug"
	"sync"
	"time"

	"github.com/mash-cloud/mash-api/internal/llm"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/store"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// housekeepingDeps bundles the sweeper's collaborators.
type housekeepingDeps struct {
	refresh *repos.RefreshTokensRepo
	pg      *store.Postgres
	metrics *observability.Metrics
	proxy   *llm.Proxy
}

// startHousekeeping launches the periodic maintenance loop: refresh-token
// retention and the metrics sampler (pool saturation, gauge export). One
// goroutine, one lifecycle, stopped via context; work is short-bounded per
// tick.
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

// guard runs one housekeeping unit behind a panic barrier: this loop is
// detached and periodic — an unrecovered panic would crash the process, and
// even a silent death would stop maintenance for the pod's remaining
// lifetime. A failed unit is logged; the next tick runs as normal.
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
	// Refresh-token retention (90 days past expiry/revocation).
	tctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	if n, err := h.deps.refresh.SweepExpired(tctx, 90*24*time.Hour); err != nil {
		observability.LogWarn("housekeeping: refresh sweep failed", "error", err)
	} else if n > 100 {
		observability.LogInfo("housekeeping: refresh tokens purged", "count", n)
	}
	cancel()
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
	if h.deps.proxy != nil {
		h.deps.metrics.ActiveStreams.Set(h.deps.proxy.ActiveCount())
	}
	h.deps.metrics.ActiveStreams.Observe(ctx)
	h.deps.metrics.ActiveRequests.Observe(ctx)
	h.deps.metrics.MeterQueueDepth.Observe(ctx)
}

// stop ends the loop and waits for the current tick to finish.
func (h *housekeeper) stop() {
	h.wg.Wait()
}
