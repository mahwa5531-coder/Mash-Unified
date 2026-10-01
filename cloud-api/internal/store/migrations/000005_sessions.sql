-- 0005 agent sessions (cloud-side metadata only; desktop owns full agent state)

CREATE TABLE IF NOT EXISTS agent_sessions (
    id            TEXT PRIMARY KEY,                     -- sess_<ulid>
    tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'closed', 'expired')),
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- client hints (labels), never message content
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ                           -- idle expiry
);
-- Tenant isolation + hot list queries
CREATE INDEX IF NOT EXISTS ix_agent_sessions_tenant_user
    ON agent_sessions (tenant_id, user_id, last_seen_at DESC)
    WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sessions_tenant
    ON agent_sessions (id, tenant_id);
COMMENT ON INDEX uq_agent_sessions_tenant IS 'Idempotency/lookup guard: a session id belongs to exactly one tenant (defense in depth for tenant isolation).';
