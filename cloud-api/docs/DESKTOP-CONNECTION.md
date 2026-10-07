# Desktop ↔ Cloud API ↔ Bifrost — The Single Connection Document

> **Scope.** This is the one document that answers: *how does the MASh desktop
> application connect to the cloud, and how does that relate to Bifrost?*
> Everything here is stated from **verified code in this repository** (file
> paths cited) or from **the desktop team's own written spec** (labelled as
> such). Nothing is guessed. Where something is still to be built on the
> desktop side, it is listed explicitly in §8 — this repo is the **cloud**
> side only.

---

## 1. The one-paragraph answer

**The desktop never connects to Bifrost. Ever.** Bifrost is a cloud-internal
service reachable only from inside the cloud network. The desktop connects to
**exactly one external thing: the NexaU Cloud API** (`https://api.<your-domain>`)
over HTTPS with its own user token. The Cloud API is the **only** party that
talks to Bifrost, using the **single** cloud-held credential
(`NEXAU_BIFROST_API_KEY`, see `internal/config/config.go` + `.env.example`).
No Bifrost URL, no provider key, no gateway secret ever reaches a user
machine — that is what "fully managed, not BYOK" means in the wire topology:

```
┌──────────────────────┐   HTTPS + user JWT   ┌──────────────────────┐  internal HTTP + 1 key  ┌──────────┐
│  NexaU Desktop app   │ ───────────────────> │  NexaU Cloud API     │ ─────────────────────> │ Bifrost  │──> 23+ LLMs
│  (local, user PC)   │        SSE / POST     │  (stateless, N pods) │  POST /v1/chat/         │ (gateway)│
└──────────────────────┘                      └──────────────────────┘  completions             └──────────┘
  holds: access + refresh        ▲                     ▲                                       ▲
  tokens only (DPAPI vault)      │                     │                                       │
                                 │                     └── holds the ONLY Bifrost credential ──┘
  NEVER holds: Bifrost URL/key ──┘                         (never sent to any client)
```

| Question | Answer | Where it is enforced |
|---|---|---|
| Does the desktop call Bifrost? | **No.** No Bifrost address exists in any client-facing response. | `internal/bifrost/` is server-side only; `/v1/config` (`internal/api/me.go:51`) returns transports/limits only |
| What does the desktop call? | The Cloud API base URL, e.g. `https://api.mash.ai` | `README.md` endpoint table |
| What credential does the desktop hold? | Its own JWT access token (1 h) + rotating refresh token (30 d) in the OS vault | `internal/auth/service.go:80` (`TokenPair`) |
| What credential does the API use for Bifrost? | One global Bearer key, env-injected, server-side only | `.env.example` lines 7–12 |
| If Bifrost scales to 100 replicas? | Invisible to both API and desktop (K8s Service VIP / LB in front of Bifrost; the API has one URL) | `docs/ARCHITECTURE.md` |

---

## 2. Connection 1 — Desktop → NexaU Cloud API (the only network hop the desktop makes)

*Verified from code in this repo.*

- **Transport**: HTTPS (TLS 1.2+). Plain HTTP is a dev-only convenience.
- **Auth header** on every authenticated call:
  `Authorization: Bearer <access_token>` — enforced by
  `internal/auth/middleware.go` (`authMW.Require(...)` wiring in
  `internal/api/router.go:102-149`).
- **Base URL**: one per deployment (e.g. `https://api.mash.ai`). The desktop
  stores nothing else network-related. `GET /v1/config` (authed) returns every
  limit/timing value the desktop should obey at runtime — request sizes, model
  entitlements, idle/stream timeouts, heartbeat interval
  (`internal/api/me.go:51-86`) — so hard-coding tunables in the client is
  unnecessary.
- **CORS/origins**: CORS is a browser concept; a native desktop HTTP client
  needs **no** origin allow-list. `NEXAU_ALLOWED_ORIGINS` exists only for the
  web dev UI.
- **Streaming**: ONE transport — SSE:
  - `POST /v1/chat/completions` with `stream:true` → OpenAI chat-completions
    chunks forwarded **verbatim** (`internal/api/llm.go`, `internal/llm/sse.go`).
  - The terminal event is `data: [DONE]`; comment heartbeats (`: ping`) keep
    intermediaries alive; mid-stream upstream failures surface as one
    in-band `{"error":{…}}` event before `[DONE]`.
  - Canceling a stream = closing the connection: the cloud cancels the
    upstream request through context propagation (no cancel endpoint, no
    resume protocol — the desktop owns replay from its local transcript).
- **OpenAI-compatible surface**: `POST /v1/chat/completions` is the ONLY LLM
  endpoint. Any existing OpenAI-style client works by changing the base URL,
  using `"provider/model"` model ids and the MASh access token instead of an
  OpenAI key.

### 2.1 What the desktop sends vs. what it must never invent

| Desktop sends | OK? | Notes |
|---|---|---|
| `Authorization: Bearer <access_token>` | ✅ | 1 h TTL (`NEXAU_AUTH_ACCESS_TOKEN_TTL` default in `.env.example`) |
| `refresh_token` to `/v1/auth/refresh` | ✅ | rotation; reuse of an old one revokes the whole family (theft detection) |
| `device_name`, `platform` (windows/macos/linux/…) at exchange time | ✅ | whitelisted platforms (`internal/auth/desktop_code.go:40`) |
| Any Bifrost model list / provider hints | ⚠️ | models come **down** from `/v1/me` + `/v1/config` (entitlements); the desktop does not choose providers |

---

## 3. Connection 2 — Cloud API → Bifrost (cloud-internal; the desktop is never involved)

*Verified from `internal/bifrost/client.go` (package doc, `NewClient`) and
`.env.example`.*

- **One URL** (`NEXAU_BIFROST_URL`, e.g. `http://bifrost:8081` — internal
  service address) and **one Bearer key** (`NEXAU_BIFROST_API_KEY` or
  `NEXAU_BIFROST_API_KEY_FILE` for secret mounts).
- **Protocol**: Bifrost's OpenAI-compatible chat-completions surface:
  `POST {base}/v1/chat/completions`, `model = "provider/model"`, SSE
  `data: … / data: [DONE]`, with `finish_reason` + `usage` standardized into
  the **last** chunk (verified against maximhq/bifrost's OpenAPI).
- **Transport hardening** (why this connection survives production load):
  one shared `http.Client` per process, HTTP/2, bounded connection pools
  (`MaxIdleConnsPerHost` etc.), retries **only before the first byte** (a
  stream never replays mid-flight), 15-minute stream ceiling
  (`NEXAU_STREAM_MAX_DURATION`), idle watchdog
  (`NEXAU_STREAM_IDLE_TIMEOUT=300s`).
- **Scaling story**: when Bifrost runs 100 replicas behind a K8s Service /
  LB, the API still dials the same single URL — pod churn is invisible
  (`docs/ARCHITECTURE.md`, capacity runs in `build/`).

**Consequence for the desktop team: there is no Bifrost connection task on
your side. Zero configuration, zero credentials, zero code.**

---

## 4. Sign-in: the web→desktop handshake (the only "setup" the desktop ever does)

*Verified from `internal/api/oauth.go`, `internal/auth/oauth.go`,
`internal/auth/desktop_code.go`; end-to-end proven in
`validation/oauth_desktop_test.go` (§42, 14 tests including dual-channel
single-winner races).*

The desktop's login button opens the system browser; tokens come back to the
desktop through a 60-second single-use code — **no long-lived token ever
crosses the browser**:

```
desktop            browser                          cloud API                        Google
  │  1. open browser │                                │                               │
  │────────────────>│ GET /v1/auth/oauth/google       │                               │
  │                 │<── 302 Google consent + tx cookie│                               │
  │                 │<═══ user consents ════════════════════════════════════════════>│
  │                 │ GET /v1/auth/oauth/google/callback?code&state                 │
  │                 │<── 302 {WebSuccessURL}?grant=wgrant_…  (single-use, 5 min) ───│
  │                 │ POST /v1/auth/web/session {grant}                                │
  │                 │<── 15-min web access token (NO refresh token) ──────────────────│
  │                 │ POST /v1/auth/desktop/code  (Bearer web token)                  │
  │                 │<── {code: "mcode_<64hex>", expires_in: 60} ─────────────────────│
  │                 │                                                                │
  │  channel 1: mash://auth/callback?code=mcode_…        (OS deep link)              │
  │<────────────────│                                                                │
  │  channel 2: POST http://localhost:8000/api/auth/login {code}   (loopback)       │
  │<────────────────│                                                                │
  │  2. POST /v1/auth/desktop/exchange {code, device_name, platform}                  │
  │────────────────────────────────────────────────>│ FULL TokenPair + device row   │
  │  3. store pair in DPAPI vault; verify with GET /v1/me                            │
```

Rules the desktop must follow (all enforced server-side, all tested):

1. **Fire both channels** (deep link + loopback). The mcode is consumed
   atomically by Lua GETDEL — **exactly one channel wins**. The loser receives
   `INVALID_OR_EXPIRED_CODE`; that is not an error, it means "the other
   channel already logged in". Verify with `GET /v1/me`; do **not** retry the
   exchange.
2. **60-second window**: if the user lingered, the web page mints a fresh
   mcode on click (`expires_in` is returned; `NEXAU_AUTH_DESKTOP_CODE_TTL`).
3. **Refresh rotation**: `POST /v1/auth/refresh {refresh_token}` returns a
   **new pair**; the old refresh token dies. Reusing a rotated token revokes
   the family (stolen-token containment) — the desktop must persist the new
   pair atomically before discarding the old one.
4. **Never put tokens in URLs or logs.** The browser leg already obeys this
   (only single-use codes travel in redirects); the desktop should too.

---

## 5. Exact wire contracts (copied from the handlers, not paraphrased)

### 5.1 `POST /v1/auth/lookup` — login screen, email step
```jsonc
// request                                      // response (account exists)
{ "email": "user@gmail.com" }                   { "exists": true, "auth_provider": "google" }
                                                // response (no account)
                                                { "exists": false }
```
Per-IP throttled (default 60/15 min, `NEXAU_AUTH_LOOKUP_PER_IP`); 429 carries
`Retry-After: 60`.

### 5.2 `POST /v1/auth/web/session` — web page redeems the OAuth grant
```jsonc
{ "grant": "wgrant_…" }      →  { access token fields, NO refresh_token }
```

### 5.3 `POST /v1/auth/desktop/code` — authed (web token)
```jsonc
// Authorization: Bearer <web access token>
{}                            →  { "code": "mcode_<64 hex>", "expires_in": 60 }
```

### 5.4 `POST /v1/auth/desktop/exchange` — the desktop's single login call
```jsonc
// request
{
  "code":        "mcode_<64hex>",
  "device_name": "Work laptop",          // optional, ≤128 chars
  "platform":    "windows",              // windows|macos|linux|android|ios|web|other
  "device_id":   "dev_<ulid>"            // optional — supply on re-login to keep one device row
}
// response — full pair (internal/auth/service.go:80)
{
  "access_token":  "…",                   // JWT, 1 h
  "token_type":    "Bearer",
  "expires_in":    3600,
  "refresh_token": "…",                   // rotating, 30 d
  "user":   { "id": "usr_…", "email": "…", "display_name": "…",
              "status": "active", "is_platform_admin": false, "email_verified": true },
  "tenant": { "id": "ten_…", "slug": "…", "name": "…", "status": "active" }
}
```
Errors: `INVALID_OR_EXPIRED_CODE` (already used / older than 60 s / losing
channel), `ACCOUNT_INACTIVE`, `VALIDATION_ERROR`.

### 5.5 `POST /v1/auth/refresh`
```jsonc
{ "refresh_token": "…" }      →  a fresh full pair (same shape as 5.4)
```

### 5.6 Runtime (authed) — the calls after login
```jsonc
GET   /v1/me                                  // server-authoritative identity, limits, quota, models
GET   /v1/config                              // limits, endpoint contract, stream timing
POST  /v1/chat/completions                    // THE LLM call (stream:true → SSE; OpenAI-compatible)
GET   /v1/usage?from&to&by_model              // tenant usage aggregates
```
Wire format: plain OpenAI chat-completions chunks, forwarded verbatim
(`choices[].delta`, usage in the final chunk, `data: [DONE]` terminator).
Sessions, runs and their transcripts are DESKTOP-LOCAL — there is no
`/v1/agent/*` surface anymore, and no resume protocol (replay from the local
transcript; the cloud buffers nothing).

---

## 6. Cloud-side configuration (all in `.env.example`, validated at boot)

| Variable | Meaning |
|---|---|
| `NEXAU_AUTH_GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URL` | Google Cloud Console OAuth client (Web application). The redirect URI must match **exactly**, e.g. `https://api.mash.ai/v1/auth/oauth/google/callback`. Setting all three + `local` auth mode mounts the OAuth routes; otherwise they stay absent (404). |
| `NEXAU_AUTH_WEB_SUCCESS_URL` | post-login page — receives `?grant=wgrant_…` |
| `NEXAU_AUTH_WEB_LOGIN_URL` | error target — receives `?error=<code>` |
| `NEXAU_AUTH_WEB_SESSION_TTL` (15m) / `NEXAU_AUTH_WEB_GRANT_TTL` (5m) / `NEXAU_AUTH_OAUTH_STATE_TTL` (10m) / `NEXAU_AUTH_DESKTOP_CODE_TTL` (60s) | handshake clockwork |
| `NEXAU_AUTH_OAUTH_COOKIE_SECURE` | tx-cookie Secure flag (false only for plain-http dev) |
| `NEXAU_BIFROST_URL` / `NEXAU_BIFROST_API_KEY` | the internal gateway hop — server-side only |

Google Cloud Console checklist: APIs & Services → Credentials → Create OAuth
client ID (Web application) → Authorized redirect URI = your
`NEXAU_AUTH_GOOGLE_REDIRECT_URL`. Scopes are fixed in code: `openid email
profile`. ID tokens are verified against Google's JWKS (RS256; `iss`/`aud`/
`exp` checked) — unverified provider emails never create accounts.

First Google sign-in provisions **user + personal tenant + owner membership +
free-plan trial atomically**; the identity anchor is the Google `sub`
**linked, not duplicated** (`internal/store/repos/oauth.go`,
`FindOrCreateGoogleUser`).

---

## 7. What is on the desktop today — *from your desktop team's spec, not from this repo*

> The desktop repository is **not** part of this codebase. The following facts
> are reproduced from the desktop spec you gave; they are **not** verified
> here, and this document deliberately does not guess beyond them.

- Stack: Next.js (App Router) shell + **FastAPI local backend bound to
  `localhost:8000`** (Windows DPAPI `auth.vault` + `auth_meta.json`).
- `ensure_valid_token()` sliding refresh already exists locally.
- The `mash://` custom-protocol handler registration is a desktop-side
  installer task (Windows registry / macOS `Info.plist` / Linux
  `.desktop`), exactly like VS Code / Slack / Cursor deep links.
- Loopback fallback contract: web page `POST`s
  `http://localhost:8000/api/auth/login` `{code}` to the FastAPI backend.

## 8. Desktop integration checklist — what the desktop team must build

Nothing below exists in this repo; nothing below is speculative cloud work —
each row maps to a **finished, tested** cloud endpoint above.

- [ ] **HTTP client module** (base URL from settings; attach
      `Authorization: Bearer <access_token>`; 401 → single refresh → retry once).
- [ ] **Browser-launch sign-in**: open `{base}/v1/auth/oauth/google` in the
      system browser (top-level navigation, not an iframe).
- [ ] **`mash://auth/callback` handler**: parse `code`, call
      `POST /v1/auth/desktop/exchange`, then `GET /v1/me` to confirm.
- [ ] **Loopback receiver**: FastAPI route `POST /api/auth/login` on
      `localhost:8000` doing the same exchange (the dual-channel loser must
      treat `INVALID_OR_EXPIRED_CODE` as success-if-`/v1/me`-works).
- [ ] **Vault write**: store the `TokenPair` in the DPAPI vault; keep your
      existing `ensure_valid_token()` sliding refresh pointed at
      `POST /v1/auth/refresh` (persist the **new** pair atomically per call).
- [ ] **Run/stream clients**: SSE consumer for
      `POST /v1/chat/completions` (`stream:true`) and
      `resume{run_id, last_sequence}` reconnect logic.
- [ ] **Startup entitlement fetch**: `GET /v1/config` once at boot; obey the
      returned limits/timeouts instead of hard-coding.

---

## 9. Failure semantics the desktop should encode

| Situation | What the desktop sees | What to do |
|---|---|---|
| Other channel won the handshake | `INVALID_OR_EXPIRED_CODE` from exchange | call `GET /v1/me`; if 200, login already succeeded — proceed |
| User lingered > 60 s | same code | web page mints a fresh mcode; retry with the new one |
| Access token expired | 401 `UNAUTHORIZED` | refresh; retry once; if refresh fails → vault clear → login again |
| Refresh token reused (rotation race) | family revoked; 401s | full re-login (this is the theft-detection working) |
| **Token revoked mid-stream (logout elsewhere)** | stream ends; the next HTTP call is 401 `TOKEN_REVOKED` | treat as forced logout: clear the vault, require re-login |
| **Stream dropped (network blip)** | SSE read returns EOF / error | the call is over: the cloud canceled the upstream and metered it `cancelled`; replay from the local transcript and retry as a NEW request |
| Rate limited | 429 + `Retry-After` | honor the header; never hammer |
| Redis/PG degraded (rare) | 503 `DEPENDENCY_UNAVAILABLE` | back off with jitter |
| Bifrost gateway failing (cloud protects itself) | 503 `UPSTREAM_CIRCUIT_OPEN`, `details.retry_after_ms` present | back off for `retry_after_ms` (typically seconds); the cloud auto-recovers — probe after the hint, no user action needed |

**Bottom line:** the desktop needs **one base URL** and **one pair of tokens**
— everything else (Bifrost, providers, keys, scaling) is the cloud's problem.
