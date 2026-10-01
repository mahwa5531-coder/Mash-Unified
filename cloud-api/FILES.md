# NexaU Cloud API — Complete File Guide

> One document describing **every file** in this repository, for engineers
> who inherit this codebase. Total: **~42,000 lines** across ~150 tracked
> text artifacts (18,083 production Go · 12,174 validation/e2e tests ·
> 7,807 unit tests · 400 SQL (10 embedded migrations,
> `internal/store/migrations/`) · docs/config).
>
> The system in one sentence: **the cloud boundary between the NexAU desktop
> runtime and the Bifrost LLM gateway** — authentication, tenant isolation,
> rate limiting, idempotency, streaming (SSE + WebSocket), cancellation,
> usage accounting and production resilience, speaking **OpenAI-compatible
> Chat Completions on both edges** (inbound to the desktop, outbound to
> Bifrost) and emitting **AG-UI-compatible events** to the desktop.
>
> Current validation state: `VALIDATION_REPORT.md` (spec §1–§45:
> 40 PASS / 5 DEGRADED-sandbox-scale / 0 FAIL, 219 tests
> — race detector clean, 8 production bugs + 7 audit defects + 2 post-mortem-
> audit defects + 20 security-audit findings found & fixed, all
> regression-covered; the 2026-09-23 cleanup pass additionally fixed an ID
> entropy-collapse bug, wired the never-connected `x-nexau-run-id` upstream
> correlation header, and brought staticcheck + deadcode to zero).
> Audit history with outcomes: `docs/OPERATIONS.md` (full reports preserved
> in git history). The 2026-09-28 cleanup pass additionally: removed the
> payment module's redundant HMAC implementations (4 copies → 1), deleted
> dead code (`CanTransitionTo`, `CatalogFromSlice`), split the 1,076-line
> single-file test blob into one scenario file per concern, made the whole
> repo gofmt-canonical (tabs), and added `docs/README.md` +
> `docs/DEPLOYMENT.md`.

---

## Repository layout at a glance

```
nexau-api/
├── cmd/                    runnable binaries (server, loadtest)
├── internal/               production code (one package per concern)
│   ├── agent/              the run pipeline (the heart of the service)
│   ├── api/                HTTP handlers + routes
│   ├── auth/               JWT, identity, login/refresh/logout
│   ├── bifrost/            OpenAI-compatible upstream client
│   ├── config/             environment configuration
│   ├── domain/             core types + stable error model
│   ├── idempotency/        duplicate-request protection
│   ├── metering/           async exactly-once usage accounting
│   ├── middleware/         transport hygiene chain
│   ├── observability/      logs, metrics, tracing
│   ├── ratelimit/          Redis Lua distributed limiter
│   ├── reqctx/             request-scoped context helpers
│   ├── store/              PostgreSQL/Redis wiring + migrations
│   └── streaming/          event envelope, SSE, WebSocket, bus
├── validation/             ★ production validation suite (spec §1–§45)
├── tests/                  earlier e2e suite (kept green)
├── scripts/                validation runner + report generator
├── docs/ARCHITECTURE.md    the design document
└── compose.yaml, Dockerfile, Makefile, .env.example
```

### The delivery package (`nexau-cloud-api.zip`)

The zip root carries the repository plus two sibling deliverables:

| Path | What it is |
|---|---|
| `nexau-api/` | this repository (everything below) |
| `capacity-test-1gb.md` | the 1 GiB RAM capacity report: methodology, 2,800-stream verified ceiling, per-stream cost (~165–205 KB), deployment notes (RLIMIT_NOFILE, GOMEMLIMIT) |
| `system-design/SYSTEM-DESIGN.md` | the complete system design in 9 Mermaid diagrams (context, components, run lifecycle, streaming/replay/resume, auth, PG model, Redis data plane, failure postures, run state machine) + 7 exhaustive appendices (routes, middleware chain, Redis key map, PG tables, config, shutdown sequence, capacity envelope) |
| `system-design/d*.mmd` | the 9 raw Mermaid sources (paste into mermaid.live to edit) |
| `system-design/d*.png` | the 9 rendered diagrams (Playwright + mermaid@11, 2× scale, QA-passed for zero overlap/clipping) |
| `system-design/REDIS-SCALABILITY-AUDIT.md` | replica / Sentinel / Cluster / proxy audit, proven from source with file:line evidence: failover = one-factory swap (~40 lines); sharding = single-key discipline holds (all Lua `KEYS[1]`-only, no MGET/MSET/MULTI/SCAN); replica reads deliberately rejected on four read-your-writes paths; remaining production blockers; migration cookbook |

---

## cmd/ — runnable binaries

| File | Lines | What it is |
|---|---|---|
| `cmd/server/main.go` | 303 | The API process. Boot order (config → observability → PostgreSQL+migrations → Redis → auth → limiter/idempotency → metering → bus → Bifrost client → run manager → agent services → HTTP) and the graceful-shutdown sequence (stop accepting → close WS 1001 → cancel runs → drain metering → flush telemetry → close Redis/PG). |
| `cmd/server/housekeeping.go` | 147 | Background sweeper: session idle expiry, run reaping + **concurrency-slot reconciliation vs PostgreSQL** (`ReapAndListSlotOwners` → `ReconcileSlots`, audit finding 4 fixed), refresh-token retention, recovery-token retention, metrics sampler. |
| `cmd/loadtest/main.go` | 295 | Standalone load generator (CLI): mixed traffic (short runs, streams, cancels, reconnects), latency percentiles, concurrency sweep. |
| `cmd/loadtest/http.go` | 50 | Load-generator HTTP client helpers (bounded transport, per-request timers). |

## internal/domain — core types & the stable error model

| File | Lines | What it is |
|---|---|---|
| `internal/domain/types.go` | 401 | User/Tenant/Membership/Plan/Subscription/Device, Session/Run (statuses: running/completed/failed/cancelled/disconnected), TokenUsage (NexAU-canonical: input excludes cached reads), UsageRecord, UsageSummary — and the entire client-facing error vocabulary (`UNAUTHORIZED`, `TOKEN_EXPIRED`, `RATE_LIMITED`, `MODEL_TIMEOUT`, `UPSTREAM_*`, …) with HTTP mappings. **Rule: `Cause` is for logs only, never serialized to clients.** |

## internal/config — configuration

| File | Lines | What it is |
|---|---|---|
| `internal/config/config.go` | ~700 | Every tunable from environment: HTTP limits, body/message/tool caps, WS tuning (heartbeat, write wait, send queue, slow-consumer grace), stream timeouts (idle, max duration), auth (mode local/jwks, TTLs, revocation, **HS256 secret-file variant**), Bifrost (URL, server-side API key, transport knobs, retries), rate limits, replay window, metering, logging, OTel, **unauth-surface throttle budgets + unverified retention**. Validation errors enumerate every misconfiguration — including **https-only `NEXAU_APP_BASE_URL` (loopback exempt) and smtp-requires-base** (audit, needs-validation finding). |
| `internal/config/audit_config_test.go` | ~150 | Audit regressions (config boundary): local mode without any HS256 secret rejected; secret FILE loads + overrides + hits the same ≥32-byte rule; App-URL scheme matrix (https / loopback ok, routable-http / ftp / javascript blocked); smtp without a link destination rejected; retention bounds. |
| `internal/config/cpu.go` | 5 | GOMAXPROCS advisory from cgroup quota (container-aware sizing). |

## internal/auth — authentication & authorization

| File | Lines | What it is |
|---|---|---|
| `internal/auth/jwt.go` | 423 |  Local HS256 signer/verifier (`LocalSigner`, + `SignWithTTL` for short web tokens) and JWKS verifier (rotation-aware). Claims: iss/aud/sub/iat/exp/jti/tid/rol. |
| `internal/auth/claims.go` | 114 | `Identity` (user+tenant+membership+subscription+models allowlist+plan limits), `CanRun()` state gate, JSON-tagged `UserInfo`/`TenantInfo` (wire shape). |
| `internal/auth/middleware.go` | 152 | `Require`: Bearer → verify → (revocation blacklist) → server-side identity resolution → state gate. Fail-closed on infrastructure errors; rejects before any upstream call. |
| `internal/auth/identity.go` | 152 | `IdentityResolver`: verified claims → authoritative identity from PostgreSQL with a short-TTL Redis cache (fail-through to PG, never an auth bypass). |
| `internal/auth/service.go` | 330 | Login (bcrypt), refresh-token rotation with reuse detection, logout/blacklist, device registry; OAuth/handshake collaborators (Google provider, OAuth/devices seams, web/desktop TTLs). |
| `internal/auth/bcrypt.go` | 20 | Password hashing wrapper (cost constant). |
| `internal/auth/signup.go` | 307 | Self-serve signup: register/verify/resend with split-token email verification (atomic single-use consume, enumeration-proof responses). |
| `internal/auth/oauth.go` | 499 |  Google OAuth client (auth-code URL, token exchange, RS256 ID-token verify against Google's JWKS w/ cache) + service flows: single-use tx-cookie-bound state, web grant, short browser session (no refresh token), email lookup. |
| `internal/auth/desktop_code.go` | 163 | The 60-second single-use desktop exchange code: issue, atomic Lua-GETDEL consume, device registration + full token-family minting on exchange. |
| `internal/auth/password.go` | 89 | Password reset (single-use newest-wins tokens) and authed change (revokes other devices). |
| `internal/auth/recovery.go` | 265 | Recovery-token issue/consume/sweep for both email verification and password reset + the mailer layer: **LogMailer (metadata-only, 2026-09-19 audit finding 2 — credential links never logged, `NEXAU_MAIL_LOG_LINKS=true` is the dev-only opt-in)** and SMTPMailer with **mandatory TLS** (implicit 465 or required STARTTLS 587 — a cleartext relay is refused before any byte leaves the process) + the OAuth-linked owner notification. |
| `internal/auth/security_audit_test.go` | ~270 | 2026-09-19 audit regressions (unit): LogMailer never leaks the credential link (+ opt-in path), OAuth pre-hijacking (unverified seed refused + untouched; verified links + notification; login/provision unaffected), reset flips `email_verified`, SMTP refuses a STARTTLS-less relay with zero envelope bytes. |
| `internal/auth/auth_test.go` | 162 | Signer round-trips, expiry, wrong secret/audience, garbage tokens, claims validation, identity gating. |
| `internal/auth/testhelpers_test.go` | 33 | Shared auth test fixtures. |
| `internal/auth/signup_test.go` | 786 |  Signup/verify/resend/forgot/reset/change matrix: token single-use, cooldowns, enumeration resistance, family revocation. |
| `internal/auth/oauth_test.go` | 584 |  Fake Google (token+JWKS): happy exchange, forged signature, bad aud/iss/exp, state lifecycle (replay, tx mismatch, missing cookie, expiry), unverified provider email, race retry convergence, web grant, lookup matrix. |
| `internal/agent/audit_ratelimit_test.go` | ~105 | Audit finding 4 at the service seam: a request context carrying a PINNED request id (as the middleware would produce from the client's header) still enforces the 5/min quota — 5 admitted / 6th rejected / no billable work for rejected calls; honest fresh ids see the same quota. |
| `internal/auth/desktop_code_test.go` | 236 | mcode shape, TTL, happy exchange (claims+family+device), replay, 8-way concurrent single winner, expiry, validation-without-burning, Redis-down fail-closed. |

## internal/agent — the run pipeline (the heart)

| File | Lines | What it is |
|---|---|---|
| `internal/agent/service.go` | 1040 |  `Service.CreateRun` executes the pipeline in spec order: session ownership (tenant-scoped lookup IS the isolation) → account/subscription gate → model entitlement → payload validation → distributed rate limit → idempotency (InFlight verifies PostgreSQL; stale claims replay instead of 409-ing for 24 h — audit finding 5 fixed) → concurrency slots → durable run row → producer/stream. `ProduceStream` maps Bifrost chunks to events with exactly-once finalization and carries **poison-pill containment** (post-mortem audit F1: the WS path runs it detached where Recovery cannot reach — panics are contained, logged, finalized `failed/INTERNAL`, recover path itself panic-guarded); `completeSync` for non-stream; replay outcomes for duplicates; `RunResponse.Failure()` maps failed runs onto transport errors for the compat surface. |
| `internal/agent/validation.go` | 490 |  `RunRequest` = canonical OpenAI Chat Completions request + correlation fields. `UnmarshalJSON` separates known fields from forward-compat `Extras`. `Validate()` enforces every invariant: model shape, roles, tool-call shapes, content blocks (incl. OpenAI's `content: null`), parameter ranges, stop shape, correlation-id charset (they enter Redis/SQL). `fingerprint()` = stable idempotency hash of billable content only. |
| `internal/agent/mapper.go` | 407 |  Bifrost chunk → AG-UI event translation: TEXT/THINKING/TOOL_CALL lifecycles (START→CONTENT→END; thinking closes at the reasoning→answer and reasoning→tool transitions with a parent message — audit finding 6 fixed), RUN_* bookends, USAGE_UPDATE on the final chunk, usage normalization to NexAU cache semantics, model/provider capture, idempotent finishing. |
| `internal/agent/manager.go` | 317 | Run manager: local producer registry, **cross-instance cancel channel** (`nexau:runctl`), concurrency slots (Redis counters with TTL backstop + sweeper reconciliation via `ReconcileSlots` — audit finding 4 fixed), release contexts detached (`WithoutCancel`), `handleControlSafely` panic guard on the control loop (post-mortem audit F1), and `Shutdown()` that cancels every run and **waits (bounded) for producers to finalize** so metering drains after the last billing facts land. |
| `internal/agent/wshandler.go` | 237 | WS transport protocol adapter: `run.create` / `run.cancel` / `resume` (subscribe-live-first, replay-merge, gap refill) / `ack` / `ping`. Runs are bound to the connection lifecycle (disconnect → cancel). |
| `internal/agent/session.go` | 119 | Session service: create/get/close with tenant-scoped access and idle TTL. |
| `internal/agent/raw.go` | 176 | Raw OpenAI passthrough producer for the compat surface (zero re-serialization on the hot path). Returns the upstream failure so the transport can answer with a real HTTP error pre-stream or an in-band OpenAI error event mid-stream (audit finding 8 fixed). |
| `internal/agent/validation_test.go` | 235 |  Payload validation matrix incl. fingerprint stability and extras round-trip. |
| `internal/agent/mapper_test.go` | 365 | Event mapping: lifecycles (element-wise incl. the reasoning→answer/tool thinking-END transitions), thinking parent ids, multi tool calls, usage floors, error closing, non-first choices dropped. |
| `internal/agent/bench_test.go` | 92 | Hot-path benchmarks (validate ~29µs, map ~1.3µs, envelope ~0.9µs, fingerprint ~0.8µs). |
| `internal/agent/service_idem_test.go` | 257 |  Idempotency crash-recovery matrix (audit finding 5): stale InFlight + terminal PG row → replay; genuine InFlight → conflict; fresh-claim insert race → conflict without aborting the winner's claim. |
| `internal/agent/panic_containment_test.go` | 235 | Poison-pill containment proofs (post-mortem audit F1): panicking sink contained with run finalized `failed/INTERNAL` and waiters released; clean run after poison stays healthy; five hostile upstream chunk shapes → no crash, valid terminal states. |

## internal/api — HTTP surface

| File | Lines | What it is |
|---|---|---|
| `internal/api/router.go` | 268 | Route table (Go 1.22 patterns): `/v1/auth/*` (signup/recovery, OAuth, lookup, web/session, desktop handshake), `/v1/me`, `/v1/config`, `/v1/agent/sessions/*` (create/get/close/runs/stream), `/v1/agent/runs/{id}` (+cancel), `/v1/agent/chat/completions` (OpenAI-compat), `/v1/usage`, health, metrics. Access-log + metrics shell, 404 fallback, WS Hijack/Unwrap passthrough. |
| `internal/api/runs.go` | 201 | Run creation (stream → SSE producer on the handler goroutine with disconnect watcher + heartbeat; non-stream → synchronous run view), run get, cancel (idempotent, cross-instance), `Idempotency-Key` header handling. |
| `internal/api/stream.go` | 162 | The WS upgrade path: token verify → identity resolve → state gate → session ownership (404 for absent AND foreign) → per-user WS quota (Redis, fail-open; release detached via `WithoutCancel` — audit finding 2 hardening) → upgrade → pumps. |
| `internal/api/compat.go` | 216 | **OpenAI-compatible surface** (`POST /v1/agent/chat/completions`): full pipeline enforcement, deterministic implicit session per user, raw SSE passthrough on stream with a **lazy 200-commit** (pre-stream upstream failure → real HTTP error with request_id; mid-stream failure → in-band OpenAI error event before `[DONE]` — audit finding 8 fixed), raw completion body / proper HTTP error on non-stream. |
| `internal/api/sessions.go` | 58 | Session create/get/close handlers. |
| `internal/api/auth.go` | 136 | Login/refresh/logout endpoints with IP throttling. |
| `internal/api/oauth.go` | 264 | Six handshake endpoints: OAuth begin (tx cookie) / callback (redirect with single-use grant), lookup, web/session, desktop/code (authed, per-user throttle), desktop/exchange (per-IP throttle). |
| `internal/api/signup.go` | 238 | Register/verify/resend/forgot/reset/change endpoints (local mode; unmounted in jwks mode). |
| `internal/api/me.go` | 85 | `/v1/me` + `/v1/config` (client-visible identity + server configuration subset). |
| `internal/api/usage.go` | 87 | `/v1/usage` — per-tenant usage summaries. |
| `internal/api/health.go` | 70 | Liveness (never tied to dependencies) + readiness (PG/Redis/Bifrost probes). |

## internal/bifrost — the upstream (OpenAI-compatible) client

| File | Lines | What it is |
|---|---|---|
| `internal/bifrost/client.go` | 313 |  Shared-transport HTTP client: server-side credential injection, bounded pools, dial/TLS/header timeouts, pre-first-byte retry policy with jitter (never retries auth failures; retries 429/5xx safely). |
| `internal/bifrost/stream.go` | 326 |  Incremental SSE `StreamReader`: data-line parsing, `[DONE]`, in-band BifrostError detection, 1 MiB line bound, **idle watchdog that cancels the context AND closes the body** (a blocked read only observes the request context — closing the body is what actually aborts), abort classification (idle vs cancel vs protocol), idempotent Close. |
| `internal/bifrost/errors.go` | 306 |  BifrostError normalization: stable `UPSTREAM_*` codes, safe HTTP mapping (upstream 401/403 → 502 — never imply the client's token was wrong), retryable classification, transport-error mapping. |
| `internal/bifrost/types.go` | 278 | Chat request/response/chunk wire types (verified against the Bifrost OpenAPI spec: `model` = "provider/model", usage in the LAST chunk, `extra_fields{provider,model_deployment,latency}`, in-band error fields). |
| `internal/bifrost/bifrost_test.go` | 404 |  Stream parsing, malformed chunks, in-band errors, idle watchdog, retries, cancellation, chunk error detection, status mapping. |
| `internal/bifrost/breaker.go` | 369 | Upstream circuit breaker: CLOSED/OPEN/HALF-OPEN with consecutive + failure-rate (ring window) trip modes, exponential cooldown capped at OpenMax, bounded half-open probe generations, late in-flight result neutrality, injectable clock, breaker metrics (state gauge, trips, rejections). |
| `internal/bifrost/breaker_test.go` | 652 | 22 breaker tests under `-race`: every transition and boundary (min-samples, backoff cap, probe limits), client-level classification (4xx alive, 408 counts, mid-stream drops, cancellation neutrality, in-band provider errors ignored), fast-fail with zero HTTP hits, message hygiene, Health bypass, concurrent hammer. |

## internal/streaming — events, SSE, WebSocket, bus

| File | Lines | What it is |
|---|---|---|
| `internal/streaming/events.go` | 185 | The `Envelope` (event_id/session_id/run_id/sequence/type/timestamp/data) — the only cloud→desktop shape — and the AG-UI-compatible event vocabulary (RUN_*, TEXT_MESSAGE_*, THINKING_*, TOOL_CALL_*, USAGE_UPDATE, MODEL_CALL_FINISHED, RESUME_*). |
| `internal/streaming/sse.go` | 138 | SSE writer: per-event flush (never buffers a response), heartbeat comments, **write deadlines via `http.NewResponseController`** (works through wrapper chains — slow consumers fail the write, which cancels the run and aborts upstream). |
| `internal/streaming/websocket.go` | 540 |  WS transport: 2 pumps per connection, bounded send queue, slow-consumer grace → eviction, **loud grace-window drops** (`nexau_ws_grace_drop_total` + per-episode log + `RESYNC_REQUIRED` hint on recovery — audit finding 7 fixed), ping keepalive, close-code hygiene, OnClose hooks (run cancellation), graceful-shutdown registry, **a single write mutex serializing every frame** (gorilla requirement), and **the heartbeat auth guard** (`SetAuthGuard` — every tick re-runs an injectable probe; failure closes 1008, so a connection never outlives its credential). |
| `internal/streaming/audit_wsguard_test.go` | ~110 | Audit regression: guard probe semantics (nil/error/pass) and the full loop — a guard installed mid-connection closes the live socket with 1008 on the wire. |
| `internal/streaming/websocket_test.go` | 97 | Grace-drop loudness + RESYNC_REQUIRED delivery; no hint without an actual drop episode. |
| `internal/streaming/bus.go` | 241 | Redis event bus: per-run Streams (replay, MAXLEN + TTL bounded) + per-session PubSub (live fan-out); publish is best-effort per leg (one leg failing never blocks delivery); forwarder goroutine panic-guarded (post-mortem audit F1). |
| `internal/streaming/events_test.go` | 113 | Envelope round-trip, event-id uniqueness, SSE writer concurrency, heartbeat lifecycle. |

## internal/middleware — transport hygiene

| File | Lines | What it is |
|---|---|---|
| `internal/middleware/middleware.go` | 371 |  Chain with **double Recovery** (innermost runs on whatever goroutine executes the handler — including the one Timeout spawns — plus outermost for the transport shell; post-mortem audit F2) → request-id (sanitized) → tracing → in-flight semaphore → body limit → CORS → timeout (streams opt out). `statusWriter` passes through Flush/Hijack and **`Unwrap()`** (deadline + hijack transparency through wrappers). |
| `internal/middleware/errors.go` | 10 | Shared domain-error JSON writer (single wire format). |
| `internal/middleware/middleware_test.go` | 247 | Request-id rules, panic recovery, body-limit streaming, in-flight saturation, CORS, **Timeout×Recovery composition** (panic under blanket timeout → 500 not process death; slow handler → 504 in budget). |

## internal/ratelimit, idempotency, metering, observability, reqctx, ids, store

| File | Lines | What it is |
|---|---|---|
| `internal/ratelimit/limiter.go` | 300 | Distributed sliding window (Redis Lua, ZSET, single round trip for all scopes), strictest-wins, denial `Retry-After` = window remainder (audit finding 3 fixed), concurrency slots with TTL backstop + sweeper reconciliation (`Reconcile`), **explicit fail-open/fail-closed posture** with an alarm metric. |
| `internal/ratelimit/limiter_test.go` | 233 | Window boundaries, expiry, zero-limit disable, slot expiry, reconcile, **Retry-After direction (both edges)**, fail-open AND fail-closed under Redis-down. |
| `internal/ratelimit/audit_member_test.go` | ~75 | §45 support (audit finding 4, mechanism): a pinned ZSET member keeps the window count at 1 (ZADD dedupe — why the member must be server-generated); unique members enforce the limit exactly and denials consume no budget. |
| `internal/idempotency/idempotency.go` | 204 |  Redis `SET NX PX` idempotency with request fingerprints: Fresh/Replay/InFlight/Reuse outcomes, scoped per tenant+user, `ClaimedAt` for stale-claim disambiguation. |
| `internal/idempotency/idempotency_test.go` | 105 | Outcome matrix incl. TTL expiry and scoping. |
| `internal/metering/usage.go` | 245 | Async bounded-queue recorder: batcher goroutine, idempotent batch insert retries behind a **panic guard** (post-mortem audit F1: a panicking writer must not kill the process nor silently stop billing), **loud drops** (never silently lose billing), Close() drains. |
| `internal/metering/usage_test.go` | 106 | Batching, transient retry, overflow drop alarm, close drain. |
| `internal/metering/panic_test.go` | 86 | Poison-pill containment proof: a panicking UsageWriter drops its batch loudly and the batcher keeps flushing later records (no process crash, no silent billing stop). |
| `internal/observability/metrics.go` | 181 |  Instrument registry (http.*, stream.*, ws.* incl. grace drops, runs.*, bifrost.*, usage.*, ratelimit.*, idempotency.*, meter queue depth). |
| `internal/observability/observability.go` | ~225 | slog structured JSON logging (redaction keys), OTel traces/metrics wiring, Prometheus endpoint. The built-in deny-list redacts credentials, content **and `link`** (2026-09-19 audit finding 2 — emailed links carry single-use credentials). |
| `internal/observability/redact_audit_test.go` | ~50 | Deny-list regression: `link` (+ case variants), the credential set, extra configured keys; operational keys pass through untouched. |
| `internal/reqctx/reqctx.go` | 39 | Request-scoped helpers (request-id extraction). |
| `internal/ids/ids.go` | 112 |  Prefixed ID generation + charset validation (ids cross Redis/SQL — validated everywhere; accepts mixed-case echoes: OpenAI tool-call ids, provider model names — audit finding 1 fixed). |
| `internal/ids/ids_test.go` | 102 |  Mixed-case acceptance (real OpenAI tool-call id shapes), unsafe-character rejection, length bounds. |
| `internal/store/store.go` | 195 | pgx pool + Redis client wiring, migration bootstrap, error mapping: not-found/unique/timeout/**connection-class → 503 DEPENDENCY_UNAVAILABLE** (a DB outage is never a 500). |
| `internal/store/migrate.go` | 95 |  Ordered migration runner. |
| `internal/store/repos/auth.go` | 170 |  Users/tenants/memberships queries (tenant-scoped). |
| `internal/store/repos/identity.go` | 228 | Subscriptions/entitlements (model allowlist with patterns) queries. |
| `internal/store/repos/agent.go` | 441 | Sessions/runs/usage queries: tenant-scoped lookups, terminal-state writes (exactly-once), usage batch insert, `ReapAndListSlotOwners` (orphaned-run reaping + slot-owner enumeration with per-dimension window counts), `CountRunning`. |
| `internal/store/repos/oauth.go` | 214 | OAuth identity resolution (subject→login · email→link · neither→atomic provision with tenant/membership/trial; unique-index race arbitration) + devices upsert (untrusted client ids degrade to fresh rows). |
| `internal/store/repos/recovery.go` | 281 | Recovery-token store: single-use consume, newest-wins supersede, retention sweeps. |
| `internal/store/repos/payments.go` | 341 | The payment module's PostgreSQL `Store`: every money-mover is ONE transaction (row lock + status guard + ledger `UNIQUE(order_id,kind)` + balance upsert — `ApplyPaid`); unique-violation → sentinel mapping; `NULLIF`/`COALESCE` discipline on nullable text (live-caught bug: Go `""` vs SQL NULL in the partial unique index). |
| `internal/store/repos/payments_test.go` | 379 | PG-truth integration tests (env-guarded on `NEXAU_TEST_DATABASE_URL`): unique constraints, exactly-once replay, 24-transaction concurrent `ApplyPaid` storm under real row locks, failed→late-capture, expiry, webhook dedupe. |
| `internal/store/repos/json.go` | 5 | JSONB helpers. |
| `internal/store/migrations/*.sql` (10 files) | 400 | Schema: users → memberships → subscriptions/plans → devices+sessions → sessions → runs (idempotency unique index) → usage → housekeeping indexes → signup/recovery → **payments** (orders with idempotency + provider-order uniques, webhook-event PK dedupe, credit ledger + balances). |

## internal/payment — prepaid credit top-ups (Razorpay)

The provider does the money; this module ROUTES it and keeps an honest
ledger (responsibility split: `docs/PAYMENT-GATEWAY.md` §1b). Every file is
one atom; there is exactly ONE mint path (`apply.go`) shared by confirm,
webhook and reconcile.

| File | Lines | What it is |
|---|---|---|
| `internal/payment/domain.go` | 177 | Order entity, statuses, terminal-state rules (the SQL guards are the transition authority), ledger entry, webhook event, client view DTO. |
| `internal/payment/provider.go` | 140 | `Provider` — the ONLY money-transmission contract (razorpay.Client in prod, MockProvider in dev/tests). |
| `internal/payment/store.go` | 75 | `Store` — the ONLY persistence contract, with its concurrency semantics spelled out. |
| `internal/payment/service.go` | 101 | Service assembly, read APIs (balance/history), nil-safe disabled mode. |
| `internal/payment/hmac.go` | 34 | The ONE HMAC-SHA256 implementation (both Razorpay schemes, constant-time compare). |
| `internal/payment/errors.go` | 106 | Typed client-safe failures; storage sentinels. |
| `internal/payment/catalog.go` | 117 | Purchasable packs (defaults + `NEXAU_PAYMENT_CATALOG_JSON` override, boot-fail on invalid). |
| `internal/payment/checkout.go` | 157 | Idempotent order creation (unique replay/reuse semantics, amount echo check). |
| `internal/payment/confirm.go` | 80 | Three-legged Checkout handshake verification (signature + provider fetch + amount match). |
| `internal/payment/webhook.go` | 128 | Budget → HMAC over raw bytes → parse → dedupe → amount cross-check → state apply. |
| `internal/payment/apply.go` | 64 | **The exactly-once core** — the single mint path; paid is absorbing. |
| `internal/payment/reconcile.go` | 137 | Read-through reconcile on status views + background sweeper (TTL expiry, missed-capture recovery). |
| `internal/payment/mock.go` | 271 | MockProvider: dev mode (`NEXAU_PAYMENT_PROVIDER=mock`, no keys) + test lifecycle control; speaks the razorpay webhook wire format. |
| `internal/payment/razorpay/client.go` | 182 | REST transport: basic auth, timeouts, GET-only bounded retries (POST /orders is single-shot — double-order hazard), error classification. |
| `internal/payment/razorpay/orders.go` | 114 | CreateOrder/FetchOrder/FetchPayment/FetchOrderPayments + ParseWebhook. |
| `internal/payment/razorpay/signature.go` | 35 | Fail-closed wrappers over `payment/hmac.go` (unset secret never verifies). |
| `internal/payment/razorpay/types.go` | 49 | Wire DTOs (never leak past the package). |
| `internal/payment/razorpay/*_test.go` | 309 | Known-answer HMAC vectors, transport behavior vs a wire-compatible fake server (auth 401, no-retry-on-POST proof). |
| `internal/payment/*_test.go` (scenario files) | 1,187 | One file per concern: `harness` (SQL-faithful fake store), `catalog`, `checkout`, `confirm`, `webhook`, `reconcile`, `concurrency` (32-goroutine checkout race, 36-way confirm/webhook/reconcile storm, 50-tenant isolation — all -race), `provider_e2e` (real razorpay.Client vs fake server, exactly-once incl. duplicate webhooks). |
| `internal/api/payments.go` | 228 | Thin HTTP handlers (decode → service → encode); webhook route reads raw bytes untouched (HMAC over exact bytes). |

## validation/ — ★ the production validation suite (spec §1–§43)

The user's directive: *mock the OpenAI-agent-like input and test; the NexAU
desktop runtime is NOT executed because the API is OpenAI-compatible.*
Every test name is `TestV{NN}_*` where NN = spec section; the report
generator maps that onto PASS/FAIL/DEGRADED/NOT TESTED.

| File | Lines | Spec sections | What it proves |
|---|---|---|---|
| `validation/harness_test.go` | 1432 |  §2 | The whole environment: OpenAI-compatible **mock Bifrost with fault injection** (scripts, per-body scripts, status errors, malformed, in-band errors, header stalls, connection drops, fail-first, request/auth capture), **fault-injectable PG seam fakes** (sessions/runs/usage with latency + error injection), identity table (suspended user/tenant, inactive/past-due subscription, model allowlist, plan limits), **multi-replica stack** (N API instances over shared Redis/PG/Bifrost), **toggleable TCP proxy** for true Redis network outages + recovery, SSE/WS desktop readers, resource monitors (goroutines/FDs/RSS/heap), VALMETRIC emission, log capture. Optional `stackOpts` knobs (meterQueue/meterBatch/wsHB, defaults = previous hard-coded values). |
| `validation/auth_matrix_test.go` | 380 | §3, §4 | Full auth matrix (valid/expired/invalid/malformed/missing/wrong-type/revoked/disabled user/disabled tenant) — every rejection happens **before Bifrost**; authorization matrix (own/cross-user/cross-tenant sessions, subscription states, model entitlements incl. patterns); forged tenant/session ids never redirect anything. |
| `validation/idempotency_tenancy_test.go` | 301 | §5, §18 | Retry-after-timeout executes exactly once and bills once; key+payload mismatch → 422; concurrent duplicates → single execution; tenant-isolation attacks across sessions/runs/usage/cancel with forged ids — every cross-tenant request fails. |
| `validation/streaming_test.go` | 481 | §6, §7, §8, §9, §11, §12 | Incremental delivery + TTFB; **10,000 events in exact order (no dup/gap/reorder)**; slow consumers evicted (WS grace + SSE write deadline) with upstream abort; desktop disconnect propagation (WS + SSE); **idle timeout fires at IdleTimeout, NOT MaxDuration** (caught a real bug); active long streams not killed by duration; header-stall timeout; slow sparse streams with bounded resources. |
| `validation/bifrost_failure_test.go` | 398 | §10, §13 | Upstream mid-stream drop → stable error, run failed, request_id recorded, no internal leakage (URLs/credentials/orgs); provider status matrix (401/403/404/408/409/429/5xx) on both surfaces; retry semantics (503 retried to MaxRetries, 401 never, recovery after transient 503); malformed chunks, in-band errors, garbage bodies; **compat streaming failures: pre-stream → real HTTP error, mid-stream → in-band OpenAI error event before [DONE]** (audit finding 8 regression). |
| `validation/ratelimit_test.go` | 165 | §14 | User boundary (5 allowed, 6th rejected, rejected never forwarded); **3 replicas sharing one Redis enforce ONE global limit** (not 3 local ones); concurrency slots; limits never cross tenants. |
| `validation/redis_pg_failure_test.go` | 457 | §15, §16, §17, §31 | Network-level Redis outage via toggleable proxy: fail-open AND fail-closed postures asserted explicitly (limits never silently bypassed), auth never Redis-dependent, mid-stream outage converges; PG failures → clean 503s, process alive, no goroutine leak, transient terminal-write failure recovers; slow PG; pool stress with bounded waiting; **recovery after Redis/PG/Bifrost failures + restoration**. |
| `validation/malicious_test.go` | 351 | §19, §20 | 24-case malformed-input matrix (wrong types, invalid roles, NaN/Infinity, invalid unicode, duplicate keys, unknown-field passthrough), deep nesting bounded, huge strings, concurrent malicious flood (no panic, bounded resources); oversized boundaries (limit-1/limit/limit+1/2x/10x) rejected **before Bifrost**; tool floods capped. |
| `validation/ws_abuse_test.go` | 279 | §21 | Unauthenticated/expired upgrade rejection; 200 rapid connect/disconnect cycles (goroutines + FDs return to baseline); idle-connection quota; binary frames / unknown types / invalid JSON / oversized frames handled cleanly; 30 concurrent active streams. |
| `validation/multireplica_test.go` | 312 | §25, §26 | 4 replicas: auth/authz/tenant isolation/idempotency/usage consistent, **cross-instance cancel** (run on replica 1 cancelled via replica 3); replica churn under traffic; replica death mid-stream → recoverable client outcome, valid run state, resume protocol works. |
| `validation/cancellation_test.go` | 380 | §27 | Every race combination (completion-vs-cancel, timeout-vs-completion, disconnect-during-cancel, provider-failure-during-cancel) + a 30-round randomized matrix: exactly one terminal transition, valid final state, at most one billing row. |
| `validation/usage_test.go` | 256 | §28 | Accurate attribution (tenant/user/run/session/provider/model), NexAU cache semantics, per-outcome accounting (success bills tokens; failed/cancelled/disconnected/timeout produce exactly one **zero-token audit row**), retry bills once, duplicates bill once, multi-run totals exact. |
| `validation/observability_test.go` | 272 | §29, §35, §36 | request_id/session_id/run_id flow through events, run rows, usage and error responses; logs never contain payloads/tokens/credentials; metrics instruments wired; **Bifrost credential presented only upstream, never in responses/logs**; run rows store metadata only (no payloads); replay buffer MAXLEN+TTL bounded; no file/workspace/audit blobs. |
| `validation/shutdown_test.go` | 217 |  §30 | 20 active SSE + 10 active WS + 30 upstream streams, production shutdown sequence: bounded time, all upstream cancelled, all runs terminal, metering fully drained (every run has its usage row — caught a real bug), listener gone, no goroutine leak; drains reject new work. |
| `validation/agent_loop_test.go` | 406 | §37 | The full agent loop on **three surfaces** (agent SSE, OpenAI-compat raw SSE, WebSocket): user task → tool call → local tool execution → tool result → final answer; lifecycle integrity, ordering, per-turn usage, run/session identity, cancellation mid-loop. |
| `validation/leaks_test.go` | 344 | §22, §32, §33, §34 | Long-running stream soak with periodic RSS/goroutine/FD snapshots; **two-round leak detection** (round-over-round growth — immune to pool warm-up) for goroutines and FDs; multi-round memory stability (warm-up growth allowed, steady-state growth fails). |
| `validation/duration_test.go` | 374 | §22 | **Stream-duration semantics at production timing** (idle 300s / cap 15m): 570-chunk continuous generation (571s measured, 570/570 events in strict order, TTFB 1.0s, flat goroutines=27/RSS=31MB/FDs=17 for the whole run, usage captured at minute 9+); 240s mid-stream silence surviving the production idle watchdog; duration-cap termination fires **exactly at `StreamMaxDuration`** (client error + terminal run + upstream cancel, no zombie generation); scaled idle-gap boundary (1.5s vs 2s watchdog). Answers "can the LLM generate for 10 minutes straight" — yes: 600s < 900s cap, idle timer resets per chunk. |
| `validation/load_test.go` | 382 | §23, §24, §39 | Mixed realistic traffic (shorts/streams/cancels/errors/errors) at 10/100/500-user tiers with bounded load client; latency percentiles + TTFB + throughput + resources per tier (VALMETRIC); burst (40 → 400 → 40) with recovery; §39 discipline: baseline → sweep → bounded saturation. |
| `validation/capacity_test.go` | 413 | RAM capacity | **1 GiB concurrency ceiling probe** (`TestVCap1GB_Concurrent3MinLive`): waves of N concurrent 3-minute-live streaming runs (1 chunk/s × 180s) under `debug.SetMemoryLimit(1 GiB)` + 250 ms RSS watchdog; fresh stack per wave; lean 8KB-buffer SSE readers; ramp/overlap/span/peak-RSS/goroutine/FD/GC metrics; FITS-vs-BREACH verdict per wave; strict mode. **Verified: 2,800 concurrent 3-min-live requests in 1 GiB (98.3% of budget), breach at 2,900**; gated by `NEXAU_CAP_WAVES` env. Report: `download/capacity-test-1gb.md`. |
| `validation/fault_matrix_test.go` | 376 | §38 | Combined failures: disconnect+bifrost-timeout, reconnect+replica-restart, **Redis outage mid-burst** (clean degradation, recovery), slow-PG+high-concurrency (no deadlock), Bifrost-429+client-retry (bounded amplification), disconnect+cancel, shutdown+active-WS. |
| `validation/oauth_desktop_test.go` | 965 |  §42 | Google OAuth + desktop handshake over the wire: fake Google (auth/token/JWKS) + browser journey (cookie jar): full 4-screen flow, tampered/replayed state, missing tx cookie, forged ID token, unverified email, dual-channel single winner, code expiry, lookup matrix, rate limits (429+Retry-After), link-not-duplicate, token-leak scan, concurrent same-subject provision, auth gate, web-session shape. |
| `validation/postmortem_hardening_test.go` | 202 | §43 | Post-mortem hardening (danluu taxonomy): hostile upstream chunk shapes over the real WS transport → valid terminal states, live connection, clean post-storm run; 8 concurrent hostile connections → replica stays live; no goroutine growth (frame-count delta vs baseline). |
| `validation/circuit_breaker_test.go` | 358 | §44 | Upstream circuit breaker E2E on tight thresholds: 503-storm → trip → instant `UPSTREAM_CIRCUIT_OPEN` with zero upstream hits (mock counter verified) → non-LLM surfaces still 200 → cooldown → probe recovery → closed; circuit state on `/health/ready` across the lifecycle; WS `run.create` as the closing probe; OpenAI-compat surface guarded. |
| `validation/security_audit_test.go` | ~400 | §45 | The 2026-09-19 security-audit regressions through the real stack: pinned `X-Request-Id` cannot defeat RPM quotas (5 admitted / 6th 429 / exactly 5 upstream calls); monthly token quota binds at run creation (runs beginning inside the quota finish, `PLAN_QUOTA_EXCEEDED` after, other tenants unaffected); fallback models checked against the restricted allowlist; the full OAuth pre-hijacking chain (attacker seed → Google refused `OAUTH_ACCOUNT_UNVERIFIED` → victim resets password (mailbox proof) → Google links → attacker's password dead); a live WS closed with 1008 after logout while the same token 401s on HTTP; and per-IP throttles on refresh / verify-email / oauth-begin. |
| `validation/signup_test.go` | 713 | §41 | User lifecycle: register → verify → login gate (`EMAIL_NOT_VERIFIED`), resend cooldowns, forgot/reset (single-use, newest-wins, session revocation), password change (token refresh + other-device revocation), enumeration resistance. |

## tests/ — the earlier e2e suite (kept green)

| File | Lines | What it is |
|---|---|---|
| `tests/harness_test.go` | 516 |  The original e2e harness (single instance, scripted fake Bifrost, in-memory seam fakes, miniredis). |
| `tests/streaming_e2e_test.go` | 540 | Incremental delivery, disconnect→upstream cancel, cancel endpoint, upstream drop, tenant isolation, idempotent execution/billing, non-stream runs, rate-limit 429. |
| `tests/websocket_e2e_test.go` | 290 | WS lifecycle, cancel, malformed frames, foreign sessions, resume replay. |
| `tests/goroutines_test.go` | 63 | Baseline goroutine leak check. |
| `tests/helpers_test.go` | 70 | Small SSE/HTTP helpers. |

## scripts/, docs/, deployment

| File | Lines | What it is |
|---|---|---|
| `scripts/run_validation.sh` | 41 | Runs the full validation suite (race enabled), captures `go test -json`, runs the package regression, renders `VALIDATION_REPORT.md`. `SHORT=1` skips soaks/loads. |
| `scripts/run_full_validation_grouped.sh` | 63 | Same suite in 12 duration-bounded groups (`g1`…`g12`, each fits a 10-minute window; the §22 10-min soak gets its own slot) + `regression` + `render` subcommands — for sandboxes that kill long single invocations. |
| `scripts/validation_report.py` | 302 | The §40 report generator: maps `TestV{NN}_` → sections, extracts VALMETRIC performance lines, renders PASS/FAIL/DEGRADED/NOT TESTED with full failure detail, documented limitations, the measured performance record, and the production-defect log (suite-found + independent-audit defects). |
| `docs/README.md` | 50 | Documentation index: reading order, conventions, source-of-truth pointers. |
| `docs/DEPLOYMENT.md` | ~150 | Fresh-to-deploy runbook: prerequisites, required env keys, payments enablement, compose/bare-metal bring-up, smoke tests, rollback. |
| `docs/ARCHITECTURE.md` | 278 | The design document: topology, wire contracts (verified against the real NexAU + Bifrost repos), pipeline order, failure postures, scaling model. Carries a post-implementation note pointing at the audit (all verified divergences fixed). |
| `docs/PAYMENT-GATEWAY.md` | ~500 | Razorpay integration: §1b who-owns-what split, flows, §3.3b broker-vs-webhook delivery semantics, state machine, exactly-once protocol, concurrency matrix, env keys, security posture, live-verification record. |
| `docs/DESKTOP-CONNECTION.md` | ~290 | **The single connection document**: desktop ↔ cloud API ↔ Bifrost topology (the desktop never touches Bifrost; one base URL + one token pair), exact sign-in handshake sequence, wire contracts copied from the handlers, cloud-side env config, the desktop integration checklist and failure semantics. Every claim cites its source file; desktop-side facts are labelled as coming from the desktop spec, not this repo. |
| `docs/CIRCUIT-BREAKER.md` | 201 | Upstream circuit-breaker design: failure model (what counts and what never counts), state machine, integration points, metrics + readiness reporting, desktop contract, configuration rationale, test evidence, deliberate limitations. |
| `docs/OPERATIONS.md` | 60 | Living operator runbook: deployment checklist (secret generation + mandatory rotation, SMTP TLS, LB requirements), ops-runbook items (XID wraparound, backup drills, cert expiry, migration discipline), and the compact audit history — full reports preserved in git history. |
| `README.md` | 360 |  Quickstart, API surface, protocol, ops runbook, security checklist — handshake sequence in §"Web login → desktop handshake"; the dedicated end-to-end guide is `docs/DESKTOP-CONNECTION.md`. |
| `VALIDATION_REPORT.md` | ~380 | Generated: the current §1–§45 verdict (40 PASS / 5 DEGRADED / 0 FAIL, 0 data races, 219 tests) with all measured metrics and both defect logs. |
| `FILES.md` | this file | The complete per-file guide. |
| `Makefile` | 73 | build/test/race/vet/bench/fmt/lint/up/down/logs/clean/package + **validation** + **validation-report** + **loc**. |
| `compose.yaml` | 72 | Production-shaped stack: postgres, redis, bifrost, api (replicable). |
| `Dockerfile` | 39 | Multi-stage, non-root, healthcheck. |
| `.env.example` | ~200 | Every environment variable (~100 keys, 14 sections) documented with defaults and security notes. |
| `go.mod` / `go.sum` | 53 | Module + pinned dependencies (pgx, go-redis, gorilla, golang-jwt, miniredis, otel, prometheus). |

---

## How to run everything

```bash
make build          # compile server + loadtest
make test           # unit + e2e + validation (fast pass)
make race           # everything under the race detector
make validation     # ★ the full §1–§42 suite + VALIDATION_REPORT.md
make loc            # line-count inventory
make up             # docker compose stack (pg + redis + bifrost + api)
```

## The 8 production bugs this validation suite found and fixed

1. Idle watchdog couldn't unblock a stalled upstream read (terminated at MaxDuration instead of IdleTimeout) — `bifrost/stream.go`.
2. SSE write deadlines silently never applied behind middleware wrappers — `streaming/sse.go` + `Unwrap()`.
3. Concurrent WebSocket frame writes panicked the process (eviction vs write pump) — `streaming/websocket.go` write mutex.
4. Graceful shutdown dropped usage rows for WS-bound runs — `agent/manager.go` producer WaitGroup.
5. OpenAI-compat non-stream surface returned the internal run wrapper instead of the raw completion / proper HTTP error — `api/compat.go` + `agent/service.go`.
6. `stop` accepted non-string scalars — `agent/validation.go`.
7. `"content": null` on assistant tool-call messages rejected (breaks real OpenAI agent loops) — `agent/validation.go`.
8. PG connection-class errors mapped to 500 instead of 503 DEPENDENCY_UNAVAILABLE — `store/store.go`.

Each fix is regression-covered by the validation suite that caught it.
