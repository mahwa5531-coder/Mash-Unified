# RFC-0026: HistoryList  — typed REPLACE  FrameworkContext API + append-only 

- ****: implemented (Stage 1 + Stage 2a)
- ****: P2
- ****: `architecture`, `dx`, `event-sourcing`, `cleanup`, `api`
- ****: NexAU (`HistoryList` / `Executor` / provider serializers / `RoundAndTokenReminderMiddleware` / `ContextCompactionMiddleware` / `HookResult` / `FrameworkContext` / `ModelCallParams`)
- ****: 2026-05-09
- ****: 2026-07-31

## 

 RFC-0022 Phase 3  typed REPLACE 。 "compaction middleware  `agent_state.history.emit_typed_replace(...)` + `adopt_replaced_state`  baseline " ， **HookResult  generic `HistoryEvent` discriminated union → executor  middleware  dispatch by event type → `FrameworkContext.history.replace(...)`  API **。

**FrameworkContext.history  RPC-friendly  API**—— `replace(messages, *, extra)` ， lambda tool  RPC stub。AgentState  deprecation （ `FrameworkContext`）， RFC  `history` 。

****： `HookResult.with_modifications(messages=...)` （additive）。`HistoryList.emit_typed_replace` / `adopt_replaced_state`  wrapper 。**`AgentState.history` **—— production caller， RFC-0022 Phase 3  demo doc 。

Stage 2a  `prompt_messages` 。 `USER`；
 `FRAMEWORK` role。Round/token reminder  FRAMEWORK，
APPEND， USER。 provider  USER/FRAMEWORK 
 user turn，canonical UMP  role、id、content、metadata 。

## 

### Phase 3 

RFC-0022 Phase 3  `CompactAutoVariant` / `UserClearVariant`  typed REPLACE extra， action  " REPLACE  compaction / user clear / focused compact  untyped "，。"middleware "，：

**① `agent_state.history` ** —— `AgentState`  per-execution （`run_id` / `context` / `global_storage` / `sandbox_manager`），Phase 3  `history: HistoryList | None`， middleware 。Middleware  `agent_state.history.emit_typed_replace(...)`， "middleware  HookResult  → executor " 。

**② `adopt_replaced_state` ** —— ，（`emit_typed_replace`），"" reset  list + baseline + pending_messages。：`emit_typed_replace` fire-and-forget ，**** baseline， `flush()` " baseline "→  untyped REPLACE →  compaction  REPLACE 。

**③ Compaction ** —— `ContextCompactionMiddleware`  `before_model` / `after_model`  `_emit_typed_replace_for_compaction(...)`（ A： typed REPLACE +  baseline） `return HookResult.with_modifications(messages=compacted_messages)`（ B： executor  messages）。：
-  A （fire-and-forget ）→  typed REPLACE  → 
- "falls back to fingerprint-diff REPLACE on the next flush"——baseline  A ，flush 

### 

> **HistoryList "transient prompt mutations""persistent history events" channel（`HookResult.messages`）， `flush()`  fingerprint diff  intent。**

，** trade-off **—— compaction  typed extra，"middleware ""HookResult  + executor "。

###  bug

：`round_and_token_reminder`  USER。Executor  working
messages  HistoryList，flush  USER fingerprint  untyped REPLACE。
， UI  compaction。

Stage 2a  UMP  role ： USER， FRAMEWORK。
FRAMEWORK  durable working context， APPEND； role 。
Provider  framework role ， user-shaped content。

## 

### 

 typed REPLACE  `FrameworkContext.history.replace(messages, *, extra)` ** API **，：

```
                                    ┌────────────────────────────────────────┐
hook （regular compaction /     │ HookResult.history_event=ReplaceEvent  │
  /clear / /compact / /undo）   ───▶│   ↓                                    │
                                    │ MiddlewareManager  outparam          │
                                    │   ↓                                    │
                                    │ Executor  hook_input.history_event   │
                                    │   → dispatch by .type:                 │
                                    │     ReplaceEvent → ctx.history.replace │
                                    │     UnknownEvent → skip (forward-compat)│
                                    └────────┬───────────────────────────────┘
                                             │
                                             ▼
                          ┌──────────────────────────────────────┐
                          │ FrameworkContext.history.replace(    │
                          │     messages, extra=variant)         │  ◀──  API
                          │   ↓ ( HistoryList)             │
                          │ HistoryList.replace_all(             │
                          │     messages, replace_extra=variant) │
                          │   -  list                    │
                          │   -  baseline                    │
                          │   - schedule_async typed REPLACE     │
                          └──────────────────────────────────────┘
                                             ▲
                                             │
                                    ┌────────┴─────────────────────────────┐
emergency （wrap_model_call    │ ContextCompactionMiddleware      │
   LLM-retry ）  ─────▶│ params.framework_context.history     │
                                    │   .replace(...) —  API     │
                                    │ （ HookResult， hook ）│
                                    └──────────────────────────────────────┘
```

** FrameworkContext.history  HistoryList**：FrameworkContext  / tool /  lambda tool  API ，narrow /  / RPC-friendly。HistoryList （ `list[Message]` ，、）。"public API → " RFC-0026 。

### 

#### 1. `FrameworkContext.history` ——  API

```python
class HistoryAPI:
    """Write-side typed-event API for agent history.

    RPC-friendly by design — every public method takes only serializable
    arguments (Pydantic Message + ReplaceVariantBase subclass). When
    running in remote-tool mode (lambda / RPC future), this becomes a
    thin RPC stub.
    """
    def replace(
        self,
        messages: list[Message],
        *,
        extra: ReplaceVariantBase,  # required — typed channel only
    ) -> None: ...

class FrameworkContext:
    # ...existing tools / execution APIs...
    history: HistoryAPI  # NEW grouped API
```

****： `replace`。：
-  typed-event  production caller  compaction
- APPEND  executor （`history.append/extend`  list ）， middleware  emit
-  production caller（CLAUDE.md demo ）
- （`append` / `read_messages` / `undo`），"narrow first" " API "

**RPC **： Pydantic ， in-process object handle ——lambda tool  ctx  `replace`  RPC stub。

#### 2. `HookResult.history_event` ——  → executor  typed-event 

```python
# nexau/archs/main_sub/execution/history_events.py (NEW)
class ReplaceEvent(BaseModel):
    type: Literal["replace"] = "replace"
    messages: list[Message]
    extra: ReplaceVariantBase

class AppendEvent(BaseModel):
    type: Literal["append"] = "append"
    messages: list[Message]
    extra: AppendExtra | None = None

class UndoEvent(BaseModel):
    type: Literal["undo"] = "undo"
    before_run_id: str
    extra: UndoExtra | None = None

class UnknownEvent(BaseModel):
    """Forward-compat fallback; old SDK reading new event types lands here."""
    type: str

# Discriminated union over .type, with callable Discriminator that
# routes unknown values to UnknownEvent (vs raising ValidationError).
HistoryEvent = Annotated[
    Annotated[ReplaceEvent, Tag("replace")] |
    Annotated[AppendEvent, Tag("append")] |
    Annotated[UndoEvent, Tag("undo")] |
    Annotated[UnknownEvent, Tag("unknown")],
    Discriminator(_discriminate_history_event),
]

# hooks.py
@dataclass
class HookResult:
    messages: list[Message] | None = None
    # ...  ...
    history_event: HistoryEvent | None = None  # NEW —  slot
```

** `history_event`  `replace_extra`**：

 RFC-0026  `replace_extra: ReplaceVariantBase | None`—— typed REPLACE。 `/undo` ？ `undo_extra` （slot  N  typed slot）， UndoExtra  ReplaceVariantBase（）。

 `history_event` slot + discriminated union ：
-  event type → union  variant，0 caller 
-  SDK  type → fallback  `UnknownEvent`（callable Discriminator ），executor ， crash
-  variant  typed extra，（`isinstance(event, ReplaceEvent)` ）

****： middleware  `messages`  history event（compaction / `/clear` / `/compact <focus>` /  `/undo`），**** `history_event` 。

****： None； middleware  `messages`  `history_event` → executor  fingerprint-diff 。

#### 3. `MiddlewareManager` —— outparam 

`BeforeModelHookInput` / `AfterModelHookInput`  `history_event: HistoryEvent | None = None` （outparam）。`run_before_model` / `run_after_model`  hook  `hook_result.history_event`， `hook_input.history_event`，executor 。

 `run_*`  outparam， stale 。

#### 4. Executor ——  event type dispatch

```python
def _emit_pending_history_event(framework_context, event):
    if event is None:
        return
    if isinstance(event, ReplaceEvent):
        framework_context.history.replace(event.messages, extra=event.extra)
        return
    # AppendEvent / UndoEvent / UnknownEvent:  ctx.history.* 
    # （RFC-0026 "narrow first"）。silently skip——producer 
    #  ctx.history.append/undo  +  dispatch 。
    logger.debug("RFC-0026: skipping history_event %r — no producer wired", type(event).__name__)
```

 `run_before_model` / `run_after_model` ：

```python
messages = self.middleware_manager.run_before_model(before_model_hook_input)
_emit_pending_typed_replace(
    framework_context,
    messages,
    before_model_hook_input.replace_extra,
)
```

** eager-write  end-of-iteration sync**： Phase 3 ——typed REPLACE  `messages_after`  compaction （ assistant response）。 REPLACE  " append "。

#### 5. Emergency  ——  ctx.history.replace

`ContextCompactionMiddleware.wrap_model_call`  LLM ， hook 、 `HookResult`：

```python
if params.framework_context is not None:
    params.framework_context.history.replace(
        compacted_messages,
        extra=self._build_compaction_variant(mode="emergency", ...),
    )
```

 `ModelCallParams.framework_context`（RFC-0026 ） ctx， API。**** `agent_state.history`——AgentState  history 。

 hook-dispatched `ReplaceEvent` ，emergency direct path 
`HookResult` 。 `HistoryAPI.replace(...)` 
direct-replace outbox；`Executor`  `call_llm` / `call_llm_async` 
outbox， working `messages`  `compacted_messages`， assistant
 tool result。： `HistoryList` 
Executor ，run  `_sync_history(...)`  messages 
 typed REPLACE， history 。

#### 6. AgentState ——  history 

AgentState  `agent_context.py` / `framework_context.py` ****（ `FrameworkContext`）。 RFC：
- **** `history: HistoryList | None` 
- （`pending_replace_extra` ）
- Constructor  `history=` 
-  `agent_state.history`  `ctx.history.replace(...)`

 production caller （grep ： RFC-0022 Phase 3  +  demo doc ）。

#### 7. `HistoryList.replace_all(replace_extra=)` —— 

```python
def replace_all(
    self,
    new_messages: list[Message],
    *,
    update_baseline: bool = False,
    replace_extra: ReplaceVariantBase | None = None,  # NEW
) -> None:
    self.clear()
    super().extend(new_messages)
    if self._persistence_enabled:
        self._pending_messages.clear()
        if update_baseline or replace_extra is not None:
            current_non_system = [m for m in self if m.role != Role.SYSTEM]
            self._baseline_fingerprints = self._compute_fingerprints(current_non_system)
        if replace_extra is not None:
            self._schedule_typed_replace(new_messages, replace_extra)
```

****：`replace_extra`  `update_baseline=True`——typed  post-REPLACE ground truth， flush  fingerprint diff 。

#### 8. `emit_typed_replace` / `adopt_replaced_state` ——  wrapper

 SDK  RFC-0022 Phase 3 ，。 RFC  wrapper  canonical ：

```python
def emit_typed_replace(self, new_messages, *, extra):
    """DEPRECATED (RFC-0026): use HookResult.replace_extra from middleware,
    or replace_all(messages, replace_extra=...) from non-hook contexts."""
    self.replace_all(new_messages, update_baseline=True, replace_extra=extra)

def adopt_replaced_state(self, new_messages):
    """DEPRECATED (RFC-0026): use replace_all(messages, update_baseline=True)."""
    self.replace_all(new_messages, update_baseline=True)
```

，。

### 

**Before（Phase 3 ）：**

```python
# context_compaction/middleware.py
def before_model(self, hook_input):
    compacted_messages = self._compact(hook_input.messages)
    self._emit_typed_replace_for_compaction(
        agent_state=hook_input.agent_state,
        mode="regular",
        messages_before=hook_input.messages,
        messages_after=compacted_messages,
        # ...
    )
    return HookResult.with_modifications(messages=compacted_messages)

#  _emit_typed_replace_for_compaction ：
history = getattr(agent_state, "history", None)
if history is None:
    return
variant = CompactAutoVariant(...)
history.emit_typed_replace(compacted_messages, extra=variant)
#  A ； B  _origin_history.replace_all(messages)
# （baseline  A  →  fingerprint-diff ）
```

**After（RFC-0026）：**

```python
# context_compaction/middleware.py
def before_model(self, hook_input):
    compacted_messages = self._compact(hook_input.messages)
    variant = self._build_compaction_variant(
        mode="regular",
        messages_before=hook_input.messages,
        messages_after=compacted_messages,
        # ...
    )
    return HookResult.with_modifications(
        messages=compacted_messages,
        replace_extra=variant,
    )

# executor.py  hook_input.replace_extra →  _write_typed_replace_if_pending
# → HistoryList.replace_all(replace_extra=variant)
```

## 

### 

####  A： event sourcing（）

 `HistoryList`  `EventLog`  derived view， `AppendEvent` / `ReplaceEvent` ， fingerprint-diff 。

****：
- （~5  +  middleware audit + reader  replay ）
-  breaking change 
-  #528  Phase 1+2+3  PR 

→  RFC-0026 Stage 1（ RFC，HookResult ） +  Stage 2/3（ + EventLog projection）。

####  B： `ModelCallParams.replace_extra`  emergency 

 emergency  `agent_state.history`， `ModelCallParams`  `replace_extra` ， middleware  set  llm_caller  wrap_model_call  executor。

****：
- llm_caller  params， tuple  dataclass，
- emergency  typed REPLACE **eager-write**（ Phase 3 ）， executor sync  REPLACE " append "，
-  `history.replace_all`  canonical ， Phase 3  `emit_typed_replace`，

####  C： AgentState  `pending_replace_extra` 

。

****：AgentState ****（ `FrameworkContext`），——。

####  D： API  `ctx.actions.*`  `ctx.history.*`

`AgentRunActionModel` / `RunActionType` / `nexau_agent_run_actions`  "action" ；， API  `ctx.actions.replace(...)` 。

****：

| | `ctx.history.replace(...)` | `ctx.actions.emit(ReplaceEvent(...))` |
|---|---|---|
|  | Domain operation（""） | Implementation detail（" action  event"） |
| Caller  |  |  |
|  | ，IDE  |  `emit(event)`， union |
|  | （） | （ event ） |
|  | Linux ``read(fd)`` | Linux ``syscall(SYS_read, ...)`` |

：** `ctx.history.*`  API，`actions`  RFC-0022 **。：

1. ** raw emit **：middleware  `HookResult.history_event`  → executor dispatch → `ctx.history.<verb>`，"middleware  emit  event"；`ctx.actions.emit(...)`  over-engineering
2. **"narrow first" **：`ctx.actions`  caller  API surface
3. **`history` **：`ctx.history.read_messages()`  `ctx.actions.replay()` ；`ctx.history.replace(messages, extra)`  `ctx.actions.emit(ReplaceEvent(...))` 
4. **`actions`  nexau **：tool action / agent action / sub-agent action / RunAction  action， `ctx.actions` ；`history` 

**（mental model， namespace）**：

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1:  API（ middleware / tool ）     │
│   ctx.history.replace(messages, extra=variant)            │
│   () ctx.history.append / undo / read_messages       │
└─────────────────┬────────────────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────────────────┐
│ Layer 2: （RFC-0022， middleware/tool）│
│   AgentRunActionModel    (DB )                          │
│   RunActionType          (action  enum)               │
│   AgentRunActionService  ( service)                 │
│   nexau_agent_run_actions ()                            │
└──────────────────────────────────────────────────────────┘
```

** raw emit**：（ time-travel  `ctx.history.replay_events(events: list[HistoryEvent])`），**** `ctx.history`，**** API  generic `ctx.actions.emit(event)` namespace。

### 

- ** fingerprint-diff **：HistoryList  `flush()`  baseline diff 
  history  middleware。Round/token reminder  append-only FRAMEWORK； producer（
  `runtime_environment`） Stage 2a 。
- **Emergency  direct replace  history **：`ctx.history.replace(...)`
   durable history， Executor  direct-replace outbox 
  working messages。 end-of-run sync  messages ， typed
  REPLACE。
- **`emit_typed_replace` / `adopt_replaced_state` **： deprecated wrapper  public API surface， minor  `@deprecated` decorator + warning，。

## 

### 

#### Stage 1（ RFC，）

`HookResult`  typed extra + executor  `FrameworkContext.history.replace`  API + emergency  API。

- [x] `nexau/archs/main_sub/execution/history_events.py`  — `HistoryEvent` discriminated union（ReplaceEvent / AppendEvent / UndoEvent / UnknownEvent + callable Discriminator forward-compat fallback）
- [x] `FrameworkContext.history` (HistoryAPI)  API，`replace(messages, *, extra)` 
- [x] `HookResult.history_event: HistoryEvent | None` （additive，generic slot  typed slot）
- [x] `BeforeModelHookInput` / `AfterModelHookInput` outparam `history_event` 
- [x] `MiddlewareManager.run_before_model` / `run_after_model`  + publish outparam
- [x] `ModelCallParams.framework_context` （emergency ）
- [x] `LLMCaller.call_llm` / `call_llm_async`  `framework_context`  →  ModelCallParams
- [x] Executor  4  middleware  `_emit_pending_history_event(framework_context, event)` dispatch by event type
- [x] Executor  `wrap_model_call` emergency direct replace 
  `HistoryAPI` outbox， local working messages  compacted history
- [x] FrameworkContext  2  `_history=` 
- [x] `HistoryList.replace_all`  `replace_extra=` kwarg + `_schedule_typed_replace`  helper（，）
- [x] `emit_typed_replace` / `adopt_replaced_state`  wrapper（ back-compat）
- [x] `ContextCompactionMiddleware` ：regular before/after → `history_event=ReplaceEvent(...)`；emergency → `params.framework_context.history.replace(...)`
- [x] **** `AgentState.history`  + import + constructor 
- [x] `Agent._run_async_inner`  `history=`  AgentState
- [x] `tool/CLAUDE.md` （`agent_state.history` →  ctx.history）
- [x]  `tests/unit/test_rfc0026_history_event_channel.py`（12  test：HookResult.history_event  + ReplaceEvent round-trip + outparam funneling + UnknownEvent forward-compat fallback +  + back-compat shim ）

#### Stage 2a（ RFC，）

 UMP messages  role  reminder ， prompt channel：

- [x] `RoundAndTokenReminderMiddleware`  append  FRAMEWORK， USER；
- [x] OpenAI Chat/Responses、Anthropic、Gemini  provider  USER/FRAMEWORK；
- [x]  FRAMEWORK ， USER ，；
- [x]  FRAMEWORK  canonical history， provider turn；
- [x] Gemini  functionResponse  FRAMEWORK text  provider USER content，
       provider  user/model ；
- [x] public dict history  role ，`FRAMEWORK`/`framework` round-trip
       FRAMEWORK； role  USER。

#### Stage 2（ PR，）

 producer  APPEND/REPLACE ， fingerprint-diff 。
`prompt_messages`： canonical working history  UMP messages；
 role 。

- [ ] audit  message  middleware， APPEND/REPLACE；
- [ ] `HookResult.history_event: AppendEvent | ReplaceEvent | None`  durable mutation；
- [ ] HistoryList  `_baseline_fingerprints` / `_pending_messages` / `_compute_fingerprints` / `_prepare_flush`  diff ；`flush` " background task "
- [ ]  `emit_typed_replace` / `adopt_replaced_state`  deprecated wrapper

#### Stage 3（ PR，）

HistoryList  EventLog  derived view。

- [ ]  `EventLog` （single-thread serial ，append-only）
- [ ] `HistoryList(event_log)`  replay event_log  list
- [ ] `HistoryList.append/extend/replace_all`  emit `AppendEvent` / `ReplaceEvent` + 
- [ ]  HistoryList  EventLog（ in-memory / SQLite / Postgres）
- [ ]  `_schedule_async`  EventLog （ fire-and-forget ）
- [ ] AgentState.history backreference 

#### Stage 4（ PR，）

Reader  EventLog.replay 。

- [ ] `load_messages_semantics` / `replay_oracle`  reader  EventLog.replay 
- [ ]  fingerprint-based reader 
- [ ] UNDO  first-class event 

### 

Stage 1（ RFC ）：
- `nexau/archs/main_sub/execution/history_events.py` (NEW) — `HistoryEvent` discriminated union + `UnknownEvent` forward-compat fallback
- `nexau/archs/main_sub/framework_context.py` —  `HistoryAPI`  API + `ctx.history` 
- `nexau/archs/main_sub/execution/hooks.py` — `HookResult.history_event` + outparam + `ModelCallParams.framework_context` + MiddlewareManager 
- `nexau/archs/main_sub/execution/llm_caller.py` — `call_llm` / `call_llm_async`  `framework_context` →  ModelCallParams
- `nexau/archs/main_sub/execution/executor.py` — `_emit_pending_history_event` dispatcher + 4  middleware  + FrameworkContext  `_history=` + `_sync_history` 
- `nexau/archs/main_sub/history_list.py` — `replace_all(replace_extra=)` + `_schedule_typed_replace` +  deprecated wrapper
- `nexau/archs/main_sub/agent_state.py` — **** `history`  + `HistoryList` import
- `nexau/archs/main_sub/agent.py` — `AgentState(...)`  `history=`
- `nexau/archs/main_sub/execution/middleware/context_compaction/middleware.py` — `_build_compaction_variant`  builder + 3 （regular hook  → ReplaceEvent；emergency → ctx.history.replace）
- `nexau/archs/tool/CLAUDE.md` — 
- `tests/unit/test_rfc0026_history_event_channel.py` — 12 

Stage 2a：
- `nexau/archs/main_sub/execution/middleware/round_and_token_reminder.py`
- `nexau/core/serializers/user_projection.py`
- `nexau/core/serializers/{openai_chat,anthropic_messages,gemini_messages}.py`
- `tests/unit/test_{round_and_token_reminder,user_framework_projection,anthropic_gemini_serializers}.py`

Stage 2/3/4 （ PR）：
- `nexau/archs/main_sub/execution/middleware/runtime_environment.py`
- `nexau/archs/main_sub/history_list.py`（）
- `nexau/archs/session/...`（EventLog ）

## 

### （Stage 1 ）

`tests/unit/test_rfc0026_history_event_channel.py`，8 ：

1. `HookResult.replace_extra`  None /  round-trip
2. `MiddlewareManager`  hook  `replace_extra` publish  `hook_input` outparam
3. `MiddlewareManager`  `run_*`  outparam（ stale）
4. `HistoryList.replace_all(replace_extra=variant)`  typed REPLACE row（ SQLite）
5. `HistoryList.replace_all(messages)`  extra → （ fingerprint-diff ）
6. `emit_typed_replace`（deprecated） typed REPLACE row
7. `adopt_replaced_state`（deprecated） baseline，subsequent flush 

### 

 unit suite：3641 passed / 0 failed（Stage 1 ； 3633， 8 ）。
- `test_run_action_lifecycle_service.py` / `test_run_action_db_roundtrip.py` / `test_run_action_typed_replace.py`  RFC-0022 Phase 1+2+3 
- `test_executor_coverage3.py`  mock （`replace_all` kwarg  `replace_extra`）

### 

NAC（`china-qijizhifeng/nexau-cloud-runtime` PR #549）K8s Sandbox  compaction → typed REPLACE ，。

## 

1. ** `emit_typed_replace` / `adopt_replaced_state`  `@deprecated` warning**： RFC  wrapper， warning。 minor ，。 SDK  caller  telemetry 。

2. **`agent_state.history` **：emergency 。 AgentState  FrameworkContext ， `FrameworkContext.history_handle`  `ModelCallParams.history`， RFC-0027 / Stage 3 。

3. ** producer **：`runtime_environment`  message  middleware
    APPEND/REPLACE 。Stage 2a  prompt channel；
   UMP role + typed history event 。

## 

- [RFC-0022](./0022-agent-run-action-lifecycle-and-typed-blocks.md) —  RFC ，Phase 1+2+3  typed REPLACE protocol
- [RFC-0021](./0021-history-archive-on-compaction.md) — compaction 
-  commits（ `feat/rfc-0022-phase-3-typed-compact-replace`）：
  - `5ec839ba` — （ `AgentState.pending_replace_extra` ）
  - `b96e8896` — follow-up  AgentState ， emergency  canonical 