# （RFC-0027）

`SensitiveWordMiddleware`：** /  / **、
run，， `ContentBlockedEvent`。

## 

|  |  |
|---|---|
| `sensitive_word_agent.yaml` |  agent （ +  Langfuse tracer） |
| `sensitive_lexicon/*.txt` | （3 ，3 ） |
| `quickstart.py` |  YAML， /  |

## 

```bash
export LLM_MODEL=nex-agi/Nex-N2-Pro
export LLM_BASE_URL=https://your-gateway/v1      #  /v1
export LLM_API_KEY=sk-...
export LLM_API_TYPE=openai_chat_completion
# ：trace  Langfuse
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_HOST=https://your-langfuse

python examples/sensitive_word/quickstart.py
```

：「」，「」。

## （Python）

```python
from nexau import Agent, AgentConfig
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.execution.middleware.sensitive_word import SensitiveWordMiddleware

config = AgentConfig(
    name="my_agent",
    llm_config=LLMConfig(model="...", base_url="https://your-gateway/v1", api_key="sk-..."),
    middlewares=[SensitiveWordMiddleware(lexicon_dir="/opt/nexau/sensitive_lexicon")],
)
print(Agent(config=config).run(message="..."))   # 
```

## YAML 

```yaml
middlewares:
  - import: nexau.archs.main_sub.execution.middleware.sensitive_word:SensitiveWordMiddleware
    params:
      lexicon_dir: /opt/nexau/sensitive_lexicon   # ：（）
      case_sensitive: false
      block_input: true       # （）
      block_output: true      # 
      raise_on_block: false   # false=；true= SensitiveContentBlockedError
      extra_words: ["A", "X"]   # 
```

## （）

```python
SensitiveWordMiddleware(lexicon_dir="/opt/full_lexicon")    # ： .txt =
SensitiveWordMiddleware(lexicon_file="/opt/words.txt")      # ：=
SensitiveWordMiddleware(lexicon_words=["", ""])      # 
```

- `lexicon_dir` / `lexicon_file` / `lexicon_words` ；。
-  `examples/sensitive_word/sensitive_lexicon/`  **3 **（: /
  : / :），；** `lexicon_dir` **。
- `lexicon_dir` （ CWD ）。

## 

|  |  |  |
|---|---|---|
|  /  /  | `before_model` | ****（） |
| （`Role.TOOL`） | `before_model` | **** before_model |
|  | `after_model` | ， |

> ，""（ chunk ）；。

## 

1. ****（ / `RunErrorEvent.message`）： + ，。
2. **`ContentBlockedEvent`**（，）：`source` / `categories` / `words` / `message`。
   —— `AgentEventsMiddleware`， SSE 。
3. ****：`[SensitiveWordMiddleware] BLOCKED source=... categories=... hits=...`。

##  + （）

""，：
-  OpenAI  function calling， `tool_call_mode="openai"`。
- ，** `before_model`** ，
   `... → TOOL_CALL_RESULT → ContentBlockedEvent(source=input) → RUN_ERROR`。

## 

- `tracers=[LangfuseTracer()]`（ `LANGFUSE_PUBLIC_KEY/SECRET_KEY/HOST` ） run
  trace  Langfuse。： `ContentBlockedEvent` / ，Langfuse trace 
   span。