# 2026-05-04 — Live test economics: what must be live, what should be recorded, how to assert without flake

**TL;DR**:  RFC-0023 PR-C.2  81  SKIPPED live ，
 " PR "  test-saas  ~15min、test 、
 false-fail。 **live vs replay ** + 
**cache ** +  **per-PR / nightly  + **
。 agent / ： LLM 。

**Date**: 2026-05-04
**Driver**: PR #519 (closes #518) — wiring live cross-provider matrix
**Files**:
- `tests/aggregator_parity/fixtures/<provider>/recordings/*.sse` (cassettes)
- `tests/integration/test_aggregator_live_e2e.py` (live smoke + nightly)
- `tests/integration/test_block_matrix_langfuse_live.py` (nightly only)
- `tests/integration/test_token_usage_live_matrix.py` (nightly only)
- `tests/integration/test_two_turn_payload_live.py` (per-PR cache + signature)
- `tests/conftest.py` (`_AGGREGATOR_LIVE_SMOKE`, `live_nightly` auto-marker)
- `pytest.ini` (`live_nightly` marker registration)
- `Makefile` (`test` excludes nightly, `test-nightly` runs only nightly)
- `.github/workflows/nightly.yml`
- `scripts/notify_lark.sh`

---

## ： LLM 

```
1. ？
   ├── (A)  SDK  wire format （aggregator /  / ）
   │   → REPLAY:  SSE  fixtures/<provider>/recordings/，
   │     test_set_a_aggregator_replay.py 
   │
   ├── (B)  /  provider （cache prefix 、thinking signature
   │     、 provider gap、auth/TLS、 SSE chunk ）
   │   → LIVE: 
   │     ├──  PR : cache invariant (cost-impacting), signature roundtrip
   │     │   → per-PR ( _AGGREGATOR_LIVE_SMOKE  same-provider )
   │     └── drift : cross-provider matrix,  quirky tools / multichunk
   │         → live_nightly ( nightly job )
   │
   └── (C)  / "" → ；
```

** replay**。Live ："？"

---

##  live 

|  |  |  |
|------|--------------|---------|
| **prompt cache ** | / provider ；，" prefix " | per-PR `test_two_turn_payload_live` |
| **Anthropic thinking signature ** | signature  provider /；， 2  provider  stale； live → live  | per-PR `test_two_turn_payload_live` |
| ** provider gap** | A  reasoning_summary → B、A  tool_call.id → B； A  + B ， PR  "B  payload"， | nightly `test_block_matrix_langfuse_live` (64-case) |
| ** / ** | SSE ，；auth/TLS/gateway  | per-PR 4  smoke + nightly drift |

 → replay。

---

## Cache （）

### （）

```python
cached = response.usage.prompt_tokens_details.cached_tokens
assert cached > 0, "cache miss"
```

****：：
1. **CI runner  system ** →  cache cold → cached=0（ bug）
2. **SDK ** → cache miss（）

 1  CI （prompt ，gateway ），
 false-fail。

### （）

```python
cached_1 = _safe_cached(resp1.usage, "prompt_tokens_details")
cached_2 = _safe_cached(resp2.usage, "prompt_tokens_details")
assert cached_2 >= cached_1, "turn-2 cache regressed below turn-1"
```

****：turn 2  turn 1 ****。 cache
， SDK ， `turn2.cached >= turn1.cached`：

|  |  `> 0` |  `>= turn1` |
|------|---------|--------------|
| Cache  cold（CI ） | ❌  | ✅ 0 ≥ 0 |
| Cache  warm | ✅ | ✅ |
| **SDK **（ bug） | ⚠️  | ❌  |

 ——  "turn 1  turn 2 miss"（ turn 2
prefix ）。

### ：usage  None

```python
def _safe_cached(usage: Any, details_attr: str) -> int:
    """Return ``usage.<details_attr>.cached_tokens`` or 0."""
    details = getattr(usage, details_attr, None)
    if details is None:
        return 0
    return getattr(details, "cached_tokens", None) or 0
```

OpenAI  cache  `prompt_tokens_details` ，
 `.cached_tokens`  `AttributeError`。defensive 。

###  provider cache 

| Provider |  |
|----------|------|
| OpenAI Chat | `usage.prompt_tokens_details.cached_tokens` |
| OpenAI Responses | `usage.input_tokens_details.cached_tokens` (！) |
| Anthropic | `usage.cache_read_input_tokens` (， details ) |
| Gemini |  `cachedContent`  API（ NexAU SDK ） |

### Anthropic  cache_control

```python
llm_kwargs["cache_control_ttl"] = "5m"
# system prompt  ≥ 1024 tokens (sonnet 4-5)
```

 Anthropic （ OpenAI ）。NexAU SDK ，
 `LLMConfig.cache_control_ttl`， apply  system block。

---

## Per-PR vs Nightly 

### Per-PR (， push )

-  replay （aggregator parity, set A replay, ump matrix）
- 4  per-provider live smoke ( provider  streaming)
- `test_two_turn_payload_live` (cache + signature)
-  unit + windows + e2e

CI ：≤10min

### Nightly (`live_nightly` marker, cron 02:00 CST)

- 64-case `test_block_matrix_langfuse_live` (cross-provider drift)
- 41-case `test_token_usage_live_matrix` (token usage drift)
- 23  `test_aggregator_live_e2e`  smoke （tools / multichunk /
  reasoning / async / shutdown / traced）

 Lark，****（drift ，）。

### 

****：don't decorate 23  `@pytest.mark.live_nightly`。
 `tests/conftest.py`  SMOKE ：

```python
_AGGREGATOR_LIVE_SMOKE = frozenset({
    "test_openai_chat_streaming_e2e_northgate_gpt52",
    "test_openai_responses_streaming_e2e_northgate_gpt52",
    "test_anthropic_streaming_e2e_northgate_sonnet45",
    "test_gemini_rest_streaming_e2e_gateway_31pro",
})

# in pytest_collection_modifyitems:
if "test_aggregator_live_e2e.py" in str(item.fspath) and item.name not in _AGGREGATOR_LIVE_SMOKE:
    item.add_marker(pytest.mark.live_nightly)
```

 nightly。** /  frozenset**，
 decorator 。

 nightly （`test_block_matrix_*`, `test_token_usage_*`），
 `pytestmark = [..., pytest.mark.live_nightly]`。

### Make 

```bash
make test           # excludes -m "live_nightly"
make test-nightly   # only -m "live_nightly"
```

---

##  SSE 

```bash
# 1.  curl， .sse 
curl -sS -N https://gateway/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{...payload...}' > tests/aggregator_parity/fixtures/<provider>/recordings/<scenario>.sse

# 2.  parse +  aggregator
uv run pytest tests/unit/test_set_a_aggregator_replay.py::test_all_oac_recordings_parse_and_build -v

# 3. （mirror  test_openrouter_reasoning_details_preserved ）
```

 raw SSE bytes， `curl -N` 。SDK  `_parse_sse_blocks`
 events  aggregator。

** redact**：API key  request header  response body；
session id  metadata  replay 。

---

## CI 

###  sender

`scripts/notify_lark.sh "<message>"` —— （HMAC-SHA256），
`LARK_WEBHOOK` env  warn-and-exit（ CI）。

###  workflow

| Workflow |  |  |
|----------|------|-----|
| `nightly.yml` | cron 18:00 UTC + manual | drift  |
| `main-failure-alert.yml` | `workflow_run` of CI | main  push  CI ：commit +  +  job |
| `pr-stuck-alert.yml` | `workflow_run` of CI | PR 24h  ≥3 ： + PR comment  |

PR-stuck  `<!-- pr-stuck-alert -->` sentinel comment ；
 comment = re-arm。

### Secrets

- `LARK_NIGHTLY_WEBHOOK` (URL)
- `LARK_NIGHTLY_SIGN_SECRET` (HMAC-SHA256 key)

 channel  webhook ，sender 。

---

##  / 

### " live  PR " 

 ""，：
-  ~15min（）
- LLM 
- false-fail 
- **Drift  vs **

： " bug  provider  drift？"。

###  trace count  eventual consistency 

Langfuse /  async ingest backend：trace  ≠ 。
fetch helper  retry （ `require_named=True`），
 `flush()`  race。

### Cache 

 "Cache "。**** (turn2 ≥ turn1)
 **** (cached > 0) （）（ false-fail）。

###  mock async  patch sync slot

```python
# Agent.run()  → asyncio.run(run_async) →  _async_openai_client
# Patch agent.openai_client (sync)  no-op
#  patch agent._async_openai_client
```

5  bug  `test_two_turn_payload_live`  ""  spy.calls
 —— 。 sync → async +  patch target 。

### deepseek-v4-flash  placeholder，

Smoke  model  " wire format +  provider 
"。 deepseek-v4-flash ， northgate  deepseek
， vision。 `gpt-5.2`： OpenAI Chat
shape ， northgate  gpt 、。

：**smoke target **。 quirk  model
。