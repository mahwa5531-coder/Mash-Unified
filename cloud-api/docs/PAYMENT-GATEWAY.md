# Payment Gateway — System Design (Razorpay)

Status: implemented · Owner: `internal/payment` · Migration: `000010_payments.sql`

## 1. Scope & goals

Prepaid **credit top-ups** for tenants, paid in INR through Razorpay. The module
owns the full money path: checkout, client-side handshake verification, signed
webhooks, reconciliation, an append-only credit ledger and a per-tenant balance.

Non-goals (v1, deliberately): subscription billing (the `plans`/`subscriptions`
tables already own that), refunds (webhook is recorded but does not reverse
balance), multi-currency (INR only — Razorpay constraint), invoices/GST.

## 1b. Who owns what — Razorpay vs this module

The provider does the money. We ROUTE it and keep an honest ledger. That is
the whole job, and every line of code below exists to do exactly one of
these five things:

| Concern | Owner | Why the merchant side still needs code |
|---|---|---|
| Card/UPI/netbanking UI, mandates, auto-capture, settlement, refunds, subscription deductions | **Razorpay** | none — we never touch it |
| Payment attempts & retries, webhook delivery & re-delivery | **Razorpay** | we must DEDUPE redeliveries (at-least-once delivery) |
| "This payment is real" | Razorpay signs, **we verify** | an unauthenticated POST to `/v1/payments/webhook` is one curl away from free credits without HMAC verification |
| "This payment belongs to this order, is captured, for this amount" | **we cross-check** (confirm fetch + amount match) | a valid signature on a hand-crafted ₹1 payment must never mint a ₹500 pack |
| "Credits apply exactly once" | **we own** (DB row lock + status guard + ledger UNIQUE) | webhook + confirm + poll arrive for the same payment in any order — the DB arbitrates |
| "One checkout per idempotency key" | **we own** (unique index) | network retries must not fork orders |
| Missed webhook recovery | **we own** (read-through reconcile + sweeper) | webhooks get dropped; money must still land |

If a proposed change to this module does not serve one of those rows, it
does not belong here. There is no second money path to add.

## 2. Package layout (atomic design)

Every file is one atom: one contract, one concern. No file knows how the others
persist, transmit or route.

```
internal/payment/
  domain.go       Order, statuses, terminal states, ledger entry, webhook event
  errors.go       typed failures → domain.Error mapping (client-visible)
  provider.go     Provider interface (the ONLY provider contract)
  hmac.go         the ONE HMAC-SHA256 implementation (both Razorpay schemes)
  catalog.go      purchasable credit packs (defaults + JSON override)
  store.go        Store interface (the ONLY persistence contract)
  service.go      Service struct, config, wiring, read APIs (balance/history)
  checkout.go     Checkout()        — idempotent order creation
  confirm.go      Confirm()         — Razorpay Checkout handshake verification
  webhook.go      HandleWebhook()   — signature check, dedupe, state apply
  apply.go        applyPaid/applyFailed/applyExpired — exactly-once core
  reconcile.go    GetOrder() + StartSweeper() — poll fallback, TTL expiry
  mock.go         MockProvider — dev mode + tests (no network, no keys)

internal/payment/razorpay/
  client.go       transport: basic auth, timeouts, GET-only retry, error map
  orders.go       CreateOrder / FetchOrder / FetchPayment / FetchOrderPayments
  signature.go    fail-closed wrappers over payment/hmac.go
  types.go        wire DTOs (kept OUT of the domain package)

internal/store/repos/payments.go   PostgreSQL Store implementation
internal/store/migrations/000010_payments.sql
internal/api/payments.go           thin HTTP handlers
```

Test scenarios live in one file per concern (same test package):
`harness_test.go` (fake store + fixtures), `catalog_test.go`,
`checkout_test.go`, `confirm_test.go`, `webhook_test.go`, `reconcile_test.go`,
`concurrency_test.go` (the race storms), `provider_e2e_test.go` (real
razorpay.Client vs wire-compatible fake server). PG-truth integration tests:
`internal/store/repos/payments_test.go` (env-guarded on a real database).

Dependency rule: `api → payment → {provider, store}`. The domain package
(`internal/domain`) is the only shared import. Wire DTOs never leak past
`razorpay/`; persistence types never leak past `repos`.

## 3. End-to-end flows

### 3.1 Checkout

```
Client                API                    Service               Razorpay
  │ POST /v1/payments/checkout {pack_id}      │                     │
  │ Idempotency-Key: <key> │                  │                     │
  │──────────────────────►│ Checkout()        │                     │
  │                       │──────────────────►│ 1. rate budget (Redis, per user)
  │                       │                   │ 2. resolve pack (catalog snapshot)
  │                       │                   │ 3. idempotent replay check (DB)
  │                       │                   │ 4. POST /orders ───►│
  │                       │                   │    ◄── order_NNN ────│
  │                       │                   │ 5. INSERT order row (pending)
  │                       │ ◄──────────────────│
  │ ◄─ {order_id, provider_order_id,          │
  │     amount_paise, key_id, status, …}      │
```

The response carries everything Razorpay Checkout.js needs (`key_id` +
`provider_order_id`). The pack's price and credit amount are **snapshotted on
the order row** — later catalog edits never mutate an in-flight order.

### 3.2 Client confirm (happy path, no webhook wait)

Razorpay's Checkout widget returns `razorpay_payment_id`,
`razorpay_order_id`, `razorpay_signature` to the page, which posts them to:

```
POST /v1/payments/confirm {razorpay_order_id, razorpay_payment_id, razorpay_signature}
```

The service (1) re-computes `HMAC_SHA256(order_id|payment_id, key_secret)` and
compares in constant time, (2) **fetches the payment from Razorpay** — the
signature proves the payment exists, the fetch proves it is `captured` and the
amount matches the order (server-authoritative, never trust the client), then
(3) applies credits exactly-once (§5).

### 3.3 Webhook (authoritative backstop)

```
Razorpay ──► POST /v1/payments/webhook
             X-Razorpay-Signature: <hmac-sha256(webhook_secret, raw_body)>
               1. verify signature over the RAW body (constant time) → 401 if bad
               2. INSERT event id (unique) → duplicate delivery = 200, no-op
               3. resolve order by payload.order.entity.id
               4. apply the state machine (§4) exactly-once (§5)
             ◄─ 200 always (when signature valid) — ack fast, no retry storms
```

Handled events: `payment.captured`, `payment.failed`, `order.paid`. Anything
else (`payment.refunded`, `refund.processed`, …) is recorded for audit and
acknowledged — reversal is v2 and tracked in the ledger design (§8).

### 3.3b Delivery semantics — why there is no message broker

"RabbitMQ redelivers un-acked messages; SQS re-exposes them after the
visibility timeout; Kafka lets every consumer group replay the log." All
true, and all three converge on the one rule this module lives by:
**payment handlers must be idempotent, because the delivery system may hand
you the same event twice.**

Razorpay webhooks are the same contract in a thinner package: it retries a
webhook until it gets a 2xx (at-least-once), and the dashboard can resend
any event on demand (replay). The mapping from broker concepts to this
module:

| Broker concept | This module's equivalent |
|---|---|
| ack only after the work is done | HTTP 200 returned only **after** the ledger tx commits (webhook.go) |
| message returns to the queue on worker crash | non-2xx / crash → Razorpay retries the webhook |
| SQS `MessageDeduplicationId` | `payment_webhook_events.event_id` PRIMARY KEY — the INSERT verdict IS the dedupe |
| Kafka per-group offsets, replay | `payment_webhook_events` payload + `reconcile.go` sweeper = deliberate, safe replay |
| "could the customer be charged twice?" | No — the **charge happens at Razorpay**; we only mint credits, and §5 guarantees once |

What we deliberately did NOT do: add RabbitMQ/SQS/Kafka. There is no
fan-out (no five teams consuming a payment event) — one webhook fans into
one transactional ledger write in PostgreSQL, where a row lock, a status
guard and a UNIQUE constraint arbitrate every race. A broker between
Razorpay and the DB would move the exactly-once problem without solving
it, and would be the same over-engineering this module was de-bloated to
remove. If multi-consumer fan-out is ever needed (email, analytics, fraud
each with independent replay), the seam is the append-only
`credit_ledger`/`payment_webhook_events` tables — poll them or CDC them;
the idempotency keys are already there.

### 3.4 Reconciliation (missed-webhook fallback)

`GET /v1/payments/orders/{id}` on a still-pending order triggers one upstream
`FetchOrder` (bounded frequency: only while non-terminal, provider errors
swallowed → serve cached state). A background sweeper (`StartSweeper`, ctx-
cancelled at shutdown) expires pending orders past their TTL and re-checks
orders that were `attempted` within the TTL window. Between confirm, webhook
and reconcile, every path funnels into the same `applyPaid` — the database
arbitrates.

## 4. Order state machine

```
            ┌──────────┐  payment attempt seen   ┌───────────┐
 created ──►│ pending  │────────────────────────►│ attempted │
            └────┬─────┘                         └─────┬─────┘
                 │ payment.captured / order.paid / confirm-verified
                 │  (the ONLY transition into a terminal-wins state)
                 ▼
            ┌───────────┐   payment.failed    ┌──────────┐
            │   paid    │                     │  failed  │
            └───────────┘                     └──────────┘
                 ▲        TTL elapsed (sweeper) ┌──────────┐
                 └── late capture beats ────────│ expired  │
                     expiry (paid is king)     └──────────┘
```

Rules (enforced in `domain.go` AND in SQL `WHERE` guards — belt and braces):

- `paid` is terminal and **absorbing**: once paid, no event regresses it.
- `paid` may be entered from ANY state (a late capture can beat an `expired`
  or `failed` mark — money arrived, credits must apply).
- `failed`/`expired` may not overwrite `paid` or each other's terminal record
  (a late `failed` after `paid` is dropped, not an error).
- Every transition is a single conditional `UPDATE ... WHERE status IN (...)`
  — the row counts decide who won; no read-modify-write races.

## 5. Exactly-once credit application (the crux)

Three concurrent writers can reach the same order: client confirm, webhook
delivery, reconciliation poll. All funnel into one transactional store call:

```sql
BEGIN;
  SELECT ... FROM payment_orders WHERE id = $1 FOR UPDATE;          -- serialize
  UPDATE payment_orders
     SET status='paid', provider_payment_id=$2, paid_at=now(), updated_at=now()
   WHERE id = $1 AND status <> 'paid';                              -- state guard
  -- 0 rows updated ⇒ someone already applied ⇒ COMMIT, return no-op
  INSERT INTO credit_ledger (id, tenant_id, order_id, kind, credits, balance_after)
  VALUES (..., 'topup', $credits, ...);                             -- UNIQUE(order_id, kind)
  INSERT INTO credit_balances (tenant_id, balance) VALUES ($tenant, $credits)
  ON CONFLICT (tenant_id) DO UPDATE
    SET balance = credit_balances.balance + EXCLUDED.balance,       -- atomic add
        updated_at = now();
COMMIT;
```

- **Row lock** (`FOR UPDATE`) serializes concurrent appliers on the order.
- **State guard** (`status <> 'paid'`) makes re-application a no-op.
- **Unique ledger constraint** is the durable backstop: even a bug that races
  past the guard cannot double-credit (constraint violation aborts the tx).
- **Balance is maintained incrementally** in the same tx — O(1) reads, no
  full-ledger SUM on hot paths. The ledger remains the audit source of truth
  (`balance_after` snapshots every step and can reconstruct the balance).

## 6. Concurrency & abuse controls (explicit design answers)

| Scenario | Control |
|---|---|
| Double-click / network retry on checkout | `Idempotency-Key` → unique partial index `(tenant_id, idempotency_key)`; same key+pack replays the same order; same key+different pack → 422 `IDEMPOTENCY_KEY_REUSE` |
| Concurrent checkouts by one user (real traffic) | Per-user Redis budget (`NEXAU_PAYMENT_CHECKOUT_PER_USER` / hour) + per-order uniqueness on `(provider, provider_order_id)` |
| Webhook + confirm racing on one order | §5 row lock + state guard → exactly one ledger row, one balance bump |
| Razorpay re-delivering the same webhook | `payment_webhook_events.event_id` PRIMARY KEY → duplicate = 200 no-op |
| Out-of-order events (`failed` after `captured`) | State machine ranks: `paid` absorbing, terminal states cannot regress |
| Webhook forgery / replay with edited body | HMAC-SHA256 over raw bytes, `hmac.Equal` constant-time; unauthenticated route has NO other power (signature is the auth) |
| Webhook DoS | Global body limit (middleware), per-IP budget (`NEXAU_PAYMENT_WEBHOOK_PER_IP` / min), fail-closed on signature |
| Amount tampering (pay ₹1 for ₹5,000 pack) | Confirm fetches the payment server-side and compares `amount_paise` + `order_id` + `status=captured`; mismatch → reject + keep order pending |
| Provider order-id collision across providers | Unique `(provider, provider_order_id)` — provider swap cannot alias |
| Missed webhooks (outage) | §3.4 reconcile-on-read + sweeper |
| Duplicate credit after operator DB restore | Ledger `UNIQUE(order_id, kind)` survives restores; balances rebuild from ledger if divergent (rebuild = future op tooling, schema supports it) |
| Shutdown mid-webhook | `FOR UPDATE` tx either committed or not; webhook re-delivered by Razorpay (we always 200 only after commit) |

Throughput posture: the payment path is per-user-rate-limited and PG-row-
serialized — by construction it carries far less concurrency than the LLM run
path (thousands of RPS). The Hotspot is `credit_balances` per tenant, but a
tenant's top-ups are serialized by their own order-row locks, so contention is
bounded to one tenant's own payment bursts.

## 7. Money handling

- **Integer paise everywhere** (`int64`); floats are forbidden by convention
  and lint-checked in review. ₹1 = 100 paise.
- Currency is `INR` fixed; column + DTO carry it for forward-compat.
- Catalog amounts are validated to `[100, 10_000_000]` paise (₹1 – ₹1,00,000,
  Razorpay's per-order bounds).

## 8. Credit ledger model

Append-only. `kind ∈ {topup, adjustment, refund}` (v1 writes only `topup`;
the enum leaves room for the v2 refund reversal and manual adjustments without
a schema change). `balance_after` snapshots the running balance — the ledger
can always be replayed to audit `credit_balances`.

Consumption of credits by LLM usage (metering debit) is intentionally NOT in
this module: it will be a `debit` writer against the same ledger with the same
exactly-once discipline, keyed by usage-record id.

## 9. Provider abstraction

```go
type Provider interface {
    Name() string
    CreateOrder(ctx context.Context, req CreateOrderRequest) (*ProviderOrder, error)
    FetchOrder(ctx context.Context, providerOrderID string) (*ProviderOrder, error)
    FetchPayment(ctx context.Context, providerPaymentID string) (*ProviderPayment, error)
    FetchOrderPayments(ctx context.Context, providerOrderID string) ([]*ProviderPayment, error)
    VerifyCheckoutSignature(orderID, paymentID, signature string) bool
    VerifyWebhookSignature(body []byte, signature string) bool
    ParseWebhook(body []byte) (*WebhookEvent, error)
}
```

`FetchOrderPayments` exists for reconciliation: when a missed webhook is
recovered via polling, the order's payment id would otherwise be lost —
reconcile fetches the order's payments and records the captured one.

Three implementations: `razorpay.Client` (production), `payment.MockProvider`
(dev/test — deterministic lifecycle, zero keys, zero network) and the disabled
mode (routes return 503 `PAYMENTS_DISABLED`, mounted-but-off so dashboards
show a stable contract).

Razorpay client transport rules:

- Basic auth `key_id:key_secret`, 10s dial / 15s response-header / 20s
  request timeout, shared connection pool.
- **GETs retry** (max 2, exp backoff, 429/5xx/network only). **POST /orders
  never auto-retries** — a timed-out create may have succeeded upstream, and a
  blind retry would fork provider orders; the failure surfaces to the caller
  and the local pending row expires via sweeper (no money can leak: an unpaid
  Razorpay order costs nothing).
- 401 → typed auth failure (config error, page alert), 4xx → validation
  family, 5xx → `DEPENDENCY_UNAVAILABLE`.

## 10. HTTP surface

| Route | Auth | Notes |
|---|---|---|
| `GET  /v1/payments/catalog` | user | purchasable packs (id, label, amount, credits) |
| `POST /v1/payments/checkout` | user | `Idempotency-Key` honored (strongly recommended); 429 on per-user budget |
| `POST /v1/payments/confirm` | user | Razorpay Checkout handshake; owns-order check |
| `GET  /v1/payments/orders/{id}` | user | own order only; pending orders trigger a bounded upstream re-check |
| `GET  /v1/payments/history?limit=` | user | tenant's orders, newest first, capped |
| `GET  /v1/payments/balance` | user | tenant credit balance + last top-up |
| `POST /v1/payments/webhook` | **signature** | unauthenticated by token, authenticated by HMAC |

All handlers are thin (decode → service → encode), matching the codebase rule
that business logic never lives in `internal/api`.

## 11. Configuration (env keys)

| Key | Default | Meaning |
|---|---|---|
| `NEXAU_PAYMENT_PROVIDER` | `disabled` | `disabled` \| `mock` \| `razorpay` |
| `NEXAU_RAZORPAY_KEY_ID` | — | e.g. `rzp_test_ABC123…` (Dashboard → API Keys, **Test** mode) |
| `NEXAU_RAZORPAY_KEY_SECRET` | — | paired secret (also used to verify Checkout handshakes) |
| `NEXAU_RAZORPAY_WEBHOOK_SECRET` | — | Dashboard → Settings → Webhooks secret (different from key secret) |
| `NEXAU_RAZORPAY_API_BASE` | `https://api.razorpay.com/v1` | override only for tests/proxies |
| `NEXAU_PAYMENT_CATALOG_JSON` | built-in packs | JSON array override `[{id,label,amount_paise,credits,badge?}]` |
| `NEXAU_PAYMENT_ORDER_TTL` | `15m` | pending order expiry (sweeper) |
| `NEXAU_PAYMENT_SWEEP_INTERVAL` | `1m` | sweeper cadence |
| `NEXAU_PAYMENT_HISTORY_LIMIT` | `50` | max page for history |
| `NEXAU_PAYMENT_CHECKOUT_PER_USER` | `20` | checkout requests / user / hour |
| `NEXAU_PAYMENT_WEBHOOK_PER_IP` | `120` | webhook posts / IP / min |
| `NEXAU_PAYMENT_MOCK_AUTOCAPTURE` | `3s` | mock mode: orders self-capture after this delay (dev UX) |

Validation: `razorpay` mode fails boot when any of the three secrets is
missing (fail-fast, listing all missing keys); `mock` needs none.

**Live verification (2026-09-28, this implementation)**: the full flow
was driven over real HTTP against the real server binary with real
PostgreSQL and real Redis (mock provider): catalog → checkout →
idempotent replay → 10-way concurrent checkout (1 order) → reconcile →
signed webhook → forged-signature rejection (400) → confirm replay →
duplicate webhook → 30-way concurrent completion storm (20 distinct-event
webhooks + 10 polls on one pending order → exactly one credit). The live
run caught two real bugs (both fixed + regression-tested): Go `""`
leaking into the partial unique index as a phantom shared key (rejected
all key-less checkouts after the first), and reconcile paying without
recording the payment id.

**Testing with Razorpay Test keys** (no real money ever moves): generate a
**Test** key pair in the Razorpay Dashboard, set the four `NEXAU_RAZORPAY_*`
values, point a test webhook at `<public-base>/v1/payments/webhook` with the
webhook secret, and use Razorpay's test card numbers (e.g. `4111 1111 1111
1111`, any future expiry, any CVV) in the Checkout widget — the API creates
real `order_…` ids against Razorpay's test environment, webhooks carry
`payment.captured`, and credits apply exactly as in production. In sandbox
here, the same wire path is proven by `razorpay/client_test.go` against a
byte-compatible fake Razorpay server, and by the mock provider in-process.

## 12. Observability

Counters: `nexau_payment_orders_total{provider,status}`,
`nexau_payment_credits_applied_total{provider}`,
`nexau_payment_webhooks_total{event,outcome}` (outcome ∈ applied|duplicate|
ignored|rejected). Every webhook body that fails signature verification is
logged at WARN with request id (never with the body — payload could contain
PII notes).

## 13. Security posture

- Webhook = **the only** unauthenticated route in this module, and HMAC is its
  entire auth: signature checked BEFORE any DB write, in constant time, over
  the exact raw bytes (no re-marshal — Go map iteration order would break it).
- Checkout secrets never appear in responses: `confirm` returns only status;
  `key_id` (public by design in Razorpay Checkout) is the only credential
  ever sent to the browser.
- Amount/ownership verified server-side on every money-moving path (§6).
- PII in Razorpay `notes` is limited to `{order_id, tenant_id, pack_id}` —
  enough for support correlation, nothing more.
- All order reads are tenant-scoped by the auth middleware identity; cross-
  tenant order ids are 404s (not 403s — no existence oracle).
