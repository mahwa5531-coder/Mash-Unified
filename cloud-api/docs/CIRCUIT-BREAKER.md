# Upstream Circuit Breaker — Bifrost Path

**Status:** implemented and verified · **Scope:** `internal/bifrost` · **Spec:** validation §44
**Added:** 2026-09-18 · **Motivation:** the last genuine gap from the
`awesome-scalability` Stability catalog audit (Task 22) — and the catalog's own
#1 pattern (Heroku, Shopify, Trivago, Zendek case studies): *stop hammering a
failing dependency; fail fast; recover automatically.*

---

## 1. What problem this solves

Before the breaker, a sustained Bifrost outage meant every LLM request burned
its full budget upstream: dial timeout (10 s) or HTTP 503, times the bounded
retry policy (2 retries with backoff), for **every** request, for the entire
outage. The API stayed alive (panic containment, watchdogs, bounded pools all
predate this), but it paid the maximum latency and socket cost per request
and amplified load against a struggling gateway — the classic retry-storm
anti-pattern the awesome-scalability catalog documents across Heroku, Shopify
and SoundCloud incidents.

With the breaker, after the trip threshold the request is rejected **before
any network work** with a stable error and a retry hint, and the platform
self-recovers through half-open probes. Non-LLM surfaces (auth, sessions,
replay, health) are completely unaffected — the breaker is scoped to the
upstream LLM call only.

## 2. Failure model — what counts as a "gateway fault"

The breaker protects against **gateway death/flapping**, not provider quality:

| Outcome | Recorded as | Rationale |
|---|---|---|
| Network error before response headers (dial fail, reset, timeout) | **failure** | gateway unreachable |
| HTTP 5xx status | **failure** | gateway sick |
| HTTP 408 | **failure** | gateway timed out the request |
| Mid-stream termination without `[DONE]` | **failure** | gateway dropped the connection |
| Mid-stream idle-watchdog abort (`MODEL_TIMEOUT` stream-idle) | **failure** | gateway stalled |
| Non-JSON SSE data line / oversized SSE line | **failure** | protocol-broken upstream |
| HTTP 2xx response headers received | **success** | gateway alive (2xx headers = liveness proof) |
| HTTP 4xx other than 408 (400/401/403/404/409/429) | **success** | gateway alive and answering |
| In-band `BifrostError` riding a 200 SSE stream | *ignored* | provider problem on a live gateway |
| Client cancellation / caller budget exhausted (`ctx` done) | *ignored* | not the gateway's fault |
| `GET /health` probe results | *ignored* | readiness is a separate concern |

Recording happens **per upstream attempt** (so our own bounded retries make
the breaker more sensitive, matching Envoy's per-attempt semantics) and at the
**exact classification sites** in `internal/bifrost/stream.go` — never by
string-matching error codes.

## 3. State machine

```
                trip (consecutive ≥ N                     probe success
                OR rate ≥ R over window)                 ┌────────────┐
   ┌─────────┐ ───────────────────────────► ┌─────────┐ │            ▼
   │ CLOSED  │                              │  OPEN   │ └──► HALF-OPEN ──┐
   └─────────┘ ◄─────────────────────────── └─────────┘        (≤ P probes) │
        ▲  ▲          cooldown elapsed                │ probe failure      │
        │  │          admits first probe              │ (re-open,          │
        │  │                                           │ cooldown grows)   │
        │  └──────────────────── probe success ────────┴───────────────────┘
        └──────────── in-flight results from before a trip are ignored ─────┘
```

* **CLOSED** — traffic flows. Two independent trip conditions:
  * *consecutive*: `≥ ConsecutiveFailures` hard failures back-to-back
    (default 10; a single success resets the streak);
  * *rate*: failure fraction over the last `WindowSize` outcomes (default 60)
    `≥ FailureRate` (default 0.60) once at least `MinSamples` (default 30)
    exist. Evaluated when failures arrive — a success never trips on the past.
    This mode catches a *flapping* gateway that interleaves 200-headers with
    mid-stream drops.
* **OPEN** — every `Completion`/`CompletionStream` call fast-fails with
  503 `UPSTREAM_CIRCUIT_OPEN` (`details.retryable=true`,
  `details.retry_after_ms`, `details.circuit="open"`), **zero** upstream
  traffic. Results of calls that were already in flight when the trip
  happened are ignored (they belong to the batch that caused it).
  Cooldown: `OpenBase` (default 30 s) doubling per repeated trip, capped at
  `OpenMax` (default 5 m). A successful recovery resets the backoff.
* **HALF-OPEN** — after the cooldown elapses (checked lazily on the next
  call), up to `HalfOpenProbes` (default 3) concurrent probes are admitted;
  everything else still fast-fails. First probe success closes the circuit
  and resets all counters; a probe failure re-opens with grown cooldown. If
  the probe window itself elapses without resolution (hung probes are bounded
  by the stream watchdogs and 15-minute duration cap), a fresh probe
  generation is admitted — recovery is guaranteed to make progress.

State is **per process (per replica)** — each replica trips and recovers
independently, the standard in-process-breaker deployment shape. One breaker
per `bifrost.Client`, and the client is a process-wide singleton, so it is
effectively per-upstream-host.

## 4. Where it hooks into the code

| Concern | Location |
|---|---|
| Gate (fast-fail before any work) | `internal/bifrost/client.go` — `gate()` at the top of `Completion` and `CompletionStream` |
| Per-attempt recording | the `withRetry` closures in `client.go` (post error / error status / 2xx headers) |
| Mid-stream fault recording | `internal/bifrost/stream.go` — `cbFail()` / `cbOnTimeout()` at the exact terminal-error classification sites |
| State + transitions + backoff + ring | `internal/bifrost/breaker.go` (mutex-guarded, injectable clock for tests) |
| Metrics | `internal/observability/metrics.go` (see §5) |
| Readiness reporting (informational) | `internal/api/health.go` — `bifrost_circuit` field; **never** gates readiness |
| Config | `internal/config/config.go` (`BifrostConfig.CB*`, env `NEXAU_BIFROST_CB_*`, all in `.env.example`) |
| Wiring | `cmd/server/main.go` maps config into `bifrost.TransportConfig.CircuitBreaker` |

`Health()` deliberately **bypasses** the breaker: a tripped breaker must not
darken the readiness probe, and a healthy `/health` must not close a tripped
breaker.

## 5. Observability

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `nexau_bifrost_breaker_state` | gauge | — | 0 closed, 1 half-open, 2 open |
| `nexau_bifrost_breaker_trips_total` | counter | `reason` = consecutive \| rate \| half_open_probe | every transition to OPEN |
| `nexau_bifrost_breaker_rejected_total` | counter | `state` | every fast-failed call |

Ops alerting suggestion: page on `trips_total` rate > 0 sustained 5 min, or on
`rejected_total` rate exceeding a fraction of run traffic. The state is also
human-visible on `GET /health/ready`:

```json
{ "status": "ok", "dependencies": [...], "bifrost_circuit": "open", "time": "..." }
```

## 6. Client-visible contract (desktop team)

| Surface | Behavior while OPEN |
|---|---|
| OpenAI-compat `POST /v1/agent/chat/completions` | HTTP 503, body `error.code=UPSTREAM_CIRCUIT_OPEN`, `error.details.retry_after_ms` |
| Auth, `/health/*`, payments | **unaffected** |

`retry_after_ms` is the remaining cooldown at rejection time — a safe
backoff hint. The circuit self-heals; the desktop only needs polite backoff,
no user-facing error flow beyond the normal retry.

## 7. Configuration

| Env | Default | Notes |
|---|---|---|
| `NEXAU_BIFROST_CB_ENABLED` | `true` | master switch (zero-value config = disabled for tests) |
| `NEXAU_BIFROST_CB_CONSECUTIVE` | `10` | consecutive trip threshold |
| `NEXAU_BIFROST_CB_WINDOW` | `60` | rate window (outcomes) |
| `NEXAU_BIFROST_CB_MIN_SAMPLES` | `30` | rate trip minimum samples |
| `NEXAU_BIFROST_CB_FAILURE_RATE` | `0.60` | rate trip fraction |
| `NEXAU_BIFROST_CB_OPEN_BASE` | `30s` | first cooldown |
| `NEXAU_BIFROST_CB_OPEN_MAX` | `5m` | cooldown cap (exponential growth) |
| `NEXAU_BIFROST_CB_HALFOPEN_PROBES` | `3` | concurrent recovery probes |

Defaults reasoning: with 2 pre-first-byte retries, 10 consecutive *attempts*
≈ 3–4 fully failing requests from one replica — quick enough to protect the
gateway, tolerant enough not to trip on one bad pod behind the VIP. The 60%
rate over 60 outcomes catches flapping within roughly a minute of traffic.
Tighten (`CB_CONSECUTIVE=5`) for aggressive protection; loosen for brownouts
with high variance.

## 8. Test evidence

**Unit + client integration** (`internal/bifrost/breaker_test.go`, 22 tests,
all under `-race`): disabled-never-opens; consecutive trip; success-resets
streak; rate trip (incl. min-samples boundary, and the rule that only
failings evaluate the rate); open fast-fail with cooldown hint; half-open
admission after cooldown; probe concurrency limit; probe-success close +
backoff reset; probe-failure re-open with doubled cooldown; backoff
saturation at `OpenMax`; late in-flight results ignored; zero-value defaults;
16×500 concurrent hammer; client fast-fail with **zero HTTP hits** and full
error-shape assertions; 4xx/429 never trips; 408 counts; mid-stream drop
counts (threshold 1) and fast-fails; cancellation neutrality (10 aborted
calls never trip); in-band provider errors never trip; `Health()` bypass;
message-hygiene (no internal leakage).

**E2E validation §44** (`validation/circuit_breaker_test.go`, full stack,
`-race`): 503-storm → trip → instant `UPSTREAM_CIRCUIT_OPEN` with zero
upstream hits (mock hit-counter verified) → sessions/liveness/readiness still
200 during the outage → cooldown elapses → probe run completes → circuit
closed → subsequent runs healthy; circuit state on `/health/ready` across the
full lifecycle; WS `run.create` as the closing probe; OpenAI-compat surface
guarded with the same semantics.

**Harness note:** `defaultOpts()` pins the breaker to *enabled-but-inert*
(thresholds far above fault-injection volumes) so sections §1–§43 keep their
documented outcomes; §44 builds stacks with production-shaped tight
thresholds. The full §1–§44 suite re-ran green under `-race` after the
integration.

## 9. Known limitations (deliberate)

* Per-replica state — no cross-replica coordination. During a trip, other
  replicas keep probing independently. This is standard (Envoy, Hystrix) and
  desirable: one replica's bad connection pool doesn't trip everyone.
* No per-provider or per-model scoping — Bifrost is one logical upstream;
  provider-level failover is Bifrost's own job (its `fallbacks` field).
* The `429`-as-success choice means the breaker does not protect against
  being throttled — that is the rate limiter's and Bifrost's concern, and
  Retry-After pacing already exists in the retry policy.
* In-flight calls that started before a trip are allowed to complete; the
  bound is the existing retry/timeouts (≤ ~30–35 s worst case), not the
  breaker.
