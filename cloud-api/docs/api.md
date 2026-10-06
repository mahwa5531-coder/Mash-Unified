# MASh Cloud API Reference (`docs/api.md`)

**Base URL**: `https://api.mash.audit` (or `http://localhost:8080` in local development)  
**Protocol**: HTTPS / REST / Server-Sent Events (SSE)  
**Auth Model**: Google OAuth / OIDC Identity Provider + MASh Session Layer (Bearer Access Token + Rotated Refresh Token)

---

## 1. Authentication & Session Lifecycles

MASh exclusively uses Google OAuth 2.0 / OIDC for user authentication. MASh issues its own short-lived access tokens (~15–60 min) and rotated refresh tokens (~30 days). The desktop never stores Google credentials or provider LLM keys.

### 1.1 Start Google OAuth
Initiates the PKCE Google OAuth login flow.

- **Method**: `POST`
- **Path**: `/v1/auth/google/start`
- **Auth**: None (Public)
- **Request Body**: (Optional JSON)
  ```json
  {
    "redirect_url": "https://api.mash.audit/v1/auth/oauth/google/callback"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&response_type=code&scope=openid+email+profile...",
    "state": "oauth_state_01m43vkd...",
    "code_verifier": "pkce_verifier_string..."
  }
  ```

---

### 1.2 Desktop Code Generation (Web Session)
When a user signs in via web browser, the authenticated web session creates a single-use 60-second exchange code for the desktop application.

- **Method**: `POST`
- **Path**: `/v1/auth/desktop/code`
- **Auth**: Bearer `<WEB_ACCESS_TOKEN>`
- **Request Headers**:
  - `Authorization: Bearer <WEB_ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "code": "mcode_8f43a9d12e...",
    "expires_at": "2026-10-04T22:00:00Z"
  }
  ```

---

### 1.3 Desktop Token Exchange
Desktop exchanges the single-use 60-second code for MASh API credentials.

- **Method**: `POST`
- **Path**: `/v1/auth/desktop/exchange`
- **Auth**: None (One-time code)
- **Request Body**:
  ```json
  {
    "code": "mcode_8f43a9d12e..."
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "access_token": "mash_at_9921bdf...",
    "refresh_token": "mash_rt_7712a4c...",
    "device_token": "mash_dt_5521b10...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "user": {
      "id": "usr_01jm84...",
      "email": "auditor@firm.com",
      "status": "active"
    },
    "tenant": {
      "id": "ten_01jm84...",
      "slug": "audit-firm",
      "status": "active"
    }
  }
  ```

---

### 1.4 Refresh Token Rotation
Refreshes an expired access token using the rotated refresh token. The old refresh token is atomically consumed and revoked (with automatic family reuse detection).

- **Method**: `POST`
- **Path**: `/v1/auth/refresh`
- **Auth**: None (Uses Refresh Token)
- **Request Body**:
  ```json
  {
    "refresh_token": "mash_rt_7712a4c..."
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "access_token": "mash_at_1234abcd...",
    "refresh_token": "mash_rt_9876wxyz...",
    "token_type": "Bearer",
    "expires_in": 3600
  }
  ```
- **Error (Reused / Revoked Token)**: `401 Unauthorized`
  ```json
  {
    "error": {
      "code": "REFRESH_TOKEN_REUSED",
      "message": "Revoked refresh token was reused; session invalidated"
    }
  }
  ```

---

### 1.5 Session Status
Inspects the current access token and session state.

- **Method**: `GET`
- **Path**: `/v1/auth/session`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "authenticated": true,
    "user_id": "usr_01jm84...",
    "tenant_id": "ten_01jm84...",
    "role": "member",
    "status": "active"
  }
  ```

---

### 1.6 Logout & Logout All
- `POST /v1/auth/logout`: Revokes the current session's refresh token and blacklists the access token JTI in Redis.
- `POST /v1/auth/logout-all`: Revokes **all** active refresh tokens and sessions for the calling user across all devices.

- **Method**: `POST`
- **Path**: `/v1/auth/logout` or `/v1/auth/logout-all`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "status": "logged_out"
  }
  ```

---

## 2. Models & Inference

MASh isolates LLM credentials on the cloud API. The desktop client calls `/v1/responses` or `/v1/agent/chat/completions` using the logical model alias `"mash-agent"`. The cloud proxies the request to the upstream Bifrost gateway.

Zero conversation transcript, prompt messages, or tool outputs are persisted in the cloud database.

### 2.1 List Available Models
Returns the list of supported model aliases.

- **Method**: `GET`
- **Path**: `/v1/models`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "object": "list",
    "data": [
      {
        "id": "mash-agent",
        "name": "MASh Auditor Agent (Default)",
        "object": "model",
        "created": 1728000000,
        "owned_by": "mash"
      },
      {
        "id": "openai/gpt-4o-mini",
        "name": "GPT-4o Mini",
        "object": "model",
        "created": 1728000000,
        "owned_by": "openai"
      }
    ]
  }
  ```

---

### 2.2 LLM Responses / Completions (`/v1/responses` & `/v1/agent/chat/completions`)
Unified inference endpoint. Accepts standard OpenAI chat messages and tool definitions.

- **Method**: `POST`
- **Path**: `/v1/responses` (or `/v1/agent/chat/completions`)
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Request Headers**:
  - `Content-Type: application/json`
  - `X-Session-ID: <client_session_id>` (Optional desktop audit session correlation ID)
  - `X-Run-ID: <run_id>` (Optional desktop iteration run ID)
- **Request Body**:
  ```json
  {
    "model": "mash-agent",
    "stream": true,
    "messages": [
      {
        "role": "system",
        "content": "You are MASh, an expert audit AI assistant."
      },
      {
        "role": "user",
        "content": "Check trial balance variance for account 4100."
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "query_local_ledger",
          "description": "Executes SQL query on local SQLite ledger",
          "parameters": {
            "type": "object",
            "properties": {
              "query": { "type": "string" }
            },
            "required": ["query"]
          }
        }
      }
    ],
    "temperature": 0.2
  }
  ```

#### Streaming SSE Response (`stream: true`)
Standard Server-Sent Events stream chunked directly to the client:
```
data: {"id":"cmpl_01...","object":"chat.completion.chunk","model":"mash-agent","choices":[{"index":0,"delta":{"role":"assistant","content":"Checking"}}]}

data: {"id":"cmpl_01...","object":"chat.completion.chunk","model":"mash-agent","choices":[{"index":0,"delta":{"content":" variance..."}}]}

data: {"id":"cmpl_01...","object":"chat.completion.chunk","model":"mash-agent","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":120,"completion_tokens":25,"total_tokens":145}}

data: [DONE]
```

#### Non-Streaming JSON Response (`stream: false`)
```json
{
  "id": "cmpl_01...",
  "object": "chat.completion",
  "created": 1728000000,
  "model": "mash-agent",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Variance on account 4100 is within 2% materiality threshold."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 25,
    "total_tokens": 145
  }
}
```

---

### 2.3 Cancel In-Flight Inference
Allows the desktop application to signal immediate abortion of an in-flight LLM call.

- **Method**: `POST`
- **Path**: `/v1/agent/chat/completions/cancel`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "run_id": "run_01m43vkdf...",
    "reason": "user_cancelled"
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "status": "cancelled",
    "run_id": "run_01m43vkdf..."
  }
  ```

---

## 3. Account, Entitlements & Usage

### 3.1 User Profile (`GET /v1/me`)
- **Method**: `GET`
- **Path**: `/v1/me`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "user": {
      "id": "usr_01jm84...",
      "email": "auditor@firm.com",
      "status": "active"
    },
    "tenant": {
      "id": "ten_01jm84...",
      "slug": "audit-firm",
      "status": "active"
    },
    "membership": {
      "role": "member",
      "status": "active"
    },
    "subscription_status": "active"
  }
  ```

---

### 3.2 Subscription Plan Details (`GET /v1/me/plan`)
- **Method**: `GET`
- **Path**: `/v1/me/plan`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "tier": "pro",
    "status": "active",
    "period_end": "2026-11-04T00:00:00Z",
    "features": {
      "models": ["mash-agent", "openai/gpt-4o-mini"],
      "concurrency": 16,
      "max_request_bytes": 2097152
    }
  }
  ```

---

### 3.3 Token & Credit Usage (`GET /v1/me/usage`)
- **Method**: `GET`
- **Path**: `/v1/me/usage`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "tokens": {
      "input_tokens": 145000,
      "completion_tokens": 28500,
      "total_tokens": 173500
    },
    "credit_balance": 4850,
    "period": "current"
  }
  ```

---

### 3.4 Client Configuration (`GET /v1/client/config` or `GET /v1/config`)
Returns runtime settings required by the desktop client.

- **Method**: `GET`
- **Path**: `/v1/client/config` (or `/v1/config`)
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "default_model": "mash-agent",
    "available_models": ["mash-agent", "openai/gpt-4o-mini"],
    "stream_idle_timeout_seconds": 300,
    "max_body_bytes": 2097152
  }
  ```

---

## 4. Billing & Payments (Razorpay)

MASh integrates with Razorpay for subscription orders and top-up credit packs.

### 4.1 Payment Catalog
Returns active credit packs and subscription plans.

- **Method**: `GET`
- **Path**: `/v1/billing/catalog` (or `/v1/payments/catalog`)
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "packs": [
      {
        "id": "pack_basic",
        "name": "Audit Starter Pack",
        "credits": 1000000,
        "amount_paise": 250000,
        "currency": "INR"
      }
    ]
  }
  ```

---

### 4.2 Create Checkout Order
Creates a Razorpay order for checkout in the desktop or web UI.

- **Method**: `POST`
- **Path**: `/v1/billing/checkout` (or `/v1/payments/checkout`)
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "pack_id": "pack_basic"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "order_id": "ord_01jm8...",
    "razorpay_order_id": "order_EKf7vdq8P51234",
    "amount": 250000,
    "currency": "INR",
    "key_id": "rzp_test_..."
  }
  ```

---

### 4.3 Verify Payment
Verifies cryptographic HMAC signature after user completes Razorpay payment dialog.

- **Method**: `POST`
- **Path**: `/v1/billing/verify` (or `/v1/payments/verify`)
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Request Body**:
  ```json
  {
    "order_id": "ord_01jm8...",
    "razorpay_payment_id": "pay_EKf8Abc...",
    "razorpay_order_id": "order_EKf7vdq8P51234",
    "razorpay_signature": "4a71d2..."
  }
  ```
- **Response**: `200 OK`
  ```json
  {
    "status": "paid",
    "credits_granted": 1000000,
    "balance": 1500000
  }
  ```

---

### 4.4 Get Active Subscription (`GET /v1/billing/subscription`)
- **Method**: `GET`
- **Path**: `/v1/billing/subscription`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "subscription": {
      "id": "sub_01jm84...",
      "plan_id": "plan_pro",
      "status": "active",
      "current_period_end": "2026-11-04T00:00:00Z"
    }
  }
  ```

---

### 4.5 Cancel Subscription (`POST /v1/billing/subscription/cancel`)
- **Method**: `POST`
- **Path**: `/v1/billing/subscription/cancel`
- **Auth**: Bearer `<ACCESS_TOKEN>`
- **Response**: `200 OK`
  ```json
  {
    "status": "cancelled",
    "message": "Subscription cancelled; active through end of billing period"
  }
  ```

---

### 4.6 Razorpay Webhook
Handles asynchronous payment state transitions. Authenticated via `X-Razorpay-Signature`.

- **Method**: `POST`
- **Path**: `/v1/payments/webhook`
- **Auth**: Razorpay Webhook Signature
- **Headers**:
  - `X-Razorpay-Signature: <hex_hmac_sha256>`
- **Response**: `200 OK`

---

## 5. System Health & Readiness

### 5.1 Liveness Probe (`GET /health`)
Shallow check; returns `200 OK` if the HTTP process is listening.

### 5.2 Readiness Probe (`GET /ready`)
Deep dependency check; returns `200 OK` if PostgreSQL, Redis, and Bifrost are reachable.
- **Response**: `200 OK`
  ```json
  {
    "status": "ok",
    "database": "ok",
    "redis": "ok",
    "bifrost": "ok"
  }
  ```
