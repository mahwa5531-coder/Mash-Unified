# Operations Runbook

Living operator-facing checklist for deploying and running the NexaU Cloud
API. Everything here is actionable; the historical audit narratives that
produced these items live in git history (see "Audit history" below).

## Deployment checklist

1. **Secret**: generate and inject `NEXAU_AUTH_HS256_SECRET` (env or
   `NEXAU_AUTH_HS256_SECRET_FILE` secret-mount; `openssl rand -hex 32`).
   Compose refuses to start without it.
2. **Rotate the HS256 secret** on any deployment that ever ran the old
   committed default — schedule a maintenance window; all access tokens
   invalidate and clients re-authenticate.
3. Set `NEXAU_APP_BASE_URL` to the https website origin (loopback exempt in
   dev); verify the SMTP relay offers STARTTLS — the mailer refuses cleartext.
4. Optionally tune `NEXAU_AUTH_REFRESH_PER_IP`, `NEXAU_AUTH_OAUTH_PER_IP`,
   `NEXAU_AUTH_UNVERIFIED_RETENTION` (defaults: 60, 60, 72h).
5. Never set `NEXAU_MAIL_LOG_LINKS=true` outside a local dev machine.
6. Confirm the load balancer: read-timeout > 15m (long streams), WS
   upgrade-header passthrough, `X-Accel-Buffering: no` for SSE.

## Ops-runbook items (deployment layer, not code)

1. **Postgres XID wraparound** (Sentry, Mandrill class): monitor
   `datfrozenxid` age and autovacuum; alert long before 2^31.
2. **Backup + tested restores** (Keepthescore, Razorpay class): daily base
   backup + WAL archiving, and a scheduled restore drill — an untested
   backup is not a backup.
3. **Certificate/TLS expiry monitoring** (Mozilla add-ons, Azure Feb-29
   class): the API terminates TLS at the LB; expiry must page, not surprise.
4. **Schema migration discipline on live tables** (GoCardless, GitHub
   Nov-2021 class): migrations here are additive `CREATE TABLE/INDEX` with a
   cluster-wide advisory lock at boot; keep them additive, use `CONCURRENTLY`
   for indexes on hot tables, and never deploy type changes together with
   strict readers (CircleCI 2021 class).

## Where things live

| Concern | Document |
|---|---|
| Quickstart, API surface, protocol | `README.md` |
| Topology, wire contracts, failure postures | `docs/ARCHITECTURE.md` |
| Desktop integration contract | `docs/DESKTOP-CONNECTION.md` |
| Upstream circuit breaker (config + desktop error contract) | `docs/CIRCUIT-BREAKER.md` |
| Full test-suite evidence (§1–§45) | `VALIDATION_REPORT.md` |
| All environment knobs | `.env.example` |

## Audit history (full reports in git history)

| Date | Audit | Outcome |
|---|---|---|
| 2026-09-17 | Independent code audit (8 external defect claims) | 7 confirmed → all fixed with regression coverage |
| 2026-09-18 | Post-mortem-pattern audit (danluu catalog, ~180 incidents) | 2 serious defects fixed (poison-pill containment, Timeout×Recovery gap); 14 patterns verified addressed |
| 2026-09-18 | Upstream circuit breaker gap (awesome-scalability rubric) | Shipped: `internal/bifrost/breaker.go` + §44 E2E |
| 2026-09-19 | Security audit remediation | All 20 confirmed findings closed; §45 E2E; one mandatory operator action (secret rotation, above) |
| 2026-09-23 | Cleanup pass (staticcheck + deadcode + manual) | ID entropy-collapse bug fixed (duplicate ids after 436 same-ms generations pre-fix); un-wired `x-nexau-run-id` correlation header wired; 16 dead declarations, 50 MB of run artifacts and a duplicate `migrations/` tree removed; lint + deadcode now zero |

To read a full audit report: `git log --diff-filter=D --name-only -- docs/`
locates the deleted file, then `git show <rev>:nexau-api/docs/<file>.md`.
