-- 0006 agent runs (one row per logical LLM request / agent turn segment)

CREATE TABLE IF NOT EXISTS agent_runs (
    id                TEXT PRIMARY KEY,                 -- run_<ulid>
    session_id        TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
    tenant_id         TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id        TEXT NOT NULL,                    -- HTTP request correlation (req_<ulid>)
    turn_id           TEXT,                             -- optional client turn correlation
    idempotency_key   TEXT,
    requested_model   TEXT NOT NULL,                    -- e.g. "anthropic/claude-sonnet-4-5"
    resolved_model    TEXT,                             -- model_deployment actually used (from Bifrost)
    provider          TEXT,
    stream            BOOLEAN NOT NULL DEFAULT FALSE,
    status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'completed', 'failed',
                                        'cancelled', 'disconnected', 'expired')),
    error_code        TEXT,                             -- NexaU error code, never raw provider detail
    error_message     TEXT,
    cancel_reason     TEXT,                             -- 'user' | 'disconnect' | 'shutdown' | 'upstream'
    cancel_by         TEXT,                             -- user id / 'system'
    attempt           INT NOT NULL DEFAULT 1,           -- internal retry attempt count
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_event_at    TIMESTAMPTZ,
    last_event_at     TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_tenant
    ON agent_runs (id, tenant_id);
CREATE INDEX IF NOT EXISTS ix_agent_runs_session
    ON agent_runs (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_agent_runs_tenant_time
    ON agent_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_agent_runs_status_running
    ON agent_runs (tenant_id, status) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_idempotency
    ON agent_runs (tenant_id, user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
COMMENT ON INDEX uq_agent_runs_idempotency IS 'DB-level backstop: one durable run per idempotency key even if Redis state was lost.';

COMMENT ON TABLE agent_runs IS 'Authoritative run registry: status, attribution and outcome. Message content itself lives on the desktop (UMP history) — the cloud stores metadata only.';
