# RFC-0011:  Token Usage 

- ****: draft
- ****: P1
- ****: `architecture`, `observability`, `dx`
- ****: `nexau/archs/main_sub/execution/`, `nexau/archs/llm/llm_aggregators/`, `nexau/archs/session/`, `nexau/archs/tracer/`, `nexau/core/`
- ****: 2026-03-16
- ****: 2026-03-16

## 

 NexAU  token usage  `JsonDict | None`（`dict[str, Any]`），、 usage 。 RFC ：

1. **** — `TokenUsage`  dataclass， dict；
2. **Provider ** —  `_normalize_usage()`  `TokenUsage`， OpenAI / Anthropic / Gemini / ；
3. **** — `UsageAccumulator`  Agent → Sub-Agent ， token budget ；
4. **** —  `UsageEvent`， `AgentEventsMiddleware` ；`SessionManager`  run-level 。

 LLM  token 、、， `ModelResponse` / middleware / tracer 。

> **Scope **：（cost estimation / pricing table / dollar budget） RFC ， RFC 。

---

## 

### 1) Usage  dict ，

 `ModelResponse.usage`  `JsonDict | None`（ `dict[str, Any] | None`）， `.get("input_tokens", 0)` 。 "Zero `Any`" ，：

- IDE  usage ，；
- ：（ `"imput_tokens"`）；
- `_normalize_usage()`  `dict[str, Any] | None`， dict。

### 2)  / Agent  usage 

 usage  `ModelResponse` ：

-  run （iteration） token ；
- Sub-agent  usage  parent ；
- `SessionManager`  history  usage 。

OpenHands  `Metrics`  agent controller ；OpenCode  session-level `getUsage()` 。NexAU 。

### 3)  usage 

`AgentEventsMiddleware`  text / tool_call / thinking ， usage 。（ transport  UI） token ， run  `ModelResponse` 。

---

## 

### 

```
┌─────────────────────────────────────────────────────────┐
│                   Layer 4:  &                   │
│  UsageEvent → AgentEventsMiddleware → Transport/UI      │
│  Message.metadata["usage"]  ( history )        │
└────────────────────────┬────────────────────────────────┘
                         │ emits / persists
┌────────────────────────▼────────────────────────────────┐
│              Layer 3:                           │
│  UsageAccumulator (per Agent)                           │
│    .record(token_usage)                                 │
│    .merge_child(child_accumulator)                      │
│    .check_budget() → over_token / ok                    │
└────────────────────────┬────────────────────────────────┘
                         │ consumes
┌────────────────────────▼────────────────────────────────┐
│              Layer 2: Provider                      │
│  _normalize_usage() → TokenUsage (not dict)             │
└────────────────────────┬────────────────────────────────┘
                         │ normalizes
┌────────────────────────▼────────────────────────────────┐
│              Layer 1:                         │
│  TokenUsage    —  token                        │
│  UsageSummary  — run-level                       │
└─────────────────────────────────────────────────────────┘
```

### 

#### Layer 1: 

 `nexau/core/usage.py`， frozen dataclass。

##### `TokenUsage`

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TokenUsage:
    """Immutable, type-safe token count snapshot.

    RFC-0011:  token ， JsonDict | None。

    All fields default to 0 so callers never need null-checks.
    Provider-specific extras (e.g. Anthropic cache tokens) are stored
    as explicit fields to allow precise accumulation via __add__.
    """

    input_tokens: int = 0
    """Prompt / input tokens (including cache contributions when applicable)."""

    completion_tokens: int = 0
    """Output / completion tokens."""

    reasoning_tokens: int = 0
    """Tokens consumed by chain-of-thought / extended thinking (0 if not applicable)."""

    total_tokens: int = 0
    """Grand total. If the provider supplies it, use theirs; otherwise sum of above."""

    cache_creation_tokens: int = 0
    """Anthropic: tokens written to prompt cache in this request."""

    cache_read_tokens: int = 0
    """Anthropic: tokens read from prompt cache in this request."""

    input_tokens_uncached: int = 0
    """Base input tokens excluding cache contributions (Anthropic accounting)."""

    def __add__(self, other: TokenUsage) -> TokenUsage:
        """Element-wise addition for accumulation."""
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            cache_creation_tokens=self.cache_creation_tokens + other.cache_creation_tokens,
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            input_tokens_uncached=self.input_tokens_uncached + other.input_tokens_uncached,
        )

    def to_dict(self) -> dict[str, int]:
        """Serialize to plain dict for JSON / tracer compatibility."""
        ...
```

** —  frozen dataclass  Pydantic**：

- `TokenUsage` ， API validation；
- frozen ，；
- slots=True （）；
-  `ModelToolCall`、`ModelResponse`  dataclass 。

** —  cache  extras dict**：

- Anthropic cache tokens  `_normalize_usage()` ，、；
-  `__add__` ，extras dict ；
-  provider （ audio tokens）， extras。

##### `UsageSummary`

```python
@dataclass(frozen=True, slots=True)
class UsageSummary:
    """Run-level usage summary, persisted to session storage.

    RFC-0011:  run  UsageAccumulator 。
    """

    run_id: str
    agent_name: str
    total_usage: TokenUsage
    llm_call_count: int = 0
    child_summaries: tuple[UsageSummary, ...] = ()
    """Sub-agent summaries, forming a recursive tree mirroring the agent hierarchy."""
```

##### Provider 

| Provider          | input_tokens | completion_tokens | reasoning_tokens | cache_creation | cache_read | total_tokens |
|-------------------|:------------:|:-----------------:|:----------------:|:--------------:|:----------:|:------------:|
| OpenAI Chat       | prompt_tokens | completion_tokens | completion_tokens_details.reasoning_tokens | — | — | total_tokens |
| OpenAI Responses  | input_tokens  | output_tokens     | reasoning_tokens  | — | — | total_tokens |
| Anthropic         | input_tokens  | output_tokens     | — (thinking tokens billed as output) | cache_creation_input_tokens | cache_read_input_tokens | input + output |
| Gemini REST       | promptTokenCount | candidatesTokenCount | thoughtsTokenCount | — | — | totalTokenCount |
| OpenAI-compatible | prompt_tokens | completion_tokens | varies | — | — | total_tokens |

> ****：Anthropic  extended thinking tokens  `output_tokens`， reasoning_tokens。`_normalize_usage()`  `completion_tokens_details`  `output_tokens_details`  reasoning_tokens， Anthropic  0。

#### Layer 2: Provider 

 `nexau/archs/main_sub/execution/model_response.py`：

##### `_normalize_usage()`  `TokenUsage`

```python
from nexau.core.usage import TokenUsage


def _normalize_usage(usage: dict[str, object] | None) -> TokenUsage:
    """Normalize provider-specific usage dict into canonical TokenUsage.

    RFC-0011: ， from_openai_message / from_anthropic_message /
    from_openai_response / from_gemini_rest 。

    Returns TokenUsage (never None) —  usage  TokenUsage()。
    """
    if usage is None:
        return TokenUsage()

    # ... ， TokenUsage  dict ...
    return TokenUsage(
        input_tokens=direct_input,
        completion_tokens=completion,
        reasoning_tokens=reasoning,
        total_tokens=total,
        cache_creation_tokens=cache_creation,
        cache_read_tokens=cache_read,
        input_tokens_uncached=uncached,
    )
```

****：`ModelResponse.usage`  `JsonDict | None`  `TokenUsage`。 `TokenUsage`  `to_dict()`，（tracer adapters、middleware） `.get()`， `__getitem__` / `get` 。（）。

#### Layer 3: 

 `nexau/core/usage.py`  `UsageAccumulator` 。

```python
import threading
from enum import Enum


class BudgetStatus(Enum):
    OK = "ok"
    OVER_TOKEN = "over_token"


class UsageAccumulator:
    """Thread-safe, per-agent token accumulator.

    RFC-0011: ， Agent/Executor 。

    # 1. Executor  LLM  record()
    # 2. Sub-agent  merge_child()
    # 3. Run  snapshot()  UsageSummary
    """

    def __init__(
        self,
        agent_name: str,
        run_id: str,
        token_budget: int | None = None,
    ) -> None:
        self._lock = threading.Lock()
        self._agent_name = agent_name
        self._run_id = run_id
        self._token_budget = token_budget

        self._total_usage = TokenUsage()
        self._llm_call_count = 0
        self._children: list[UsageSummary] = []

    def record(self, usage: TokenUsage) -> None:
        """Record a single LLM call's usage.

        RFC-0011:  Executor  after_model hook 。
        ：sub-agent 。
        """
        with self._lock:
            self._total_usage = self._total_usage + usage
            self._llm_call_count += 1

    def merge_child(self, child_summary: UsageSummary) -> None:
        """Merge a completed sub-agent's summary into this accumulator.

        RFC-0011:  SubAgentManager  agent 。
         usage  parent total， summary 。
        """
        with self._lock:
            self._total_usage = self._total_usage + child_summary.total_usage
            self._children.append(child_summary)

    def check_budget(self) -> BudgetStatus:
        """Check whether token budget is exceeded.

        RFC-0011:  Executor 。
        ，（warning / stop / compact）。
        """
        with self._lock:
            if self._token_budget is not None and self._total_usage.total_tokens >= self._token_budget:
                return BudgetStatus.OVER_TOKEN
            return BudgetStatus.OK

    @property
    def total_usage(self) -> TokenUsage:
        """Current cumulative usage (read-only snapshot)."""
        with self._lock:
            return self._total_usage

    def snapshot(self) -> UsageSummary:
        """Create an immutable summary of current state.

        RFC-0011:  Executor  run ， SessionManager 。
        """
        with self._lock:
            return UsageSummary(
                run_id=self._run_id,
                agent_name=self._agent_name,
                total_usage=self._total_usage,
                llm_call_count=self._llm_call_count,
                child_summaries=tuple(self._children),
            )
```

** ContextCompactionMiddleware **：

`ContextCompactionMiddleware` ** run **（" token  prompt"）。`UsageAccumulator` ****（" token"）。：

- compaction  `max_context_tokens` vs  history token ；
- budget  `token_budget` vs  `total_tokens`。

#### Layer 4: 

##### 4a. Usage 

 `UsageUpdateEvent`  `nexau/archs/llm/llm_aggregators/events.py`：

```python
@dataclass
class UsageUpdateEvent(Event):
    """Emitted after each LLM call with token usage data.

    RFC-0011:  AgentEventsMiddleware  after_model hook 。
    Transport  UI， token 。
    """

    type: str = field(default="USAGE_UPDATE", init=False)
    usage: TokenUsage = field(default_factory=TokenUsage)
    cumulative_usage: TokenUsage = field(default_factory=TokenUsage)
    iteration: int = 0
```

 `UsageSummaryEvent`  run ：

```python
@dataclass
class UsageSummaryEvent(Event):
    """Emitted when a run finishes, carrying the complete UsageSummary tree.

    RFC-0011:  AgentEventsMiddleware  RunFinishedEvent 。
    """

    type: str = field(default="USAGE_SUMMARY", init=False)
    summary: UsageSummary = field(default_factory=lambda: UsageSummary(run_id="", agent_name="", total_usage=TokenUsage()))
```

##### 4b. History ：`Message.metadata["usage"]`

 assistant  LLM  `TokenUsage`  `metadata`。`Message.metadata`  `response_items`、`thought_signature` ，usage 。

```python
# executor.py —  assistant message  usage
assistant_msg = response.to_ump_message()
assistant_msg.metadata["usage"] = response.usage.to_dict()
history.append(assistant_msg)
```

：

- ** schema **：`Message.metadata`  `dict[str, Any]`，`HistoryList.flush()` → `AgentRunActionModel.append_messages`  metadata， ORM ；
- **history replay  usage**： usage，；
- **run/session **： run_id  assistant messages  `metadata["usage"]`  run ，；
-  `response_items`、`thought_signature`  metadata 。

###### 

```python
class SessionManager:
    async def get_run_usage(self, session_id: str, run_id: str) -> TokenUsage:
        """Compute run-level usage by summing assistant message metadata.

        RFC-0011:  run_id  AgentRunActionModel 
        assistant messages， metadata["usage"]。
        """
        ...

    async def get_session_total_usage(self, session_id: str) -> TokenUsage:
        """Aggregate all runs' usage into a session-level total.

        RFC-0011:  session  run  assistant messages，
         metadata["usage"]。 session 。
        """
        ...
```

###### 

```
LLM  ModelResponse ( TokenUsage)
    │
    ├─→ Message.metadata["usage"] = usage.to_dict()    #  metadata
    │       └─→ history.append(msg)
    │             └─→ HistoryList.flush()
    │                   └─→ AgentRunActionModel.append_messages  #  metadata
    │
    └─→ accumulator.record(usage)                       # 
          └─→ run  accumulator.snapshot()          #  + 
```

##### 4c. Executor 

```python
# executor.py  —  UsageAccumulator 

class Executor:
    def execute(self, config, messages, agent_state, global_storage) -> ExecutorOutput:
        # 1.  accumulator
        accumulator = UsageAccumulator(
            agent_name=config.name,
            run_id=agent_state.run_id,
            token_budget=config.token_budget,
        )
        agent_state.usage_accumulator = accumulator

        for iteration in range(max_iterations):
            # 2. Budget 
            status = accumulator.check_budget()
            if status != BudgetStatus.OK:
                #  warning event，
                ...

            # 3. LLM 
            response = llm_caller.call(messages, llm_config)

            # 4.  usage
            usage: TokenUsage = response.usage  #  TokenUsage
            accumulator.record(usage)

            # 5.  assistant message metadata
            assistant_msg = response.to_ump_message()
            assistant_msg.metadata["usage"] = usage.to_dict()
            history.append(assistant_msg)

            # 6.  UsageUpdateEvent
            emit(UsageUpdateEvent(
                usage=usage,
                cumulative_usage=accumulator.total_usage,
                iteration=iteration,
            ))

            # ... tool execution, history update ...

        # 7. Run ， summary 
        summary = accumulator.snapshot()
        emit(UsageSummaryEvent(summary=summary))

        # 8. flush history（usage  assistant message metadata ，）
        history.flush()

        return ExecutorOutput(content=..., usage_summary=summary)
```

##### 4d. Sub-Agent 

```python
# subagent_manager.py 

async def call_sub_agent(agent_name, message, agent_state, global_storage):
    # Sub-agent  summary
    result = await sub_agent.run_async(message)
    child_summary = result.usage_summary

    #  parent accumulator 
    parent_accumulator = agent_state.usage_accumulator
    parent_accumulator.merge_child(child_summary)
```

#### Tracer 

`langfuse.py`  `_sanitize_usage()`  `TokenUsage.to_dict()`， int 。

```python
def _sanitize_usage(usage: Mapping[str, object]) -> dict[str, int]:
    return {k: v for k, v in usage.items() if isinstance(v, int)}

def _sanitize_usage(usage: TokenUsage) -> dict[str, int]:
    return usage.to_dict()
```

#### AgentConfig 

```yaml
# agent.yaml
name: my_agent
llm_config:
  model: claude-sonnet-4-6
  ...

# RFC-0011:  budget 
token_budget: 1000000        #  token （ sub-agents）
budget_action: warn           # warn | stop ()
```

### 

####  run  usage summary

```python
agent = Agent(config=config, session_manager=session_mgr)
result = agent.run("Hello")

#  result 
summary = result.usage_summary
print(f"Tokens: {summary.total_usage.total_tokens}")
print(f"Input: {summary.total_usage.input_tokens}")
print(f"Completion: {summary.total_usage.completion_tokens}")
print(f"LLM calls: {summary.llm_call_count}")

#  session 
summaries = await session_mgr.get_usage_summaries(session_id)
for s in summaries:
    print(f"Run {s.run_id}: {s.total_usage.total_tokens} tokens")
```

####  usage 

```python
def handle_event(event: Event):
    match event:
        case UsageUpdateEvent():
            print(f"[iter {event.iteration}] +{event.usage.total_tokens} tokens, "
                  f"cumulative: {event.cumulative_usage.total_tokens}")
        case UsageSummaryEvent():
            print(f"Run total: {event.summary.total_usage.total_tokens} tokens")

agent.run("Complex task", event_handlers=[handle_event])
```

#### Token budget 

```yaml
name: budget_agent
llm_config:
  model: claude-opus-4-6
token_budget: 500000
budget_action: stop
```

 token  500k ，Executor 。

---

## 

### 

#### A.  dict， TypedDict

```python
class TokenUsageDict(TypedDict):
    input_tokens: int
    completion_tokens: int
    ...
```

****：TypedDict  dict， `__add__`、、。，。

#### B.  Pydantic BaseModel

****：`TokenUsage` （ LLM ），Pydantic 。 codebase  `ModelToolCall`、`ModelResponse`  stdlib dataclass，。

#### C. OpenHands ： Metrics 

OpenHands  `Metrics` 。****：

-  NexAU  multi-agent / multi-session ；
-  Agent/Executor  accumulator ， agent 。

### 

1. **`ModelResponse.usage` **： `JsonDict | None`  `TokenUsage`  breaking change。 `ModelResponse`  API（ `nexau.core` ），。
2. ****： LLM  `TokenUsage` 。`slots=True` ， LLM 。

---

## 

### 

- [ ] **Phase 1: ** — `nexau/core/usage.py`（`TokenUsage`, `UsageSummary`, `BudgetStatus`）
- [ ] **Phase 2: ** — `_normalize_usage()`  `TokenUsage`；`ModelResponse.usage`  `TokenUsage`；
- [ ] **Phase 3: UsageAccumulator** — 、Executor 、SubAgentManager 
- [ ] **Phase 4: ** — `UsageUpdateEvent`、`UsageSummaryEvent`、AgentEventsMiddleware 
- [ ] **Phase 5: ** — `Message.metadata["usage"]` 、SessionManager （`get_run_usage` / `get_session_total_usage`， ORM schema ）
- [ ] **Phase 6: Token Budget** — `AgentConfig` 、Executor budget 

### 

- `nexau/core/usage.py` — ： + 
- `nexau/archs/main_sub/execution/model_response.py` — ：`_normalize_usage()`  `TokenUsage`，`ModelResponse.usage` 
- `nexau/archs/main_sub/execution/executor.py` — ： `UsageAccumulator`
- `nexau/archs/main_sub/execution/subagent_manager.py` — ： agent summary 
- `nexau/archs/llm/llm_aggregators/events.py` — ：`UsageUpdateEvent`、`UsageSummaryEvent`
- `nexau/archs/main_sub/execution/middleware/agent_events_middleware.py` — ： usage 
- `nexau/archs/session/` — ：SessionManager  `get_run_usage()` / `get_session_total_usage()` （ message metadata ， schema ）
- `nexau/archs/tracer/adapters/langfuse.py` — ： `TokenUsage` 
- `nexau/archs/main_sub/execution/middleware/round_and_token_reminder.py` — ： accumulator 

---

## 

### 

- `TokenUsage.__add__` （ cache ）
- `TokenUsage.to_dict()` 
- `_normalize_usage()`  OpenAI / Anthropic / Gemini / None 
- `UsageAccumulator.record()` / `merge_child()` / `check_budget()` / `snapshot()` 
- `BudgetStatus` 

### 

-  Agent.run()  `result.usage_summary` 
- Sub-agent ：parent summary  child summaries，total 
- Token budget stop： token_budget， agent 
- Event stream： event_handler， `UsageUpdateEvent` / `UsageSummaryEvent` 
- ：assistant message `metadata["usage"]`  `HistoryList.flush()`  DB，reload  metadata 
- Session ：`get_run_usage()`  message metadata ，`get_session_total_usage()`  run 

### 

-  `RoundAndTokenReminderMiddleware`  token  accumulator 
- Langfuse dashboard  usage  `UsageSummary` 

---

## 

1. **Streaming usage**： provider（OpenAI Streaming） stream  chunk  usage， `llm_aggregators` 。， Phase 2 。

2. **Image / audio token **：Gemini  OpenAI  token （Gemini  `cachedContentTokenCount`，OpenAI  `prompt_tokens_details`  `audio_tokens` / `image_tokens`）。Phase 1 ， `TokenUsage` 。

3. **Responses API `include` **：OpenAI Responses API  `include=["usage"]`  usage。 `llm_aggregators` ？。

4. ** session  budget**： budget  per-run。 per-session  per-user  budget？， `SessionManager.get_session_total_usage()` 。

---

## 

- **OpenHands** `openhands/llm/metrics.py` — `TokenUsage` dataclass, `Metrics` 
- **OpenCode** `packages/core/src/session/usage.ts` — 4  usage , `getUsage()` , provider 
- **NexAU ** `nexau/archs/main_sub/execution/model_response.py` — `_normalize_usage()`, `_coerce_usage()`
- **NexAU tracer** `nexau/archs/tracer/adapters/langfuse.py` — `_sanitize_usage()`
- **NexAU events** `nexau/archs/llm/llm_aggregators/events.py` — `CompactionStartedEvent`, `CompactionFinishedEvent`
- **NexAU token counter** `nexau/archs/main_sub/utils/token_counter.py` — `TokenCounter` (context window counting, orthogonal to usage accounting)