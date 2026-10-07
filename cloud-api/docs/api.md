# MASh Cloud API — HTTP Reference

The cloud layer does exactly four things: **identity** (Google OAuth only),
**entitlements** (plans, quotas, rate limits), **billing** (Razorpay credit
top-ups) and the **LLM tunnel** (`POST /v1/chat/completions` → private
Bifrost gateway). Everything agent-related — sessions, transcripts, tools,
files, execution — lives on the user's desktop and never crosses this API
except as opaque request payloads.

- Base URL: `https://api.mash.cloud` (self-hosted: your deployment)
- Auth: `Authorization: Bearer <access_token>` unless noted
- Errors: `{"error":{"code":"…","message":"…","request_id":"req_…","details":{…}}}`
- Correlation: send `X-Request-Id: <opaque id>`; it is echoed in errors and forwarded upstream

---

## Authentication (Google OAuth only)

There is exactly one identity provider: Google. No email/password, no magic
links, no email verification flows exist in this API.

### Desktop login flow (web-to-desktop handshake)

```
desktop ──open browser──▶ GET /v1/auth/oauth/google
browser ──Google consent─▶ GET /v1/auth/oauth/google/callback?code&state
browser ◀── 302 WebSuccessURL?grant=wgrant_… ── (single-use web grant)
browser ──POST /v1/auth/web/session {grant} ──▶ short web access token
browser ──POST /v1/auth/desktop/code ◀─ mcode_… (60s single-use code)
browser ──deep link / loopback──▶ desktop receives mcode
desktop ──POST /v1/auth/desktop/exchange {code, device…}──▶ FULL token pair
```

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/auth/oauth/google` | — | Begin "Continue with Google" (302 to Google consent) |
| GET | `/v1/auth/oauth/google/callback` | — | Finish OAuth → 302 to `WebSuccessURL?grant=…` |
| POST | `/v1/auth/web/session` | — | `{grant}` → short web access token (no refresh token) |
| POST | `/v1/auth/desktop/code` | Bearer (web) | Mint a 60-second single-use `mcode_…` |
| POST | `/v1/auth/desktop/exchange` | — | `{code, device_name?, platform?, device_id?}` → token pair |
| POST | `/v1/auth/refresh` | — | `{refresh_token}` → rotated token pair |
| POST | `/v1/auth/logout` | Bearer | Revoke one refresh token |
| POST | `/v1/auth/logout-all` | Bearer | Revoke every session (lost device) |

**Token pair response** (exchange/refresh):

```json
{
  "access_token": "eyJ…",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "nxr_…",
  "user": {
    "id": "usr_…", "email": "…", "display_name": "…", "avatar_url": "…",
    "status": "active", "is_platform_admin": false, "email_verified": true
  },
  "tenant": {"id": "ten_…", "slug": "…", "name": "…", "status": "active"}
}
```

Properties: OAuth state is single-use and tx-cookie-bound; ID tokens are
verified against Google's JWKS (RS256, iss/aud/exp, email_verified required);
identity is anchored on the Google `sub` (`users.external_subject`), never the
email; refresh tokens are opaque, hash-stored, rotated on every use with
family-based reuse detection (reuse revokes the family); long-lived tokens
never cross the browser — only single-use short-TTL codes do.

**Auth errors**: `UNAUTHORIZED` 401, `TOKEN_EXPIRED` 401, `TOKEN_REVOKED` 401,
`OAUTH_STATE_INVALID` 400, `OAUTH_EMAIL_UNVERIFIED` 403,
`IDENTITY_CONFLICT` 409, `INVALID_OR_EXPIRED_CODE` 400,
`REFRESH_TOKEN_REUSED` 401, `RATE_LIMITED` 429 (per-IP handshake budgets).

---

## The LLM endpoint

### `POST /v1/chat/completions` — tunnel to the model gateway

OpenAI Chat Completions-compatible. Point the desktop agent runtime's
OpenAI-style client here. The model MUST be `"provider/model"` (Bifrost
routing format), e.g. `openai/gpt-4o`, `anthropic/claude-3-5-sonnet`.

```json
{
  "model": "openai/gpt-4o",
  "stream": true,
  "messages": [{"role": "user", "content": "hello"}],
  "tools": [...], "temperature": 0.2, "max_tokens": 1024
}
```

Pipeline (in order, all before any upstream traffic):

1. **Identity** — Bearer token → server-authoritative identity (never client-supplied)
2. **Account state** — user/tenant/membership must be active. A tenant with **no effective trial/paid subscription (canceled, expired, never subscribed) degrades to the public Free plan** — Free limits, LLM allowed. `SUBSCRIPTION_INACTIVE` 403 remains only as the fail-closed posture when no public `free` plan is configured at all
3. **Validation** — messages/tools/params bounds (`INVALID_REQUEST` 400)
4. **Model entitlement** — plan/tenant allowlist, patterns supported; fallbacks checked too (`MODEL_NOT_ENTITLED` 403)
5. **Rolling token windows** — two independent budgets, either can bind: a 5-hour
   burst window and a 7-day weekly window, both in normalized tokens summed
   from `llm_calls` (`WINDOW_QUOTA_EXCEEDED` 429 with `window`, `quota_tokens`,
   `used_tokens` and the exact `resets_at` — the earliest instant usage drops
   back below quota; clients schedule the retry from it). When the completed
   usage alone is still under quota but in-flight calls hold the remaining
   budget, the same code is returned with `in_flight: true` and
   `reserved_tokens` — the window is not exhausted, the budget is merely
   claimed by running calls; retry after a few seconds (no `resets_at` is
   published: claims release at call completion, not window expiry)
6. **Rate limits** — RPM per user + per tenant (Redis sliding window, `RATE_LIMITED` 429 with `retry_after_ms`)
7. **Concurrency** — in-flight LLM calls per user + per tenant (`CONCURRENCY_LIMIT` 429)
8. **In-flight token reservation** — every admitted call atomically claims an
   estimate of its token cost (payload-derived, clamped to
   `NEXAU_QUOTA_RESERVE_{MIN,MAX}_TOKENS`) against each window's REMAINING
   budget. This is what makes window 5 race-free: without it, N parallel
   admits each see the same completed-usage position and collectively
   overshoot the window. Claims settle when the call's usage row lands
   (failed calls release immediately; completed calls after a 2s pipeline
   margin). Fail-open on Redis loss, TTL-backed for crash recovery
   (`NEXAU_QUOTA_RESERVE_*` keys, `internal/llm/reserve.go`)
9. **Tunnel** — forward to the private Bifrost gateway (cloud-side credential; clients never see provider keys)

**stream=true (default for agent use)** — SSE:

```
data: {"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"he"}}]}

data: {"id":"c1",...,"choices":[{"index":0,"finish_reason":"stop"}],"usage":{...}}

data: [DONE]
```

- Chunks are forwarded **verbatim** — no re-serialization, no transformation.
- Headers commit lazily on the first upstream byte: a pre-stream upstream
  failure answers with a real HTTP error (OpenAI SDKs observe status + code).
- A mid-stream upstream failure emits one in-band OpenAI-style
  `{"error":{…}}` event before `[DONE]`.
- Comment heartbeats (`: ping`) keep intermediaries alive.
- Client disconnect ⇒ upstream request canceled immediately; usage seen so
  far is still metered (status `cancelled`).

**stream=false** — the completion JSON body (verbatim upstream shape).

**Per-call guarantees**: one `llm_calls` row records the fact (tokens, cost,
latency, resolved model, status) for quota accounting and usage display.
Message content is NEVER persisted anywhere in the cloud layer.

**Errors**: `UPSTREAM_UNAVAILABLE` 502, `UPSTREAM_CIRCUIT_OPEN` 503 (with
`retry_after_ms`), `MODEL_TIMEOUT` 504, `UPSTREAM_*` pass-through codes,
`PAYLOAD_TOO_LARGE` 413.

---

## Identity & client config

### `GET /v1/me`

The resolved identity: user (Google profile), tenant, membership, effective
plan, limits, model allowlist and the live quota position — the same
rolling-window computation the enforcement gate uses.

```json
{
  "user": {...},
  "tenant": {...},
  "membership": {"role": "owner", "status": "active"},
  "subscription_status": "active",
  "plan": {"id": "pln_pro", "code": "pro", "name": "Pro"},
  "limits": {
    "requests_per_minute_user": 600,
    "requests_per_minute_tenant": 600,
    "concurrent_requests_user": 16,
    "concurrent_requests_tenant": 16,
    "max_request_bytes": 2097152,
    "window_5h_tokens": 2000000,
    "window_weekly_tokens": 10000000
  },
  "quota": {
    "currency": "normalized_tokens",
    "windows": [
      {
        "window": "5h",
        "used_tokens": 12345,
        "reserved_tokens": 8192,
        "quota_tokens": 2000000,
        "used_percent": 0,
        "resets_at": null
      },
      {
        "window": "weekly",
        "used_tokens": 210000,
        "reserved_tokens": 8192,
        "quota_tokens": 10000000,
        "used_percent": 2,
        "resets_at": null
      }
    ]
  },
  "models": null,
  "restricted": false
}
```

`resets_at` is present only on a window that is at or over quota — it is the
exact earliest instant usage drops back below quota (rolling windows shrink
as old calls age out, so recovery is per-usage, not a fixed boundary). Under
quota it is `null`: there is nothing to wait for. `reserved_tokens` is the
in-flight claim running calls hold against the window; `used_percent` uses
the effective position (`used + reserved`), so the bar shows 100% exactly
when the gate rejects. Token values are
normalized tokens (the quota currency), not raw provider counts — see
`docs/TABLES.md` for the accounting model.

### `GET /v1/config`

Client integration config: the LLM endpoint contract, payload limits, stream
semantics (idle timeout, max duration, heartbeat).

---

## Usage

### `GET /v1/usage?from=RFC3339&to=RFC3339&by_model=true`

Tenant-scoped aggregation over authoritative `llm_calls` (never
client-reported counts). Window defaults to the trailing 30 days; max span
366 days. `by_model=true` adds a per-resolved-model breakdown.

---

## Payments (credit top-ups)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/payments/catalog` | Bearer | Purchasable credit packs |
| POST | `/v1/payments/checkout` | Bearer | Create order (Idempotency-Key honored) |
| POST | `/v1/payments/confirm` | Bearer | Razorpay Checkout handshake |
| GET | `/v1/payments/orders/{order_id}` | Bearer | Order status (reconciles if pending) |
| GET | `/v1/payments/history` | Bearer | Tenant orders, newest first |
| GET | `/v1/payments/balance` | Bearer | Credit balance + last top-up |
| POST | `/v1/payments/webhook` | HMAC | Provider events (signature is the auth) |

Provider disabled ⇒ `PAYMENTS_DISABLED` 503 on the same paths (stable
contract). See `docs/PAYMENT-GATEWAY.md`.

---

## Health & metrics (unauthenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health/live` | Process liveness (never touches dependencies) |
| GET | `/health/ready` | PG/Redis/Bifrost probes + breaker state (Bifrost never gates readiness) |
| GET | `/metrics` | Prometheus (when enabled) |

---

## What does NOT exist (by design)

These surfaces were removed on 2026-10-05 — the agent runtime lives on the
desktop and the cloud is Google-only. Clients must not implement against:

- `POST /v1/agent/sessions`, `GET/DELETE /v1/agent/sessions/{id}` — sessions are desktop-local
- `POST /v1/agent/sessions/{id}/runs`, `GET /v1/agent/runs/{id}`, `POST /v1/agent/runs/{id}/cancel` — run orchestration is desktop-local
- `GET /v1/agent/sessions/{id}/stream` (WebSocket) — SSE on `/v1/chat/completions` is the only stream transport
- `POST /v1/auth/login|register|lookup` and every `/v1/auth/email/*`, `/v1/auth/password/*` route — Google OAuth is the only identity provider
