# RFC-0023: Provider Stream Aggregator Unification

- ****: draft
- ****: P2
- ****: `architecture`, `refactoring`, `dx`, `testing`
- ****: NexAU(`archs/llm/llm_aggregators/`、`archs/main_sub/execution/llm_caller.py`、`archs/main_sub/execution/middleware/agent_events_middleware.py`)
- ****: 2026-05-01
- ****: 2026-05-01

## 

NexAU ** provider stream aggregator**—— provider SSE :Set A(`llm_aggregators/`) AG-UI events  SSE,Set B(`llm_caller.py`  `*StreamAggregator`) ModelResponse dict 。 provider ,。 RFC  canonical aggregator——provider , push AG-UI events  finalize  ModelResponse,Set B  Set A 。

> ****: RFC  [RFC-0022(Agent Run Action )](0022-agent-run-action-lifecycle-and-typed-blocks.md) ****。RFC-0022 Phase 2(iter )" SSE  token "" RunAction  Message"****; RFC ,iter  chunk → aggregate 。

, PR  review:
1. ** ①**(Parity ): provider SSE fixture +  aggregator ,
2. ** ②**(AG-UI events ): `ModelCallFinishedEvent`  sidecar event, AG-UI  ModelResponse (`stop_reason` / `model_name` )
3. ** ③**(Set B ):`*StreamAggregator`  Set A  `Aggregator` ABC (),`llm_caller.py` 

## 

### 1. 

 provider(Anthropic / OpenAI Chat Completions / OpenAI Responses / Gemini REST)****:

| Provider | Set A  | Set B  |
|---------|-----------|-----------|
| Anthropic | `archs/llm/llm_aggregators/anthropic/anthropic_event_aggregator.py`(318 ) | `llm_caller.py:2570-` `AnthropicStreamAggregator`(~290 ) |
| OpenAI Chat | `openai_chat_completion/` | `llm_caller.py:2454-` `OpenAIChatStreamAggregator` |
| OpenAI Responses | `openai_responses/` | `llm_caller.py:2860-` `OpenAIResponsesStreamAggregator` |
| Gemini REST | `gemini_rest/` | `llm_caller.py:3028-` `GeminiRestStreamAggregator` |

 provider (Anthropic  extended thinking、OpenAI  reasoning summary、Gemini  part ), SSE 。——。

### 2. ""

。****——`agent_events_middleware.after_model()` hook  `model_response.usage`(Set B ) emit `UsageUpdateEvent`  Set A 。 Set A ,** Set B **, usage。

"":
-  Set B  usage ,Set A middleware 
-  SSE  block 

### 3. RFC-0022 Phase 2 

RFC-0022 §  Phase 2  RFC § ③ 。iter  APPEND  Message  SSE  token , chunk → aggregate framing 。

## 

1. ** AG-UI **—— RFC  `ag_ui` , nexau  events (`nexau/archs/llm/llm_aggregators/events.py`)。
2. ** `ModelResponse` / `Message` **——, RFC 。
3. ** LLM provider**—— RFC  4  provider , provider 。
4. ** iter **—— RFC-0022 Phase 2 。 RFC 。
5. ** `agent_events_middleware`**——; RFC 。

## 

### A. Set A (`archs/llm/llm_aggregators/`)

****:

```python
class Aggregator[InputT, OutputT](ABC):
    def aggregate(self, item: InputT) -> None: ...
    def build(self) -> OutputT: ...
    def clear(self) -> None: ...

class AnthropicEventAggregator(Aggregator[RawMessageStreamEvent, None]):
    """Set A  — push ,build()  return None"""
    def __init__(self, *, on_event: Callable[[Event], None], run_id: str) -> None: ...
```

****: `on_event(Event)`  nexau  ag_ui events,** ModelResponse**。

****:

```
Set A → agent_events_middleware ()
              ↓
          on_event  SSE
```

**`build()`  None**——Set A  push-style,"finalize "。

### B. Set B (`llm_caller.py`  `*StreamAggregator`)

****( Anthropic ):

```python
class AnthropicStreamAggregator:
    def __init__(self) -> None:
        self.role: str = "assistant"
        self.model_name: str | None = None
        self.usage: dict[str, Any] | None = None
        self.stop_reason: str | None = None
        self._active_blocks: dict[int, dict[str, Any]] = {}
        self._completed_blocks: list[dict[str, Any]] = []

    def consume(self, event: Any) -> None: ...

    def finalize(self) -> dict[str, Any]:
        #  ModelResponse-shaped dict:
        # { role, content, model, stop_reason, usage }
```

****:`finalize() -> dict[str, Any]`,:`role` / `content` (block list) / `model` / `stop_reason` / `usage`。

****:** `llm_caller.py` **, `ModelResponse.from_anthropic_message(payload)` 。

** ABC **,。

### C. ag_ui events  ✅ 

```python
# ag_ui/core/types.py
class ConfiguredBaseModel(BaseModel):
    model_config = ConfigDict(
        extra="allow",         # ←  nexau-specific 
        alias_generator=to_camel,
        populate_by_name=True,
    )

# ag_ui/core/events.py
class BaseEvent(ConfiguredBaseModel):
    type: EventType
    timestamp: Optional[int] = None
    raw_event: Optional[Any] = None    # ←  provider  payload 
```

():

1. **`extra='allow'` **—— BaseEvent , reader 
2. **`raw_event: Any`**—— provider  payload, reader  unpack
3. **`CustomEvent(name, value)`**——nexau 
4. ** nexau-specific event **—— nexau (`UsageUpdateEvent` / `CompactionStartedEvent` )

### D. nexau  ag_ui ()

`nexau/archs/llm/llm_aggregators/events.py` :

```python
#  ag_ui ( nexau )
TextMessageStartEvent extends AgUiTextMessageStartEvent
ThinkingTextMessageStartEvent extends AgUiThinkingTextMessageStartEvent
RunStartedEvent extends AgUiRunStartedEvent
RunErrorEvent extends AgUiRunErrorEvent

#  nexau 
UsageUpdateEvent(run_id, usage: TokenUsage)        # type="USAGE_UPDATE"
CompactionStartedEvent / CompactionFinishedEvent
TransportErrorEvent
UserMessageEvent / TeamMessageEvent                # RFC-0002 
ImageMessageStartEvent / ContentEvent / EndEvent   # 
ToolCallResultEvent                                 #  ag_ui 

#  union type
Event = TextMessageStartEvent | ... | UsageUpdateEvent
```

****:nexau  ag_ui 。 RFC  sidecar event ( `ModelCallFinishedEvent`)****,。

### E. Gap :Set B  vs Set A  events

| Set B `finalize()`  | Set A  | Gap  |
|-----------------------|------------------|---------|
| `role` | `TextMessageStartEvent.role` | ✅  |
| `content`(blocks)|  ContentEvent  | ✅  |
| `usage`(token )| `UsageUpdateEvent.usage`( middleware ,**** aggregator )| ⚠️  Set B, aggregator  |
| `stop_reason` | ❌  | **** |
| `model_name` / `model` | ❌  | **** |
| `id`(provider message id)| `TextMessageStartEvent.message_id`  | ⚠️  |
| Reasoning `signature`(Claude extended thinking)| ❌ ag_ui  ThinkingTextMessage  | **** |
| Reasoning `redacted_data`(Claude RedactedThinking)| ❌  | **** |

**Gap **。:

- ** `ModelCallFinishedEvent`**( `UsageUpdateEvent` ) LLM  emit, `stop_reason` / `model_name` / `id` /  provider-specific metadata。
- ** `ThinkingTextMessageStart/EndEvent`**  `signature` / `redacted_data` ( ag_ui `extra='allow'`)。

### F. Fixture 

****:

- `tests/fixtures/token_usage_regression.yaml` —  yaml,token usage ,** SSE **
- `tests/scripts/generate_llm_aggregator_logging_data.py` —  API  events ,** commit**( `tests/test_data/llm_aggregators/`,)

****:

-  provider  SSE ()
- VCR / pytest-recording  cassette
- Set A / Set B  corpus

****:

|  |  |  |
|-----|-----|-----|
| `test_anthropic_event_aggregator.py` | 761 | Set A |
| `test_openai_chat_completion_aggregator.py` | 1098 | Set A |
| `test_openai_responses_aggregator.py` | 1533 | Set A |
| `test_anthropic_stream_else_branch.py` | 298 | Set A |
| `test_llm_streaming.py` | 364 | Set B |
| `test_llm_caller_async_stream.py` | 920 | Set B |
| **** | **~5000** | |

 SDK type (`RawMessageStartEvent(...)` ),。** corpus**  parity 。

### G.  SSE corpus 

** corpus**。 repo / :

- `anthropics/anthropic-sdk-python/tests/test_streaming.py`: SSE parser,inline 
- `openai/openai-python` tests:
- `BerriAI/litellm` / `langchain-ai/langchain`: cassette corpus
- `vcrpy` / `pytest-recording`:, LLM  corpus

****:—— `generate_llm_aggregator_logging_data.py`  provider  SSE ,redact  commit  `tests/fixtures/provider_streams/`。

## 

###  ①():Set A ,Set B 

 Set A  `Aggregator` ABC  `finalize() -> ModelResponse`( sibling  `Finalizable[T]`),Set A  provider  push events ;`llm_caller.py`  `aggregator.finalize()`  `*StreamAggregator.finalize()`。

```
:
   provider SSE
        ├─→ Set A AnthropicEventAggregator → on_event → ag_ui events
        └─→ Set B AnthropicStreamAggregator → finalize() → dict → ModelResponse

:
   provider SSE
        └─→ unified AnthropicEventAggregator
                  ├─→ on_event  ag_ui events()
                  └─→ finalize()  ModelResponse( Set B)
```

****( `Aggregator` ABC):

```python
class Aggregator[InputT, OutputT](ABC):
    @abstractmethod
    def aggregate(self, item: InputT) -> None: ...

    @abstractmethod
    def build(self) -> OutputT: ...    # , ModelResponse  None

    @abstractmethod
    def clear(self) -> None: ...
```

—— push-only  finalizable :

```python
class Aggregator[InputT, OutputT](ABC):
    def aggregate(self, item: InputT) -> None: ...
    def build(self) -> OutputT: ...

class AnthropicEventAggregator(Aggregator[RawMessageStreamEvent, ModelResponse]):
    def __init__(self, *, on_event: Callable[[Event], None] | None = None, run_id: str): ...
    # build()  ModelResponse; on_event() events
```

`on_event`  optional,:
- (Set B ), `on_event`, `build()`
- (unified mode), `on_event`  `build()`

****:
- provider ,
- , ABC
- Set B ( import  build )

****:
-  class  push events + finalize state,(Anthropic  ~500 )
- (parity test )

###  ②(): provider parser,Set A / Set B 

```
provider SSE
    ↓
ProviderParser(, provider ,,)
    ↓  normalized event
    ├─→ AGUIBuilder → ag_ui events
    └─→ ModelResponseBuilder → ModelResponse
```

****:
- ,
-  provider 

****:
- ** schema**—— schema  ag_ui events , ②  ① 
- ,

****:** ①**。 schema ,ag_ui events  nexau —— over-engineering。

### sidecar metadata events 

 Gap, events( `nexau/archs/llm/llm_aggregators/events.py`, `UsageUpdateEvent` ):

```python
class ModelCallFinishedEvent(BaseEvent):
    """LLM call  emit , ModelResponse  ag_ui  events 。"""

    type: Literal["MODEL_CALL_FINISHED"] = "MODEL_CALL_FINISHED"
    run_id: str
    llm_call_id: str | None = None       # provider  message/response id
    model_name: str | None = None
    stop_reason: str | None = None
    finish_reason: str | None = None     # OpenAI  finish_reason
    raw_metadata: dict[str, Any] | None = None  # provider (cache_creation_input_tokens )
```

**emit **:aggregator `finalize()` , ag_ui 。

**ThinkingTextMessage events **( `extra='allow'` ):

```python
class ThinkingTextMessageStartEvent(AgUiThinkingTextMessageStartEvent):
    # :
    signature: str | None = None
    is_redacted: bool = False

class ThinkingTextMessageEndEvent(AgUiThinkingTextMessageEndEvent):
    redacted_data: str | None = None
```

> ****: ag_ui `extra='allow'`  `stop_reason` / `model_name`  event ?
>
>  `stop_reason` / `model_name` ** LLM call **, message/block—— `MessageEndEvent.extra` 。 event """"。

###  / 

`finalize()`  provider raw events  `aggregate()` , `finalize()` ( Set B `_completed_blocks` )。 RFC 。

emit :
- `RunStartedEvent`  message-level event
- `ModelCallFinishedEvent` **** message-level event,**** `RunFinishedEvent`
- `finalize()` 

## 

###  ① — Parity ( PR-A)

****: Set A / Set B ,"",。

****:

```
tests/aggregator_parity/
├── fixtures/
│   ├── anthropic/
│   │   ├── plain_text.txt          ← 
│   │   ├── tool_calls.txt          ← / tool 
│   │   ├── extended_thinking.txt   ← Claude extended thinking
│   │   ├── redacted_thinking.txt   ← redacted thinking
│   │   └── long_context.txt        ← (prompt cache )
│   ├── openai_chat/
│   ├── openai_responses/
│   └── gemini/
├── conftest.py
├── test_anthropic_parity.py
├── test_openai_chat_parity.py
├── test_openai_responses_parity.py
├── test_gemini_parity.py
├── strategies.py                    ← Hypothesis ()
└── reconstructor.py                 ← AG-UI events → Message 
```

**Fixture **:

1.  `tests/scripts/generate_llm_aggregator_logging_data.py`, `--dump-raw-sse` , provider  SSE byte stream 
2.  prompt( 5  × 4 provider = 20  fixture) API
3. **redact**: API key、user-identifying ,
4. commit fixture  `tests/aggregator_parity/fixtures/`

**Parity **:

```python
def test_anthropic_parity(fixture_path: Path):
    raw_sse = fixture_path.read_bytes()

    # Set B 
    model_response_dict = run_set_b_anthropic(raw_sse)
    msg_from_b = Message.from_model_response_dict(model_response_dict)

    # Set A 
    agui_events = collect_agui_events(run_set_a_anthropic(raw_sse))
    msg_from_a = reconstruct_message_from_agui(agui_events)

    # ()
    assert msg_from_a.role == msg_from_b.role
    assert blocks_semantic_equal(msg_from_a.content, msg_from_b.content)

    # ( Set A , gap,)
    record_gap("usage", missing_in=msg_from_a, present_in=msg_from_b)
    record_gap("stop_reason", ...)
    record_gap("model_name", ...)
```

****():role / content blocks( /  /  / )。
****( gap):usage / stop_reason / model_name / signature / redacted_data。

** — Vendor Truth **:

Set A vs Set B ****。""—— vendor  aggregation 。 **prompt cache **: assistant `Message` (history compaction、multi-turn tool loop、agent-of-agent) vendor , vendor  non-stream  response —— prompt cache prefix , / ,。

 § ① :

- `scripts/record_fixture.py --also-non-stream`: SSE , prompt  `stream:false` , `<scenario>.non_stream.json`  `recordings/` ;Anthropic / OpenAI Chat / OpenAI Responses  body  `stream:false` ,Gemini  path  (`streamGenerateContent` → `generateContent`)。
- `tests/aggregator_parity/test_stream_vs_non_stream.py`: `<scenario>.sse` + `<scenario>.non_stream.json` ,SSE  Set A → reconstructor → `Message`,non-stream JSON  `<provider>_non_stream_json_to_message` → `Message`,。
-  vendor-side ( bug ) `KNOWN_VENDOR_TRUTH_DIVERGENCES`,,strict xfail。


****: ① merge ,`pytest tests/aggregator_parity/` ,`tests/aggregator_parity/gap_report.md`  Set A —— ② 。

****: ②  Set A ,parity test ; ③  Set B ,parity test ""( aggregator,parity )。

###  ② — AG-UI events ( PR-B)

****: Set A  events  ModelResponse , ③ 。

****:

1.  `nexau/archs/llm/llm_aggregators/events.py`  `ModelCallFinishedEvent`、 `ThinkingTextMessageStart/EndEvent` 
2. 4  provider  Set A aggregator  emit  event( LLM call ,)
3. parity test( ① )**** —— Set A  missing usage / stop_reason / model_name 
4. `agent_events_middleware.after_model()`  `model_response`  usage, `ModelCallFinishedEvent`( Set B )

****:`agent_events_middleware`  SSE 。 `UsageUpdateEvent` ,——`UsageUpdateEvent` , emit  aggregator  middleware。

###  ③ — Set B ( PR-C)

****: Set B, Set A  provider stream parser。

****:

1.  `Aggregator` ABC  `build()`  provider  `ModelResponse`( sibling  `Finalizable[T]`)
2. 4  Set A aggregator  ModelResponse ( Set B )
3. `llm_caller.py`  4  `*StreamAggregator` class ****, Set A aggregator  `build()`
4. `agent_events_middleware` —— `llm_caller`  aggregator 
5.  Set B (`test_llm_streaming.py` 、`test_llm_caller_async_stream.py` )
6. parity test " aggregator "(,parity )

**Anthropic  ~500 **(Set A  318 + Set B  ~290, 30%)。 provider 。

**§ ③ merge (Acceptance Criteria)**:

 PR-C ,—— Set B  Set A ,。

1. **Set A vs Set B **( ① ):`pytest tests/aggregator_parity/test_*_parity.py` 0 strong failure;0 weak gap( ② , § ② )。
2. **Set A vs Vendor Non-Stream **( ① ):`pytest tests/aggregator_parity/test_stream_vs_non_stream.py` 0 strong failure;`KNOWN_VENDOR_TRUTH_DIVERGENCES`  entry  + strict xfail,Reviewer  divergence  bug。
3. **Vendor truth fixture **: provider  ≥ 3  `<scenario>.non_stream.json` , plain text / tool call / reasoning( redacted reasoning, provider ); § ③  ground truth 。


**RFC-0022 Phase 2 **: ③ merge ,`AgentRunner`  LLM iter , aggregator  ModelResponse → Message → APPEND, iter 。

## 

### 

1. ** ②( provider parser )**: §。—— schema  ag_ui events, over-engineering。

2. **, parity test **:——,RFC-0022 Phase 2 ,parity test """ source",。

3. ** ag_ui , nexau-specific events**:——Reasoning signature、redacted thinking、Anthropic cache token、provider-specific stop_reason  nexau  ag_ui ( UI )。`extra='allow'` + nexau  events 。

4. ** `stop_reason` / `model_name`  `MessageEndEvent.extra`  `ModelCallFinishedEvent`**:——`stop_reason`  LLM call , message; MessageEndEvent 。

### 

- ** aggregator class **( ~500  / provider)。 helper (`MessageBuilder` / `ToolCallBuilder` ,Set B  helper)。
- ** ①  fixture  API key**——CI  fixture  key, provider 。 `generate_llm_aggregator_logging_data.py` ,。
- ** ② / ③ **—— ②  ③ ,Set B , Set A  ModelResponse 。 Set B  ModelResponse  source of truth(parity test )。

## 

### 

- [ ] ** ① — Parity (PR-A)**
  - `tests/aggregator_parity/` 
  - `tests/scripts/generate_llm_aggregator_logging_data.py`  `--dump-raw-sse`
  -  4 provider × 5  = 20  fixture
  - 4  parity test ( +  gap )
  - `gap_report.md` 
  - ****:`scripts/record_fixture.py --also-non-stream`(4 provider )+ `test_stream_vs_non_stream.py` + `NON_STREAM_LOADERS` + `KNOWN_VENDOR_TRUTH_DIVERGENCES` (, fixture ); 4 provider × ≥3  = ≥12  `<scenario>.non_stream.json` 
- [ ] ** ② — AG-UI events (PR-B)**
  -  `ModelCallFinishedEvent`、 `ThinkingTextMessage*` 
  - 4 provider Set A aggregator emit  events
  - `agent_events_middleware`  `ModelCallFinishedEvent`( Set B )
  - parity test 
- [ ] ** ③ — Set B (PR-C)**
  - `Aggregator` ABC (`build()`  ModelResponse  sibling )
  - 4  Set A aggregator  ModelResponse 
  -  `llm_caller.py`  4  `*StreamAggregator`
  - 
  -  Set B 
  - ** RFC-0022 Phase 2**

### 

- `nexau/archs/llm/llm_aggregators/events.py` —  `ModelCallFinishedEvent`( ②)
- `nexau/archs/llm/llm_aggregators/anthropic/anthropic_event_aggregator.py` — emit  events + finalize ModelResponse( ②③)
-  OpenAI Chat / Responses / Gemini( 4  provider )
- `nexau/archs/main_sub/execution/llm_caller.py` —  4  `*StreamAggregator`( ③)
- `nexau/archs/main_sub/execution/middleware/agent_events_middleware.py` —  usage ( ②)
- `tests/aggregator_parity/` — ( ①)
- `tests/scripts/generate_llm_aggregator_logging_data.py` — ( ①)

### 

 ① 。:

-  ② ,parity test ,
-  ③ ,parity test ""( aggregator,parity ); fixture-driven  provider 

 ①  fixture  API key  `generate_llm_aggregator_logging_data.py`, RFC  secret 。

## 

1. **`Aggregator` ABC **:`build() -> OutputT` , sibling `Finalizable[T]` ?Phase ③ 。
2. ** ②  `agent_events_middleware.after_model` **: ② merge  ③ ,middleware  `ModelCallFinishedEvent`  `model_response.usage`  fallback?。
3. **Fixture redaction **:user content / assistant content ,redaction 。" prompt /" redaction 。
4. **`raw_event`  provider aggregator **:`BaseEvent.raw_event`  provider  payload, Set A 。 ②  provider emit  `raw_event =  SSE chunk`? fixture ,。

## 

- [RFC-0022](0022-agent-run-action-lifecycle-and-typed-blocks.md):Agent Run Action ( RFC  Phase 2 )
- [RFC-0002](0002-agent-team.md):(`UserMessageEvent` / `TeamMessageEvent` )
- AG-UI (`ag_ui` ): UI 
- `nexau/archs/llm/llm_aggregators/CLAUDE.md`:Set A 
- `tests/scripts/generate_llm_aggregator_logging_data.py`: API 