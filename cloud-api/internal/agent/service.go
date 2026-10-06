// service implements the model-request pipeline (spec §7): every step in
// order, fail-closed authorization, fail-open rate limiting, idempotent run
// creation, incremental forwarding, authoritative usage, exactly-once
// completion. One producer goroutine per run, registered with the manager.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/ids"
	"github.com/nexau-cloud/nexau-api/internal/metering"
	"github.com/nexau-cloud/nexau-api/internal/observability"
	"github.com/nexau-cloud/nexau-api/internal/ratelimit"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// RateRules carry the request-rate dimensions (config defaults; plan values
// override when set).
type RateRules struct {
	RPMUser    int64
	RPMTenant  int64
	ConcUser   int64
	ConcTenant int64
	FailOpen   bool
}

// StreamTiming carries stream deadlines.
type StreamTiming struct {
	IdleTimeout time.Duration
	MaxDuration time.Duration
}

// Service is the run pipeline. Safe for concurrent use.
type Service struct {
	sessions SessionsStore
	runs     RunsStore
	usage    UsageQuery
	bifrost  BifrostClient
	meter    *metering.Recorder
	idem     *idempotency.Store
	mgr      *Manager
	lim      *ratelimit.Limiter

	limits           Limits // validation bounds
	rate             RateRules
	timing           StreamTiming
	setupTimeout     time.Duration
	nonStreamTimeout time.Duration
	sessionIdleTTL   time.Duration
	m                *observability.Metrics
}

// Narrow storage/upstream interfaces: the service depends on behavior, not
// packages (also the seam for integration-test fakes).
type SessionsStore interface {
	Get(ctx context.Context, tenantID, id string) (*domain.Session, error)
	Create(ctx context.Context, s *domain.Session) error
	TouchSession(ctx context.Context, tenantID, id string, ttl time.Duration) error
	Close(ctx context.Context, tenantID, id string) error
}

type RunsStore interface {
	Create(ctx context.Context, run *domain.Run) error
	Get(ctx context.Context, tenantID, id string) (*domain.Run, error)
	GetByIdempotencyKey(ctx context.Context, tenantID, userID, key string) (*domain.Run, error)
	Complete(ctx context.Context, tenantID, runID, status, errorCode, errorMessage, cancelReason, cancelBy, resolvedModel, provider string) (bool, error)
	SetFirstEvent(ctx context.Context, tenantID, runID string) error
	CountRunning(ctx context.Context, tenantID, userID string) (int, error)
}

// UsageQuery is the read-side billing seam for quota enforcement. The
// concrete implementation is repos.UsageRepo; integration fakes count from
// zero (quota enforcement inert unless configured).
type UsageQuery interface {
	// MonthToDateTokens sums input+output tokens recorded for the tenant
	// in the current calendar month (UTC).
	MonthToDateTokens(ctx context.Context, tenantID string) (int64, error)
}

type BifrostClient interface {
	Completion(ctx context.Context, req *bifrost.ChatRequest) (*bifrost.ChatResponse, error)
	CompletionStream(ctx context.Context, req *bifrost.ChatRequest) (*bifrost.StreamReader, error)
}

// Config wires the service.
type Config struct {
	Sessions         SessionsStore
	Runs             RunsStore
	Usage            UsageQuery
	Bifrost          BifrostClient
	Meter            *metering.Recorder
	Idem             *idempotency.Store
	Manager          *Manager
	Limiter          *ratelimit.Limiter
	Limits           Limits
	Rate             RateRules
	Timing           StreamTiming
	SetupTimeout     time.Duration
	NonStreamTimeout time.Duration
	SessionIdleTTL   time.Duration // slides session expiry on activity
	Metrics          *observability.Metrics
}

func NewService(cfg Config) *Service {
	setup := cfg.SetupTimeout
	if setup <= 0 {
		setup = 15 * time.Second
	}
	nonStream := cfg.NonStreamTimeout
	if nonStream <= 0 {
		nonStream = 120 * time.Second
	}
	idleTTL := cfg.SessionIdleTTL
	if idleTTL <= 0 {
		idleTTL = 24 * time.Hour
	}
	return &Service{
		sessions:         cfg.Sessions,
		runs:             cfg.Runs,
		usage:            cfg.Usage,
		bifrost:          cfg.Bifrost,
		meter:            cfg.Meter,
		idem:             cfg.Idem,
		mgr:              cfg.Manager,
		lim:              cfg.Limiter,
		limits:           cfg.Limits,
		rate:             cfg.Rate,
		timing:           cfg.Timing,
		setupTimeout:     setup,
		nonStreamTimeout: nonStream,
		sessionIdleTTL:   idleTTL,
		m:                cfg.Metrics,
	}
}

// Manager exposes the run manager (cancel path, shutdown).
func (s *Service) Manager() *Manager { return s.mgr }

// RunResponse is the stream=false reply: the OpenAI-compatible completion
// plus the cloud run envelope.
type RunResponse struct {
	Run        *RunInfo           `json:"run"`
	Completion json.RawMessage    `json:"completion,omitempty"`
	Usage      *domain.TokenUsage `json:"usage,omitempty"`

	// failErr carries the domain error of a synchronously-failed run. It is
	// deliberately unserialized: the agent runs surface reports failures
	// inside Run (status/error_code), while the OpenAI-compatible surface
	// maps it to a proper HTTP error response.
	failErr *domain.Error
}

// Failure returns the domain error for a failed synchronous run (nil when
// the run succeeded). Derived from the run row when the original error is
// unavailable (idempotent replay of a failed run).
func (r *RunResponse) Failure() *domain.Error {
	if r == nil {
		return nil
	}
	if r.failErr != nil {
		return r.failErr
	}
	if r.Run != nil && r.Run.Status == domain.RunFailed && r.Run.ErrorCode != "" {
		return failedRunError(r.Run.ErrorCode)
	}
	return nil
}

// failedRunError reconstructs a transport-mappable domain error from the
// stable run error code (idempotent replay path).
func failedRunError(code string) *domain.Error {
	httpStatus := http.StatusBadGateway
	switch code {
	case "MODEL_TIMEOUT":
		httpStatus = http.StatusGatewayTimeout
	case "MODEL_NOT_FOUND":
		httpStatus = http.StatusNotFound
	case "UPSTREAM_RATE_LIMITED":
		httpStatus = http.StatusTooManyRequests
	}
	return domain.ErrUpstreamError(code, "The LLM gateway returned an error for this request.", httpStatus)
}

// RunInfo is the client-visible run metadata (safe subset).
type RunInfo struct {
	ID             string     `json:"id"`
	SessionID      string     `json:"session_id"`
	TurnID         string     `json:"turn_id,omitempty"`
	Status         string     `json:"status"`
	Stream         bool       `json:"stream"`
	RequestedModel string     `json:"requested_model"`
	ResolvedModel  string     `json:"resolved_model,omitempty"`
	Provider       string     `json:"provider,omitempty"`
	ErrorCode      string     `json:"error_code,omitempty"`
	StartedAt      time.Time  `json:"started_at"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

func info(r *domain.Run) *RunInfo {
	return &RunInfo{
		ID: r.ID, SessionID: r.SessionID, TurnID: r.TurnID, Status: r.Status,
		Stream: r.Stream, RequestedModel: r.RequestedModel, ResolvedModel: r.ResolvedModel,
		Provider: r.Provider, ErrorCode: r.ErrorCode, StartedAt: r.StartedAt, CompletedAt: r.CompletedAt,
	}
}

// StreamHandle controls a started streaming run (producer runs detached or
// on the caller's goroutine).
type StreamHandle struct {
	Run    *domain.Run
	Cancel context.CancelCauseFunc
	ctx    context.Context // run context: cancellable with cause, no setup deadline
	done   chan struct{}

	finishOnce sync.Once
}

// Done is closed when the producer finalized (or the run was aborted
// pre-producer via AbortStream).
func (h *StreamHandle) Done() <-chan struct{} { return h.done }

// Context exposes the run context (cancellation-aware observers).
func (h *StreamHandle) Context() context.Context { return h.ctx }

// Finish closes the done channel exactly once: several paths may try to
// close it (producer completion, sync completion, pre-producer abort) and a
// double close would panic.
func (h *StreamHandle) Finish() {
	h.finishOnce.Do(func() { close(h.done) })
}

// CreateRun executes pipeline steps 5–13 and returns either a completed
// RunResponse (stream=false) or a started producer (stream=true).
//
// The caller (HTTP/WS handler) owns the sink; the producer owns the Bifrost
// call, event emission, usage recording and finalization.
func (s *Service) CreateRun(ctx context.Context, idn *auth.Identity, sessionID string, req *RunRequest) (*RunResponse, *StreamHandle, *domain.Error) {
	// Setup phase gets its own deadline; the producer context is derived from
	// the ORIGINAL ctx (so SSE client disconnects still propagate) and never
	// inherits the setup timeout (streams outlive setup by minutes).
	sctx, setupDone := context.WithTimeout(ctx, s.setupTimeout)
	defer setupDone()

	// 7. Session ownership + state (tenant-scoped lookup IS the isolation).
	sess, err := s.sessions.Get(sctx, idn.Tenant.ID, sessionID)
	if err != nil {
		return nil, nil, storeMap(err)
	}
	if sess == nil {
		return nil, nil, domain.ErrSessionNotFound()
	}
	switch sess.Status {
	case domain.SessionClosed:
		return nil, nil, domain.ErrSessionClosed()
	case "expired":
		return nil, nil, domain.ErrSessionClosed()
	}
	if sess.ExpiresAt != nil && sess.ExpiresAt.Before(time.Now()) {
		return nil, nil, domain.ErrSessionClosed()
	}
	if sess.UserID != idn.User.ID {
		// Same tenant, different owner: isolated per-user (safe 404, no probing).
		return nil, nil, domain.ErrSessionNotFound()
	}

	// Session liveness: this run IS activity — slide the idle deadline so
	// an actively-used session is never swept (idle semantics, not a hard
	// lifetime). Best-effort: a failed touch never blocks a run.
	_ = s.sessions.TouchSession(sctx, idn.Tenant.ID, sessionID, s.sessionIdleTTL)

	// 9. Account/tenant/subscription state — full gate at run creation.
	if reason := idn.CanRun(); reason != "" {
		switch reason {
		case "SUBSCRIPTION_INACTIVE":
			return nil, nil, domain.ErrSubscriptionInactive()
		case "TENANT_SUSPENDED":
			return nil, nil, domain.ErrTenantSuspended()
		default:
			return nil, nil, domain.ErrForbidden("Account state does not permit this request.")
		}
	}

	// 8. Model entitlement (allowlist with patterns).
	if idn.Restricted && !modelAllowed(idn.Models, req.Model) {
		return nil, nil, domain.ErrModelNotEntitled(req.Model)
	}

	// 12–13. Payload validation.
	if de := req.Validate(s.limits); de != nil {
		return nil, nil, de
	}

	// 8b. Fallback entitlement (after format validation): every fallback
	// model must be inside the restricted allowlist too — listing an
	// off-allowlist model as a fallback must not bypass the primary
	// entitlement check (2026-09-19 audit finding).
	if idn.Restricted {
		for _, fb := range req.Fallbacks {
			if !modelAllowed(idn.Models, fb) {
				return nil, nil, domain.ErrModelNotEntitled(fb)
			}
		}
	}

	// 11b. Monthly token quota (plan-level, enforced at run creation — the
	// point of consumption; advertised in /v1/me and now actually binding).
	if de := s.quotaGate(sctx, idn); de != nil {
		return nil, nil, de
	}

	// 11. Distributed rate limiting (logical requests only).
	rpmUser, rpmTenant := s.rate.RPMUser, s.rate.RPMTenant
	concUser, concTenant := s.rate.ConcUser, s.rate.ConcTenant
	if idn.Limits.RequestsPerMinuteUser > 0 {
		rpmUser = idn.Limits.RequestsPerMinuteUser
	}
	if idn.Limits.RequestsPerMinuteTenant > 0 {
		rpmTenant = idn.Limits.RequestsPerMinuteTenant
	}
	if idn.Limits.ConcurrentRunsUser > 0 {
		concUser = idn.Limits.ConcurrentRunsUser
	}
	if idn.Limits.ConcurrentRunsTenant > 0 {
		concTenant = idn.Limits.ConcurrentRunsTenant
	}
	requestID := requestIDFrom(ctx)
	// ZSET member: SERVER-GENERATED and unique per admission. The inbound
	// X-Request-Id is client-controlled — reusing one fixed value would
	// dedupe every ZADD onto a single member and pin the window count at 1,
	// defeating both per-user and per-tenant RPM quotas (2026-09-19 audit,
	// finding 4: 20/20 billable runs admitted under a 5/min plan).
	verdict := s.lim.AllowAll(sctx, ids.RequestID(),
		ratelimit.Scope{Key: rlKey("user", idn.Tenant.ID, idn.User.ID), Limit: rpmUser, Window: time.Minute},
		ratelimit.Scope{Key: rlKey("tenant", idn.Tenant.ID, ""), Limit: rpmTenant, Window: time.Minute},
	)
	if !verdict.Allowed {
		if s.m != nil {
			s.m.RateLimited.Add(sctx, 1, observability.Attr("scope", "rpm"))
		}
		de := domain.ErrRateLimited(verdict.RetryAfter.Milliseconds(), "requests_per_minute")
		return nil, nil, de
	}

	// 10. Idempotency.
	idemKey := req.IdempotencyKey
	runID := ids.RunID()
	if idemKey != "" && s.idem != nil {
		outcome, prev, err := s.idem.Begin(sctx, idn.Tenant.ID, idn.User.ID, idemKey, req.fingerprint(), runID, sessionID)
		if err != nil {
			return nil, nil, domain.AsError(err)
		}
		switch outcome {
		case idempotency.Reuse:
			if s.m != nil {
				s.m.IdempotencyHits.Add(sctx, 1, observability.Attr("outcome", "reuse"))
			}
			return nil, nil, domain.ErrIdempotencyMismatch()
		case idempotency.InFlight:
			// Redis says the original is still running — but Redis is
			// not the truth. If the owning instance crashed, the PG row
			// is already terminal (swept as ORPHANED_RUN) while the
			// Redis claim still reads "running" for the full 24 h TTL.
			// Verify PostgreSQL before rejecting the retry, otherwise
			// a crashed instance poisons the key for ~24 h (audit
			// finding 5).
			orig, gerr := s.runs.Get(sctx, idn.Tenant.ID, prev.RunID)
			if gerr != nil {
				return nil, nil, storeMap(gerr)
			}
			if orig != nil && orig.Terminal() {
				// Stale claim (crashed instance): the authoritative
				// row is terminal — replay the original outcome.
				if s.m != nil {
					s.m.IdempotencyHits.Add(sctx, 1, observability.Attr("outcome", "in_flight_stale"))
				}
				return s.replayOutcome(sctx, idn, sessionID, prev, req)
			}
			if orig == nil && !prev.ClaimedAt.IsZero() {
				// Row not visible YET. A fresh claim means the
				// winner is between the Redis claim and the durable
				// insert (the normal concurrent-duplicate race —
				// observed by TestV05); an old claim means the
				// winner died inside that window and never inserted.
				grace := 2 * s.setupTimeout
				if grace < 30*time.Second {
					grace = 30 * time.Second
				}
				if time.Since(prev.ClaimedAt) > grace {
					if s.m != nil {
						s.m.IdempotencyHits.Add(sctx, 1, observability.Attr("outcome", "in_flight_stale"))
					}
					// Stale claim without a row: replayOutcome
					// aborts it and reports IDEMPOTENCY_ORPHANED;
					// the client's immediate retry starts fresh.
					return s.replayOutcome(sctx, idn, sessionID, prev, req)
				}
			}
			// Genuinely still running (PG confirms, or the insert
			// race has not settled): duplicate in progress.
			if s.m != nil {
				s.m.IdempotencyHits.Add(sctx, 1, observability.Attr("outcome", "in_flight"))
			}
			return nil, nil, domain.ErrDuplicate()
		case idempotency.Replay:
			return s.replayOutcome(sctx, idn, sessionID, prev, req)
		}
		if s.m != nil {
			s.m.IdempotencyHits.Add(sctx, 1, observability.Attr("outcome", "fresh"))
		}
	}

	// Concurrency slots.
	if de := s.mgr.AcquireSlots(sctx, idn.Tenant.ID, idn.User.ID, concUser, concTenant); de != nil {
		if s.m != nil {
			s.m.RateLimited.Add(sctx, 1, observability.Attr("scope", "concurrency"))
		}
		// The run never became durable: release the idempotency key so a
		// client retry is not answered DUPLICATE_IN_PROGRESS for the full
		// TTL (transient rejection must not poison the key).
		s.idemAbort(ctx, idn, idemKey, runID)
		return nil, nil, de
	}

	// 14. Durable run metadata.
	run := &domain.Run{
		ID:             runID,
		SessionID:      sessionID,
		TenantID:       idn.Tenant.ID,
		UserID:         idn.User.ID,
		RequestID:      requestID,
		TurnID:         req.TurnID,
		IdempotencyKey: idemKey,
		RequestedModel: req.Model,
		Stream:         req.Stream,
		Status:         domain.RunRunning,
		StartedAt:      time.Now().UTC(),
	}
	if err := s.runs.Create(sctx, run); err != nil {
		s.mgr.ReleaseSlots(ctx, idn.Tenant.ID, idn.User.ID)
		// DB-level idempotency backstop: another instance won the race.
		if isUnique(err) && idemKey != "" {
			existing, gerr := s.runs.GetByIdempotencyKey(sctx, idn.Tenant.ID, idn.User.ID, idemKey)
			if gerr == nil && existing != nil {
				// Our Redis claim points at a run that was never inserted;
				// repoint it to the authoritative run so future retries
				// take the fast replay path.
				s.idemRepoint(sctx, idn, idemKey, existing)
				return s.replayOutcome(ctx, idn, sessionID,
					&idempotency.Record{RunID: existing.ID, Status: existing.Status, SessionID: existing.SessionID}, req)
			}
		}
		// Durable write failed: the key must not stay "running" for the
		// full TTL — release it (retry may succeed once the fault clears).
		s.idemAbort(ctx, idn, idemKey, runID)
		return nil, nil, storeMap(err)
	}
	if s.m != nil {
		s.m.RunsStarted.Add(sctx, 1)
	}

	// Producer context: derived from the caller ctx (values + disconnect
	// propagation kept), cancellable with cause (user/disconnect/shutdown).
	// The run id is attached here so every Bifrost request this producer
	// makes carries x-nexau-run-id — the client-side reader existed but
	// nothing ever set the value, so the correlation header was always
	// empty (cleanup finding, 2026-09-23).
	runCtx, cancel := context.WithCancelCause(reqctx.WithRunID(ctx, run.ID))
	handle := &StreamHandle{Run: run, Cancel: cancel, ctx: runCtx, done: make(chan struct{})}
	s.mgr.Register(&activeRun{runID: run.ID, sessionID: sessionID, tenantID: idn.Tenant.ID, userID: idn.User.ID, cancel: cancel})

	if req.Stream {
		return nil, handle, nil
	}

	// stream=false: synchronous completion on the caller's goroutine.
	resp := s.completeSync(runCtx, idn, run, req)
	handle.Finish()
	return resp, nil, nil
}

// idemAbort releases an idempotency claim on a setup-context-free budget (the
// setup deadline may already be exhausted when this runs).
func (s *Service) idemAbort(ctx context.Context, idn *auth.Identity, key, runID string) {
	if s.idem == nil || key == "" {
		return
	}
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	s.idem.Abort(actx, idn.Tenant.ID, idn.User.ID, key, runID)
}

// idemRepoint rewrites the idempotency record to the authoritative run.
func (s *Service) idemRepoint(ctx context.Context, idn *auth.Identity, key string, run *domain.Run) {
	if s.idem == nil || key == "" || run == nil {
		return
	}
	actx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	defer cancel()
	s.idem.Repoint(actx, idn.Tenant.ID, idn.User.ID, key, &idempotency.Record{
		RunID: run.ID, Status: run.Status, SessionID: run.SessionID,
	})
}

// completeSync performs a non-streaming completion, bounded by the
// non-stream request budget (separate from stream lifecycles, spec §21) and
// finalizes the run.
func (s *Service) completeSync(ctx context.Context, idn *auth.Identity, run *domain.Run, req *RunRequest) *RunResponse {
	out := &RunResponse{Run: info(run)}
	ctx, cancel := context.WithTimeout(ctx, s.nonStreamTimeout)
	defer cancel()

	resp, err := s.bifrostCompletion(ctx, req)
	if err != nil {
		de := domain.AsError(err)
		s.finalize(ctx, idn, run, req, outcomeData{status: domain.RunFailed, errCode: de.Code})
		out.Run.Status = domain.RunFailed
		out.Run.ErrorCode = de.Code
		out.failErr = de
		return out
	}

	model, provider := "", ""
	if resp.ExtraFields != nil {
		model, provider = resp.ExtraFields.ResolvedModel(), resp.ExtraFields.Provider
	}
	usage := NormalizeUsage(resp.Usage)
	s.finalize(ctx, idn, run, req, outcomeData{
		status: domain.RunCompleted, model: model, provider: provider, usage: usage,
		latencyMS: latencyOf(resp.ExtraFields),
	})
	out.Run.Status = domain.RunCompleted
	out.Run.ResolvedModel = model
	out.Run.Provider = provider
	out.Usage = usage
	if blob, err := json.Marshal(resp); err == nil {
		out.Completion = blob
	}
	return out
}

// outcomeData is the finalization fact set.
type outcomeData struct {
	status       string
	errCode      string
	model        string
	provider     string
	usage        *domain.TokenUsage
	latencyMS    int64
	cancelReason string
	cancelBy     string
}

// finalize records usage + terminal state + slot/idempotency release exactly
// once per run. The DB WHERE status='running' guard makes concurrent terminal
// transitions (completion vs cancellation race) idempotent.
func (s *Service) finalize(ctx context.Context, idn *auth.Identity, run *domain.Run, req *RunRequest, out outcomeData) {
	// Detached from caller cancellation (billing must land), but with a
	// statement budget: a wedged PG cannot stall producers indefinitely
	// or extend graceful shutdown.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()

	// Usage first: billing must land even if the status write races.
	if s.meter != nil {
		s.meter.Record(domain.UsageRecord{
			RunID:          run.ID,
			CallSeq:        1,
			TenantID:       idn.Tenant.ID,
			UserID:         idn.User.ID,
			SessionID:      run.SessionID,
			Provider:       out.provider,
			Model:          orDefault(out.model, run.RequestedModel),
			RequestedModel: run.RequestedModel,
			Status:         out.status,
			Usage:          derefUsage(out.usage),
			LatencyMS:      int(out.latencyMS),
			StartedAt:      run.StartedAt,
			CompletedAt:    ptrTime(time.Now().UTC()),
		})
		if s.m != nil && out.usage != nil {
			s.m.UsageTokensIn.Add(ctx, out.usage.InputTokens, observability.Attr("model", run.RequestedModel))
			s.m.UsageTokensOut.Add(ctx, out.usage.OutputTokens, observability.Attr("model", run.RequestedModel))
		}
	}

	changed, err := s.runs.Complete(ctx, idn.Tenant.ID, run.ID, out.status,
		out.errCode, "", out.cancelReason, out.cancelBy, out.model, out.provider)
	if err != nil {
		observability.LogError("agent: run completion write failed",
			"run_id", run.ID, "error", err)
	}
	if s.m != nil {
		s.m.RunsCompleted.Add(ctx, 1, observability.Attr("status", out.status))
	}

	s.mgr.Deregister(run.ID)
	s.mgr.ReleaseSlots(ctx, idn.Tenant.ID, idn.User.ID)
	if s.idem != nil && run.IdempotencyKey != "" {
		s.idem.Complete(ctx, idn.Tenant.ID, idn.User.ID, run.IdempotencyKey, run.ID, out.status)
	}
	_ = changed
}

// AbortStream terminates a run that failed BEFORE its producer started
// (SSE writer setup failure — the transport cannot carry events). Cancels the
// run context, finalizes it (terminal state, usage zero-record, slot +
// idempotency release) and closes the handle synchronously — callers never
// wait on Done() (nothing else would ever close it) and the run never stays
// registered in the manager.
func (s *Service) AbortStream(idn *auth.Identity, handle *StreamHandle, req *RunRequest, cause string) {
	if handle == nil || handle.Run == nil {
		return
	}
	handle.Cancel(NewCancelCause(cause, idn.User.ID))
	status := domain.RunFailed
	if cause == CancelDisconnect {
		status = domain.RunDisconnected
	}
	s.finalize(handle.ctx, idn, handle.Run, req, outcomeData{
		status: status, cancelReason: cause, cancelBy: idn.User.ID,
	})
	handle.Finish()
}

// replayOutcome answers a duplicate request with the original run's state.
// It NEVER returns (nil, nil, nil): callers assume a non-nil response or
// handle and would panic on the producer path. An orphaned record (Redis
// entry whose PG row is gone) is released and reported as a conflict — the
// client's immediate retry starts fresh.
func (s *Service) replayOutcome(ctx context.Context, idn *auth.Identity, sessionID string, prev *idempotency.Record, req *RunRequest) (*RunResponse, *StreamHandle, *domain.Error) {
	run, err := s.runs.Get(ctx, idn.Tenant.ID, prev.RunID)
	if err != nil {
		return nil, nil, storeMap(err)
	}
	if run == nil {
		// Redis record exists but the PG row is gone: stale claim.
		s.idemAbort(ctx, idn, req.IdempotencyKey, prev.RunID)
		return nil, nil, domain.ErrIdemOrphaned()
	}
	return &RunResponse{Run: info(run)}, nil, nil
}

// GetRun resolves a run tenant-scoped.
func (s *Service) GetRun(ctx context.Context, idn *auth.Identity, runID string) (*domain.Run, *domain.Error) {
	if err := ids.Validate(runID, 64); err != nil {
		return nil, domain.ErrNotFound("run")
	}
	run, err := s.runs.Get(ctx, idn.Tenant.ID, runID)
	if err != nil {
		return nil, storeMap(err)
	}
	if run == nil {
		return nil, domain.ErrRunNotFound()
	}
	if run.UserID != idn.User.ID && !isPrivileged(idn) {
		// Tenant admins may inspect; members only see their own runs.
		return nil, domain.ErrRunNotFound()
	}
	return run, nil
}

// CancelRun aborts a run by id, wherever it lives (spec §20 propagation).
func (s *Service) CancelRun(ctx context.Context, idn *auth.Identity, runID string) (*domain.Run, *domain.Error) {
	run, derr := s.GetRun(ctx, idn, runID)
	if derr != nil {
		return nil, derr
	}
	if run.Terminal() {
		// Cancelling a finished run: idempotent success with final state.
		return run, nil
	}
	s.mgr.Cancel(ctx, run, CancelUser, idn.User.ID)
	// Optimistic state for the response; the producer finalizes authoritatively.
	run.Status = domain.RunCancelled
	run.CancelReason = CancelUser
	run.CancelBy = idn.User.ID
	return run, nil
}

// --- helpers ----------------------------------------------------------------

func (s *Service) bifrostCompletion(ctx context.Context, req *RunRequest) (*bifrost.ChatResponse, error) {
	return s.bifrost.Completion(ctx, req.ToBifrost())
}


func modelAllowed(allowlist []string, model string) bool {
	if len(allowlist) == 0 || model == "mash-agent" || model == "default" {
		return true
	}
	for _, pattern := range allowlist {
		if pattern == model {
			return true
		}
		if strings.HasSuffix(pattern, "/*") {
			if prefix := strings.TrimSuffix(pattern, "/*"); strings.HasPrefix(model, prefix+"/") {
				return true
			}
		}
	}
	return false
}

func rlKey(dim, tenantID, userID string) string {
	if userID != "" {
		return "rl:rpm:" + dim + ":" + tenantID + ":" + userID
	}
	return "rl:rpm:" + dim + ":" + tenantID
}

func requestIDFrom(ctx context.Context) string {
	if rid := reqctx.RequestID(ctx); rid != "" {
		return rid
	}
	return ids.RequestID()
}

// quotaGate enforces the plan's monthly token quota at run creation. Checked
// BEFORE the run starts (pre-run state), never mid-run: a run that begins
// inside the quota is allowed to finish. Inert when the plan sets no quota
// (MonthlyTokenQuota <= 0) or the usage seam is unwired. A usage-store
// failure fails OPEN (availability posture — matches the limiter), with the
// miss visible in logs and the QuotaGateFails metric.
func (s *Service) quotaGate(ctx context.Context, idn *auth.Identity) *domain.Error {
	quota := idn.Limits.MonthlyTokenQuota
	if quota <= 0 || s.usage == nil {
		return nil
	}
	used, err := s.usage.MonthToDateTokens(ctx, idn.Tenant.ID)
	if err != nil {
		observability.LogWarn("agent: quota gate usage query failed (fail-open)",
			"tenant_id", idn.Tenant.ID, "error", err)
		if s.m != nil {
			s.m.QuotaGateFails.Add(ctx, 1)
		}
		return nil
	}
	if used >= quota {
		observability.LogInfo("agent: monthly token quota exhausted",
			"tenant_id", idn.Tenant.ID, "used", used, "quota", quota)
		if s.m != nil {
			s.m.QuotaRejected.Add(ctx, 1)
		}
		return domain.ErrPlanQuotaExceeded(quota, used)
	}
	return nil
}

func isUnique(err error) bool {
	type sqlStater interface{ SQLState() string }
	var s sqlStater
	if errors.As(err, &s) {
		return s.SQLState() == "23505"
	}
	return false
}

func storeMap(err error) *domain.Error { return store.MapDBError(err) }

func safeMessage(de *domain.Error) string {
	if de == nil {
		return "The run failed."
	}
	return de.Message
}

func byOr(by, def string) string {
	if by != "" {
		return by
	}
	return def
}

func orDefault(v, def string) string {
	if v != "" {
		return v
	}
	return def
}

func derefUsage(u *domain.TokenUsage) domain.TokenUsage {
	if u == nil {
		return domain.TokenUsage{}
	}
	return *u
}

func ptrTime(t time.Time) *time.Time { return &t }

func latencyOf(ef *bifrost.ExtraFields) int64 {
	if ef == nil {
		return 0
	}
	return ef.Latency
}

// withoutCancelValuesShim is unused; retained as documentation marker.

func isPrivileged(idn *auth.Identity) bool {
	return idn.Membership.Role == domain.RoleOwner || idn.Membership.Role == domain.RoleAdmin
}
