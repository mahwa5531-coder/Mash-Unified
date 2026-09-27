# RFC-0027: 

- ****: draft
- ****: P1
- ****: `security`, `content-safety`, `middleware`
- ****: `nexau-py`（Agent ）
- ****: 2026-06-04
- ****: 2026-06-04

## 

 NexAU Agent  `SensitiveWordMiddleware`：
LLM //， LLM ，
， Agent Executor 
""，。

## 

 NexAU ：

1. /《》
   ，。
2. （Tool  ad-hoc 、Transport 、
   System Prompt ）：
   - （）
   - 、，
   - ，
3.  `MiddlewareManager`  `wrap_model_call`、`before_model`、
   `after_model` ，""， Executor。

## 

### 

：

1. ****（，）： `HookResult` 
   `force_stop_reason` ， `BeforeModelHookInput`  outparam，
    RFC-0026  `history_event` ——`MiddlewareManager.run_before_model` /
   `run_after_model`  `force_stop_reason` surface  hook_input，
   Executor  hook  BREAK， reason 。
   ****： `AgentStopReason.ERROR_OCCURRED`。

2. ****：
   `nexau/archs/main_sub/execution/middleware/sensitive_word.py`，，
    `before_model` 、`after_model` 。
   `force_stop_reason=ERROR_OCCURRED`  `HookResult`，
   assistant （ / ）。`before_model` 
   Executor  LLM ——。 override
   `set_event_emitter` ，**
   `ContentBlockedEvent`**（//； compaction 
   `CompactionStartedEvent` ， `RunErrorEvent` ，）。
   。

> ： `wrap_model_call` +  `ModelResponse` 
> ；"（AgentStopReason）" provider  DTO，
> ， wrap 。（""）。

，（ `.txt` →
category=``），。
`examples/sensitive_word/sensitive_lexicon/`，（3 ，
3 ），； `lexicon_dir` （ MIT 
[`konsheng/Sensitive-lexicon`](https://github.com/konsheng/Sensitive-lexicon)，
，）。

### 

#### 

```
input  → before_model(scan messages) ── hit? ─► HookResult(force_stop_reason, messages+=refusal)
                                                   │
                       run_before_model surfaces → hook_input.force_stop_reason
                                                   │
            Executor  outparam → BREAK（LLM ），refusal  final_response

output → [LLM ] → after_model(scan original_response) ── hit? ─► HookResult(force_stop_reason, )
                                                   │
   _process_xml_calls_async  run_after_model 、（should_stop=True）
                                                   │
       Executor  hook_input.force_stop_reason → BREAK，refusal  final_response
```

> ：`after_model`  `_process_xml_calls_async` ，
> 、****， tool call 。

#### 

- `SensitiveHit(word, category, start, end)` — 。
- `SensitiveScanResult(text, hits)` — ，
  `matched` / `categories` / `words` 。
- `SensitiveContentBlockedError(source, scan_result)` — 
  `raise_on_block=True` ， Transport 
  （：、 401、）。

#### 

 `.txt`  UTF-8 ：

- 
- 
- `#` 
-  stem  category

#### 

 Aho-Corasick  `_AhoCorasick`：

- `add(word, category)` — 
- `build()` — BFS  fail 
- `scan(text) -> list[SensitiveHit]` — 

 `O(|text| + matches)`， trie ；
， < 50 ms， 1KB  < 1 ms（ 3 ）。

#### 

```python
SensitiveWordMiddleware(
    *,
    lexicon_dir: Path | str | None = None,
    lexicon_file: Path | str | None = None,
    lexicon_words: Iterable[str] | None = None,
    extra_words: Iterable[str] | None = None,
    case_sensitive: bool = False,
    block_input: bool = True,
    block_output: bool = True,
    refusal_template: str = _DEFAULT_REFUSAL_TEMPLATE,
    scan_roles: Iterable[Role] | None = None,  #  USER/FRAMEWORK/SYSTEM/TOOL
    raise_on_block: bool = False,
)
```

> **tool result （A ）**： `scan_roles`  `TOOL`，
> ** `before_model`** 。 `ToolResultBlock`
> （`get_text_content()` ）， `_extract_scan_text` 
> （ str  TextBlock ）。""，
> `ToolCallResultEvent` ；"/"，。

`lexicon_dir` / `lexicon_file` / `lexicon_words` ；。
，" →  →  → extra"， category。

#### 

```
⚠️ ：{source}「{category}」（ {hits}），
。

，。
```

`{source}` """"，`{category}` （
3 ，`/` ），`{hits}` （ 5 ， `… (+N more)` ）。

### 

```python
from nexau.archs.main_sub.execution.middleware.sensitive_word import (
    SensitiveWordMiddleware,
)

agent_config.middlewares.append(
    SensitiveWordMiddleware(lexicon_dir="/opt/nexau/sensitive_lexicon")
)
```

YAML ：

```yaml
middlewares:
  - import: nexau.archs.main_sub.execution.middleware.sensitive_word:SensitiveWordMiddleware
    params:
      lexicon_dir: /opt/nexau/sensitive_lexicon
      case_sensitive: false
      block_input: true
      block_output: true
```

## 

### 

1. ** `before_model`  messages ""** — 
   ，""，。
2. ** `wrap_model_call` +  `ModelResponse`  `force_stop_reason` **
   （ A）— （ 1 ），
   `AgentStopReason`  provider  DTO，，
   `wrap_model_call` ， `before/after_model` 。
   ****： `HookResult.force_stop_reason` （ RFC ），
    2  hook ，。
3. ** `pyahocorasick` C ** — ，；
    Python AC （< 1 ms / ）。
4. ** +  alternation** —  regex compile ，
   。

### 

1. **** — `after_model`  LLM  ModelResponse 
   ， SSE  transport  chunk  `stream_chunk`
   ；""， `stream_chunk` 
   （""）。
2. **//** — ，
   （、、）。
3. **** — ，
   ， `extra_words`  `lexicon_words` 。

## 

### 

- [x] Phase 1:  +  + 。
- [ ] Phase 2:  `docs/advanced-guides/` ； agent
  (`examples/`) 。
- [ ] Phase 3: （`stream_chunk` ）。
- [ ] Phase 4: （Langfuse / Trace  `content_safety.blocked`
  span）。

### 

**：**
- `nexau/archs/main_sub/execution/hooks.py` — `HookResult.force_stop_reason`  +
  `BeforeModelHookInput` outparam + `run_before_model`/`run_after_model` surfacing
- `nexau/archs/main_sub/execution/executor.py` — `_apply_middleware_force_stop`  +
  3 （before_model  / `_process_xml_calls_async`  / after_model ）

>  `ERROR_OCCURRED`， `stop_reason.py`  `agent_events_middleware.py`
> （`ERROR_OCCURRED`  `RunErrorEvent`）。

**：**
- `nexau/archs/llm/llm_aggregators/events.py` —  `ContentBlockedEvent` 
  （ `Event`  + `__all__`）
- `nexau/archs/main_sub/execution/middleware/sensitive_word.py` — ；
   `force_stop_reason=ERROR_OCCURRED`  `set_event_emitter` 
  `ContentBlockedEvent`
- `examples/sensitive_word/sensitive_lexicon/*.txt` — （ 3 ； `lexicon_dir` ）

**：**
- `tests/unit/test_sensitive_word_middleware.py`
- `tests/unit/test_hooks.py`（ surfacing）

## 

### 

1. `_AhoCorasick` （/////）
2. （、、、、case-sensitive 、extra ）
3. `scan_messages` （ASSISTANT ）+ tool result 
   （`Role.TOOL`  `ToolResultBlock`，str / TextBlock ）
4. `before_model`（）： /  `force_stop_reason` +  /
   `block_input=False`  / `raise_on_block`。
5. `after_model`（）： /  +  `force_stop_reason` /
   `block_output=False`  / `raise_on_block`。
6. `MiddlewareManager`：`run_before_model` / `run_after_model`  surface
   `force_stop_reason`  outparam，。
7. ： `ERROR_OCCURRED`；wire  emitter 
   `ContentBlockedEvent`（ run_id / source /  / ）， emitter 
   ，。
8. ： 3 （//） category ，
   。

### 

`TestExecutorIntegration`  `Agent.run` → `execute_async`（mock `call_llm_async`）：

- ：`call_llm_async` ，（ LLM ）。
- ：`call_llm_async` ，，。

 Phase 2 ： `LLMFailoverMiddleware`、`ContextCompactionMiddleware` 。

### 

```bash
uv run pytest tests/unit/test_sensitive_word_middleware.py -v --no-cov
uv run ruff check nexau/archs/main_sub/execution/middleware/sensitive_word.py
uv run pyright nexau/archs/main_sub/execution/middleware/sensitive_word.py
```

## 

1. ""（""/）？
2.  UX：， chunk？
3.  `RunErrorEvent`  `ContentBlockedEvent`？
4. ： `VERSION` 
    hash？

## 

- [konsheng/Sensitive-lexicon](https://github.com/konsheng/Sensitive-lexicon)
  — （MIT License）
- RFC-0003: LLM Failover Middleware —  `wrap_model_call` 
- RFC-0026: History Event Channel Cleanup — `HookResult` / `MiddlewareManager`
  
- Aho-Corasick ：Aho, A.V.; Corasick, M.J. (1975). *Efficient
  string matching: An aid to bibliographic search*.