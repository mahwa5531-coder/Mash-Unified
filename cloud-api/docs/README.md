# MASh Cloud API — Documentation

One page per concern. Read in this order for a new engineer; jump straight
to the section you need otherwise.

| Doc | What it covers | When you need it |
|---|---|---|
| [`../README.md`](../README.md) | Product overview, quick start, endpoint summary | First contact |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **Current as-built architecture**: topology, the LLM tunnel hot path, identity model, data model, invariants | Understanding the system as it is |
| [`api.md`](api.md) | **The HTTP contract**: every endpoint, `/v1/me` plan+quota shape, gate order, SSE semantics, billing/webhooks, rate limits | Client integration |
| [`TABLES.md`](TABLES.md) | **The data dictionary**: every table + where the 5h/weekly window budgets live (`plans.limits`) and where the token-normalization values live (`token_normalization`) — both hot-changeable via SQL | Schema questions, operator dials |
| [`CLEANUP-2026-10-05.md`](CLEANUP-2026-10-05.md) | **The simplification audit trail**: what was deleted (agent runtime, non-Google auth), what replaced it, the DB re-provisioning step | Why the codebase looks like this |
| [`DESKTOP-CONNECTION.md`](DESKTOP-CONNECTION.md) | Web-to-desktop handshake, OAuth flow, exchange codes, stream semantics | Desktop client integration |
| [`PAYMENT-GATEWAY.md`](PAYMENT-GATEWAY.md) | Razorpay integration: who owns what, flows, exactly-once crediting, env keys, security posture | Anything money-related |
| [`CIRCUIT-BREAKER.md`](CIRCUIT-BREAKER.md) | Upstream (Bifrost) failure isolation and recovery behavior | Debugging upstream outages |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Fresh-to-deploy runbook**: prerequisites, required env keys, compose/bare-metal bring-up, smoke tests, rollback | Standing the service up |
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook: metrics, alerts, common incidents, audit history | On-call |

## Source of truth for configuration

`.env.example` at the repo root documents **every** environment key with
defaults and security notes. The config loader validates all of them at boot
and fails fast with the complete list of problems — never one error at a
time.

## Conventions (short form)

- Go 1.25, stdlib `net/http` (no framework), pgx v5 for PostgreSQL,
  go-redis v9. No ORM.
- Layering: `cmd/server` → `internal/api` (thin handlers) →
  `internal/<domain>` services → `internal/store/repos` (SQL).
  Business logic never lives in handlers; SQL never leaves repos.
- Money is integer paise; floats never appear on money paths.
- Tests: unit files beside the code, integration suite in `tests/`
  (miniredis + in-memory fakes + fake Bifrost — no infra required). CI runs
  everything with `-race`.
