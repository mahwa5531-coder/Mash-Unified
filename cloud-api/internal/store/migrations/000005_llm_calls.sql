-- 0005 llm_calls — the ONLY model-activity table.
--
-- The agent runtime lives entirely on the user's desktop. The cloud stores one
-- row per proxied LLM call for quota accounting and usage display — never
-- message content, never transcripts, never agent state. Prompt/completion
-- payloads transit the wire but are not persisted anywhere in this layer.

CREATE TABLE IF NOT EXISTS llm_calls (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    call_id        TEXT NOT NULL UNIQUE,                -- llm_<ulid> (server-generated)
    tenant_id      TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id     TEXT NOT NULL,                       -- correlation id (x-request-id)
    requested_model TEXT NOT NULL,                      -- client-requested "provider/model"
    resolved_model TEXT,                                -- model actually served (Bifrost)
    provider       TEXT,                                -- upstream provider
    stream         BOOLEAN NOT NULL DEFAULT TRUE,
    status         TEXT NOT NULL
                   CHECK (status IN ('completed', 'failed', 'cancelled')),
    error_code     TEXT,
    error_message  TEXT,
    input_tokens      BIGINT NOT NULL DEFAULT 0,
    output_tokens     BIGINT NOT NULL DEFAULT 0,
    total_tokens      BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens  BIGINT NOT NULL DEFAULT 0,
    cache_read_tokens  BIGINT NOT NULL DEFAULT 0,
    cache_write_tokens BIGINT NOT NULL DEFAULT 0,
    input_cost     NUMERIC(18,8),
    output_cost    NUMERIC(18,8),
    total_cost     NUMERIC(18,8),
    latency_ms     INT,
    started_at     TIMESTAMPTZ NOT NULL,
    completed_at   TIMESTAMPTZ,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usage windows + quota gate.
CREATE INDEX IF NOT EXISTS ix_llm_calls_tenant_time
    ON llm_calls (tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ix_llm_calls_user_time
    ON llm_calls (user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ix_llm_calls_tenant_model_time
    ON llm_calls (tenant_id, resolved_model, recorded_at DESC);

COMMENT ON TABLE llm_calls IS 'One row per proxied LLM request: metering facts only (tokens, cost, latency, status). No payloads, no agent state — those live on the desktop.';
