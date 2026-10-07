# MASh Cloud API — Architecture

## 1. System position

```
┌──────────────────────────┐         ┌─────────────────────────────┐
│  MASh Desktop (user owns │         │        MASh Cloud API        │
│  EVERYTHING local)       │         │  (this repository, Go)       │
│                          │         │                               │
│  agent runtime           │  HTTPS  │  ┌─────────┐   ┌──────────┐  │
│  workspaces, files       │────────▶│  │  auth   │   │ payments │  │
│  transcripts, sessions   │         │  └─────────┘   └──────────┘  │
│  tools, execution        │         │  ┌─────────┐   ┌──────────┐  │      ┌────────────┐
│  retry/state machines    │         │  │ quotas  │──▶│ LLM      │──┼─────▶│  Bifrost   │
│                          │         │  │ limits  │   │ tunnel   │  │      │ (private)  │
└──────────────────────────┘         │  └─────────┘   └──────────┘  │      └────────────┘
          ▲                          └─────────────────────────────┘         │
          │ Google OAuth (browser)                ▲                          ▼
          └────────────────────────────────────────┤                 OpenAI / Anthropic /
                                                   │                 DeepSeek / …
                                       PostgreSQL + Redis (Aiven)    (via Bifrost only)
```

**Responsibility split (the contract this codebase enforces):**

| Concern | Owner |
|---|---|
| Agent runtime, sessions, transcripts, tools, files, execution | **Desktop** (never the cloud) |
| Workspaces & all local state | **Desktop** |
| Identity (Google OAuth only), token sessions | Cloud |
| Subscriptions, plans, quotas, credits | Cloud |
| Billing (Razorpay) | Cloud |
| Rate limiting per plan | Cloud |
| LLM access (tunnel to Bifrost) | Cloud |
| Provider keys / routing / fallbacks | **Bifrost** (cloud never sees provider keys) |

The desktop never talks to OpenAI/Anthropic/DeepSeek/Razorpay/Google directly —
only to this API and (browser-only) Google's consent screen.

## 2. Package map (the entire production surface)

```
cmd/server/            main.go (wiring + graceful shutdown), housekeeping.go
internal/api/          HTTP surface: router + 15 handlers (auth, me, config,
                       chat/completions, usage, payments, health)
internal/auth/         Google OAuth + web-to-desktop handshake + refresh
                       rotation + identity resolver + middleware
internal/llm/          THE proxy: request validation, SSE writer, tunnel
                       service (entitlement → quota → rate limits → Bifrost)
internal/bifrost/      upstream client: transport, retries, circuit breaker,
                       SSE stream reader, error normalization
internal/ratelimit/    Redis Lua sliding window + concurrency slots
internal/metering/     async bounded llm_calls recorder (batch, exactly-once)
internal/payment/      credit top-ups: orders, ledger, webhook, sweeper
                       (+ razorpay/ subpackage)
internal/store/        pgx pool + embedded migrations; repos/ (users/tenants/
                       subs/entitlements/refresh/oauth/devices/llm-calls/payments)
internal/domain/       User/Tenant/Plan/Subscription/LLMCall/TokenUsage + error model
internal/config/       env loading + validation (all knobs)
internal/middleware/   recovery, request-id, tracing, body limit, CORS, in-flight
internal/observability/ slog + OTel + Prometheus instruments
internal/ids/          ULID-style prefixed ids
internal/reqctx/       request/call correlation keys
```

That is the whole list. There is no agent package, no streaming bus, no
WebSocket transport, no idempotency store — by design (see
`docs/CLEANUP-2026-10-05.md` for what was removed and why).

## 3. The LLM tunnel (the hot path)

`POST /v1/chat/completions` (`internal/llm`, `internal/api/llm.go`):

```
Bearer token ─ auth.Middleware ─ IdentityResolver (Redis-cached 30s, PG truth)
     │
     ▼
llm.Proxy.admit  ──  account/tenant/membership/subscription state
     │               payload validation (bounds, roles, params)
     │               model entitlement (allowlist + patterns, fallbacks too)
     │               rolling token windows (5h burst + 7d weekly, normalized
     │               tokens: WindowUsage SUMs vs plans.limits quotas; the
     │               weights come from token_normalization)
     │               RPM sliding window  (rl:rpm:user:*, rl:rpm:tenant:*)
     │               concurrency slots   (rl:conc:user:*, rl:conc:tenant:*)
     ▼
bifrost.Client ──▶ POST {Bifrost}/v1/chat/completions  (Bearer cloud key,
                    x-request-id + x-mash-call-id + traceparent, retries
                    pre-first-byte only, circuit breaker)
     │
     ├── stream=true:  StreamReader.Next() ──▶ SSE verbatim passthrough
     │                 (lazy headers, heartbeats, [DONE], in-band errors
     │                 after first byte, write deadlines)
     │
     └── stream=false: bounded by BifrostReqTimeout, verbatim JSON body
     │
     ▼
metering.Recorder ──▶ one llm_calls row (call_id, tokens, cost, latency,
                      resolved model, provider, status) — batched async,
                      idempotent by UNIQUE(call_id)
```

Cancellation is structural: the SSE stream lives on the request context, so a
client disconnect cancels the upstream HTTP request through Go's context
propagation — no out-of-band cancel channel, no manager. Usage observed to
that point is still metered (`cancelled`).

**Privacy invariant**: message content transits the wire but is never
persisted. `llm_calls` stores metering facts only. There is no table in the
schema that can hold a prompt or completion.

## 4. Identity model

- **Google is the only IdP.** `Service.FinishGoogleOAuth` verifies the ID
  token against Google's JWKS (RS256, `iss`/`aud`/`exp` mandatory,
  `email_verified` required) and resolves the user by `(auth_provider='google',
  external_subject=sub)` — the `sub` is the immutable anchor; email is
  metadata. Fresh identities are provisioned atomically with a personal
  tenant, owner membership and a trialing Free subscription.
- **Token architecture**: HS256 access tokens (~15 min) minted locally;
  opaque refresh tokens (30 d, rotated on every use, hash-stored, family +
  reuse detection). The browser only ever holds a short web-session token and
  single-use codes (`wgrant_`, `mcode_`); the desktop vault holds the pair.
- **Authorization** happens per request: `IdentityResolver` loads
  user + tenant + membership + effective subscription + plan limits +
  model allowlist from PG (30 s Redis cache), never trusting client input.

## 5. Data model (7 tables + schema_migrations)

```
tenants ─┬─ users (Google identity; NO password column)
         ├─ tenant_members
         ├─ subscriptions ── plans ── (entitlements)
         ├─ devices / refresh_tokens (token sessions)
         ├─ llm_calls (metering facts; the ONLY model-activity table)
         └─ payment_orders / payment_webhook_events / credit_ledger /
            credit_balances
```

Migrations are a fresh, renumbered chain (000001–000007). **Existing
databases from the pre-cleanup schema must be re-provisioned** — see
`docs/CLEANUP-2026-10-05.md § Migration`.

## 6. Operational posture

- **State**: PostgreSQL is authoritative (identity, subscriptions, calls,
  money). Redis is ephemeral (rate windows, concurrency slots, OAuth state,
  grants, mcodes, identity cache, jti blacklist) — losing it degrades limits
  (fail-open with alarm) and handshake codes, nothing else.
- **Scaling**: stateless API replicas; all cross-instance state is Redis
  (sliding windows, slot counters). No sticky sessions; SSE needs no
  session pinning (streams live and die with one request).
- **Circuit breaker**: the Bifrost path trips on consecutive failures or
  failure-rate (fast-fail 503 `UPSTREAM_CIRCUIT_OPEN`), recovers via bounded
  half-open probes — `docs/CIRCUIT-BREAKER.md`.
- **Shutdown**: stop accepting → drain metering queue (bounded grace) →
  flush telemetry. In-flight streams end with their request context.
- **Housekeeping**: one goroutine, refresh-token retention (90 d past
  expiry/revocation) + metric gauge sampling. Nothing else to sweep —
  `llm_calls` rows are terminal the moment they are written.

## 7. Security invariants

1. Provider keys live only in Bifrost; the cloud holds one Bifrost key.
2. Tokens never appear in URLs, logs or the browser beyond single-use codes.
3. Identity is server-resolved on every authenticated request.
4. Client-supplied ids (request ids, device ids) are untrusted: rate-limit
   members are server-generated, foreign device ids degrade to fresh rows.
5. The HS256 secret is deployment-only (`NEXAU_AUTH_HS256_SECRET` or secret
   file; compose fails fast when missing).
6. All tenant-scoped queries filter through `(tenant_id, user_id, status)`.
