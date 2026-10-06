# Deployment Runbook — NexaU Cloud API

Everything needed to go from a clean checkout to a running, verified
deployment. Three infrastructure dependencies (PostgreSQL, Redis, Bifrost),
one binary, migrations run automatically at boot.

## 1. Prerequisites

| Component | Version | Notes |
|---|---|---|
| PostgreSQL | 15+ | schema + credit ledger; `pgx` pure-Go driver, no extensions |
| Redis | 6+ | rate limiting, idempotency, streaming fan-out, replay |
| Bifrost | any | the LLM gateway this API fronts; needs an API key |
| Go | 1.25+ | only for bare-metal builds (Docker path needs nothing) |

## 2. Environment — what you MUST add

Copy `.env.example` → `.env` and fill these in; everything else has sane
defaults (all ~100 keys are documented inline in `.env.example`):

### Required (service will not boot without them)

```bash
NEXAU_DATABASE_URL=postgres://nexau:PASSWORD@postgres:5432/nexau?sslmode=require
NEXAU_REDIS_URL=redis://redis:6379/0
NEXAU_BIFROST_URL=http://bifrost:8081
NEXAU_BIFROST_API_KEY=<key from your Bifrost deployment>

# local auth mode (this API mints its own JWTs):
NEXAU_AUTH_HS256_SECRET=$(openssl rand -hex 32)   # >= 32 bytes, secret-file variant available

# public origin used for web application:
NEXAU_APP_BASE_URL=https://app.your-domain.example
```

Docker/k8s secret mounts: every `*_SECRET`/`*_API_KEY` has a `*_FILE`
variant (e.g. `NEXAU_AUTH_HS256_SECRET_FILE=/run/secrets/hs256_secret`)
that takes precedence.

### Payments (optional — off by default)

`NEXAU_PAYMENT_PROVIDER=disabled` is the default: payment routes answer
`503 PAYMENTS_DISABLED` and nothing else happens. To enable:

```bash
# Dev / staging with zero keys — full flow, orders self-capture:
NEXAU_PAYMENT_PROVIDER=mock

# Production / real money (all three REQUIRED, boot fails fast otherwise):
NEXAU_PAYMENT_PROVIDER=razorpay
NEXAU_RAZORPAY_KEY_ID=rzp_live_XXXXXXXXXXXX        # Dashboard → API Keys
NEXAU_RAZORPAY_KEY_SECRET=<paired secret>
NEXAU_RAZORPAY_WEBHOOK_SECRET=<webhook secret>     # Dashboard → Webhooks — NOT the key secret
```

Then register the webhook in the Razorpay Dashboard:
`https://<your-public-base>/v1/payments/webhook`, events
`payment.captured`, `payment.failed`, `order.paid`.
Full details: [`PAYMENT-GATEWAY.md`](PAYMENT-GATEWAY.md) §1b (who owns
what), §11 (every payment key).

### Commonly tuned (all optional)

| Key | Default | What it does |
|---|---|---|
| `NEXAU_HTTP_ADDR` | `:8080` | listen address |
| `NEXAU_ALLOWED_ORIGINS` | — | CORS allow-list (browsers need it; native desktop doesn't) |
| `NEXAU_AUTH_MODE` | `local` | `local` (this API mints JWTs) or `jwks` (external IdP) |
| `NEXAU_RATE_REQ_PER_MIN_USER/TENANT` | see `.env.example` | rate-limit budgets |

## 3. Bring-up

### Docker Compose (recommended)

```bash
cp .env.example .env      # fill §2 values
docker compose up -d --build
docker compose logs -f api # migrations run automatically at boot
```

Brings up: `postgres`, `redis`, `bifrost`, `api` (all on one network;
the API waits for both datastores to answer health checks).

### Bare metal

```bash
make build              # → bin/nexau-api (or: go build -o bin/nexau-api ./cmd/server)
set -a; . ./.env; set +a
./bin/nexau-api         # migrations embedded; runs against $NEXAU_DATABASE_URL
```

## 4. Verify the deployment (smoke tests)

```bash
# liveness (no auth required)
curl -fsS localhost:8080/health

# authed call through the full stack (api → bifrost)
curl -fsS localhost:8080/v1/agent/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}' | head -c 400

# payments (when enabled): catalog + a mock checkout
curl -fsS localhost:8080/v1/payments/catalog -H "Authorization: Bearer $TOKEN"
```

In `mock` provider mode, a checkout self-captures after
`NEXAU_PAYMENT_MOCK_AUTOCAPTURE` (default 3s) and the order status flips to
`paid` — watch it with `GET /v1/payments/orders/{id}`.

With Razorpay **Test** keys the same flow runs against Razorpay's test
environment using their test cards (`4111 1111 1111 1111`, any future
expiry) — no real money ever moves. See `PAYMENT-GATEWAY.md` §11.

## 5. Operations quick reference

- **Metrics**: `/metrics` (Prometheus format, default on).
  Payment counters: `nexau_payment_orders_total`,
  `nexau_payment_credits_applied_total`, `nexau_payment_webhooks_total`.
- **Migrations**: embedded, forward-only, run at boot inside one
  transaction per file. New deployment = empty DB = everything applied.
- **Rollback**: deployments are stateless — roll back the binary/image and
  restart; migrations are additive and old binaries tolerate newer schemas
  within one version. Never roll back the database.
- **Scaling**: the API is horizontally scalable (all coordination state
  lives in PG/Redis — no in-process session, lock or leader state, payments
  included: exactly-once is enforced at the row level, not the process
  level).
- **On-call**: [`OPERATIONS.md`](OPERATIONS.md).

## 6. Test stages in CI (what "green" means)

| Stage | Command | Covers |
|---|---|---|
| Unit + scenario | `go test ./internal/... -race` | every package, including the payment race storms |
| HTTP e2e | `go test ./tests/... -race` | full request lifecycle over real HTTP |
| PG integration | `NEXAU_TEST_DATABASE_URL=… go test ./internal/store/repos/...` | real-SQL truth (uniqueness, row locks, exactly-once) |
