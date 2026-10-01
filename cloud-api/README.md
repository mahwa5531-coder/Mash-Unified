# NexaU Cloud API

The secure, scalable cloud boundary between the **NexAU desktop agent runtime**
and the **Bifrost LLM gateway**.

```
NexaU Desktop (agent loop, tools, files, local state)
        │  HTTPS / WSS  ·  Bearer <NEXAU_ACCESS_TOKEN>
        ▼
NexaU Cloud API  ← this service
  authentication · authorization · tenant isolation · entitlements
  rate limiting · idempotency · streaming relay · cancellation
  usage metering · observability · replay & resume
        │  OpenAI-compatible chat completions  ·  Bearer <BIFROST_API_KEY>
        ▼
Bifrost  →  LLM providers
```

The cloud is **not** an agent runtime: the agent loop, tool execution,
filesystem, DuckDB/Python and audit workspace stay on the desktop. The cloud
owns identity, policy, model access, streaming, usage and production
infrastructure concerns. Bifrost credentials exist only server-side.

---

## Quick start

```bash
cp .env.example .env          # fill NEXAU_AUTH_HS256_SECRET etc.
docker compose up -d --build  # postgres + redis + bifrost + api
docker compose logs -f api    # migrations run automatically at boot
```

Smoke test (local auth mode):

```bash
# Login (default dev user must be provisioned; see Provisioning below)
TOKEN=$(curl -s localhost:8080/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@nexau.test","password":"<password>"}' | jq -r .access_token)

# Create a session, run a streaming model request
SESSION=$(curl -s -X POST localhost:8080/v1/agent/sessions \
  -H "Authorization: Bearer $TOKEN" | jq -r .id)

curl -N localhost:8080/v1/agent/sessions/$SESSION/runs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

---

## API surface

| Endpoint | Purpose |
|---|---|
| `POST /v1/auth/register` | self-serve signup: user + personal tenant + owner membership + free-plan trial (409 `EMAIL_TAKEN` on duplicate; local mode) |
| `POST /v1/auth/email/verify` | consume the single-use emailed verification token (split-token, atomic consume) |
| `POST /v1/auth/email/resend` | re-issue the verification email (generic 202 — enumeration-proof; cooldown-gated) |
| `POST /v1/auth/password/forgot` | request a single-use reset link (generic 202; newest-wins supersedes older links) |
| `POST /v1/auth/password/reset` | consume reset token + set new password + revoke every session |
| `POST /v1/auth/password/change` | authed change: returns a fresh token pair, other devices are revoked |
| `GET /v1/auth/oauth/google` | begin "Continue with Google" (302 → Google consent; sets the tx cookie; top-level navigation) |
| `GET /v1/auth/oauth/google/callback` | finish OAuth → 302 to the web success page with a single-use `?grant=` code |
| `POST /v1/auth/lookup` | login-screen email step: `{exists, auth_provider}` (per-IP throttled) |
| `POST /v1/auth/web/session` | grant → SHORT web access token (15 min, **no refresh token** — the browser is not a vault) |
| `POST /v1/auth/desktop/code` | (authed) mint a 60-second single-use `mcode_…` for the desktop handshake |
| `POST /v1/auth/desktop/exchange` | mcode → FULL token pair (device registered; GETDEL single-use — the losing channel gets `INVALID_OR_EXPIRED_CODE`) |
| `POST /v1/auth/login` | email+password → token pair (local mode; IP-throttled; 403 `EMAIL_NOT_VERIFIED` gate) |
| `POST /v1/auth/refresh` | refresh-token rotation (reuse detection revokes the family) |
| `POST /v1/auth/logout` | revoke refresh token + blacklist access jti |
| `GET /v1/me` | server-authoritative identity, limits, model entitlements (+ `email_verified`) |
| `GET /v1/config` | desktop integration config (limits, endpoints, timing) |
| `POST /v1/agent/sessions` | open a session |
| `GET /v1/agent/sessions/{id}` | session metadata |
| `DELETE /v1/agent/sessions/{id}` | close a session |
| `POST /v1/agent/sessions/{id}/runs` | create a run (`stream:true` → SSE of AG-UI envelopes) |
| `GET /v1/agent/runs/{id}` | run status (resume decisions) |
| `POST /v1/agent/runs/{id}/cancel` | cancel a run anywhere in the fleet |
| `GET /v1/agent/sessions/{id}/stream` | WebSocket: run.create / run.cancel / resume / ack / ping |
| `POST /v1/agent/chat/completions` | OpenAI-compatible pass-through (raw SSE bytes) |
| `GET /v1/usage?from&to&by_model` | tenant usage aggregates (authoritative) |
| `GET /v1/payments/catalog` | purchasable credit packs (INR paise → fixed credits) |
| `POST /v1/payments/checkout` | create a top-up order (`Idempotency-Key` honored; Razorpay Checkout.js payload returned) |
| `POST /v1/payments/confirm` | verify the Razorpay Checkout handshake (HMAC + server-side payment fetch + amount check) |
| `GET /v1/payments/orders/{id}` | order status (pending orders reconcile against the provider first) |
| `GET /v1/payments/history?limit` | tenant orders, newest first |
| `GET /v1/payments/balance` | tenant credit balance + last top-up |
| `POST /v1/payments/webhook` | Razorpay events (HMAC-SHA256 signature = the only auth; exactly-once crediting) |
| `GET /health/live` · `GET /health/ready` | liveness (cheap) / readiness (deps) |
| `GET /metrics` | Prometheus (when `NEXAU_OTEL_PROMETHEUS=true`) |

### Event envelope (transport-neutral)

```jsonc
{
  "event_id": "evt_…", "session_id": "sess_…", "run_id": "run_…",
  "sequence": 42,                      // per-run, monotonic, gap-free
  "type": "TEXT_MESSAGE_CONTENT",     // AG-UI vocabulary (NexAU parity)
  "timestamp": "2026-09-10T07:00:00.000Z",
  "data": { "message_id": "msg_…", "delta": "Revenue" }
}
```

Lifecycle per logical unit: `*_START → *_CONTENT… → *_END` for text,
thinking and tool calls; `RUN_STARTED/RUN_FINISHED/RUN_ERROR/RUN_CANCELLED`
bookends; `USAGE_UPDATE` + `MODEL_CALL_FINISHED` on the final chunk. The raw
compat surface (`/v1/agent/chat/completions`) forwards provider SSE bytes
verbatim — existing NexAU `LLMConfig` clients need only a base-URL change.

### WebSocket protocol

```jsonc
// client → server
{"type":"run.create","request":{…run body…}}
{"type":"run.cancel","run_id":"run_…"}
{"type":"resume","run_id":"run_…","last_sequence":42}
{"type":"ack","run_id":"run_…","sequence":42}
{"type":"ping"}
// server → client: event envelopes + {"type":"RESUME_OK"|"RESUME_MISSED"|"RESYNC_REQUIRED"|…}
```

`RESYNC_REQUIRED` is advisory: the server drops WS frames only inside the
slow-consumer grace window (bounded, metered, logged); on receiving the hint
the client resumes affected runs by `last_sequence` to refill gaps from the
per-run replay buffer.

Reconnect + resume works from **any** API instance: events live in a bounded
Redis Stream per run (MAXLEN + TTL window); the desktop resumes by
`last_sequence`. Close codes: 1000 normal, 1001 going away, 1008 policy,
1011 internal/slow-consumer eviction.

### Web login → desktop handshake (Google OAuth + single-use codes)

The 4-screen desktop sign-in contract. **No long-lived token ever crosses the
browser** — only single-use, short-TTL opaque codes:

```
desktop          browser                    cloud API                     Google
  │  opens browser  │                            │                          │
  │─────────────────> GET /v1/auth/oauth/google  │                          │
  │                 │<-- 302 ---------------------│ state + tx cookie        │
  │                 │<==== consent + approve =============================>│
  │                 │  GET …/oauth/google/callback?code&state              │
  │                 │<-- 302 WebSuccessURL?grant=wgrant_… (single-use, 5m) --│
  │                 │  POST /v1/auth/web/session {grant}                   │
  │                 │--> 15-min access token (NO refresh token)            │
  │                 │  POST /v1/auth/desktop/code  (Bearer web token)      │
  │                 │--> mcode_… (single-use, 60 s)                         │
  │                 │                                                            │
  │   channel 1: mash://auth/callback?code=mcode_…   (deep link)              │
  │<─────────────────│                                                            │
  │   channel 2: POST localhost:8000/api/auth/login {code} (fallback)        │
  │<─────────────────│                                                            │
  │  POST /v1/auth/desktop/exchange {code, device_name, platform}             │
  │────────────────────────────────────────────>│ FULL token pair + device   │
```

Properties (all validated in §42):

- **OAuth state**: 32-byte CSPRNG, single-use (atomic Lua GETDEL), 10-minute
  TTL, bound to a same-site tx cookie set on the begin hop — tampered state,
  replayed state and cross-site injections all fail with the generic
  `OAUTH_STATE_INVALID`.
- **ID tokens** are verified against Google's JWKS (RS256 only, `iss`/`aud`/
  `exp` checked); unverified provider emails never create accounts; the
  first Google sign-in provisions user + personal tenant + owner membership +
  free-plan trial atomically; a later password signup with the same email is
  linked, not duplicated (password login keeps working).
- **Dual-channel delivery**: the web page fires the deep link AND the
  localhost loopback POST with the same mcode; the code is single-use, so the
  losing channel receives `INVALID_OR_EXPIRED_CODE` — the desktop treats that
  as "the other channel won" and verifies via `GET /v1/me` (do not retry the
  exchange). Codes are 60 s old after minting; the page can mint a fresh one
  on click if the user lingered.
- **Browser session**: 15-minute access token only (config
  `NEXAU_AUTH_WEB_SESSION_TTL`), held in page memory (never localStorage); the
  browser never receives a refresh token.

Setup: register the redirect URI (exact match,
`NEXAU_AUTH_GOOGLE_REDIRECT_URL`, e.g. `https://api.mash.ai/v1/auth/oauth/google/callback`)
in Google Cloud Console → Credentials → OAuth client (Web application), then
set `NEXAU_AUTH_GOOGLE_CLIENT_ID` / `_SECRET` and `NEXAU_AUTH_WEB_SUCCESS_URL`
(the web success page that receives `?grant=`). The "Continue with Google"
button must be a **top-level navigation** to `GET /v1/auth/oauth/google` (the
tx cookie rides the two top-level GET hops; XHR-initiated flows will fail).

> 📄 **Desktop integration guide**: the full end-to-end connection story —
> desktop ↔ this API ↔ Bifrost (the desktop never talks to Bifrost), every
> wire contract, env knob, and the desktop-side build checklist — lives in
> [`docs/DESKTOP-CONNECTION.md`](docs/DESKTOP-CONNECTION.md).

---

## Architecture

- **Request pipeline** (ordered): session ownership → account/tenant/subscription
  gate → model entitlement → payload validation → distributed rate limit →
  idempotency → concurrency slots → durable run row → Bifrost forwarding →
  incremental event mapping → authoritative usage → exactly-once finalization.
- **Streaming**: one producer goroutine per run; chunks are forwarded the
  moment they arrive (never buffered); backpressure via write deadlines; idle
  watchdog (default 300 s, NexAU parity) and a hard stream-duration cap.
- **Cancellation**: `context.Context` cause-chains end-to-end. Desktop
  disconnect (SSE write failure / WS close), explicit cancel (REST or WS),
  and server shutdown all abort the upstream request within milliseconds.
  Cross-instance cancel rides a Redis control channel; run state is guarded
  by `WHERE status='running'` (concurrent terminal transitions are no-ops).
- **Metering**: Bifrost's authoritative `BifrostLLMUsage` (last chunk) is
  normalized to NexAU `TokenUsage` semantics (input excludes cache reads),
  then batched through a bounded async queue into `usage_records` with
  `UNIQUE(run_id, call_seq)` — exactly-once under any retry.
- **Idempotency**: `Idempotency-Key` (header or body) via Redis `SET NX PX`
  plus a PostgreSQL unique partial index backstop. Same body → replay of the
  original run; different body → `IDEMPOTENCY_KEY_REUSE` (422).
- **Horizontal scale**: N identical instances; all correctness state lives in
  PostgreSQL (truth) + Redis (limits, idempotency, replay, fan-out). No
  sticky sessions, no process-local correctness.
- **Bound everywhere**: connection pools, request bodies, WS frames, send
  queues, replay buffers, metering queue, in-flight semaphore, SSE line
  sizes. Overflow is loud (metrics + logs) and never unbounded. WS frames
  dropped inside the slow-consumer grace window are counted
  (`nexau_ws_grace_drop_total`), logged, and followed by a `RESYNC_REQUIRED`
  control frame so the client refills sequence gaps from the replay buffer
  (audit finding 7 — fixed 2026-09-17).

Full analysis (runtime map, Bifrost contract, boundary decisions): see
`docs/ARCHITECTURE.md`.

## Configuration

All configuration is externalized (see `.env.example`): database, Redis,
Bifrost URL/key, auth mode (`local` HS256 or `jwks` external IdP), separate
timeouts per concern (auth, DB, Redis, dial, header, request, stream idle,
stream max), rate limits per dimension (user/tenant RPM, concurrent runs,
WS connections), replay window, metering batcher, log level/format/redaction,
OTel endpoints. Validation failure at boot lists every problem at once.

## Provisioning (local mode)

Users/tenants/subscriptions are provisioned by operators (or an external
IdP in `jwks` mode). Minimal bootstrap for a new tenant:

```sql
-- ids are ULID-style: prefix_<26 chars>
INSERT INTO tenants (id, slug, name) VALUES ('ten_x…', 'acme', 'Acme Inc.');
INSERT INTO users (id, email, display_name, password_hash, status)
  VALUES ('usr_x…', 'dev@nexau.test', 'Dev', '<bcrypt>', 'active');
INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ('ten_x…', 'usr_x…', 'owner');
INSERT INTO plans (id, code, name, limits, models)
  VALUES ('pln_x…', 'pro', 'Pro',
          '{"concurrent_runs_per_user":16,"requests_per_minute_user":600}'::jsonb,
          '["openai/*","anthropic/*"]'::jsonb);
INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start)
  VALUES ('sub_x…', 'ten_x…', 'pln_x…', 'active', now());
```

## Operations

- **Migrations** run automatically at boot behind a PostgreSQL advisory lock
  (safe for rolling, multi-instance deploys).
- **Graceful shutdown**: stop accepting → close WS (1001) → cancel in-flight
  runs → drain usage metering → flush telemetry → close Redis → close
  PostgreSQL → exit.
- **Housekeeping** (background, per instance): idle-session expiry,
  orphaned-run recovery, refresh-token retention, metrics sampling.
- **Observability**: structured logs with redaction (credentials and content
  never logged), OTel tracing (request → auth → ratelimit → bifrost →
  usage), Prometheus metrics (`nexau_*`), correlation ids everywhere
  (`request_id`, `run_id`, `x-request-id` upstream).

## Testing

```bash
make test         # unit + e2e suites (miniredis + mock Bifrost)
make race         # everything under the race detector
make bench        # hot-path benchmarks
```

The e2e suite proves: incremental delivery (timing-based, not just ordering),
desktop-disconnect → upstream cancellation, cross-connection cancel,
upstream-drop → clean `RUN_ERROR`, tenant isolation, idempotent
exactly-once execution + billing, WS lifecycle + resume, rate-limit 429s.

The codebase has been hardened by five independent audit passes — the full
history with outcomes lives in `docs/OPERATIONS.md` (§ Audit history): an
independent code audit (2026-09-17, 7 confirmed defects → all fixed with
regression coverage), a post-mortem-pattern audit against the
danluu/post-mortems catalog (2026-09-18, poison-pill containment on every
detached goroutine + the latent Timeout×Recovery gap fixed), an upstream
**circuit breaker** guarding the Bifrost path (503
`UPSTREAM_CIRCUIT_OPEN` with `retry_after_ms` and zero upstream traffic
while open — auth, sessions and replay untouched by design), a full
**security-audit remediation** (2026-09-19, all 20 confirmed findings
closed: runtime-only JWT secret injection, OAuth pre-hijacking defense,
server-generated limiter members, per-IP throttles on every unauthenticated
surface, plan quotas, WS lifetime bounded by its token, mandatory SMTP
TLS), and a cleanup pass (2026-09-23: staticcheck + deadcode at zero, an
ID entropy-collapse bug fixed, the `x-nexau-run-id` correlation header
wired, 50 MB of run artifacts and dead declarations removed).

## Load testing

```bash
go run ./cmd/loadtest \
  -url http://localhost:8080 -token "$TOKEN" \
  -streams 500 -requests 500 -duration 60s
```

Reports first-byte latency, p50/p95/p99, throughput, error rate, RSS and
goroutine count (spec §40 measurements).

## Benchmarks (reference, 2 vCPU sandbox)

| Path | ns/op | allocs/op |
|---|---|---|
| chunk → AG-UI events | ~1,300 | 6 |
| envelope marshal | ~940 | 2 |
| request validation (256-msg payload) | ~29,000 | 85 |
| idempotency fingerprint | ~830 | 4 |

The relay overhead between desktop ↔ Bifrost is single-digit microseconds per
event — the gateway is not the latency bottleneck.

## Security checklist

TLS-compatible (terminate at the LB; the server never touches provider
keys) · server-side authorization on every route · tenant isolation at
every query · subscription + entitlement enforcement (including fallback
models) · monthly plan quotas enforced at run creation · request size
limits · distributed rate limiting with server-generated members · per-IP
throttles on ALL unauthenticated surfaces · WebSocket lifetime bounded by
its token (heartbeat re-authorization, 1008 on revocation) · secret isolation
(Bifrost key + HS256 secret: env/secret-file only, never committed, never
logged, never returned) · OAuth pre-hijacking defense (verified-account link
gate + owner notifications) · credential links never logged · safe errors
(correlation id, no internals) · redacted logging (deny-list covers tokens,
links, credentials, content) · mandatory TLS to the SMTP relay, https-only
emailed links · upstream timeout controls · cancellation · idempotency ·
connection limits · bounded memory · no unbounded channels · no goroutine
leaks (verified by `-race` suite) · dependency review (pgx, go-redis,
gorilla/websocket, jwt/v5, OTel — all small, focused, maintained).

## Repository layout

```
cmd/server/          wiring, graceful shutdown, housekeeping
cmd/loadtest/        reproducible load generator
internal/config/     externalized configuration + validation
internal/domain/     core types + stable error model
internal/auth/       JWT/JWKS verification, rotation, middleware
internal/bifrost/    shared-client SSE relay, error normalization, retries, breaker
internal/ratelimit/  Redis Lua sliding window + concurrency slots
internal/idempotency Idempotency-Key store (Redis + PG backstop)
internal/agent/      pipeline, validation, run manager, event mapping
internal/streaming/  AG-UI envelope, Redis bus, SSE writer, WebSocket
internal/metering/   async exactly-once usage recorder
internal/payment/    prepaid credit top-ups: checkout / confirm / webhook / reconcile / ledger
internal/payment/razorpay  Razorpay REST client (auth, retries, HMAC verification)
internal/api/        router + handlers
internal/middleware/ request-id, recovery, tracing, limits, CORS, timeout
internal/store/      pgx pool, Redis, migration runner (embeds migrations/), repositories
tests/               e2e integration suite
validation/         §1–§45 production validation suite
docs/                documentation index: docs/README.md
docs/DEPLOYMENT.md          fresh-to-deploy runbook (env keys, bring-up, smoke tests)
docs/ARCHITECTURE.md        system design (topology, contracts, failure postures)
docs/PAYMENT-GATEWAY.md     Razorpay integration (who owns what, exactly-once, env keys)
docs/DESKTOP-CONNECTION.md  the desktop integration contract
docs/CIRCUIT-BREAKER.md     upstream breaker design + desktop error contract
docs/OPERATIONS.md          operator runbook (deployment checklist, audit history)
```
