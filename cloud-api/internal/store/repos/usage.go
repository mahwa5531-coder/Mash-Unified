package repos

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// LLMCallsRepo persists and aggregates llm_calls — the only model-activity
// table. One row per proxied request, written once at completion (metering
// facts only; payloads are never stored).
type LLMCallsRepo struct{ Pool *pgxpool.Pool }

func NewLLMCalls(p *pgxpool.Pool) *LLMCallsRepo { return &LLMCallsRepo{Pool: p} }

// InsertCalls writes a batch of completed calls. ON CONFLICT (call_id) DO
// NOTHING keeps the write idempotent under metering-batch retries — a retried
// batch can never double-charge.
func (r *LLMCallsRepo) InsertCalls(ctx context.Context, calls []domain.LLMCall) error {
	if len(calls) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for i := range calls {
		c := &calls[i]
		status := c.Status
		if status == "" {
			status = domain.CallCompleted
		}
		var completedAt any
		if c.CompletedAt != nil {
			completedAt = *c.CompletedAt
		}
		b.Queue(`
                        INSERT INTO llm_calls (
                                call_id, tenant_id, user_id, request_id,
                                requested_model, resolved_model, provider, stream,
                                status, error_code, error_message,
                                input_tokens, output_tokens, total_tokens,
                                raw_prompt_tokens, raw_completion_tokens,
                                reasoning_tokens, cache_read_tokens, cache_write_tokens,
                                input_cost, output_cost, total_cost,
                                latency_ms, started_at, completed_at
                        ) VALUES (
                                $1, $2, $3, $4,
                                $5, $6, $7, $8,
                                $9, $10, $11,
                                $12, $13, $14,
                                $15, $16,
                                $17, $18, $19,
                                $20, $21, $22,
                                $23, $24, $25
                        )
                        ON CONFLICT (call_id) DO NOTHING`,
			c.CallID, c.TenantID, c.UserID, c.RequestID,
			c.RequestedModel, c.ResolvedModel, c.Provider, c.Stream,
			status, nullString(c.ErrorCode), nullString(c.ErrorMessage),
			c.Usage.InputTokens, c.Usage.OutputTokens, c.Usage.TotalTokens,
			c.Usage.RawPromptTokens, c.Usage.RawCompletionTokens,
			c.Usage.ReasoningTokens, c.Usage.CacheReadTokens, c.Usage.CacheWriteTokens,
			nullFloat(c.Usage.InputCost), nullFloat(c.Usage.OutputCost), nullFloat(c.Usage.TotalCost),
			c.LatencyMS, c.StartedAt, completedAt)
	}
	return r.Pool.SendBatch(ctx, b).Close()
}

// Summary aggregates one tenant's usage over [from, to).
func (r *LLMCallsRepo) Summary(ctx context.Context, tenantID string, from, to time.Time) (*domain.UsageSummary, error) {
	s := &domain.UsageSummary{TenantID: tenantID, From: from, To: to}
	err := r.Pool.QueryRow(ctx, `
                SELECT count(*),
                       COALESCE(sum(input_tokens), 0),
                       COALESCE(sum(output_tokens), 0),
                       COALESCE(sum(total_tokens), 0),
                       COALESCE(sum(reasoning_tokens), 0),
                       COALESCE(sum(cache_read_tokens), 0),
                       COALESCE(sum(cache_write_tokens), 0),
                       COALESCE(sum(COALESCE(total_cost, 0)), 0)
                FROM llm_calls
                WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < $3`,
		tenantID, from, to).
		Scan(&s.Calls, &s.InputTokens, &s.OutputTokens, &s.TotalTokens,
			&s.ReasoningTokens, &s.CacheReadTokens, &s.CacheWriteTokens, &s.TotalCost)
	if err != nil {
		return nil, err
	}
	return s, nil
}

// ByModel aggregates one tenant's usage over [from, to), grouped by the
// resolved model.
func (r *LLMCallsRepo) ByModel(ctx context.Context, tenantID string, from, to time.Time) ([]map[string]any, error) {
	rows, err := r.Pool.Query(ctx, `
                SELECT COALESCE(resolved_model, requested_model) AS model,
                       count(*),
                       COALESCE(sum(input_tokens), 0),
                       COALESCE(sum(output_tokens), 0),
                       COALESCE(sum(total_tokens), 0),
                       COALESCE(sum(COALESCE(total_cost, 0)), 0)
                FROM llm_calls
                WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < $3
                GROUP BY 1
                ORDER BY 5 DESC`, tenantID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var model string
		var calls, in, outT, total int64
		var cost float64
		if err := rows.Scan(&model, &calls, &in, &outT, &total, &cost); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"model": model, "calls": calls,
			"input_tokens": in, "output_tokens": outT,
			"total_tokens": total, "total_cost": cost,
		})
	}
	return out, rows.Err()
}

// WindowUsage reports the tenant's rolling-window normalized-token position:
// Used5h sums total_tokens over the last 5 hours, UsedWeekly over the last 7
// days. One indexed round trip — the exact numbers the quota gate admits
// against and /v1/me renders, so the desktop usage bar can never diverge from
// enforcement.
func (r *LLMCallsRepo) WindowUsage(ctx context.Context, tenantID string) (*domain.WindowUsage, error) {
	var u domain.WindowUsage
	err := r.Pool.QueryRow(ctx, `
                SELECT COALESCE(sum(total_tokens) FILTER (WHERE recorded_at >= now() - interval '5 hours'), 0),
                       COALESCE(sum(total_tokens) FILTER (WHERE recorded_at >= now() - interval '7 days'), 0)
                FROM llm_calls
                WHERE tenant_id = $1
                  AND recorded_at >= now() - interval '7 days'`,
		tenantID).Scan(&u.Used5h, &u.UsedWeekly)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// WindowRecovery returns the earliest instant the window's usage drops back
// below quota (nil when it already is below). It is the exact answer to "when
// can I run again": rows leave a rolling window oldest-first, so the first
// oldest-ordered prefix whose cumulative sum exceeds (used - quota) pins the
// recovery time to its expiry (recorded_at + window).
//
// Precondition: used >= quota (the caller only asks on the rejection path or
// for an at-quota display); used < quota returns nil immediately.
func (r *LLMCallsRepo) WindowRecovery(ctx context.Context, tenantID string, window time.Duration, quota, used int64) (*time.Time, error) {
	if used < quota {
		return nil, nil
	}
	interval := fmt.Sprintf("%d seconds", int64(window.Seconds()))
	var resets *time.Time
	err := r.Pool.QueryRow(ctx, `
                SELECT MIN(expiry) FROM (
                        SELECT recorded_at + $2::interval AS expiry
                        FROM (
                                SELECT recorded_at, total_tokens,
                                       sum(total_tokens) OVER (ORDER BY recorded_at ASC, id ASC
                                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
                                FROM llm_calls
                                WHERE tenant_id = $1
                                  AND recorded_at >= now() - $2::interval
                                  AND total_tokens > 0
                        ) w
                        WHERE cum > $3
                ) e`,
		tenantID, interval, used-quota).Scan(&resets)
	if err != nil {
		return nil, err
	}
	return resets, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullFloat(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}
