# RFC-0004: Context  TokenCounter Block 

- ****: draft
- ****: P1
- ****: `architecture`, `runtime`, `dx`, `observability`, `breaking-change`
- ****: `nexau/archs/main_sub/execution/`, `nexau/archs/main_sub/utils/`, `nexau/archs/main_sub/config/`, `nexau/archs/main_sub/`
- ****: 2026-02-26
- ****: 2026-03-06

## 

 RFC ：

1. Token  legacy dict  UMP block （breaking）。
2. ： `max_tokens`， overflow / 。
3. `wrap_model_call`  provider ，“ emergency ”。
4.  compaction （/）， SSE 。
5.  `CONTEXT_TOKEN_LIMIT`  `RunErrorEvent` 。
6.  LLM （`finish_reason` + `raw_message` ）。

---

## 

### 1) Token 

- legacy dict  block ；
- /tool_use/tool_result/reasoning ；
- 。

### 2) 

- ：， provider overflow / ；
- 、。

### 3) 

-  `No response content or tool calls` ， provider ，。

---

## （）

### A. TokenCounter：UMP block （Breaking）

（`nexau/archs/main_sub/utils/token_counter.py`）：

- `count_tokens(messages, tools=None)`  `Sequence[Message]`；
-  dict-like  `TypeError`（）；
-  block ：`text` / `tool_use` / `tool_result` / `image` / `reasoning`；
-  `85 tokens`；
-  schema ；
-  fallback ：
  1. `encoding_for_model(model)`
  2. `get_encoding("o200k_base")`
  3. `get_encoding("cl100k_base")`
  4.  fallback。

### B. 

 emergency fallback ，：

1. `emergency_compact_enabled`（ContextCompactionMiddleware ）
   -  `wrap_model_call`  emergency fallback ；
   -  `before_model` / `after_model` 。

2. 
   - `current_prompt_tokens > max_context_tokens`  warning；
   - `available_tokens`  `max_tokens` ， `1`。

### C.  emergency fallback 

1. （regular）
   - `before_model`： trigger + compaction_strategy ；
   - `after_model`： trigger + compaction_strategy ；
   -  `emergency_compact_enabled` 。

2. emergency （wrap fallback）
   - ：
     - `auto_compact=true`
     - `emergency_compact_enabled=true`
     -  provider context overflow （）
   -  `UserModelFullTraceAdaptiveCompaction`，。
   - ，`compacted_messages`  run  durable working history；
      retry  transient prompt， history
      emergency 。

### D. “” emergency 

：`nexau/archs/main_sub/execution/middleware/context_compaction/compact_stratigies/user_model_full_trace_adaptive.py`

：

1. ：
   - system message（）
   -  `1`  iteration
   -  `tool_use -> tool_result` 
   -  user message
2.  token  50/50 ；
3.  emergency prompt ；
4.  merge ；
5.  `system + merged_summary(framework) + keep_region`；
6.  token gate（ tools），。

：`nexau/archs/main_sub/execution/middleware/context_compaction/prompts/emergency_compact_prompt.md`

### E. 

（`nexau/archs/llm/llm_aggregators/events.py`）：

- `COMPACTION_STARTED`
- `COMPACTION_FINISHED`

：

- `before_model`
- `after_model`
- `wrap_model_call`

SSE （`nexau/archs/transports/http/sse_client.py`）。

### F. 

`AgentEventsMiddleware`  `CONTEXT_TOKEN_LIMIT` ， `RunErrorEvent`。

### G. 

`llm_caller.py` ：

-  OpenAI `finish_reason`  `usage`；
-  tool_calls ，：
  - `finish_reason`
  - `role`
  - `content_len`
  - `tool_calls`
  - `usage`
  - `raw_message` （）。

---

## （Breaking + ）

### 1) TokenCounter （Breaking）

- `TokenCounter.count_tokens(...)` “ legacy dict”“ `Sequence[Message]`”。
- dict  `TypeError`。

### 2)  token_counter （Breaking）

：

```python
def counter(messages: list[dict[str, Any]]) -> int: ...
```

：

```python
from nexau.core.messages import Message

def counter(messages: list[Message], tools: list[dict[str, Any]] | None = None) -> int: ...
```

### 3) /

- `emergency_compact_enabled: bool = True`（ContextCompactionMiddleware ）

### 4) （Breaking）

- `overflow_max_tokens_stop_enabled` ；
- ， overflow / 。

---

##  origin/main （ 2026-03-04）

>  `origin/main` 。

### （M/A/D）

1. 
   - `docs/advanced-guides/context_compaction.md`
   - `rfcs/README.md`
   - `rfcs/0004-context-overflow-emergency-compaction-and-error-events.md`（）

2. 
   - `nexau/archs/main_sub/config/base.py`
   - `nexau/archs/main_sub/config/config.py`
   - `nexau/archs/main_sub/agent.py`
   - `nexau/archs/main_sub/execution/executor.py`
   - `nexau/archs/main_sub/execution/llm_caller.py`
   - `nexau/archs/main_sub/utils/token_counter.py`

3. compaction 
   - `nexau/archs/main_sub/execution/middleware/context_compaction/config.py`
   - `nexau/archs/main_sub/execution/middleware/context_compaction/factory.py`
   - `nexau/archs/main_sub/execution/middleware/context_compaction/middleware.py`
   - `nexau/archs/main_sub/execution/middleware/context_compaction/__init__.py`
   - `nexau/archs/main_sub/execution/middleware/context_compaction/compact_stratigies/__init__.py`

4. 
   - `nexau/archs/llm/llm_aggregators/events.py`
   - `nexau/archs/main_sub/execution/middleware/agent_events_middleware.py`
   - `nexau/archs/transports/http/sse_client.py`

5. 
   - `tests/unit/test_context_compaction.py`（）
   - `tests/e2e/test_emergency_compaction_e2e.py`（）

### （??）

- `nexau/archs/main_sub/execution/middleware/context_compaction/compact_stratigies/user_model_full_trace_adaptive.py`
- `nexau/archs/main_sub/execution/middleware/context_compaction/prompts/emergency_compact_prompt.md`
- `tests/integration/test_wrap_emergency_compaction_integration.py`

>  RFC /，。

---

## （）

### 

- unit test（`tests/unit/`）
- integration test（`tests/integration/`）

### 

-  unit/integration （ e2e ）。

---

## 

1. `wrap_model_call` fallback “provider ”；
   “” overflow。

2. emergency +merge ， attempt ；
   ，。

3.  token （85），。

4.  legacy dict shim （ RFC  TokenCounter ）。

---

## （）

1. “、、 `origin/main` 、”。
2.  breaking change 。
3. 。
4. ： unit/integration。
5.  emergency durable-history ：provider overflow  emergency
    retry，`agent.history` / 
   `compaction_level="emergency"`  summary message。

---

## 

- [RFC-0001: Agent ](./0001-state-persistence-on-stop.md)
- [RFC-0002: AgentTeam —  Agent ](./0002-agent-team.md)
- [RFC ](./WRITING_GUIDE.md)