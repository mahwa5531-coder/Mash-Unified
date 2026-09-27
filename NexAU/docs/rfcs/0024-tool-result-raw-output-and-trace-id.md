# RFC-0024: ToolResultBlock raw_output + RunStartExtra.trace_id（LLM/UI ）

- ****: draft
- ****: P1
- ****: `architecture`, `persistence`, `llm`, `observability`
- ****: nexau core (`messages.py` schema, `tool_executor.py`, `agent.py` run lifecycle)、 nexau （NAC、coder、workbench、OSS）
- ****: 2026-05-07
- ****: 2026-05-07

## 

nexau  run  **event channel  / persisted channel ** ， SSOT （ NAC RFC-0088 v2） `nexau_agent_run_actions`  live event  UI 。 RFC ：

1. **`ToolResultBlock.raw_output: dict | None`**： dict ，`returnDisplay`  `tool_executor` strip  `raw_output`。`ToolCallResultEvent`  `raw_output` 。
2. **`RunStartExtra.trace_id`  populate**：`agent.run()`  OTel span context  W3C trace id  `RUN_START.extra.trace_id`，`RUN_STARTED` event 。

， 100%  live UI；（NAC gateway  `_trace_id` stamp ）。

## 、

### 1.1 

nexau  chat  `ToolCallResultEvent` （`{tool_use_id, raw, returnDisplay, ...}`）， `tool_executor.py` ：

```python
# tool_executor.py:368-373
raw_output.pop("returnDisplay", None)
llm_tool_output = self._strip_display_only_from_llm_output(llm_tool_output)
return ToolExecutionResult(raw_output=raw_output, llm_tool_output=llm_tool_output)
```

 `llm_tool_output`  RFC-0017  XML formatter ， `ToolResultBlock.content`。 `nexau_agent_run_actions.append_messages[*].content[*]`  tool_result ——`returnDisplay`、 dict （`output_dir`、`stdout_file`、`exit_code`  meta）。

### 1.2 SSOT 

（ NAC playground） `nexau_agent_run_actions`  UI ：
-  replay ，`returnDisplay`  → 
- `output_dir` / `stdout_file`  → "" UI affordance 
-  formatter（RFC-0017 §3.4） UI  opaque →  typed 

"persisted ⊇ event" SSOT ， live  replay —— chat  UI hint，。

### 1.3 trace_id 

`RunStartExtra` schema  RFC-0022 Phase 1  `trace_id: str | None` ， `agent.run()`  `create_run_start()`  populate（ DB 200+ run_start  `extra->>'trace_id'`  NULL）。

`RUN_STARTED` event  `trace_id` 。 "View Trace" （ NAC  gateway  traceparent  stamp  live event  `_trace_id` —— in-memory，，）。

### 1.4 

 nexau  reverse-engineer ，：
- NAC：gateway tap stamp `_trace_id`、 XML envelope unwrap → JSON
-  coder / workbench / OSS  returnDisplay 

 LLM/UI ， nexau  library "、"。`returnDisplay`  nexau  LLM/UI ， ephemeral event channel ，。

## 、

### 2.1 

#### 2.1.1 `ToolResultBlock.raw_output` 

```python
# nexau/core/messages.py
class ToolResultBlock(BaseModel):
    type: Literal["tool_result"] = "tool_result"
    tool_use_id: str
    is_error: bool = False
    content: str | list[TextBlock | ImageBlock]  # ← , formatter , LLM 

    # ：tool  ToolExecutor.finalize_tool_execution 
    # （dict / list / None）。Schema  dict | list | None  Pydantic
    # 。UI ：
    #   - raw_output["returnDisplay"]    returnDisplay 
    #   - raw_output["duration_ms"]      meta
    #   - raw_output["output_dir"]       affordance
    #   - 
    # ： finalize_tool_execution 
    # ``{"result": "..."}``， trivial wrapping —— 
    #  "raw" ，UI  trivial wrapping  filter。
    raw_output: dict[str, Any] | list[Any] | None = None
```

：`raw_output is None`  `model_dump(exclude_none=True)`  JSON， schema 。

#### 2.1.2 `RunStartExtra.trace_id`  populate

schema （RFC-0022 Phase 1 ）， call site ：

```python
# nexau/archs/main_sub/agent.py  history_list.py  persist_run_start 
import opentelemetry.trace as ot_trace

def _current_trace_id() -> str | None:
    """Extract W3C trace id (32-hex) from current OTel span context, or None."""
    span = ot_trace.get_current_span()
    if span is None:
        return None
    ctx = span.get_span_context()
    if not ctx.is_valid:
        return None
    return format(ctx.trace_id, "032x")

# create_run_start ：
extra = RunStartExtra(
    user_message_blocks=user_message_blocks,
    fresh_context=fresh_context,
    trace_id=_current_trace_id(),  # ← 
)
```

`RUN_STARTED` event  `trace_id` ：

```python
class RunStartedEvent(BaseEvent):
    type: Literal["RUN_STARTED"] = "RUN_STARTED"
    run_id: str
    root_run_id: str
    agent_id: str
    thread_id: str
    parent_run_id: str | None = None
    trace_id: str | None = None  # ← 
    # ...
```

### 2.2 

#### 2.2.1 `tool_executor.py`  strip returnDisplay

：

```python
#  tool_executor.py:368-373
raw_output.pop("returnDisplay", None)
llm_tool_output = self._strip_display_only_from_llm_output(llm_tool_output)
```

：

```python
# llm_tool_output  strip — LLM  returnDisplay（ token ）
llm_tool_output = self._strip_display_only_from_llm_output(llm_tool_output)

# raw_output  strip —  ToolResultBlock.raw_output
# returnDisplay  raw_output ，UI 
#  ToolResultBlock ：
#   ToolResultBlock(
#       tool_use_id=tool_use_id,
#       content=llm_tool_output,          # formatter （XML / ）
#       raw_output=raw_output if isinstance(raw_output, dict) else None,
#       is_error=...,
#   )
```

#### 2.2.2 `ToolCallResultEvent`  raw_output 

```python
# AgentEventsMiddleware.after_tool（ emit point）
ToolCallResultEvent(
    tool_call_id=tool_use_id,
    raw=raw_output,                                    #  ToolResultBlock.raw_output
    returnDisplay=raw_output.get("returnDisplay") if isinstance(raw_output, dict) else None,
    ...
)
```

 `ToolCallResultEvent.returnDisplay` ， `raw.get("returnDisplay")`，****。

### 2.3 

 `raw_output`  optional + default None， reader （pydantic `extra='allow'` ）→ ， schema 。

：
-  `raw_output`  ToolResultBlock ：consumer  fallback（NAC  XML envelope unwrap ）
- ： backfill ， `content`  XML envelope  unwrap  `raw_output`。，。

### 2.4 

nexau  library， Rust（NAC）、TypeScript（NAC frontend）、Python（OSS / coder / workbench）。schema ：

- pydantic `extra='allow'`  → Python  OK
- Rust serde：`#[serde(default)]` + `Option<T>`  →  OK
- TypeScript：`raw_output?: Record<string, unknown>` → tsc 

，nexau bump minor ，。

## 、

### 3.1 

|  |  |
|---|---|
| **，** | ，； formatter ；NAC  in-memory `_trace_id` map / tab  |
| ** `content`  dict（ LLM  raw）** |  RFC-0017 （content  LLM-ready ， token ）， |
| ** `metadata: dict` ** | schema ； consumer ； RFC  typed `raw_output`（） |
| ** nexau， NAC  UI ** |  RFC-0088 v2 §1.1  |
| **trace_id  event channel transitional** |  NAC ， /  tab ； RFC  |

### 3.2 

1. ****：tool_result  ~30% （dict ）。 message body ， KB ，。 raw_output（>16KB） truncate。
2. **schema **： schema 。`Optional + default None` ，。
3. **returnDisplay **： `return {"content": ..., "returnDisplay": ...}` ； `event.returnDisplay` （ raw ）。。

### 3.3  RFC-0017 

RFC-0017  **LLM ** （XML formatter  `str(dict)`）。 RFC  **UI ** （raw_output  strip-after-event）。：

- RFC-0017：`content`  LLM 
- RFC-0024：`raw_output`  UI 

formatter ，UI  `content`  parse。

## 、

### Phase 1: schema + populate（，）

- [ ] `nexau/core/messages.py`：`ToolResultBlock`  `raw_output` 
- [ ] `nexau/archs/main_sub/execution/tool_executor.py`： `ToolResultBlock`  raw_output dict ； strip raw_output  returnDisplay
- [ ] `nexau/archs/main_sub/agent.py`：`create_run_start`  OTel span  trace_id  `RunStartExtra.trace_id`
- [ ] `nexau/archs/llm/llm_aggregators/events.py`：`RunStartedEvent`  `trace_id` ， RunStartExtra 
- [ ] `nexau/archs/llm/llm_aggregators/events.py`：`ToolCallResultEvent.raw`  align  `raw_output`，emit  ToolResultBlock 
- [ ] ：roundtrip  raw_output ；trace_id populate  OTel context /
- [ ] CHANGELOG / 

### Phase 2: deprecate strip （， grace period）

- [ ] `tool_executor.py`  deprecation log： emit `returnDisplay`  event ， raw_output； N  raw_output.returnDisplay
- [ ] `ToolCallResultEvent.returnDisplay`  `# deprecated, read raw_output["returnDisplay"]`

### Phase 3:  + 

- [ ] NAC： `_trace_id` map  `RunStartExtra.trace_id`，gateway tap stamp 
- [ ] NAC： returnDisplay  `tool_result.raw_output.returnDisplay`，XML envelope unwrap  fallback only

### Phase 4:  backfill（）

。NAC  `json` （RFC-0017 ），unwrap ；XML  parse。 session  UI 。

## 4.A trace_id （API surface）

`trace_id`  nexau ， nexau library ****。：

### 4.A.1 

- ：`str | None`， W3C 32-hex （ OTel / Langfuse v3 / Jaeger ）
- nexau （ opaque）； W3C ， trace 
- None "/"——

### 4.A.2 nexau library 

- ❌  `opentelemetry.trace.get_current_span()`
- ❌  /  / asyncio ContextVar
- ❌ 
- ❌  `traceparent` header（nexau  HTTP ）

****：：

|  | trace_id  |  |
|---|---|---|
| **NAC** | gateway  `traceparent` header → OTel global →  |  |
| **xiaobei** | `ext.trace.trace_id` body  → `LangfuseTracer` (isolated SdkTracerProvider) | ****——OTel global  httpx auto-instrumentation  span， Langfuse trace  |
| OSS /  |  |  |

 fallback **** trace_id（" trace " trace）—— None 。

### 4.A.3 caller 

-  `agent.run_async(trace_id=...)`  `agent.run(trace_id=...)`
- （Jaeger / Langfuse / ） W3C trace_id 

### 4.A.4 nexau  trace_id 

caller ，nexau  trace_id  `AgentState.trace_id`，****：

- `RunStartExtra.trace_id`（DB ）
- `RunStartedEvent.trace_id`（live SSE event，via `AgentEventsMiddleware.before_agent`）
-  agent  `parent_agent_state.trace_id` 

 live  replay 、root  sub-agent 。

### 4.A.5 

|  |  | （opt-in） | ？ |
|---|---|---|---|
| NAC（agent-runtime） |  |  |  |
| xiaobei（server.py） |  → DB NULL | `current_agent.run(..., trace_id=ext.get("trace", {}).get("trace_id"))` |  NULL（）； DB  |
| OSS /  |  → DB NULL |  |  NULL（） |

** RFC-0024 **——。

## 、

1. ** raw_output **： >16KB / >64KB ？—— KB ，。
2. ** formatter  raw_output **： formatter  dict？ str（raw_output=None）？：，str  None，UI 。
3. ** process trace_id**：sub-agent  thread/task，OTel context ？ `opentelemetry.context.attach()`  ThreadPoolExecutor / asyncio.Task 。
4. ** `model_call_id` / `usage`  SSOT**： `message_metadata.usage` ，OK；`MODEL_CALL_FINISHED.model_name` —— RFC 。

## 、

- [RFC-0017: ](./0017-flatten-tool-output.md) — `content`  LLM-
- [RFC-0022: Agent Run Action Lifecycle](./0022-agent-run-action-lifecycle-and-typed-blocks.md) — `RunStartExtra.trace_id` schema 
- NAC RFC-0088 v2: Run Actions  — SSOT （`docs/rfcs/0088-run-actions-merge.md` §3.5）
- ：north-coder  `nexau.db`，2026-03-16 ~ 2026-05-05，2446  tool_result —— `returnDisplay`  100%  strip，