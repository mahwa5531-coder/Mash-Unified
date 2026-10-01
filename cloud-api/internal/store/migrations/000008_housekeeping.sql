-- 0008 housekeeping: schema version bookkeeping table for the embedded migration
-- runner is created by the runner itself (schema_migrations). This migration adds
-- operational views used by /v1/usage and internal reconciliation.

-- Usage rollup used by GET /v1/usage (single scan per window).
CREATE MATERIALIZED VIEW IF NOT EXISTS usage_daily_tenant AS
SELECT tenant_id,
       date_trunc('day', recorded_at) AS day,
       model,
       count(*)                        AS calls,
       sum(input_tokens)               AS input_tokens,
       sum(output_tokens)              AS output_tokens,
       sum(total_tokens)               AS total_tokens,
       sum(reasoning_tokens)           AS reasoning_tokens,
       sum(cache_read_tokens)          AS cache_read_tokens,
       sum(cache_write_tokens)         AS cache_write_tokens,
       sum(COALESCE(total_cost, 0))    AS total_cost
FROM usage_records
GROUP BY tenant_id, date_trunc('day', recorded_at), model;

CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_daily_tenant
    ON usage_daily_tenant (tenant_id, day, model);

-- Orphaned/stuck-run reconciliation helper: runs stuck 'running' past the
-- maximum stream lifetime are expired by the run manager; this view surfaces
-- anything the manager itself could not close (instance crash).
CREATE OR REPLACE VIEW v_stuck_runs AS
SELECT id, tenant_id, session_id, user_id, started_at, requested_model
FROM agent_runs
WHERE status = 'running'
  AND started_at < now() - interval '1 hour';
