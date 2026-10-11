-- 0012 plans-only commerce: drop the credit wallet, bind orders to plans.
--
-- Business model decision (docs/MODELS-AND-PRICING.md §4): the ONLY
-- purchasable thing is a PLAN PERIOD (a SKU: plan_pro_1m, plan_pro_1y).
-- No individual credits are sold. A captured order activates/extends the
-- tenant's subscription (extend-or-insert, stacking periods) in the same
-- transaction that marks it paid — the subscriptions table (migration
-- 000003) IS the wallet, and its current_period_end IS the balance.
--
-- Expiry is read-side: identity resolution + the subscription read filter
-- on current_period_end > now(); a lapsed Pro tenant falls back to the
-- free plan's limits + model allowlist automatically (no sweeper needed).

-- 1. The credit machinery goes away entirely.
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS credit_balances;

-- 2. Orders carry the plan snapshot instead of credits.
--    pack_id → sku_id (the catalog handle, e.g. "plan_pro_1m");
--    plan_code + period_days are snapshotted at creation so catalog edits
--    never mutate in-flight orders; credits is dropped (nothing sells
--    credits anymore — historical rows do not exist: pre-launch change).
ALTER TABLE payment_orders
    RENAME COLUMN pack_id TO sku_id;

ALTER TABLE payment_orders
    ADD COLUMN IF NOT EXISTS plan_code   TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS period_days INT  NOT NULL DEFAULT 0;

ALTER TABLE payment_orders
    DROP COLUMN IF EXISTS credits;

-- 3. Checkout-time guard: an order must never reference a plan that
--    cannot be activated at capture (payment.Service validates via
--    PlanExists before creating the provider order). Enforced in the
--    payment_orders→plans linkage by the application layer; the snapshot
--    columns keep the audit trail even if a plan is later deleted.
