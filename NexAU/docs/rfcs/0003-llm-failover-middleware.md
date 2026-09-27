# RFC-0003: LLM  (Failover Middleware)

- ****: implemented
- ****: P1
- ****: `architecture`, `reliability`
- ****: Agent 、LLM 
- ****: 2026-02-28
- ****: 2026-02-28

## 

 LLM provider （500/502/503）（429）， provider， Agent 。 Middleware ， LLMCaller 。

## 

 LLM provider ：
- （HTTP 500/502/503）
- （HTTP 429 / RateLimitError）
- 
- 

 NexAU  `LLMCaller._call_with_retry()`  provider ， provider 。NexTask  failover ， ~240  `LLMCaller` ，：

1. ， `_nextask_` 
2.  `llm_config` 
3.  `Any` / `getattr`，
4.  fallback，
5.  `global_storage`

NexAU  `Middleware.wrap_model_call()` ， failover 。

## 

### 

 `LLMFailoverMiddleware`， `Middleware` ， `wrap_model_call(params, call_next)`  LLM 。 provider ， `LLMConfig` + SDK client， `ModelCallParams`  `call_next`，。

```
Agent YAML
  → MiddlewareManager  LLMFailoverMiddleware
    → wrap_model_call(params, call_next)
      → try: call_next(params)           #  provider
      → except: ?
        → _apply_fallback(params, provider)  #  params
        → call_next(new_params)              #  provider
```

### 

####  (FailoverTrigger)

 OR：
- `status_codes`: HTTP ， `isinstance(exc, openai.APIStatusError)` 
- `exception_types`: ， `"ConnectionError"`

####  (FallbackProvider)

 provider，。 fallback  `llm_config`  provider （ model、temperature）。

####  (CircuitBreaker, )

: CLOSED → OPEN → HALF_OPEN → CLOSED
-  `failure_threshold`  OPEN， provider
- `recovery_timeout_seconds`  HALF_OPEN，

#### 

`_apply_fallback()`  `LLMConfig.copy()` + `copy.copy(params)` ， `params`  `llm_config`。

### 

```yaml
middlewares:
  - import: nexau.archs.main_sub.execution.middleware.llm_failover:LLMFailoverMiddleware
    params:
      trigger:
        status_codes: [500, 502, 503, 529]
        exception_types: ["RateLimitError", "InternalServerError"]
      fallback_providers:
        - name: "backup-gateway"
          llm_config:
            base_url: ${env.FALLBACK_LLM_BASE_URL}
            api_key: ${env.FALLBACK_LLM_API_KEY}
        - name: "emergency"
          llm_config:
            model: "gpt-4o"
            base_url: ${env.EMERGENCY_LLM_BASE_URL}
            api_key: ${env.EMERGENCY_LLM_API_KEY}
            api_type: "openai_chat_completion"
      circuit_breaker:
        failure_threshold: 3
        recovery_timeout_seconds: 60
```

## 

### 

1. ** LLMCaller**（NexTask ）： `_call_with_retry()`  except  failover 。；、、、。
2. **Multi-Provider LLMConfig**： `LLMConfig`  provider 。，。

### 

-  failover  SDK client（`openai.OpenAI()` / `anthropic.Anthropic()`），
-  provider  tool calling （ Anthropic  OpenAI  tool schema ）

## 

### 

- [x] Phase 1:  middleware  + 
- [x] Phase 2: 
- [ ] Phase 3: （， logging ）

### 

- `nexau/archs/main_sub/execution/middleware/llm_failover.py` — 
- `tests/unit/test_llm_failover_middleware.py` — （20 cases）
- `tests/integration/test_llm_failover_integration.py` — （3 cases）
- `nexau/archs/main_sub/execution/hooks.py` — Middleware  ModelCallParams

## 

### 

 20 ，：
- `_extract_status_code`: OpenAI/Anthropic SDK 
- `_CircuitBreaker`: （CLOSED/OPEN/HALF_OPEN/reset）
- `LLMFailoverMiddleware` ：/ trigger、circuit breaker
- `wrap_model_call`:  provider 、failover 、、 provider 、、、、、 provider

### 

```bash
uv run pytest tests/unit/test_llm_failover_middleware.py -v --no-cov

uv run pyright nexau/archs/main_sub/execution/middleware/llm_failover.py
uv run mypy nexau/archs/main_sub/execution/middleware/llm_failover.py
```

## 

1.  provider tool calling ： Anthropic  OpenAI ，tool schema ，
2.  failover （，circuit breaker  HALF_OPEN ）

## 

- NexTask  `llm_caller.py` failover 
- NexAU Middleware ：`nexau/archs/main_sub/execution/hooks.py`