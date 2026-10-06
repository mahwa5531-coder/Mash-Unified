# MASh Cloud API — Architecture Inventory & Evaluation

**Date:** 2026-10-04  
**Scope:** Complete inspection of `cloud-api/` prior to simplification and target architecture alignment.  
**Objective:** Reach the smallest clean production architecture that correctly supports MASh as a modular monolith.

---

## 1. Executive Summary

MASh is a desktop-first agentic application for auditors. 
- **Desktop owns:** local workspace, local files, local agent loops, local tools, conversation transcript (SQLite), and task state.
- **Cloud API owns:** user identity (Google OAuth), session/device management, subscription/plan state, entitlements, quota/usage accounting, prepaid billing (Razorpay), secure LLM access (private Bifrost proxy), request correlation, and rate limiting.
- **Zero cloud conversation persistence:** Prompts, messages, tool results, and document contents must never be persisted in PostgreSQL or logged.

---

## 2. Component Inventory

| Component | Purpose | Used By | Dependencies | DB Tables | Endpoints | External Services | Required? | Over-engineered? | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|
| **`internal/auth`** | Google OAuth OIDC verification, JWT/claims, rotating refresh tokens with family reuse detection, desktop exchange codes | API layer, middleware | PG (`users`, `refresh_tokens`, `devices`), Redis | `users`, `devices`, `refresh_tokens` | `/v1/auth/oauth/google`, `/callback`, `/lookup`, `/web/session`, `/desktop/code`, `/desktop/exchange`, `/refresh`, `/logout` | Google OIDC JWKS | **YES** | Low | **SIMPLIFY & ALIGN** (Add `/v1/auth/google/*`, `/logout-all`, `/session` aliases) |
| **`internal/agent`** | LLM proxy pipeline, request validation, concurrency slots, implicit session resolution, raw SSE streaming | API layer (`compat.go`) | `bifrost.Client`, `ratelimit.Limiter`, `metering.Recorder`, `store/repos` | `agent_sessions`, `agent_runs`, `usage_records` | `/v1/agent/chat/completions` | Bifrost | **YES** | Medium (legacy implicit session logic) | **SIMPLIFY & EXTEND** (Support `POST /v1/responses`, model alias mapping e.g. `mash-agent`) |
| **`internal/bifrost`** | Private Bifrost gateway HTTP client, circuit breaker, raw SSE chunk forwarding, token normalization | `internal/agent` | stdlib `http.Client`, OTel, metrics | None | None | Bifrost Gateway | **YES** | Low | **KEEP** |
| **`internal/payment`** | Prepaid credit top-ups via Razorpay, HMAC verification, webhook deduplication, ledger accounting | API layer (`payments.go`) | `payment/razorpay`, `store/repos` | `payment_orders`, `payment_webhook_events`, `credit_ledger`, `credit_balances` | `/v1/payments/*` | Razorpay | **YES** | Low | **SIMPLIFY & ALIGN** (Mount `/v1/billing/*` and `/v1/webhooks/razorpay` routes) |
| **`internal/ratelimit`** | Redis sliding-window RPM rate limiting & concurrency slot management | API layer, `internal/agent` | Redis (Lua script) | None | None | Redis | **YES** | Low | **KEEP** |
| **`internal/idempotency`** | Idempotency-Key deduplication for mutating requests | `internal/agent`, payments | Redis (`SET NX PX`), PG unique indexes | `agent_runs`, `payment_orders` | None | Redis, PG | **YES** | Low | **KEEP** |
| **`internal/metering`** | Authoritative asynchronous batch token usage recorder | `internal/agent` | PG (`usage_records`) | `usage_records` | None | PostgreSQL | **YES** | Low | **KEEP** |
| **`internal/middleware`** | Panic containment, request ID, tracing, body limit, in-flight limit, CORS | HTTP server | OTel, `reqctx` | None | All | None | **YES** | Low | **KEEP** |
| **`internal/observability`** | Structured logging with automatic redaction of credentials and content, Prometheus metrics, OTel | All packages | `slog`, Prometheus, OTel | None | `/metrics` | OTLP | **YES** | Low | **KEEP** |
| **`internal/store/repos`** | Pure SQL data access layer via `pgx` | Services | PostgreSQL | All | None | PostgreSQL | **YES** | Low | **SIMPLIFY** (Clean up unused `auth_recovery_tokens` references) |
| **`internal/config`** | Environment parsing and startup validation | `main.go`, all services | `os.Getenv` | None | None | None | **YES** | Medium (contains dead WS/Mail fields) | **SIMPLIFY** (Remove dead WS/Mail configuration) |

---

## 3. Database Table Inventory & Pruning Decisions

1. `tenants` — **KEEP**: Customer account / organization boundary for tenant-level isolation.
2. `users` — **KEEP**: Customer identity; links to Google OIDC `external_subject` (`sub`).
3. `tenant_members` — **KEEP**: Multi-tenant authorization link between `users` and `tenants`.
4. `plans` — **KEEP**: Plan definitions and rate/concurrency/token limits.
5. `subscriptions` — **KEEP**: Subscription status (`trialing`, `active`, `past_due`, `canceled`).
6. `entitlements` — **KEEP**: Granular feature flags and model access rules.
7. `devices` — **KEEP**: Client installation device registry for desktop logins.
8. `refresh_tokens` — **KEEP**: Secure opaque token hashes, family tracking, and reuse detection.
9. `agent_sessions` — **KEEP (Metadata only)**: Links client session ID to tenant context.
10. `agent_runs` — **KEEP (Metadata only)**: Turn-level execution record without conversation contents.
11. `usage_records` — **KEEP (Metadata only)**: Authoritative token counts, latency, and costs (satisfies `llm_calls` requirements).
12. `usage_daily_tenant` — **KEEP**: Materialized view for fast tenant-level usage rollups.
13. `v_stuck_runs` — **KEEP**: View for operational crash recovery of in-flight runs.
14. `auth_recovery_tokens` — **DROP / DEPRECATE**: Relic from legacy password reset and email verification. Dropped from active usage.
15. `payment_orders` — **KEEP**: Razorpay order tracking with idempotency.
16. `payment_webhook_events` — **KEEP**: Webhook idempotency and replay deduplication.
17. `credit_ledger` — **KEEP**: Append-only immutable balance ledger.
18. `credit_balances` — **KEEP**: O(1) balance cache synchronized via transaction with ledger.

---

## 4. API Endpoints Alignment Plan

We will wire the target clean API structure while retaining backward-compatible routes for the desktop client connector:

### Authentication
- `POST /v1/auth/google/start` & `GET /v1/auth/oauth/google`: Begin Google OAuth flow.
- `GET /v1/auth/oauth/google/callback`: Handle Google OAuth callback & issue web grant.
- `POST /v1/auth/web/session`: Exchange web grant for short-lived session token.
- `POST /v1/auth/desktop/code`: Request short-lived single-use desktop exchange code.
- `POST /v1/auth/google/exchange` & `POST /v1/auth/desktop/exchange`: Atomic single-winner desktop exchange.
- `POST /v1/auth/refresh`: Rotate refresh token & issue new access token.
- `POST /v1/auth/logout`: Revoke active refresh token family.
- `POST /v1/auth/logout-all`: Revoke all devices & refresh tokens for the authenticated user.
- `GET  /v1/auth/session`: Inspect authenticated user/device session state.

### Account & Configuration
- `GET /v1/me`: Server-authoritative user, tenant, membership, and limit context.
- `GET /v1/me/plan`: Detailed plan code, subscription status, limits, and quotas.
- `GET /v1/me/usage`: Usage summary and quota consumption.
- `GET /v1/client/config` & `GET /v1/config`: Client configuration, timeouts, limits, and server time.

### Models & Inference
- `GET /v1/models`: List available model aliases (`mash-agent`) and capabilities.
- `POST /v1/responses`: Canonical MASh inference endpoint (supports streaming SSE, model alias resolution, quota and concurrency enforcement, metadata-only settlement).
- `POST /v1/agent/chat/completions`: Preserved for direct OpenAI-SDK and existing connector compatibility.
- `POST /v1/agent/chat/completions/cancel`: In-flight stream cancellation.

### Billing & Payments
- `GET  /v1/billing/plans` & `GET /v1/payments/catalog`: Available prepaid credit packs and plan tiers.
- `POST /v1/billing/checkout` & `POST /v1/payments/checkout`: Initiate Razorpay checkout order.
- `POST /v1/payments/confirm`: Confirm checkout payment on client completion.
- `GET  /v1/billing/subscription`: Current tenant subscription state and billing period.
- `POST /v1/billing/subscription/cancel`: Cancel renewal at period end.
- `GET  /v1/billing/payments` & `GET /v1/payments/history`: Order and payment history.
- `GET  /v1/payments/balance`: Current credit balance.
- `POST /v1/webhooks/razorpay` & `POST /v1/payments/webhook`: Webhook handler with signature verification.

### Health
- `GET /health/live`: Unauthenticated liveness probe.
- `GET /health/ready`: Dependency readiness probe (PostgreSQL, Redis, Bifrost circuit state).
- `GET /metrics`: Prometheus telemetry metrics.
