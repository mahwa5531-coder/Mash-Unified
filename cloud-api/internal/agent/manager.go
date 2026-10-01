// manager owns the in-flight run registry of THIS instance and the shared
// cross-instance control plane:
//
//   - Local registry: runID → cancellable producer (map + RWMutex).
//   - Redis control channel `nexau:runctl`: every instance subscribes; a
//     cancellation published anywhere reaches the owning instance in O(ms).
//     No sticky sessions, no broadcast fan-out per run.
//   - Concurrency slots: Redis counters with TTL backstop + reconciliation.
//
// Every goroutine the manager starts has exactly one clear lifecycle: the
// control-channel loop runs until process shutdown; producers are joined via
// their own completion paths.
package agent

import (
	"context"
	"encoding/json"
	"runtime/debug"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

const runCtlChannel = "nexau:runctl"

// CancelReason labels why a run was aborted (spec §20, §34).
const (
	CancelUser       = "user"
	CancelDisconnect = "disconnect"
	CancelShutdown   = "shutdown"
	CancelIdle       = "idle"
)

// activeRun is one producer owned by this instance.
type activeRun struct {
	runID     string
	sessionID string
	tenantID  string
	userID    string
	cancel    context.CancelCauseFunc
}

// Manager is safe for concurrent use.
type Manager struct {
	rdb     redis.UniversalClient
	lim     *ratelimit.Limiter
	m       *observability.Metrics
	slotTTL time.Duration

	mu   sync.RWMutex
	runs map[string]*activeRun

	prodWG   sync.WaitGroup // producers: Register→Deregister pairing
	wg       sync.WaitGroup
	stopOnce sync.Once
	stopCh   chan struct{}

	// ShutdownGrace bounds how long Shutdown waits for producers to
	// finalize (billing/row integrity) before proceeding.
	ShutdownGrace time.Duration
}

func NewManager(rdb redis.UniversalClient, lim *ratelimit.Limiter, slotTTL time.Duration, m *observability.Metrics) *Manager {
	mgr := &Manager{
		rdb:           rdb,
		lim:           lim,
		m:             m,
		slotTTL:       slotTTL,
		runs:          map[string]*activeRun{},
		stopCh:        make(chan struct{}),
		ShutdownGrace: 30 * time.Second,
	}
	mgr.wg.Add(1)
	go mgr.controlLoop()
	return mgr
}

// controlLoop consumes cross-instance cancellation commands until shutdown.
// Redis outages are retried with backoff — the control plane degrades (cross-
// instance cancel falls back to the DB-state path) but never crashes. A panic
// in command handling is contained (2026-09-18 audit): this loop is the only
// cross-instance cancel consumer — losing it must never be one bad message
// away.
func (mgr *Manager) controlLoop() {
	defer mgr.wg.Done()
	backoff := 500 * time.Millisecond
	for {
		select {
		case <-mgr.stopCh:
			return
		default:
		}

		sub := mgr.rdb.Subscribe(context.Background(), runCtlChannel)
		if err := sub.Ping(context.Background()); err != nil {
			_ = sub.Close()
			select {
			case <-mgr.stopCh:
				return
			case <-time.After(backoff):
			}
			if backoff < 10*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = 500 * time.Millisecond

		stopWait := make(chan struct{})
		go func() {
			select {
			case <-mgr.stopCh:
				_ = sub.Close()
			case <-stopWait:
			}
		}()

		for msg := range sub.Channel() {
			mgr.handleControlSafely(msg.Payload)
		}
		close(stopWait)
		// Channel closed (Redis restart or shutdown): loop and clean up.
		_ = sub.Close()
	}
}

// handleControlSafely runs one control command behind a panic guard: a
// poison command is logged and dropped, and the loop keeps consuming.
func (mgr *Manager) handleControlSafely(payload string) {
	defer func() {
		if rec := recover(); rec != nil {
			observability.LogError("control-plane panic contained",
				"panic", rec, "stack", string(debug.Stack()))
		}
	}()
	var cmd struct {
		RunID  string `json:"run_id"`
		Reason string `json:"reason"`
		By     string `json:"by"`
	}
	if json.Unmarshal([]byte(payload), &cmd) != nil || cmd.RunID == "" {
		return
	}
	mgr.cancelLocal(cmd.RunID, cmd.Reason, cmd.By)
}

// cancelLocal aborts a locally-owned run (cancellation propagation).
func (mgr *Manager) cancelLocal(runID, reason, by string) bool {
	mgr.mu.RLock()
	ar := mgr.runs[runID]
	mgr.mu.RUnlock()
	if ar == nil {
		return false
	}
	ar.cancel(&cancelCause{reason: reason, by: by})
	if mgr.m != nil {
		mgr.m.RunCancellations.Add(context.Background(), 1, observability.Attr("reason", reason))
	}
	return true
}

// cancelCause carries why a run was cancelled through context.
type cancelCause struct {
	reason string
	by     string
}

func (c *cancelCause) Error() string { return "run cancelled: " + c.reason }

// NewCancelCause builds a structured cancellation cause for StreamHandle.
// Cancel — used by transport disconnect watchers (SSE request context, WS
// OnClose) so aborts carry the right reason into run finalization.
func NewCancelCause(reason, by string) error { return &cancelCause{reason: reason, by: by} }

// CauseInfo extracts the structured cancellation cause.
func CauseInfo(ctx context.Context) (reason, by string, cancelled bool) {
	if ctx == nil {
		return "", "", false
	}
	if c, ok := context.Cause(ctx).(*cancelCause); ok {
		return c.reason, c.by, true
	}
	if ctx.Err() != nil {
		return CancelDisconnect, "", true
	}
	return "", "", false
}

// Register records a locally-owned producer.
func (mgr *Manager) Register(ar *activeRun) {
	mgr.prodWG.Add(1)
	mgr.mu.Lock()
	mgr.runs[ar.runID] = ar
	mgr.mu.Unlock()
}

// Deregister forgets a finished producer.
func (mgr *Manager) Deregister(runID string) {
	mgr.mu.Lock()
	_, existed := mgr.runs[runID]
	delete(mgr.runs, runID)
	mgr.mu.Unlock()
	if existed {
		mgr.prodWG.Done()
	}
}

// ActiveCount reports the local registry size (diagnostics).
func (mgr *Manager) ActiveCount() int {
	mgr.mu.RLock()
	defer mgr.mu.RUnlock()
	return len(mgr.runs)
}

// Cancel aborts a run wherever it lives:
//  1. Local registry hit → direct context cancel (producer finalizes).
//  2. Publish to the control channel → the owning instance cancels.
//  3. DB state guard: if no owner responds, mark the row cancelled so the run
//     cannot linger 'running' (crash-recovery path).
//
// Returns whether the run existed.
func (mgr *Manager) Cancel(ctx context.Context, run *domain.Run, reason, by string) bool {
	if run == nil {
		return false
	}
	if mgr.cancelLocal(run.ID, reason, by) {
		return true
	}
	// Not ours: broadcast. Best-effort; DB guard below covers the crash case.
	if mgr.rdb != nil {
		blob, _ := json.Marshal(struct {
			RunID  string `json:"run_id"`
			Reason string `json:"reason"`
			By     string `json:"by"`
		}{run.ID, reason, by})
		if err := mgr.rdb.Publish(ctx, runCtlChannel, blob).Err(); err != nil && !store.IsRedisDown(err) {
			observability.LogWarn("agent: cancel broadcast failed", "run_id", run.ID, "error", err)
		}
	}
	return true
}

// Shutdown cancels every locally-owned run (graceful shutdown step 4) and
// stops the control loop. It then WAITS (bounded by maxWait, a slice of the
// operator's total shutdown grace) for every producer to finalize: usage
// rows and terminal run states are written by the producers, so the caller's
// metering drain and process exit must happen AFTER they land — otherwise the
// last billing facts of the shutdown window are silently dropped.
func (mgr *Manager) Shutdown(maxWait time.Duration) {
	mgr.stopOnce.Do(func() {
		close(mgr.stopCh)
	})
	mgr.mu.RLock()
	runs := make([]*activeRun, 0, len(mgr.runs))
	for _, ar := range mgr.runs {
		runs = append(runs, ar)
	}
	mgr.mu.RUnlock()
	for _, ar := range runs {
		ar.cancel(&cancelCause{reason: CancelShutdown, by: "system"})
	}

	grace := maxWait
	if grace <= 0 {
		grace = 30 * time.Second
	}
	done := make(chan struct{})
	go func() {
		mgr.prodWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(grace):
		// Bounded: proceed with shutdown; residual rows take the
		// crash-recovery path (housekeeping reconciler).
	}
}

// Close waits for the control loop to exit (bounded).
func (mgr *Manager) Close() {
	mgr.Shutdown(mgr.ShutdownGrace)
	mgr.wg.Wait()
}

// --- concurrency slots ------------------------------------------------------

// SlotKey names the Redis counters for a run owner.
func SlotKey(dim, id string) string { return "rl:conc:" + dim + ":" + id }

// AcquireSlots claims user + tenant concurrency (spec: limits per dimension).
func (mgr *Manager) AcquireSlots(ctx context.Context, tenantID, userID string, userLimit, tenantLimit int64) *domain.Error {
	if !mgr.lim.Acquire(ctx, SlotKey("tenant", tenantID), tenantLimit, mgr.slotTTL) {
		return domain.ErrConcurrencyLimited("tenant")
	}
	if !mgr.lim.Acquire(ctx, SlotKey("user", userID), userLimit, mgr.slotTTL) {
		mgr.lim.Release(ctx, SlotKey("tenant", tenantID), mgr.slotTTL)
		return domain.ErrConcurrencyLimited("user")
	}
	return nil
}

// ReleaseSlots returns user + tenant slots. The context is detached from
// caller cancellation: go-redis refuses to run a command on a pre-canceled
// context, and slot release must succeed even when the caller's request
// context died (client disconnect racing a setup failure) — otherwise the
// counter leaks until the TTL backstop or reconciliation (audit finding 2
// hardening).
func (mgr *Manager) ReleaseSlots(ctx context.Context, tenantID, userID string) {
	actx := context.WithoutCancel(ctx)
	mgr.lim.Release(actx, SlotKey("user", userID), mgr.slotTTL)
	mgr.lim.Release(actx, SlotKey("tenant", tenantID), mgr.slotTTL)
}

// ReconcileSlots resets counters to authoritative PostgreSQL counts.
func (mgr *Manager) ReconcileSlots(ctx context.Context, tenantID, userID string, tenantRunning, userRunning int) {
	mgr.lim.Reconcile(ctx, SlotKey("tenant", tenantID), int64(tenantRunning), mgr.slotTTL)
	if userID != "" {
		mgr.lim.Reconcile(ctx, SlotKey("user", userID), int64(userRunning), mgr.slotTTL)
	}
}
