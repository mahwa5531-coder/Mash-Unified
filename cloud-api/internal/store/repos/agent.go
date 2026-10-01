package repos

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// SessionsRepo manages cloud-side agent session metadata.
type SessionsRepo struct{ Pool *pgxpool.Pool }

func NewSessions(p *pgxpool.Pool) *SessionsRepo { return &SessionsRepo{Pool: p} }

const sessionCols = `id, tenant_id, user_id, status, metadata, created_at, last_seen_at, expires_at`

func scanSession(row pgx.Row) (*domain.Session, error) {
	s := &domain.Session{}
	var meta []byte
	err := row.Scan(&s.ID, &s.TenantID, &s.UserID, &s.Status, &meta,
		&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt)
	if err == nil && len(meta) > 0 {
		_ = jsonUnmarshal(meta, &s.Metadata)
	}
	return s, err
}

// Create inserts a session, persisting the (bounded, labels-only) metadata.
// Tenant-scoped uniqueness is guarded by the uq_agent_sessions_tenant index
// (session ids cannot cross tenants).
func (r *SessionsRepo) Create(ctx context.Context, s *domain.Session) error {
	meta, err := jsonMarshal(s.Metadata)
	if err != nil {
		return err
	}
	_, err = r.Pool.Exec(ctx, `
                INSERT INTO agent_sessions (id, tenant_id, user_id, status, metadata, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6)`,
		s.ID, s.TenantID, s.UserID, s.Status, meta, s.ExpiresAt)
	return err
}

// Get enforces tenant isolation: a session id resolves only within its tenant.
func (r *SessionsRepo) Get(ctx context.Context, tenantID, id string) (*domain.Session, error) {
	s, err := scanSession(r.Pool.QueryRow(ctx,
		`SELECT `+sessionCols+` FROM agent_sessions WHERE id = $1 AND tenant_id = $2`, id, tenantID))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return s, err
}

// TouchSession updates liveness AND slides the idle deadline: expires_at
// moves to now+ttl on every touch, so an active session is never closed by
// the sweeper — only genuinely idle ones are (idle semantics, not a hard
// lifetime).
func (r *SessionsRepo) TouchSession(ctx context.Context, tenantID, id string, ttl time.Duration) error {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	_, err := r.Pool.Exec(ctx, `
                UPDATE agent_sessions SET last_seen_at = now(),
                        expires_at = now() + make_interval(secs => $3)
                WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, id, tenantID, ttl.Seconds())
	return err
}

// Close marks a session closed (client-driven end).
func (r *SessionsRepo) Close(ctx context.Context, tenantID, id string) error {
	ct, err := r.Pool.Exec(ctx, `
                UPDATE agent_sessions SET status = 'closed', last_seen_at = now()
                WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, id, tenantID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return domain.ErrSessionNotFound()
	}
	return nil
}

// ListForUser returns the caller's active sessions (tenant-scoped).
func (r *SessionsRepo) ListForUser(ctx context.Context, tenantID, userID string, limit int) ([]domain.Session, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := r.Pool.Query(ctx, `
                SELECT `+sessionCols+` FROM agent_sessions
                WHERE tenant_id = $1 AND user_id = $2
                ORDER BY last_seen_at DESC LIMIT $3`, tenantID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Session
	for rows.Next() {
		var s domain.Session
		var meta []byte
		if err := rows.Scan(&s.ID, &s.TenantID, &s.UserID, &s.Status, &meta,
			&s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt); err != nil {
			return nil, err
		}
		if len(meta) > 0 {
			_ = jsonUnmarshal(meta, &s.Metadata)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ExpireIdle closes sessions past their idle horizon (background sweeper).
// A session is idle when its sliding deadline elapsed (expires_at < now)
// OR its last activity is older than idleBefore — belt and braces: both
// guards implement the same NEXAU_SESSION_IDLE_TTL window.
func (r *SessionsRepo) ExpireIdle(ctx context.Context, idleBefore time.Time) (int64, error) {
	ct, err := r.Pool.Exec(ctx, `
                UPDATE agent_sessions SET status = 'closed'
                WHERE status = 'active'
                  AND ((expires_at IS NOT NULL AND expires_at < now()) OR last_seen_at < $1)`,
		idleBefore)
	if err != nil {
		return 0, err
	}
	return ct.RowsAffected(), nil
}

// RunsRepo manages the agent run registry.
type RunsRepo struct{ Pool *pgxpool.Pool }

func NewRuns(p *pgxpool.Pool) *RunsRepo { return &RunsRepo{Pool: p} }

const runCols = `id, session_id, tenant_id, user_id, request_id, turn_id, idempotency_key,
        requested_model, resolved_model, provider, stream, status, error_code, error_message,
        cancel_reason, cancel_by, started_at, completed_at`

func scanRun(row pgx.Row) (*domain.Run, error) {
	r := &domain.Run{}
	// Nullable text columns MUST scan into sql.NullString: the DDL allows
	// NULL for all of these, and a NULL into a plain *string is a scan
	// error (same class as the refresh-token F4 fix; E2E 2026-09-23).
	var turnID, idemKey, resolvedModel, provider, errCode, errMsg,
		cancelReason, cancelBy sql.NullString
	err := row.Scan(&r.ID, &r.SessionID, &r.TenantID, &r.UserID, &r.RequestID,
		&turnID, &idemKey, &r.RequestedModel, &resolvedModel, &provider,
		&r.Stream, &r.Status, &errCode, &errMsg, &cancelReason, &cancelBy,
		&r.StartedAt, &r.CompletedAt)
	if err != nil {
		return r, err
	}
	r.TurnID = turnID.String
	r.IdempotencyKey = idemKey.String
	r.ResolvedModel = resolvedModel.String
	r.Provider = provider.String
	r.ErrorCode = errCode.String
	r.ErrorMessage = errMsg.String
	r.CancelReason = cancelReason.String
	r.CancelBy = cancelBy.String
	return r, nil
}

func (r *RunsRepo) Create(ctx context.Context, run *domain.Run) error {
	// idempotency_key: an ABSENT key must be SQL NULL, never ''. The
	// uq_agent_runs_idempotency partial index only ignores NULL rows — an
	// empty string collided and 409'd every subsequent keyless run per
	// (tenant, user), making the chat surface single-use (real-PG E2E
	// 2026-09-23).
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO agent_runs (id, session_id, tenant_id, user_id, request_id, turn_id,
                        idempotency_key, requested_model, stream, status, started_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
		run.ID, run.SessionID, run.TenantID, run.UserID, run.RequestID,
		nullIfEmpty(run.TurnID), nullIfEmpty(run.IdempotencyKey),
		run.RequestedModel, run.Stream, run.Status, run.StartedAt)
	return err
}

// Get is tenant-scoped.
func (r *RunsRepo) Get(ctx context.Context, tenantID, id string) (*domain.Run, error) {
	run, err := scanRun(r.Pool.QueryRow(ctx,
		`SELECT `+runCols+` FROM agent_runs WHERE id = $1 AND tenant_id = $2`, id, tenantID))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return run, err
}

// GetByIdempotencyKey resolves a previously-created durable run for the same
// logical request (DB backstop beneath the Redis idempotency layer).
func (r *RunsRepo) GetByIdempotencyKey(ctx context.Context, tenantID, userID, key string) (*domain.Run, error) {
	run, err := scanRun(r.Pool.QueryRow(ctx, `
                SELECT `+runCols+` FROM agent_runs
                WHERE tenant_id = $1 AND user_id = $2 AND idempotency_key = $3`, tenantID, userID, key))
	if store.IsNotFound(err) {
		return nil, nil
	}
	return run, err
}

// Complete transitions a running run to a terminal state exactly once: the
// WHERE status='running' guard makes concurrent terminal transitions
// (stream completion vs cancellation race) idempotent.
func (r *RunsRepo) Complete(ctx context.Context, tenantID, runID, status, errorCode, errorMessage, cancelReason, cancelBy, resolvedModel, provider string) (bool, error) {
	ct, err := r.Pool.Exec(ctx, `
                UPDATE agent_runs SET
                        status = $3, error_code = $4, error_message = $5, cancel_reason = $6,
                        cancel_by = $7, resolved_model = COALESCE($8, resolved_model),
                        provider = COALESCE($9, provider),
                        completed_at = now(), last_event_at = now()
                WHERE id = $1 AND tenant_id = $2 AND status = 'running'`,
		runID, tenantID, status, nullIfEmpty(errorCode), nullIfEmpty(errorMessage),
		nullIfEmpty(cancelReason), nullIfEmpty(cancelBy), nullIfEmpty(resolvedModel), nullIfEmpty(provider))
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() > 0, nil
}

// SetRunning is used by the recovery path that re-registers an adopted run.
func (r *RunsRepo) SetRunning(ctx context.Context, tenantID, runID string) error {
	_, err := r.Pool.Exec(ctx, `
                UPDATE agent_runs SET status = 'running' WHERE id = $1 AND tenant_id = $2`, runID, tenantID)
	return err
}

// SetFirstEvent stamps the first event time (billing latency start).
func (r *RunsRepo) SetFirstEvent(ctx context.Context, tenantID, runID string) error {
	_, err := r.Pool.Exec(ctx, `
                UPDATE agent_runs SET first_event_at = COALESCE(first_event_at, now()), last_event_at = now()
                WHERE id = $1 AND tenant_id = $2`, runID, tenantID)
	return err
}

// RunningOwner identifies one (tenant, user) pair whose Redis concurrency
// slots must be reconciled, carrying the authoritative PostgreSQL counts.
type RunningOwner struct {
	TenantID      string
	UserID        string
	TenantRunning int // running runs in the whole tenant
	UserRunning   int // running runs of this user (user slots are tenant-free)
}

// ReapAndListSlotOwners is the housekeeping crash-recovery primitive: it
// reaps stuck 'running' rows (instance died mid-run → failed/ORPHANED_RUN)
// AND returns every (tenant, user) pair whose Redis concurrency counters must
// be reset to PostgreSQL truth:
//
//   - owners of still-running runs (post-reap), correcting any drift (e.g. a
//     Release dropped on a canceled context), and
//   - owners of the reaped rows, whose counters must fall to the new truth —
//     possibly zero — instead of waiting out the slot TTL (audit finding 4).
//
// Reconciliation is a single-key SET and therefore race-tolerant by design:
// a run starting between the snapshot and the SET is temporarily
// undercounted (bounded by the sweep interval, over-admission only); the
// slot TTL remains the hard backstop for anything the window misses.
func (r *RunsRepo) ReapAndListSlotOwners(ctx context.Context, olderThan time.Time) ([]RunningOwner, int64, error) {
	// 1. Reap stuck rows, remembering their owners.
	reapedRows, err := r.Pool.Query(ctx, `
                UPDATE agent_runs SET status = 'failed', error_code = 'ORPHANED_RUN',
                        error_message = 'Run was not finalized by its originating instance.',
                        completed_at = now()
                WHERE status = 'running' AND started_at < $1
                RETURNING tenant_id, user_id`, olderThan)
	if err != nil {
		return nil, 0, err
	}
	type ownerKey struct{ tenant, user string }
	reaped := map[ownerKey]struct{}{}
	var reapedCount int64
	for reapedRows.Next() {
		var k ownerKey
		if err := reapedRows.Scan(&k.tenant, &k.user); err != nil {
			reapedRows.Close()
			return nil, 0, err
		}
		reaped[k] = struct{}{}
		reapedCount++
	}
	if err := reapedRows.Err(); err != nil {
		reapedRows.Close()
		return nil, 0, err
	}
	reapedRows.Close()

	// 2. Post-reap truth: per (tenant, user) with per-dimension window counts.
	// Window functions are evaluated before DISTINCT, so the counts are exact
	// per row and DISTINCT dedups the (tenant, user) pairs.
	rows, err := r.Pool.Query(ctx, `
                SELECT DISTINCT tenant_id, user_id,
                        count(*) OVER (PARTITION BY tenant_id),
                        count(*) OVER (PARTITION BY user_id)
                FROM agent_runs WHERE status = 'running'`)
	if err != nil {
		return nil, 0, err
	}
	owners := make([]RunningOwner, 0, 8)
	tenantTotals := map[string]int{}
	userTotals := map[string]int{}
	seen := map[ownerKey]struct{}{}
	for rows.Next() {
		var tenantID, userID string
		var tenantN, userN int64
		if err := rows.Scan(&tenantID, &userID, &tenantN, &userN); err != nil {
			rows.Close()
			return nil, 0, err
		}
		o := RunningOwner{TenantID: tenantID, UserID: userID,
			TenantRunning: int(tenantN), UserRunning: int(userN)}
		owners = append(owners, o)
		seen[ownerKey{tenantID, userID}] = struct{}{}
		if o.TenantRunning > tenantTotals[tenantID] {
			tenantTotals[tenantID] = o.TenantRunning
		}
		if o.UserRunning > userTotals[userID] {
			userTotals[userID] = o.UserRunning
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, 0, err
	}
	rows.Close()

	// 3. Reaped owners not in the running set: reconcile to the residual truth
	// (their own runs are gone; tenant/user may still have other runs).
	for k := range reaped {
		if _, ok := seen[k]; ok {
			continue
		}
		owners = append(owners, RunningOwner{
			TenantID:      k.tenant,
			UserID:        k.user,
			TenantRunning: tenantTotals[k.tenant],
			UserRunning:   userTotals[k.user],
		})
	}
	return owners, reapedCount, nil
}

// CountRunning tallies a user/tenant's running runs (quota reconciliation).
func (r *RunsRepo) CountRunning(ctx context.Context, tenantID string, userID string) (int, error) {
	var n int
	err := r.Pool.QueryRow(ctx, `
                SELECT count(*) FROM agent_runs
                WHERE tenant_id = $1 AND status = 'running' AND ($2 = '' OR user_id = $2)`,
		tenantID, userID).Scan(&n)
	return n, err
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// UsageRepo reads usage aggregates (writes go through the metering batcher).
type UsageRepo struct{ Pool *pgxpool.Pool }

func NewUsage(p *pgxpool.Pool) *UsageRepo { return &UsageRepo{Pool: p} }

// InsertUsageRecords batch-inserts authoritative usage rows. ON CONFLICT
// (run_id, call_seq) DO NOTHING gives exactly-once semantics under retries.
func (r *UsageRepo) InsertUsageRecords(ctx context.Context, recs []domain.UsageRecord) error {
	if len(recs) == 0 {
		return nil
	}
	// Single statement, multi-row VALUES — one round trip per batch.
	sql := `
                INSERT INTO usage_records (run_id, call_seq, tenant_id, user_id, session_id,
                        provider, model, requested_model, status, input_tokens, output_tokens,
                        total_tokens, reasoning_tokens, cache_read_tokens, cache_write_tokens,
                        input_cost, output_cost, total_cost, latency_ms, started_at, completed_at)
                VALUES `
	args := make([]any, 0, len(recs)*21)
	for i, rec := range recs {
		if i > 0 {
			sql += ","
		}
		base := i * 21
		sql += "("
		for j := 1; j <= 21; j++ {
			sql += "$" + itoa(base+j)
			if j < 21 {
				sql += ","
			}
		}
		sql += ")"
		args = append(args,
			rec.RunID, rec.CallSeq, rec.TenantID, rec.UserID, rec.SessionID,
			nullIfEmpty(rec.Provider), rec.Model, nullIfEmpty(rec.RequestedModel), rec.Status,
			rec.Usage.InputTokens, rec.Usage.OutputTokens, rec.Usage.TotalTokens,
			rec.Usage.ReasoningTokens, rec.Usage.CacheReadTokens, rec.Usage.CacheWriteTokens,
			nullFloat(rec.Usage.InputCost), nullFloat(rec.Usage.OutputCost), nullFloat(rec.Usage.TotalCost),
			rec.LatencyMS, rec.StartedAt, rec.CompletedAt,
		)
	}
	sql += " ON CONFLICT (run_id, call_seq) DO NOTHING"
	_, err := r.Pool.Exec(ctx, sql, args...)
	return err
}

// Summary aggregates the tenant's usage in [from, to).
func (r *UsageRepo) Summary(ctx context.Context, tenantID string, from, to time.Time) (*domain.UsageSummary, error) {
	s := &domain.UsageSummary{TenantID: tenantID, From: from, To: to}
	err := r.Pool.QueryRow(ctx, `
                SELECT count(*), COALESCE(sum(input_tokens),0), COALESCE(sum(output_tokens),0),
                       COALESCE(sum(total_tokens),0), COALESCE(sum(reasoning_tokens),0),
                       COALESCE(sum(cache_read_tokens),0), COALESCE(sum(cache_write_tokens),0),
                       COALESCE(sum(COALESCE(total_cost,0)),0)
                FROM usage_records
                WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
		tenantID, from, to).
		Scan(&s.Calls, &s.InputTokens, &s.OutputTokens, &s.TotalTokens,
			&s.ReasoningTokens, &s.CacheReadTokens, &s.CacheWriteTokens, &s.TotalCost)
	if err != nil {
		return nil, err
	}
	return s, nil
}

// MonthToDateTokens sums input+output tokens the tenant consumed in the
// current calendar month (UTC) — the enforcement input for the plan quota
// gate at run creation. Index (tenant_id, recorded_at) keeps it O(log n).
func (r *UsageRepo) MonthToDateTokens(ctx context.Context, tenantID string) (int64, error) {
	var used int64
	err := r.Pool.QueryRow(ctx, `
                SELECT COALESCE(sum(input_tokens),0) + COALESCE(sum(output_tokens),0)
                FROM usage_records
                WHERE tenant_id = $1 AND recorded_at >= date_trunc('month', now() at time zone 'utc')`,
		tenantID).Scan(&used)
	if err != nil {
		return 0, err
	}
	return used, nil
}

// ByModel groups usage by model in the window (GET /v1/usage detail).
func (r *UsageRepo) ByModel(ctx context.Context, tenantID string, from, to time.Time) ([]map[string]any, error) {
	rows, err := r.Pool.Query(ctx, `
                SELECT model, count(*), COALESCE(sum(input_tokens),0), COALESCE(sum(output_tokens),0),
                       COALESCE(sum(total_tokens),0), COALESCE(sum(COALESCE(total_cost,0)),0)
                FROM usage_records
                WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < $3
                GROUP BY model ORDER BY sum(total_tokens) DESC LIMIT 100`,
		tenantID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var model string
		var calls, in, outTok, tot int64
		var cost float64
		if err := rows.Scan(&model, &calls, &in, &outTok, &tot, &cost); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"model": model, "calls": calls,
			"input_tokens": in, "output_tokens": outTok, "total_tokens": tot, "total_cost": cost,
		})
	}
	return out, rows.Err()
}

func nullFloat(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}

func itoa(n int) string { return strconv.Itoa(n) }
