# FRONTEND PAYMENTS INTEGRATION — Endpoint Map & Call Sequence

The one document you need while coding the client. Base path: your API
host (`https://api.<your-domain>`). Auth: every route except the webhook
takes `Authorization: Bearer <access_token>` (the same session token the
rest of the app uses).

**Commerce model: plans only.** The ONLY purchasable thing is a plan
period (a SKU) — e.g. Pro monthly (₹1,999 / 30 days) or Pro annual
(₹19,999 / 365 days). There are no credit packs, no wallet, no balance: a
captured purchase activates or extends the tenant's Pro subscription, and
expiry returns the tenant to the Free plan automatically.

---

## 1. Endpoint map (stable across providers)

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 1 | GET | `/v1/payments/catalog` | Bearer | List purchasable plan SKUs |
| 2 | POST | `/v1/payments/checkout` | Bearer | Create an order for a SKU |
| 3 | POST | `/v1/payments/confirm` | Bearer | Settle an order after paying |
| 4 | GET | `/v1/payments/orders/{order_id}` | Bearer | Poll order status (self-reconciling) |
| 5 | GET | `/v1/payments/history?limit=50` | Bearer | Tenant's orders, newest first |
| 6 | GET | `/v1/payments/subscription` | Bearer | Entitlement position (plan + paid-through + days left) |
| 7 | POST | `/v1/payments/webhook` | **signature** (server-to-server only — the frontend NEVER calls this) |

Disabled deployments answer `503 PAYMENTS_DISABLED` on all of the above —
handle it once, centrally.

---

## 2. Checkout request / response

```
POST /v1/payments/checkout
Content-Type: application/json
Idempotency-Key: <generate a UUID once per purchase attempt — resend the
                  SAME key on any retry of that attempt>

{"sku_id": "plan_pro_1m"}
```

`201 Created` — the response is provider-shaped but the core is constant:

```jsonc
{
  "order": {
    "order_id": "pay_01JD…",          // YOUR handle for every later call
    "provider": "phonepe",
    "provider_order_id": "PAY-01JD…", // provider handle (see §3)
    "status": "pending",              // pending → attempted → paid | failed | expired
    "amount_paise": 199900,           // ₹1,999.00 — integer paise, INR
    "sku_id": "plan_pro_1m",
    "plan_code": "pro",               // what the purchase activates
    "period_days": 30,                // how long the activation lasts
    "currency": "INR",
    "expires_at": "2026-10-08T12:00:00Z"
    // … timestamps
  },
  "key_id": "MERCHANTUAT",            // provider's browser-safe id
  "provider": "phonepe",
  "provider_order_id": "PAY-01JD…",
  "redirect_url": "https://mercury-till.phonepe.com/transact/…?token=…"
  // phonepe ONLY: hosted payment page — send the browser here
  // stripe ONLY:  "client_secret": "pi_…_secret_…" for Stripe.js
  // razorpay:     neither field (Checkout.js needs key_id + order only)
}
```

**Errors worth coding for:** `400` bad body · `404 SKU_NOT_FOUND` ·
`409 PLAN_NOT_CONFIGURED` (operator problem — show "try again later") ·
`422 IDEMPOTENCY_KEY_REUSE` (you reused a key with a different sku —
generate a fresh one) · `429 RATE_LIMITED` (checkout budget) ·
`502 PAYMENT_PROVIDER_*` (gateway rejected us) · `503 PAYMENTS_DISABLED`.

---

## 3. THE PHONEPE SEQUENCE (NEXAU_PAYMENT_PROVIDER=phonepe)

Standard Checkout flow: the user pays on **PhonePe's hosted page**, your
app never touches card/UPI data. No client SDK is needed.

```
┌────────────┐                        ┌────────────┐          ┌────────────┐
│  Frontend  │                        │  Your API  │          │  PhonePe   │
└─────┬──────┘                        └─────┬──────┘          └─────┬──────┘
      │                                      │                       │
  1.  │ POST /v1/payments/checkout           │                       │
      │  {sku_id} + Idempotency-Key         │                       │
      │─────────────────────────────────────►│ POST /pg/v1/pay       │
      │                                      │──────────────────────►│
      │  ◄── 201 {order, redirect_url, …} ───│◄─── PAY_PAGE url ─────│
      │                                      │                       │
  2.  │ window.location = redirect_url       │                       │
      │──────────────────────────────────────────────────────────────►│
      │                          user pays (UPI / card / netbanking)  │
      │                                      │                       │
  3a. │              (server-to-server, no browser involved)          │
      │                                      │◄─ X-VERIFY callback ──│
      │                                      │  POST {public}/v1/payments/webhook
      │                                      │  → order paid, Pro activated
      │                                      │                       │
  3b. │ browser lands on YOUR return page:   │                       │
      │   {NEXAU_PHONEPE_REDIRECT_URL}?order_id=pay_01JD…            │
      │      ◄───────────────────────────────┼───────────────────────│
      │                                      │                       │
  4.  │ POST /v1/payments/confirm            │                       │
      │  {merchant_transaction_id: PAY-01JD…}│                       │
      │─────────────────────────────────────►│ (order already paid → │
      │  ◄── 200 {order: {status:"paid"}} ───│  settled success)     │
      │                                      │                       │
  5.  │ GET /v1/payments/subscription        │                       │
      │─────────────────────────────────────►│                       │
      │  ◄── {plan_code:"pro", status:"active", days_remaining: 30}   │
```

Step-by-step:

1. **Checkout** → save `order_id` (from `order.order_id`) and
   `redirect_url`.
2. **Redirect** the whole browser to `redirect_url` (plain navigation —
   not XHR; the page is on PhonePe's domain).
3. PhonePe calls your API's webhook server-to-server (X-VERIFY signed) —
   the Pro plan activates here, no frontend involvement. The browser also
   lands back on your configured return page with `?order_id=pay_…`.
4. **Confirm** with the provider handle you kept:
   `POST /v1/payments/confirm {"merchant_transaction_id": "<provider_order_id>"}`.
   If the callback already settled it, confirm returns the paid order
   (success, not conflict). Alternatively just **poll**
   `GET /v1/payments/orders/{order_id}` — it self-reconciles from
   PhonePe's status API.
5. **Verify the entitlement**: `GET /v1/payments/subscription` →
   `plan_code:"pro"`, `status:"active"`, `days_remaining`.

### Step-2 variants for the other providers

- **stripe**: no redirect — open Stripe.js with `key_id` (pk_…) +
  `client_secret`; on completion POST confirm
  `{"payment_intent_id": "<provider_order_id>"}`.
- **razorpay**: open Razorpay Checkout.js with `key_id` + `order_id`; on
  completion POST confirm `{"razorpay_order_id": …, "razorpay_payment_id": …,
  "razorpay_signature": …}` (the widget's three fields).

The generic confirm body (`{provider_order_id, provider_payment_id,
provider_signature}`) works for every provider; the per-provider
spellings above are accepted aliases.

---

## 4. The subscription view

```
GET /v1/payments/subscription
```

```jsonc
{
  "tenant_id": "ten_…",
  "plan_code": "pro",        // "" when free
  "plan_name": "Pro",
  "status": "active",        // active | trialing | past_due | none
  "current_period_end": "2026-11-07T12:00:00Z",  // omitted when none
  "days_remaining": 30       // 0 when none
}
```

- `status:"none"` = the Free default (nothing purchased, or Pro expired).
- Renewals stack: buying monthly twice back-to-back = 60 days of Pro
  (the second period rides on top of the first's end).
- Expiry is automatic: the day `current_period_end` passes, the tenant
  reads as Free everywhere (`/v1/me` limits + model allowlist included).

---

## 5. Status model & error cheat sheet

Order: `pending → attempted → paid | failed | expired` (paid absorbing:
a late capture beats both failed and expired — money arrived).

| Situation | What to do |
|---|---|
| `503 PAYMENTS_DISABLED` | Hide the upgrade UI; billing is off on this deployment |
| Checkout `404 SKU_NOT_FOUND` | Refresh the catalog |
| Checkout `429` | Back off (per-user checkout budget) |
| Confirm `400 PAYMENT_SIGNATURE_INVALID` | Do not retry with the same body; restart checkout |
| Order `409 PAYMENT_AMOUNT_MISMATCH` | Server-side tamper alarm — contact support |
| Order stuck `pending` past `expires_at` | Treat as abandoned; the sweeper expires it |
| Callback missed, order still pending | Poll `GET orders/{id}` — read-through reconcile fixes it |
