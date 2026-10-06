# NexaU Cloud API — Architecture Report

**Status:** Pre-coding analysis deliverable (mandatory per spec §3)
**Date:** 2026-09-10
**Sources of truth:** `nex-agi/NexAU` (public repo, `main`), `maximhq/bifrost` (public repo OpenAPI spec, `main`), NexaU Cloud API specification v1.

> **Post-implementation note (2026-09-17):** this document records the design
> contract as written before implementation. An independent source audit with
> runnable proofs (`docs/CODE-AUDIT-2026-09-17.md`) confirmed 7 of 8
> externally-reported defects and refuted 1 (the WS quota-leak claim). All 7
> were fixed the same day with regression coverage: the thinking
> `START → CONTENT… → END` lifecycle of §1.13 now closes at the
> reasoning→answer transition, the "gap-free" sequence delivery of §4.3 is
> protected by loud drop accounting plus a `RESYNC_REQUIRED` hint on the WS
> path, concurrency-slot reconciliation is wired into the housekeeping
> sweeper, the idempotency InFlight path verifies PostgreSQL, the
> sliding-window Retry-After returns the window remainder, `ids.Validate`
> accepts mixed case (multi-turn tool calling), and the OpenAI-compat
> streaming surface reports upstream failures as real HTTP errors / in-band
> error events. Consult the audit document for exact locations and proofs.

---

## 1. NexAU Runtime Map

Verified by reading the actual repository — not assumptions.

```
NexAU Desktop (LOCAL)
  Agent                       nexau/archs/main_sub/agent.py
    → run(): starts agent loop, emits events via middlewares
  Executor                    nexau/archs/main_sub/execution/executor.py
    → iteration loop: LLM call → parse → tool calls → execute → repeat
  ToolExecutor                nexau/archs/main_sub/execution/tool_executor.py
    → executes tools LOCALLY (files, DuckDB, Python, Excel/PDF, OCR)
  LLMCaller                   nexau/archs/main_sub/execution/llm_caller.py
    → builds OpenAI-style params from LLMConfig + UMP messages
    → OpenAIChatStreamAggregator converts chunks → unified events
  LLM aggregators             nexau/archs/llm/llm_aggregators/{openai_chat_completion,
                               anthropic, gemini_rest, openai_responses}/
    → provider chunks → AG-UI events (Start→Content→End lifecycles)
  Middleware                  execution/middleware/ (agent_events, compaction,
                               failover, sensitive-word, ...)
  Transports                  nexau/archs/transports/{http(SSE+WS), stdio, grpc}
    → SSETransportServer (FastAPI), StopRequest → interrupt registry
  Local UI/event consumer     AG-UI event stream rendered by desktop UI
```

### Key verified facts

1. **Run start:** `Agent.run()` → Executor loop; each iteration = one LLM call + optional local tool execution.
2. **Iteration representation:** `ModelResponse` (content / reasoning / tool_calls / usage / stop_reason) + emitted event stream.
3. **LLM request construction:** `LLMConfig.to_openai_params()` — `model`, `messages`, `tools`, `tool_choice`, `max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`, `stream` (+ extra params). UMP `Message{role, blocks[]}` is serialized via `serialize_ump_to_openai_chat_payload()`.
4. **Fields sent to LLM:** canonical **OpenAI Chat Completions** request shape (roles: system/user/assistant/tool; content string or blocks; `tool_calls`; `tool_call_id`).
5. **Tool calls represented as:** OpenAI-style `tool_calls[{id, type:"function", function{name, arguments}}]`, streamed as index/id/name/arguments fragments.
6. **Tool results inserted:** as `role:"tool"` messages with `tool_call_id` + content (executed locally by ToolExecutor, fed back into the next LLM request).
7. **Streaming representation:** AG-UI events (below).
8. **Provider chunks → unified events:** per-provider aggregators; OpenAI aggregator handles `content`, `reasoning_content`/`reasoning`/`reasoning_details` (OpenRouter/DeepSeek extensions), tool-call fragments, usage in final chunk; **non-first choices are dropped** (`_noop_event_handler`).
9. **Cancellation:** transport-level `/stop` endpoint → running-agent registry keyed `(user_id, session_id, agent_id)` → agent interrupt; WS transport mirrors this.
10. **Timeouts/retries:** `LLMConfig.stream_idle_timeout_ms` (default **300 000 ms**), `connect_timeout_ms` (default **15 000 ms**), `max_retries=3`; `llm_failover` middleware.
11. **Existing IDs:** `run_id`, `root_run_id`, `agent_id`, `session_id`, `message_id`, `thinking_message_id` (+ `parent_message_id`), `tool_call_id`, W3C `trace_id` on RunStartedEvent.
12. **Authoritative local state:** session/agent models via ORM engine (SQLite/SQL) on the desktop; AgentRunActionModel history (APPEND/UNDO/REPLACE).
13. **Event structures the cloud must preserve:** the **AG-UI vocabulary** — `RUN_STARTED`, `TEXT_MESSAGE_START/CONTENT/END`, `THINKING_TEXT_MESSAGE_START/CONTENT/END`, `TOOL_CALL_START/ARGS/END`, `TOOL_CALL_RESULT`, `IMAGE_MESSAGE_START/CONTENT/END`, `USAGE_UPDATE` (canonical `TokenUsage`), `MODEL_CALL_FINISHED`, `RUN_FINISHED`, `RUN_ERROR`, `USER_MESSAGE`, `RETRY`, `TRANSPORT_ERROR`. Lifecycle pattern: START → CONTENT… → END per logical unit.

### Canonical TokenUsage (nexau/core/usage.py)

```
input_tokens            non-cached input
cache_read_tokens       cached input (hit)
cache_creation_tokens   cache write
completion_tokens       provider output count (OpenAI includes reasoning)
reasoning_tokens        reasoning output (extracted)
total_tokens            provider total semantics
```

**Cloud API does not duplicate** any of: agent loop, executor, tool execution, skills, filesystem, DuckDB/Python, compaction, sensitive-word middleware.

---

## 2. Bifrost Map

Verified from `docs/openapi/*` of `maximhq/bifrost` (the deployed gateway contract).

```
NexaU Cloud API
  → POST {BIFROST_URL}/v1/chat/completions        (OpenAI-compatible route)
     Authorization: Bearer {BIFROST_API_KEY}       (cloud-side only)
     x-request-id / traceparent propagated
     body: ChatCompletionRequest
       model: "provider/model"  (e.g. "anthropic/claude-sonnet-4-5")
       messages, tools, tool_choice, stream, stream_options{include_usage},
       temperature, top_p, max_completion_tokens, stop, seed, frequency_penalty,
       presence_penalty, logit_bias, logprobs, top_logprobs, parallel_tool_calls,
       reasoning{effort,max_tokens}, response_format, fallbacks[], metadata
  → response (non-stream): ChatCompletionResponse
       { id, created, model, object, choices[{index, finish_reason,
         message{role, content, reasoning, tool_calls[]}}], usage, extra_fields }
  → response (stream): SSE "data: {chunk}\n\n" … "data: [DONE]"
       chunk.choices[0].delta{role, content, reasoning, reasoning_details[],
                              refusal, tool_calls[{index,id,type,function{name,arguments}}]}
       Bifrost standardization: finish_reason + usage ONLY in the LAST chunk
       extra_fields: { provider, model_requested, model_deployment, latency_ms,
                       chunk_index }
  → usage: BifrostLLMUsage { prompt_tokens (+ prompt_tokens_details:
       cached_read_tokens, cached_write_tokens), completion_tokens (+
       completion_tokens_details: reasoning_tokens, …), total_tokens, cost{} }
  → errors: BifrostError { event_id, type, is_bifrost_error, status_code,
       error{ type, code, message, param, event_id },
       extra_fields{ provider, model_requested } }  — also on mid-stream 200s
       via error events
  → cancellation: server honors HTTP request context cancellation (connection
       close aborts upstream provider request where the provider supports it)
  → timeouts: per-provider config, default 30s request; streams follow it
  → health: GET /health (unauthenticated, 200/503)
  → routing: "provider/model" selects provider + model; fallbacks[] for failover
  → pooling: connection reuse is client-side responsibility (our shared
       http.Transport with per-host idle pool, HTTP/2 enabled)
```

**Bifrost credentials never leave the cloud.** Bifrost's internal database is never accessed — only its HTTP API. NexaU and Bifrost logical databases are fully separate (separate credentials, separate schemas).

---

## 3. Cloud Boundary (exact)

```
DESKTOP (authoritative)              CLOUD (authoritative)
────────────────────────────         ────────────────────────────
agent loop / executor                identity (Google OAuth: users, tenants, memberships)
tool execution (local files…)        authorization (roles, subscription, entitlements, balance)
skills                               rate limits, concurrency slots, idempotency
local session/agent state (SQLite)   OpenAI-compatible chat completions proxy
audit workspace                      authoritative usage/billing records
NexAU access + refresh credential    Bifrost credential custody
                                     streaming relay (raw SSE) + cancellation relay
```

Crossing the boundary: **HTTPS only**, with `Authorization: Bearer <NEXAU_ACCESS_TOKEN>`.
Never crossing to the desktop: provider keys, Bifrost keys, internal DB details, stack traces.

## 4. Integration Contract

### 4.1 Primary LLM surface (desktop → cloud)

`POST /v1/agent/chat/completions` — OpenAI-compatible pass-through and completions gateway.

Body is the canonical OpenAI Chat Completions request shape the desktop produces:

```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",
  "messages": [ {"role":"user","content":"…"} ],
  "tools": [ … ], "tool_choice": "auto",
  "temperature": 0.7, "max_tokens": 4096, "stream": true
}
```

- `stream:false` → JSON `ChatCompletionResponse` from Bifrost.
- `stream:true` → raw SSE stream (`data: {...}\n\n` ... `data: [DONE]\n\n`).
- Rate limiting, subscription/credit checks, idempotency, and concurrency limits are enforced server-side.
- Desktop disconnect / client cancel aborts upstream Bifrost inference via context cancellation.

*Note on pruned routes*: Server-side agent session management (`/sessions`, `/sessions/{id}/runs`, `/runs/{id}`, and WebSocket `/stream`) has been pruned. NexAU Desktop manages its own local SQLite sessions, tool executions, and state history, communicating with Cloud API solely for authentication and raw LLM inference.

### 4.2 Usage accounting contract

Authoritative usage = Bifrost `BifrostLLMUsage` (last chunk / final body) →
normalized to NexAU `TokenUsage` + Bifrost cost fields → async batch insert into
`usage_records` with `UNIQUE(run_id, call_seq)` → exactly-once even under retries.
Client-supplied token counts are never billed.

## 5. Reused vs newly built

| Concern | Reused (unchanged) | New (cloud-only) |
|---|---|---|
| Agent loop / tools / skills | NexAU desktop (all) | — |
| Message request shape | OpenAI Chat Completions (both sides) | envelope + run metadata |
| LLM transport to Bifrost | — | shared-client relay + normalization |
| Auth tokens | — | JWT (JWKS or HS256) + rotating refresh tokens |
| Usage shape | NexAU `TokenUsage` | persistence, attribution, billing fields |

## 6. Failure & retry policy (decided)

- **Safe to retry:** failures occurring **before any stream byte is forwarded**
  (connect error, 502/503/504, 429 with Retry-After) — max 2 retries, backoff+jitter.
- **Unsafe to retry (never retried):** any failure after first forwarded byte;
  mid-stream disconnects (surfaced as error event + partial-run status);
  4xx validation/auth/entitlement errors.
- **Idempotency:** `Idempotency-Key` (header or body) dedupes logical run creation
  via Redis `SET NX PX`; duplicates of completed runs return the original outcome.
- **Rate limiting:** fail-open (configurable) with critical alarm; **authz: fail-closed.**

## 7. Scale & correctness model

- N identical instances behind LB; correctness from PostgreSQL (source of truth) +
  Redis (distributed limits, idempotency) — no process-local correctness state.
- Per-stream: one goroutine with hard lifecycle (stream idle timeout and max duration watchdog).
- Bounded everywhere: pools, queues, body size, in-flight requests (semaphore), goroutines tracked and joined at shutdown.

## 8. Web login & desktop handshake (Google OAuth)

The cloud API is the OAuth **client** (server-side confidential application,
RFC 6749 §4.1). The web login page is a separate frontend; the desktop never
participates in the browser flow.

**Flow** (`internal/auth/oauth.go`, `internal/auth/desktop_code.go`,
`internal/api/oauth.go`):

1. `GET /v1/auth/oauth/google` — mints single-use state (Redis, 10-min TTL)
   bound to a same-site tx cookie; 302 to Google (openid email profile).
2. `GET /v1/auth/oauth/google/callback` — validates state+tx, exchanges the
   code (client credentials over TLS), verifies the RS256 ID token against
   Google's JWKS (iss/aud/exp), then resolves the identity:
   subject→login · email→link · neither→atomic provision
   (user+tenant+membership+trial, one tx; races arbitrated by unique indexes
   with a bounded retry). Redirects the browser to the web success page with
   a single-use `wgrant_` grant (5 min).
3. `POST /v1/auth/web/session` — grant → 15-min access token, **no refresh
   token** (browser ≠ vault; tokens never enter URLs, referrers or logs).
4. `POST /v1/auth/desktop/code` (Bearer web token) — single-use `mcode_`
   (60 s) for the desktop.
5. `POST /v1/auth/desktop/exchange` — atomic Lua-GETDEL consume (dual-channel
   race: exactly one winner), device upsert, full TokenPair with a fresh
   refresh family; the losing channel sees `INVALID_OR_EXPIRED_CODE` and must
   verify via `GET /v1/me`.

Redis additions: `auth:oauth:state:<state>`, `auth:web:grant:<grant>`,
`auth:desktop:code:<code>` — all single-use, TTL-bounded, fail-closed consume.
All four public surfaces are per-IP throttled; `/v1/auth/lookup` (the login
screen's email-resolution step) is a deliberate, bounded enumeration surface
returning `{exists, auth_provider}`. Verified end-to-end by integration tests
(full journey, tampered/replayed state, missing tx cookie, forged ID
token, unverified email, dual-channel single winner, expiry, lookup matrix,
rate limits, link-not-duplicate, token-leak scan, concurrent provision,
auth gate, web-session shape).

---

## 9. MASh Production Architecture & Identifier Separation

MASh is designed from the ground up as a desktop-first agentic SaaS for professional auditors.

### 9.1 Boundary Guarantees
1. **Zero Cloud Transcripts / Documents**: The cloud API does NOT persist conversation history, prompts, completions, tool call arguments, or client financial documents. All audit transcripts and working papers live solely in the desktop client's local SQLite database and workspace.
2. **Credential Custody**: Desktop clients never possess API keys for Google, Anthropic, OpenAI, or Bifrost. All inference flows through `https://api.mash.audit/v1/responses` authenticated via MASh bearer tokens.
3. **Model Abstraction**: Desktop applications request `"mash-agent"` (or `"default"`). The Cloud API transparently validates and maps this alias to the operator-configured upstream model deployment (e.g. `openai/gpt-4o-mini` or `anthropic/claude-sonnet-4-5`) before forwarding to private Bifrost.

### 9.2 Identifier Taxonomy
The architecture strictly decouples identifiers across different layers:
- `user_id`: Customer identity in PostgreSQL (`usr_...`).
- `auth_session_id`: Cryptographic hash / JTI representing an authenticated device session.
- `device_id`: Physical / logical installation identifier of the desktop client (`dev_...`).
- `client_session_id`: Desktop conversation identifier (passed optionally via `X-Session-ID` for log correlation; never stored as conversation state).
- `run_id`: Single agent turn/execution (generated per request `run_...` or correlated via `X-Run-ID`).
- `llm_call_id`: Upstream inference completion ID from Bifrost/provider (`cmpl_...`).
- `request_id`: Transient HTTP correlation ID (`req_...`) traced through all middleware and log records.

---

## 10. Core Lifecycles

### 10.1 Authentication & Sliding Session Lifecycle
1. User logs in via Google OAuth 2.0 / OIDC (`POST /v1/auth/google/start` or `/v1/auth/oauth/google`).
2. MASh validates ID token signature against Google JWKS and resolves identity by Google `sub`.
3. Cloud API mints a short-lived access token (~60 min) and cryptographically hashed refresh token (~30 days).
4. Desktop exchanges the 60-second web code (`POST /v1/auth/desktop/exchange`) for the token pair.
5. On access token expiry, desktop calls `POST /v1/auth/refresh`. Old refresh token is revoked, new refresh token is issued (sliding idle expiry bounded by absolute max duration).
6. Central revocation: `POST /v1/auth/logout-all` invalidates all refresh tokens in PostgreSQL and blacklists user tokens in Redis.

### 10.2 Inference & Stream Relay Lifecycle
1. Desktop sends `POST /v1/responses` with `model: "mash-agent"` and OpenAI-compatible messages.
2. Cloud API executes:
   - Rate limiting & concurrency slot acquisition (`ratelimit`).
   - Subscription & entitlement check (active subscription or positive prepaid balance).
   - Input validation (body size, message count, tool schema).
   - Model alias translation (`mash-agent` → upstream Bifrost deployment).
3. Cloud proxies request to private Bifrost gateway.
4. Response stream is relayed as Server-Sent Events (`text/event-stream`).
5. On final chunk, authoritative token usage is emitted to the asynchronous usage recorder (`metering.Recorder`).
6. Usage record is batch-inserted into PostgreSQL `usage_records` with deduplication (`UNIQUE(run_id, call_seq)`).

