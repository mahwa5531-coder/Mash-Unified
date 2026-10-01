# NexaU Cloud API — Documentation

One page per concern. Read in this order for a new engineer; jump straight
to the section you need otherwise.

| Doc | What it covers | When you need it |
|---|---|---|
| [`../README.md`](../README.md) | Product overview, quick start, API surface summary | First contact |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | **Fresh-to-deploy runbook**: prerequisites, required env keys, compose/bare-metal bring-up, smoke tests, rollback | Standing the service up |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System structure: packages, data flow, streaming (SSE/WS), replay/resume, tenancy model | Understanding how it all fits |
| [`PAYMENT-GATEWAY.md`](PAYMENT-GATEWAY.md) | Razorpay integration: who owns what, flows, exactly-once crediting, env keys, security posture | Anything money-related |
| [`DESKTOP-CONNECTION.md`](DESKTOP-CONNECTION.md) | Web-to-desktop handshake, OAuth flow, exchange codes | Desktop client integration |
| [`CIRCUIT-BREAKER.md`](CIRCUIT-BREAKER.md) | Upstream (Bifrost) failure isolation and recovery behavior | Debugging upstream outages |
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook: metrics, alerts, common incidents, audit history | On-call |

## Source of truth for configuration

`.env.example` at the repo root documents **every** environment key
(~100 keys, 14 sections) with defaults and security notes. The config loader
validates all of them at boot and fails fast with the complete list of
problems — never one error at a time.

## Validation evidence

`VALIDATION_REPORT.md` (repo root) holds the current full-suite results
(46 validation files, 219 tests, race-detector clean). Regenerate with
`scripts/run_validation.sh`.

## Conventions (short form)

- Go 1.25, stdlib `net/http` (no framework), pgx v5 for PostgreSQL,
  go-redis v9. No ORM.
- Layering: `cmd/server` → `internal/api` (thin handlers) →
  `internal/<domain>` services → `internal/store/repos` (SQL).
  Business logic never lives in handlers; SQL never leaves repos.
- Every mutation surface is idempotent (`Idempotency-Key` honored).
- Money is integer paise; floats never appear on money paths.
- Tests: unit + scenario files beside the code, HTTP e2e in `tests/`,
  fault-injection matrix in `validation/`. CI runs everything with `-race`.
