# RFC-0023 Merge Runbook（）

> ****：4  PR  stack， PR 、、CI 、
>
> ****：2026-05-04 · ****：ready-to-merge

---

##  PR

「 LLM 」（Set A  + Set B  ModelResponse）「 Set A」， ~8400 ，「 parity」「 LLM  e2e」。

---

## Stack 

```
main
 └── PR-A #508  feat: parity （3-axis）           ← 
     └── PR-B #510  feat: ModelCallFinishedEvent  sidecar event
         └── PR-C.1 #513  feat: Set A build()  vendor  + axis-4 parity
             └── PR-C.2 #514  feat: Set B  + 41 
```

****：`#508 → #510 → #513 → #514`， merge button 。 PR  PR  base  main。

---

##  PR 

| PR |  |  |
|---|---|---|
| **[#508](https://github.com/china-qijizhifeng/nexau/pull/508)** | + 4k |  SSE fixture + parity test （Set A vs Set B ） |
| **[#510](https://github.com/china-qijizhifeng/nexau/pull/510)** | + 1.5k |  `ModelCallFinishedEvent`  AG-UI  stop_reason / model_name |
| **[#513](https://github.com/china-qijizhifeng/nexau/pull/513)** | + 2k / - 1k | Set A  `build()`  vendor ；axis-4 parity  |
| **[#514](https://github.com/china-qijizhifeng/nexau/pull/514)** | + 800 / - 8.4k |  Set B；llm_caller  Set A；19 live e2e + 22 mock unit + 4 traced e2e |

---

## CI 

### 7  job（）
| Job |  |  |
|---|---|---|
| `lint` | ruff format + ruff check | ~30s |
| `typecheck` | mypy + pyright | ~1min |
| `windows-quality` | Windows  quality  | ~3min |
| `windows-target-tests` | Windows target  | ~3min |
| `windows-entrypoint-smoke` | Windows entrypoint smoke | ~1min |
| **`test-saas`** | E2B SaaS + ** PR  19 live LLM e2e** | ~10min |
| `test-selfhost` | E2B  sandbox | ~5min |
| `codecov/patch` |  ≥80% |  |

### test-saas  GitHub Secrets / Variables

```
secrets:
  LLM_API_KEY                          #  LLM key (14.103 )
  E2B_API_KEY                          # E2B SaaS
  LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY  # 
  NORTHGATE_API_KEY                    #  (PR-C.2): northgate.xiaobei.top 
  TOKEN_MATRIX_GATEWAY_GEMINI_API_KEY  #  (PR-C.2): 14.103  Gemini  (paid tier)

variables:
  LLM_BASE_URL = http://14.103.60.158:3001/v1
  LLM_MODEL = nex-agi/deepseek-v3.1-nex-1
  LANGFUSE_HOST = https://langfuse.xiaobei.top/
```

PR-C.2  ci.yml ：
```yaml
NEXAU_RUN_LIVE_LLM_TESTS: "1"
GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
NORTHGATE_API_KEY: ${{ secrets.NORTHGATE_API_KEY }}
TOKEN_MATRIX_GATEWAY_GEMINI_API_KEY: ${{ secrets.TOKEN_MATRIX_GATEWAY_GEMINI_API_KEY }}
```

###  e2e（）

```bash
TOKEN_MATRIX_GATEWAY_GEMINI_API_KEY=<key>  \
NORTHGATE_API_KEY=<key>                    \
NEXAU_RUN_LIVE_LLM_TESTS=1                 \
LLM_API_KEY=ignored                        \
uv run pytest tests/integration/test_aggregator_live_e2e.py -v

# : 23 passed in ~95s
```

---

## 

|  | OpenAI Chat | OpenAI Responses | Anthropic | Gemini |
|---|---|---|---|---|
| Happy path (sync) | ✅ | ✅ | ✅ | ✅ |
| Tool calling | ✅ | ✅ | ✅ | ✅ |
| Reasoning/thinking | ✅ (deepseek-v4-pro) | ✅ (relaxed) | ✅ (thinking + sig) | ✅ (3.1-pro) |
| Async variant | ✅ | ✅ | ✅ | ✅ |
| **Tracing branch** | ✅ | ✅ | ✅ | ✅ |
| Multi-chunk (long) | ✅ | — | ✅ | — |
| shutdown_event break | ✅ | — | — | — |

**Mock unit  case**（22 ）：
- `_maybe_wrap_stream_idle_timeout` × 6（httpx/requests/builtin/duck-typed timeout + 2 negative）
- `_get_event_emitter` × 3（chain walk + no-op fallback）
- `_resolve_run_id` × 3
- `_chat_completion_to_model_response` × 2（ + ValueError on empty）
- `_process_stream_chunk` × 4（drop / mutate / no-op）
- Anthropic aggregator edge cases × 4（truncated /  block_start / fragmented JSON / invalid JSON fallback）

---

## ⚠️  Pre-existing Flake（****）

### 1. `test_thinking_cross_validation_langfuse::test_task_b_thinking_logic_computation`
- ****： LLM  `120 + 180 + 360`， 600（ 660）， ` < 1.0` 
- ****：deepseek-v3.1-nex-1 、（ LLM  flake）
- ** PR-C.2 **： issue [#516](https://github.com/china-qijizhifeng/nexau/issues/516)

### 2. `test_interrupt_persistence::test_finally_flush_on_cancelled_error`
- ****：asyncio cancellation timing flake
- ** PR-C.2 **： issue 

### 3. test-selfhost E2B sandbox （>120s）
- ****：socket connect  prod-e2b.xiaobei.top 
- ****：infra 
- ** issue**：[#517](https://github.com/china-qijizhifeng/nexau/issues/517)

### CI 
test-saas  →  #516 / #517 / interrupt_persistence flake →  re-run；。

---

## Follow-up issues（****，PR-C.2 ）

| Issue |  |  |
|---|---|---|
| [#515](https://github.com/china-qijizhifeng/nexau/issues/515) | refactor: Gemini base_url （ substring-match ） | P2 |
| [#516](https://github.com/china-qijizhifeng/nexau/issues/516) | flake: thinking_cross_validation  | P3 |
| [#517](https://github.com/china-qijizhifeng/nexau/issues/517) | ci: E2B sandbox  | P2 |

---

## RFC-0023 

RFC-0023 § ③ ，**RFC-0022 Phase 2**（iter-level ）。

- [PR #503](https://github.com/china-qijizhifeng/nexau/pull/503)：RFC-0022 Phase 1（）——  RFC-0023 stack ****，， rebase +  CI
- RFC-0022 Phase 2 PR：， main， #503  `idempotency_key` / `RUN_START`  RFC-0023 

---

##  reviewer 

### #508 (PR-A)
- parity test ：3-axis（ /  / vendor truth）
-  fixture  SSE ：

### #510 (PR-B)
- `ModelCallFinishedEvent` schema  AG-UI 
- 「Occam pass」 `usage` / `provider_extras` ， event 

### #513 (PR-C.1)
- `build()`  vendor  dict 
- axis-4 parity（byte-equal）

### #514 (PR-C.2)
- ** review **：`llm_caller.py` 8  call site  swap， sync + async 
- ****：`_chat_completion_to_model_response` ——  review  OpenAI Chat shape mismatch 
- ****：23 e2e + 22 unit， case
- ****：`tests/aggregator_parity/` axis 1/2/4，`tests/unit/` 8  Set B ，

---

##  PR-C.2 

```bash
TOKEN_MATRIX_GATEWAY_GEMINI_API_KEY=<key> \
NORTHGATE_API_KEY=<key> \
NEXAU_RUN_LIVE_LLM_TESTS=1 \
LLM_API_KEY=ignored \
uv run pytest tests/integration/test_aggregator_live_e2e.py \
              tests/unit/test_llm_caller_helpers.py \
              -v --tb=short

# : 45 passed in ~100s
```