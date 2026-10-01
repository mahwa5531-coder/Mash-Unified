-- 0003 plans, subscriptions, entitlements

CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,                       -- pln_<code>
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    -- Enforced limits: requests_per_minute, concurrent_runs_per_user,
    -- concurrent_runs_per_tenant, max_request_bytes, monthly_token_quota
    limits      JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Model allowlist entries: exact ("openai/gpt-4o") or pattern ("anthropic/*")
    models      JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                    TEXT PRIMARY KEY,             -- sub_<ulid>
    tenant_id             TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_id               TEXT NOT NULL REFERENCES plans (id),
    status                TEXT NOT NULL
                          CHECK (status IN ('trialing', 'active', 'past_due',
                                            'canceled', 'expired')),
    current_period_start  TIMESTAMPTZ NOT NULL,
    current_period_end    TIMESTAMPTZ,
    cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_tenant_active
    ON subscriptions (tenant_id)
    WHERE status IN ('trialing', 'active', 'past_due');
COMMENT ON INDEX uq_subscriptions_tenant_active IS 'A tenant has at most one effective subscription.';

CREATE TABLE IF NOT EXISTS entitlements (
    id          TEXT PRIMARY KEY,                       -- ent_<ulid>
    tenant_id   TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    key         TEXT NOT NULL,                          -- e.g. 'models.allow', 'features.tools'
    value       JSONB NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'plan', 'promo')),
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);
CREATE INDEX IF NOT EXISTS ix_entitlements_tenant ON entitlements (tenant_id);
