# RFC-0009: Token Generate Provider And Trace Memory

- ****: implemented
- ****: P1
- ****: `architecture`, `dx`
- ****: `nexau` agent runtime, `generate_with_token` provider integration
- ****: 2026-03-09
- ****: 2026-03-14

## 

 NexAU  `api_type="generate_with_token"` ， agent 、 run  token buffer。“ HuggingFace tokenizer  + client.generate_with_token  +  detokenize ”， `trace_memory`  trace  token  trace。

## 

 NexAU ， Chat/Responses API， `input_ids` 。：

-  `Message` ，
-  token buffer，
-  token  `1`， token  `0`
-  tool call / tool result 
-  `message_trace`  token trace，、

## 

### 

：

- `LLMConfig`  `api_type="generate_with_token"`  `tokenizer_path`
- `TokenTraceSession`  token buffer、`response_mask`、round  trace  provider usage
- `Executor`  `LLM -> parse -> tool -> next round`  token session
- `Agent`  session  trace  `global_storage["trace_memory"]`

：

-  `messages`  token ids
-  token  buffer，mask  `1`
- tool result / synthetic feedback  token  buffer，mask  `0`
- token session  context compaction；

### 

#### 1. Provider 

`LLMConfig` ：

- `api_type="generate_with_token"`
- `tokenizer_path="<hf model or local path>"`

：

- `tokenizer_path` ， HuggingFace tokenizer
- `base_url` / `api_key`  detokenize HTTP  client 
-  `LLMConfig.extra_params` 
- `chat_template_kwargs`（ dict） kwargs  `apply_chat_template`，
   chat template （ `enable_thinking`、`thinking_budget` ）

 `/tokenize` 。 token  `AutoTokenizer.apply_chat_template(...)` 。

##### chat_template_kwargs 

（ Qwen3、DeepSeek-R1） chat template  `enable_thinking` 。
 `LLMConfig.extra_params["chat_template_kwargs"]`  `apply_chat_template`：

```python
LLMConfig(
    model="Qwen3-32B",
    api_type="generate_with_token",
    tokenizer_path="Qwen/Qwen3-32B",
    chat_template_kwargs={"enable_thinking": True},
)
```

`TokenTraceSession.tokenize_messages(...)`  `apply_chat_template` ，
 `llm_config.extra_params["chat_template_kwargs"]`  `**kwargs` 。
，。

#### 2. Generate 

 `TokenTraceSession`  HTTP， `LLMCaller`  client ：

```python
client.generate_with_token(...)
```

`TokenTraceSession.build_generate_with_token_kwargs(...)`  buffer ：

- `model`
- `input_ids`
- `sampling_params.max_new_tokens`
-  provider /

：

- `sampling_params` ， `temperature`、`top_p`、`top_k`、`stop`、`stop_token_ids`
- ， `stream`、`rid`、`return_logprob`、`return_hidden_states`

 `stream=True` ， warning。

#### 3. Response 

 `client.generate_with_token(...)`  OpenAI Chat Completion  payload， `nexrl_train`：

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "input_tokens": 3,
    "completion_tokens": 2
  },
  "nexrl_train": {
    "prompt_tokens": [1, 2, 3],
    "response_tokens": [4, 5]
  }
}
```

：

- `choices[0].message`  `ModelResponse`
- `nexrl_train.response_tokens`  token trace 
- `usage`  provider ； `nexrl_train.prompt_tokens` / `response_tokens` 
- `finish_reason`  `type` 

 `message.content` ， `response_tokens` ， detokenize 。

#### 4. Tokenize / Detokenize 

：

- tokenize： HF tokenizer
- generate： client  `generate_with_token(...)`
- detokenize：`TokenTraceSession.detokenize(...)`  HTTP 

detokenize ：

- `POST {base_url}/detokenize`

 `llm_config.detokenize_path` ， `extra_headers` 。

#### 5. TokenTraceSession 

`TokenTraceSession` ：

- `token_ids`
- `response_mask`
- `round_traces`
- `token_provider_usage`
- `synced_message_count`

 `trace_memory` ：

- `final_token_list`
- `response_mask`
- `round_traces`
- `token_provider_usage`

：

- `response_mask[i] == 1`  token 
- `response_mask[i] == 0`  token  system / user / history / tool result / synthetic feedback
-  tool call token ， `1`

`round_traces` ：

- `request_tokens`
- `response_tokens`
- `response_text`
- `tool_calls`

provider usage  `token_provider_usage` ， `round_traces` 。

#### 6. Executor 

`Executor.execute(...)` ：

1.  `AgentState`  `token_trace_session`
2.  provider  `generate_with_token`  session ，
3.  `initialize_from_messages(messages)`  token buffer
4.  LLM  `sync_external_messages(messages)` 
5. LLM ， assistant message 
6.  `append_model_response(...)`  token  token buffer
7. tool ， tool result message  synthetic feedback message  token buffer，mask  `0`
8. 、、overflow  token trace  `trace_memory`

 token trace 。

#### 7. Tool 

 tool result ：

- OpenAI/structured tool call ：
  - tool  `role=tool`  `Message` 
  - token trace  token  `0`
- XML/tool-feedback ：
  -  synthetic `role=user` 
  -  `Tool execution results:\n...`
  - token trace  `0`

 RFC “tool result  tool message”； tool call mode。

#### 8.  run 

`Agent`  `_token_trace_session` ， run  `AgentState`。：

-  `Agent` ， token buffer
- `trace_memory["message_trace"]`  `Agent._update_trace_memory()` 
- `trace_memory`  token trace  `Executor._store_token_trace()` 

，。

#### 9. Context Overflow 

token trace session ：

-  `TokenCounter`  prompt token 
-  token trace  context compaction
-  `append_model_response(...)`  `append_messages(...)`  `max_context_tokens` ， `TokenTraceContextOverflowError`
- `Executor` ， `CONTEXT_TOKEN_LIMIT` ， trace

 compaction ：，token buffer  message trace 。

### 

```python
agent = Agent(
    config=AgentConfig(
        name="token-agent",
        system_prompt="You are helpful.",
        llm_config=LLMConfig(
            model="my-model",
            base_url="http://gateway.internal",
            api_key="token",
            api_type="generate_with_token",
            tokenizer_path="meta-llama/Llama-3.1-8B-Instruct",
        ),
    )
)

result = agent.run(message="")

trace_memory = agent.global_storage.get("trace_memory", {})
final_token_list = trace_memory["final_token_list"]
response_mask = trace_memory["response_mask"]
message_trace = trace_memory["message_trace"]
```

## 

### 

-  token run ：
  - ： `Agent.run()` / `run_async()` 
-  `messages`  token list：
  - ： append token buffer ， `response_mask`
-  token trace， trace：
  - ：、tool 
-  token trace  context compaction：
  - ： token buffer 

### 

-  HuggingFace tokenizer
- provider  `choices[0].message`  `nexrl_train.response_tokens`
- streaming ，`stream=True` 
- token trace  message trace ，

## 

### 

- [x] Phase 1:  RFC、`TokenTraceSession`  `generate_with_token` provider 
- [x] Phase 2:  token session  `Executor`  `trace_memory`
- [x] Phase 3:  tool trace / overflow 

### 

- `nexau/archs/llm/llm_config.py` -  `api_type="generate_with_token"`  `tokenizer_path`
- `nexau/archs/main_sub/token_trace_session.py` -  token buffer、mask、round trace、detokenize
- `nexau/archs/main_sub/execution/llm_caller.py` -  `client.generate_with_token(...)` 
- `nexau/archs/main_sub/execution/executor.py` -  tool call  token trace
- `nexau/archs/main_sub/agent.py` -  run  token session， `message_trace`
- `nexau/archs/main_sub/agent_state.py` -  `token_trace_session`

## 

### 

- `build_generate_with_token_kwargs(...)`  `input_ids`  `sampling_params`
- `final_token_list`  `response_mask` 
-  token  `1`
- tool result / synthetic feedback token  `0`
- provider  `nexrl_train.response_tokens`  token
- ， detokenize 
- `message_trace`  token trace  `trace_memory`
-  `max_context_tokens`  `TokenTraceContextOverflowError`

### 

- `generate_with_token`  tool call， `LLM -> tool -> LLM` 
-  structured tool call  XML tool feedback  token trace

### 

1.  `api_type="generate_with_token"`  `tokenizer_path`
2.  agent
3.  `trace_memory.message_trace`
4.  `trace_memory.final_token_list`
5.  `trace_memory.response_mask`
6.  `trace_memory.round_traces`
7.  `trace_memory.token_provider_usage`

## 

-  `generate_with_token`  request path / transport  `detokenize_path` 
-  `round_traces`  provider ，
-  streaming 

## 

- `rfcs/0000-template.md`
- `nexau/archs/main_sub/token_trace_session.py`
- `nexau/archs/main_sub/execution/executor.py`
- `nexau/archs/main_sub/execution/llm_caller.py`
- `tests/unit/test_token_trace_session.py`
- `tests/unit/test_llm_caller.py`