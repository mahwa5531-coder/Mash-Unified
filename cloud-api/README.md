# MASh Cloud API

The thin cloud layer of **MASh** — a chat-style agentic desktop app. The
desktop owns the entire agent runtime (workspaces, files, transcripts,
sessions, tools, execution, retry policy); the cloud does exactly four
things:

1. **Identity** — Google OAuth only, via a web-to-desktop handshake
2. **Entitlements** — plans (Free/Pro), quotas, rate limits
3. **Billing** — prepaid credit top-ups (Razorpay)
4. **The LLM tunnel** — `POST /v1/chat/completions` → private [Bifrost](https://github.com/maximhq/bifrost) gateway (SSE, verbatim passthrough, metered)

Go monolith · PostgreSQL (Aiven) + Redis · one binary · stateless replicas.

## Quickstart

```bash
cp .env.example .env
# REQUIRED: NEXAU_AUTH_HS256_SECRET (openssl rand -hex 32)
# Production: NEXAU_AUTH_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URL + NEXAU_AUTH_WEB_SUCCESS_URL

docker compose up -d          # postgres + redis + bifrost + api
docker compose logs -f api
```

Smoke:

```bash
curl -s localhost:8080/health/ready | jq
```

## The LLM endpoint in one example

```bash
curl -N localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

```
data: {"id":"c1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"he"}}]}
data: {"id":"c1",...,"usage":{"prompt_tokens":10,...}}
data: [DONE]
```

OpenAI-compatible; models are `"provider/model"` (Bifrost routing). One
`llm_calls` row meters the call (tokens, cost, latency) — **message content is
never persisted anywhere in the cloud**.

## Desktop login (Google → device code → token pair)

```
desktop opens browser → GET /v1/auth/oauth/google → Google consent
→ callback 302 web-success?grant=… → POST /v1/auth/web/session
→ POST /v1/auth/desktop/code (mcode_, 60 s single-use)
→ browser hands the code to the desktop (deep link / loopback)
→ desktop POST /v1/auth/desktop/exchange → access + rotating refresh tokens
```

Refresh rotation has family-based reuse detection (reuse revokes the family).
Full contract: `docs/DESKTOP-CONNECTION.md` and `docs/api.md`.

## Repository layout

```
cmd/server/        wiring + graceful shutdown + housekeeping
internal/api/      HTTP surface (22 routes)
internal/auth/     Google OAuth, handshake, refresh rotation, middleware
internal/llm/      the proxy: validation → entitlement → quota → limits → Bifrost → SSE
internal/bifrost/  upstream client: retries, circuit breaker, stream reader
internal/ratelimit/  Redis Lua sliding windows + concurrency slots
internal/metering/   async llm_calls recorder (batch, exactly-once)
internal/payment/    Razorpay credit top-ups (orders, ledger, webhook)
internal/store/      pgx pool, embedded migrations, repos
```

Full map + invariants: `docs/ARCHITECTURE.md`. What was removed and why
(the 2026-10-05 simplification): `docs/CLEANUP-2026-10-05.md`.

## Development

```bash
make test      # unit + integration suites
make race      # + race detector
make vet       # static analysis
make lint      # fmt + vet + build
make up        # local stack
```

Tests need no infrastructure (miniredis + in-memory fakes + fake Bifrost);
the payments repo PG-integration suite opts in via `NEXAU_TEST_DATABASE_URL`.

## Documentation

| Doc | Contents |
|---|---|
| `docs/api.md` | HTTP reference — every route, every error code |
| `docs/ARCHITECTURE.md` | package map, the tunnel hot path, data model, invariants |
| `docs/DESKTOP-CONNECTION.md` | the desktop↔cloud contract end to end |
| `docs/PAYMENT-GATEWAY.md` | Razorpay integration, ledger, exactly-once credits |
| `docs/CIRCUIT-BREAKER.md` | Bifrost-path breaker design |
| `docs/DEPLOYMENT.md` | deployment + ops runbook |
| `docs/CLEANUP-2026-10-05.md` | the simplification audit trail |

## Security posture

- Provider keys live only in Bifrost; this API holds one Bifrost credential.
- Tokens never cross the browser — only single-use 60-second codes do.
- Identity is server-resolved per request; the anchor is Google's `sub`.
- The HS256 secret is deployment-only; compose fails fast without it.
- Google sign-in unconfigured ⇒ loud startup warning (nothing can log in).
