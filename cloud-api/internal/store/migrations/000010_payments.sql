-- 0010 payment gateway: provider orders, webhook dedupe, credit ledger,
-- credit balances. Design: docs/PAYMENT-GATEWAY.md §5 (exactly-once).
--
-- Money discipline: integer paise, INR only. Credits snapshot on the order
-- row at creation time — catalog edits never mutate in-flight orders.

CREATE TABLE IF NOT EXISTS payment_orders (
    id                  TEXT PRIMARY KEY,           -- pay_<ulid>
    tenant_id           TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL,              -- acting user (audit)
    provider            TEXT NOT NULL,              -- razorpay | mock
    provider_order_id   TEXT NOT NULL,              -- order_NNN (provider-issued)
    pack_id             TEXT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'INR',
    amount_paise        BIGINT NOT NULL CHECK (amount_paise BETWEEN 100 AND 10000000),
    credits             BIGINT NOT NULL CHECK (credits > 0),
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'attempted', 'paid', 'failed', 'expired')),
    provider_payment_id TEXT,
    failure_reason      TEXT,
    idempotency_key     TEXT,
    request_hash        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at             TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE payment_orders IS 'Prepaid credit top-up orders (one provider order per row).';

-- A provider order id can never map to two local orders (provider swap safety).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_provider_order
    ON payment_orders (provider, provider_order_id);

-- Idempotent checkout: same tenant + same Idempotency-Key replays the same
-- order. Partial index: orders created without a key do not participate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_idempotency
    ON payment_orders (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_payment_orders_tenant_created
    ON payment_orders (tenant_id, created_at DESC);

-- Sweeper scan path: non-terminal orders only (small by construction).
CREATE INDEX IF NOT EXISTS ix_payment_orders_open
    ON payment_orders (expires_at)
    WHERE status IN ('pending', 'attempted');

-- Webhook dedupe: Razorpay re-delivers (at-least-once); event_id is the key.
-- Duplicates are acknowledged (200) and ignored — never reprocessed.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    event_id    TEXT PRIMARY KEY,                   -- evt_NNN (provider-issued)
    provider    TEXT NOT NULL,
    event_type  TEXT NOT NULL,                      -- payment.captured, ...
    order_id    TEXT REFERENCES payment_orders (id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload     JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_payment_webhook_events_order
    ON payment_webhook_events (order_id, received_at);

-- Append-only credit ledger. UNIQUE (order_id, kind) is the durable
-- exactly-once backstop: even a racing bug cannot double-credit a top-up.
CREATE TABLE IF NOT EXISTS credit_ledger (
    id            TEXT PRIMARY KEY,                 -- led_<ulid>
    tenant_id     TEXT NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    order_id      TEXT NOT NULL REFERENCES payment_orders (id),
    kind          TEXT NOT NULL DEFAULT 'topup'
                  CHECK (kind IN ('topup', 'adjustment', 'refund')),
    credits       BIGINT NOT NULL CHECK (credits > 0),
    balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, kind)
);

CREATE INDEX IF NOT EXISTS ix_credit_ledger_tenant
    ON credit_ledger (tenant_id, created_at DESC);

-- O(1) balance reads; maintained transactionally alongside the ledger.
-- The ledger remains the audit source of truth (balance_after snapshots).
CREATE TABLE IF NOT EXISTS credit_balances (
    tenant_id  TEXT PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
