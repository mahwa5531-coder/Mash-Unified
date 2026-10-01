-- 0007 usage records (authoritative billing/attribution)

CREATE TABLE IF NOT EXISTS usage_records (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id               TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    call_seq             INT NOT NULL DEFAULT 1,        -- 1 per LLM call within the run (future: multi-call runs)
    tenant_id            TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id              TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id           TEXT NOT NULL REFERENCES agent_sessions (id) ON DELETE CASCADE,
    provider             TEXT,
    model                TEXT NOT NULL,                 -- resolved model (provider/model or deployment)
    requested_model      TEXT,
    status               TEXT NOT NULL,                 -- run outcome at meter time
    -- NexAU TokenUsage canonical fields (Bifrost BifrostLLMUsage normalized)
    input_tokens         BIGINT NOT NULL DEFAULT 0,
    output_tokens        BIGINT NOT NULL DEFAULT 0,
    total_tokens         BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens     BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens    BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens   BIGINT NOT NULL DEFAULT 0,
    -- Bifrost cost (USD, provider-quoted where available)
    input_cost           NUMERIC(18, 8),
    output_cost          NUMERIC(18, 8),
    total_cost           NUMERIC(18, 8),
    latency_ms           INT,                           -- Bifrost-reported latency
    started_at           TIMESTAMPTZ NOT NULL,
    completed_at         TIMESTAMPTZ,
    recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Exactly-once: a retried/duplicated write for the same (run, call) is a no-op.
    UNIQUE (run_id, call_seq)
);
CREATE INDEX IF NOT EXISTS ix_usage_tenant_time
    ON usage_records (tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_tenant_model_time
    ON usage_records (tenant_id, model, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ix_usage_user_time
    ON usage_records (user_id, recorded_at DESC);

COMMENT ON TABLE usage_records IS 'Authoritative usage for billing. Only provider-returned (Bifrost) counts are recorded; client-declared token counts are never persisted as billing facts.';
