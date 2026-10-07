# MASh Cloud API — Data Dictionary

> Diagram companion: [`MASh-ER-diagram.png`](MASh-ER-diagram.png) (rendered
> from [`MASh-ER-diagram.mmd`](MASh-ER-diagram.mmd) — all 14 tables, all
> columns, all FK relationships).

Every table, every column's job, and — the two operator dials this document
exists for — **where the rolling-window token budgets live** and **where the
token-normalization values live**. Both are plain SQL rows: change them with
`UPDATE`, no restart, no redeploy.

Schema at a glance (14 tables, migrations `000001`–`000008`):

```
Identity & tenancy     tenants · users · tenant_members
Plans & entitlement    plans · subscriptions · entitlements
Devices & sessions     devices · refresh_tokens
Usage & accounting     llm_calls · token_normalization
Payments & credits     payment_orders · payment_webhook_events · credit_ledger · credit_balances
```

---

## The two operator dials (read this first)

### 1. Where do the 5-hour and weekly window tokens go? → `plans.limits`

The rolling-window budgets are **plan attributes**, so they live in the
`plans` table, inside the `limits` JSONB column:

| Key | Meaning | Seeded value (Free) | Seeded value (Pro) |
|---|---|---|---|
| `window_5h_tokens` | rolling **5-hour** burst budget, normalized tokens | 60,000 | 2,000,000 |
| `window_weekly_tokens` | rolling **7-day** weekly budget, normalized tokens | 250,000 | 10,000,000 |

Both windows are enforced on every LLM call (`llm.Proxy.admit`): the gate
sums `llm_calls.total_tokens` over `now() − 5 hours` and `now() − 7 days`
and rejects with `WINDOW_QUOTA_EXCEEDED` (429) when either sum reaches its
budget. Either window can bind independently — the 5h window caps bursts,
the weekly window caps sustained spend.

**Change them at runtime** (any SQL client):

```sql
-- Raise Pro's 5-hour budget to 3M and weekly to 15M:
UPDATE plans SET limits = limits || jsonb_build_object(
    'window_5h_tokens',     3000000,
    'window_weekly_tokens', 15000000
), updated_at = now()
WHERE code = 'pro';
```

Pickup delay: the identity resolver caches the plan (with its limits) in
Redis for **~30 s** (`auth.IdentityResolver.CacheTTL`), so edits take effect
for new requests within about half a minute. A `0` disables that window for
the plan (unlimited on that dimension).

### 2. Where do the normalization values go? → the `token_normalization` table

Token accounting (how raw provider usage becomes the quota currency) is
**model data**, so it has its own table — not a config file, not code:

```sql
SELECT * FROM token_normalization;
```

| Column | Meaning | Default |
|---|---|---|
| `model` | exact `"provider/model"`, pattern `"provider/*"`, or `'*'` (default rule) | — |
| `input_weight` | scale on raw prompt tokens | 1.0 |
| `cached_read_weight` | how much each cache-hit token subtracts from input | 1.0 |
| `cached_write_weight` | how much each cache-write token subtracts from input | 1.0 |
| `output_weight` | scale on completion tokens | 1.0 |
| `is_active` | soft-disable a rule without deleting it | `true` |
| `updated_at` | audit trail of the last change | `now()` |

The formula (applied at metering time, per call):

```
normalized_input  = max(0, round(prompt · input_weight)
                        − round(cache_read  · cached_read_weight)
                        − round(cache_write · cached_write_weight))
normalized_output = round(completion · output_weight)
normalized_total  = normalized_input + normalized_output
```

With the seeded defaults (everything 1.0) this is the classic accounting:
**cache hits and cache writes are free, everything else counts 1:1**.
`llm_calls` stores BOTH the normalized values (`input_tokens`,
`output_tokens`, `total_tokens`) and the raw provider numbers
(`raw_prompt_tokens`, `raw_completion_tokens`, `cache_read_tokens`,
`cache_write_tokens`), so every row stays auditable after weights change.

**Change them at runtime:**

```sql
-- Count cached-read tokens at 10% for all Anthropic models:
UPDATE token_normalization
SET cached_read_weight = 0.1, updated_at = now()
WHERE model = 'anthropic/*';

-- Or add an exact-model override:
INSERT INTO token_normalization (model, input_weight, cached_read_weight, cached_write_weight, output_weight)
VALUES ('openai/gpt-4o', 1, 1, 1, 0.5)
ON CONFLICT (model) DO UPDATE
SET output_weight = EXCLUDED.output_weight, updated_at = now();
```

Pickup delay: the API caches the active rules for
`NEXAU_NORM_CACHE_TTL` (default **30 s**). Resolution order for a served
model: exact key → `"provider/*"` pattern → `'*'` → built-in identity rule.
A failed reload keeps serving the last good rules (accounting continuity);
a down database is backed off, not hammered.

**Why this split**: budgets are per-plan business decisions (Free vs Pro);
weights are per-model accounting facts (identical for every customer of the
same model). Keeping them in their own tables means either can change
without touching the other — and both survive restarts, audited by
`updated_at`.

---

## Identity & tenancy

### `tenants` — migration 0001

Isolated customer organizations. One per user in v1 (single-player), but the
tenant remains the anchor for subscriptions, quotas and billing — the shape
multi-player takes later.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `ten_<ulid>` |
| `slug`, `name` | TEXT | slug UNIQUE |
| `status` | TEXT | `active` \| `suspended` \| `deleted` |
| `settings` | JSONB | reserved |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### `users` — migration 0001

Google-OAuth-only identities. Stores exactly what Google's OIDC ID token
provides plus our bookkeeping. **No password hash, no local credential of
any kind.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `usr_<ulid>` |
| `email` | TEXT | display/billing metadata; `lower(email)` UNIQUE |
| `display_name` | TEXT | Google `name` claim |
| `avatar_url` | TEXT | Google `picture` claim |
| `status` | TEXT | `active` \| `suspended` \| `deleted` |
| `is_platform_admin` | BOOLEAN | |
| `auth_provider` | TEXT | always `google` |
| `external_subject` | TEXT | Google `sub` — **the immutable identity anchor**; `(auth_provider, external_subject)` UNIQUE |
| `email_verified` | BOOLEAN | Google `email_verified` claim |
| `last_login_at` | TIMESTAMPTZ | |

### `tenant_members` — migration 0002

Membership links (the isolation backbone): every tenant-scoped query joins
through `(tenant_id, user_id, status='active')`. PK `(tenant_id, user_id)`;
`role` = `owner` \| `admin` \| `member`.

---

## Plans & entitlement

### `plans` — migration 0003 (seeded in 0007)

The purchasable catalog. **This is where the window budgets live** (see the
operator dials above).

| Column | Type | Notes |
|---|---|---|
| `id`, `code`, `name` | TEXT | `code` UNIQUE (`free`, `pro`) |
| `limits` | JSONB | enforced limits — see below |
| `models` | JSONB | allowlist: exact `"openai/gpt-4o"` or pattern `"anthropic/*"`; `[]` = unrestricted |
| `is_public` | BOOLEAN | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

`limits` keys (all optional; all hot-changeable via `UPDATE`):

| Key | Meaning |
|---|---|
| `requests_per_minute_user` / `requests_per_minute_tenant` | RPM budgets (Redis sliding window) |
| `concurrent_requests_per_user` / `concurrent_requests_per_tenant` | in-flight call budgets (Redis slots) |
| `max_request_bytes` | payload cap (`PAYLOAD_TOO_LARGE` 413) |
| `window_5h_tokens` | rolling 5-hour normalized-token budget |
| `window_weekly_tokens` | rolling 7-day normalized-token budget |

Seeds (000007): Free = 20 RPM / 3 concurrent / 2 MiB / 60k 5h / 250k weekly;
Pro = 600 RPM / 16 concurrent / 2 MiB / 2M 5h / 10M weekly.

### `subscriptions` — migration 0003

A tenant's effective plan state. Status: `trialing` \| `active` \| `past_due`
(grace: allowed, metered) \| `canceled` \| `expired`. One effective
subscription per tenant (partial unique index on `tenant_id` where status in
the three effective states). `current_period_end` + `cancel_at_period_end`
drive renewal/autopay semantics. **Free fallback:** when no subscription is in
an effective state (canceled, expired, or never subscribed), the identity
resolver degrades the tenant to the public `free` plan automatically — a
canceled Pro falls back to Free limits (never a hard block). The fallback is a
read-time entitlement (synthetic active sub on `plans` where `code='free' and
is_public`); the real subscription rows keep the billing history untouched.

### `entitlements` — migration 0003

Per-tenant overrides on top of the plan: `key` (e.g. `models.allow`,
`features.tools`), `value` JSONB, `source` = `manual` \| `plan` \| `promo`,
optional `expires_at`. The model allowlist resolution is plan models →
entitlement override.

---

## Devices & sessions

### `devices` — migration 0004

Registered desktop installations (`dev_<ulid>`), one row per install, with
`last_seen_at` and revocation (`revoked_at`).

### `refresh_tokens` — migration 0004

Opaque, hash-stored (SHA-256) refresh tokens, rotated on every use, with
**family-based reuse detection** (RFC 6819 §5.2.2.3): presenting a
already-rotated token revokes the whole `family_id`. `replaced_by` chains
the rotation history; `revoked_reason` records `rotation` \| `reuse` \|
`logout` \| `admin`.

---

## Usage & accounting

### `llm_calls` — migrations 0005 + 0008

The ONLY model-activity table, and the metering source of truth: one row
per proxied request, written once at completion. **Payloads are never
stored** — tokens, cost, latency, status only.

| Column | Type | Notes |
|---|---|---|
| `id` | BIGINT identity PK | |
| `call_id` | TEXT UNIQUE | `llm_<ulid>`, server-generated; UNIQUE = exactly-once metering |
| `tenant_id`, `user_id` | TEXT FKs | attribution |
| `request_id` | TEXT | correlation (`x-request-id`) |
| `requested_model` / `resolved_model` / `provider` | TEXT | what was asked vs served |
| `stream` | BOOLEAN | |
| `status` | TEXT | `completed` \| `failed` \| `cancelled` |
| `error_code`, `error_message` | TEXT | terminal failure detail |
| `input_tokens`, `output_tokens`, `total_tokens` | BIGINT | **normalized** values (quota currency); `total = input + output` |
| `raw_prompt_tokens`, `raw_completion_tokens` | BIGINT | provider-reported numbers (audit; added in 0008) |
| `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens` | BIGINT | raw breakdowns |
| `input_cost`, `output_cost`, `total_cost` | NUMERIC(18,8) | Bifrost-reported costs |
| `latency_ms`, `started_at`, `completed_at`, `recorded_at` | | timing; `recorded_at` is the window-math column |

Indexes: `(tenant_id, recorded_at DESC)` — the exact path the 5h/weekly
window SUMs and recovery queries use — plus user and per-model variants.

This table IS the 5h/weekly deduction mechanism: nothing is decremented or
reset anywhere. The windows are computed as rolling SUMs over `recorded_at`
on every gate check (`repos.LLMCallsRepo.WindowUsage`), so there is no
counter to drift, no job to run, no restart to fear — old calls age out of
the window by themselves, and the gate and `/v1/me` always read the same
numbers. `WindowRecovery` computes the exact earliest instant the window
drops back below quota (used for `resets_at` in the 429 body and the UI).

### `token_normalization` — migration 0008

The normalization values (see the operator dials above). Seeded with the
identity rule `'*'`. Weights are `NUMERIC(9,6) >= 0`.

---

## Payments & credits

### `payment_orders` — migration 0006

Prepaid credit top-up orders (Razorpay). `amount_paise` BIGINT (integer
paise, INR only), `credits` snapshotted at creation (catalog edits never
mutate in-flight orders), `status` = `pending` \| `attempted` \| `paid` \|
`failed` \| `expired`. Idempotent checkout: UNIQUE partial index on
`(tenant_id, idempotency_key)` — double-clicking checkout replays the same
order. UNIQUE `(provider, provider_order_id)`.

### `payment_webhook_events` — migration 0006

Webhook dedupe: PK `event_id` (provider-issued). Razorpay re-delivers
at-least-once; duplicates are acknowledged and ignored — never reprocessed.

### `credit_ledger` — migration 0006

Append-only ledger. `UNIQUE (order_id, kind)` is the durable exactly-once
backstop: even a racing bug cannot double-credit a top-up. `kind` = `topup`
\| `adjustment` \| `refund`; `balance_after` snapshots the running balance.

### `credit_balances` — migration 0006

O(1) balance reads (`tenant_id` PK), maintained transactionally alongside
the ledger; the ledger remains the audit source of truth.

---

## Migration index

| Version | File | Creates / changes |
|---|---|---|
| 000001 | `users.sql` | `tenants`, `users` |
| 000002 | `memberships.sql` | `tenant_members` |
| 000003 | `subscriptions.sql` | `plans`, `subscriptions`, `entitlements` |
| 000004 | `devices_tokens.sql` | `devices`, `refresh_tokens` |
| 000005 | `llm_calls.sql` | `llm_calls` (+ window indexes) |
| 000006 | `payments.sql` | `payment_orders`, `payment_webhook_events`, `credit_ledger`, `credit_balances` |
| 000007 | `seed_plans.sql` | Free / Pro seeds with window budgets |
| 000008 | `normalization.sql` | `token_normalization`; `llm_calls.raw_*` audit columns; retires `monthly_token_quota` from `plans.limits` (idempotent — fresh installs and monthly-era upgrades converge) |

Migrations run once, version-tracked in `schema_migrations`, guarded by a
PostgreSQL advisory lock (safe under horizontal scale / rolling deploys).
