# RFC-0017: （Flatten Tool Output）

- ****: implemented
- ****: P1
- ****: `architecture`, `dx`, `llm`
- ****: nexau core (tool yaml, tool executor, middleware, messages)
- ****: 2026-04-10
- ****: 2026-05-09

## 

 Dict （ Sub-agent、MCP、 builtin tool）， NexAU  `coerce_tool_result_content()`  `str(dict)`， LLM  Python repr ，。 RFC ：** tool YAML  custom formatter；， NexAU  formatter**。 formatter  XML；2026-05-09  **Markdown  formatter**，XML  opt-in， XML-like  chat template / tool-call 。，formatter  `after_tool` middleware ，`LongToolOutputMiddleware`  raw tool output， formatter  LLM-facing output，“”“ LLM ”。

## 

### 

 Sub-agent ，`call_sub_agent()` ：

```python
{
    "status": "success",
    "sub_agent_name": "explore",
    "sub_agent_id": "d6a23025ed0c",
    "message": "In the nexau-rs project...",
    "result": "## Answer\n\n......"
}
```

，LLM ：

```
{'status': 'success', 'sub_agent_name': 'explore', 'sub_agent_id': 'd6a23025ed0c',
 'message': 'In the nexau-rs project...', 'result': '## Answer\n\n......'}
```

：

1. ****：LLM  Python repr，、
2. ****： `result` / `content` ， Dict 
3. ****： middleware  raw dict， LLM ，
4. ****：`status`、`message`、`sub_agent_name` ， token

###  formatter  LongToolOutputMiddleware

 formatter  middleware ，：

- middleware  raw dict
- middleware  `result` / `content` ， LLM 
- formatter ， LLM “ dict ”

：

```text
raw tool output
  → formatter
  → llm-facing output
  → LongToolOutputMiddleware
  → final llm-facing output
  → ToolResultBlock
```

###  YAML formatter

NexAU  YAML tool （`ToolYamlSchema` / `Tool.from_yaml()`）。formatter  YAML ：

- 
-  tool implementation  LLM 
- builtin tool、、MCP 
- ，

## 

### 

****：

```text
Tool implementation
    ↓
raw tool output
    ↓
formatter resolution
    ├─ YAML  custom formatter
    └─  →  Markdown formatter
    ↓
llm_tool_output
    ↓
after_tool middleware
    ├─ tool_output      (raw channel)
    └─ llm_tool_output  (LLM channel)
    ↓
final llm_tool_output
    ↓
ToolResultBlock.content
```

：

1. **`tool_output` **，、、frontend、
2. **`llm_tool_output`  LLM **， formatter ， middleware 
3. ** formatter**， YAML ， Markdown formatter
4. **LongToolOutputMiddleware  `llm_tool_output` **， raw dict

### 

#### 1. Tool YAML  `formatter` 

 `ToolYamlSchema` ：

```python
class ToolYamlSchema(BaseModel):
    type: Literal["tool"] | None = Field(default=None)
    name: str
    description: str
    input_schema: dict[str, Any] = Field(default_factory=dict)
    ...
    binding: str | None = None
    formatter: str | None = None
```

：

- ， custom formatter
- ， `markdown` formatter

 RFC ：

- builtin formatter alias  `markdown`  `xml`
- `markdown`  alias；`xml`  opt-in /

：

```yaml
formatter: markdown
```

：

```yaml
formatter: xml
```

```yaml
formatter: nexau.archs.tool.formatters.agent:format_agent_tool_output
```

#### 1.1  YAML Tool  formatter

 `Tool.from_yaml()` ， Python  `Tool(...)`  `formatter` ， YAML ：

```python
Tool(
    name="my_tool",
    description="...",
    input_schema={...},
    implementation=my_impl,
    formatter="markdown",  # optional; omitted also means markdown
)
```

：

- ， `markdown` formatter
-  builtin alias（ `markdown` / `xml`）
-  import path  callable（）

 YAML Tool  Python Tool ，。

#### 2. Formatter 

formatter ，， LLM-facing ：

```python
@dataclass(frozen=True)
class ToolFormatterContext:
    tool_name: str
    tool_input: dict[str, Any]
    tool_output: object
    tool_call_id: str | None
    is_error: bool


ToolFormatter = Callable[[ToolFormatterContext], object]
```

：

- `str`：， LLM 
- `dict` / `list`： formatter ， `coerce_tool_result_content()` 
- image-compatible ： multimodal 

#### 3.  Markdown formatter

 tool YAML  formatter ， NexAU  Markdown formatter。XML formatter  `formatter: xml`。

 Markdown formatter  JSON，**、、** XML-like 。：

```markdown
## Tool Result

### Metadata

- `status`: success
- `sub_agent_name`: explore
- `sub_agent_id`: d6a23025ed0c

### Body (`result`)

## Answer

......
```

 Markdown formatter ：

1. ****：，
2. ** bypass Markdown formatter**： MCP tool  Python tool， formatter  image-like / multimodal image ， bypass Markdown formatter， `coerce_tool_result_content()` 
3. **Dict / List **： Markdown 
4. ** display-only **： `returnDisplay`
5. ****： `returnDisplay`  display-only ，Dict  `content`  `result` ，， XML
6. ****： `result`、`content`、`stdout`、`stderr`、`message`， multiline string
7. ** Metadata **
8. ** Body section**

#### 4. Custom formatter  YAML 

 AgentTool  formatter：

```yaml
name: Agent
binding: nexau.archs.tool.builtin.agent_tool:call_sub_agent
formatter: nexau.archs.tool.formatters.agent:format_agent_tool_output
```

 builtin ：`run_shell_command`  formatter， Claude Code BashTool  shell transcript ， XML：

```yaml
name: run_shell_command
binding: nexau.archs.tool.builtin.shell_tools:run_shell_command
formatter: nexau.archs.tool.formatters.shell:format_run_shell_command_output
```

：

```text
hello world
warn: something happened

Command running in background with ID: 123. Output is being written to: /tmp/.../stdout.txt
```

custom formatter ：

```text
Sub-agent finished (sub_agent_name: explore, sub_agent_id: d6a23025ed0c).

## Answer

......
```

 XML：

```xml
<sub_agent_result name="explore" id="d6a23025ed0c" status="success">
  <body><![CDATA[
## Answer
......
  ]]></body>
</sub_agent_result>
```

#### 5. After-tool ：`tool_output` + `llm_tool_output`

 `AfterToolHookInput`  `tool_output` ，：

-  runtime 
-  LLM 

 RFC ：

```python
@dataclass
class AfterToolHookInput(BeforeToolHookInput):
    tool_output: Any = None
    llm_tool_output: Any = None


@dataclass
class HookResult:
    ...
    tool_output: Any | None = None
    llm_tool_output: Any | None = None
```

：

|  |  |  |
|------|------|------------|
| `tool_output` |  | frontend、、、、 |
| `llm_tool_output` | formatter  | LongToolOutputMiddleware、ToolResultBlock、LLM |

：

-  middleware  `tool_output`，
-  LLM-oriented middleware  `llm_tool_output`
- `LongToolOutputMiddleware`  `llm_tool_output`

：

1. **raw-oriented middleware**： `tool_output`
   - 、、frontend display
2. **LLM-oriented middleware**： `llm_tool_output`
   -  LongToolOutputMiddleware
3. ** middleware**：
   -  raw metadata  llm preview 

#### 6. ：formatter  middleware 

：

```python
raw_output = output if output is not None else content

llm_output = tool.format_output_for_llm(
    tool_input=tool_parameters,
    tool_output=raw_output,
    tool_call_id=str(call_id),
    is_error=bool(feedback.get("is_error")),
)

hook_input = AfterToolHookInput(
    agent_state=agent_state,
    sandbox=sandbox,
    tool_name=tool_name,
    tool_input=tool_parameters,
    tool_output=raw_output,
    llm_tool_output=llm_output,
    tool_call_id=tool_call_id,
)

after_result = middleware_manager.run_after_tool(hook_input, llm_output)
final_llm_output = after_result.llm_tool_output if provided else llm_output

tool_result_block = ToolResultBlock(
    tool_use_id=str(call_id),
    content=coerce_tool_result_content(final_llm_output, fallback_text=None),
    is_error=bool(feedback.get("is_error")),
)
```

 `tool.format_output_for_llm(...)` ：

1.  YAML  `formatter`
2.  Markdown formatter
3.  `ToolFormatterContext`
4.  formatter  `llm_tool_output`

#### 7.  `LongToolOutputMiddleware`

`LongToolOutputMiddleware` ：** formatter  `llm_tool_output`**。

：

1.  `llm_tool_output`，、、、
2.  `llm_tool_output`， `tool_output`
3. middleware ， `llm_tool_output`
4. `tool_output` ， LLM 

：

```python
def after_tool(self, hook_input: AfterToolHookInput) -> HookResult:
    llm_output = hook_input.llm_tool_output
    if llm_output is None:
        llm_output = hook_input.tool_output

    serialized = self._serialize_for_measurement(llm_output)
    if len(serialized) <= self.max_output_chars:
        return HookResult.no_changes()

    truncated = self._truncate(serialized)
    saved_path = self._save_to_temp_file(full_text=serialized, ...)
    hinted = truncated + self._build_hint(saved_path)

    return HookResult.with_modifications(llm_tool_output=hinted)
```

：** middleware ， LLM 。**

#### 7.1  middleware 

 `LongToolOutputMiddleware` ， after-tool middleware ：

- **AgentEventsMiddleware**： `tool_output` ，/， LLM-facing 
- **LoggingMiddleware.after_tool**： `tool_output` ， `llm_tool_output` ，“raw ”“”
- ** middleware**： LLM ， `llm_tool_output`

，。

#### 8. `coerce_tool_result_content()` 

 formatter ，：

```python
fallback_text=str(content)
```

 formatter  middleware ， Python repr。

：

- executor  `fallback_text=None`
- `coerce_tool_result_content()`  / multimodal 
-  formatter  `ToolResultBlock.content`

## 

###  1： Markdown formatter + LongToolOutputMiddleware

：

```python
{
    "status": "success",
    "sub_agent_name": "explore",
    "sub_agent_id": "d6a23025ed0c",
    "message": "Find the RuntimeBundle struct...",
    "result": "## Answer\n\nNexAU handles tool results through..."
}
```

formatter ：

```markdown
## Tool Result

### Metadata

- `status`: success
- `sub_agent_name`: explore
- `sub_agent_id`: d6a23025ed0c

### Body (`result`)

## Answer

NexAU handles tool results through...
```

，`LongToolOutputMiddleware`  Markdown ， dict。

###  2：Agent tool  custom formatter

YAML：

```yaml
name: Agent
formatter: nexau.archs.tool.formatters.agent:format_agent_tool_output
```

LLM ：

```text
Sub-agent finished (sub_agent_name: explore, sub_agent_id: d6a23025ed0c).

## Answer

NexAU handles tool results through...
```

，middleware 。

###  3： Dict  Markdown formatter

：

```python
{"status": "ok", "message": "File created", "path": "/tmp/test.py"}
```

：

```markdown
## Tool Result

### Metadata

- `status`: ok
- `message`: File created
- `path`: /tmp/test.py
```

## 

### 

|  |  |  |  |
|------|------|------|------|
| A:  `str(dict)`  `json.dumps` |  | ， |  |
| B: formatter  middleware  |  | middleware  LLM  |  |
| C:  formatter， |  |  Agent / MCP / Bash  |  |
| **D: tool YAML  custom formatter， Markdown formatter， formatter  middleware ** | 、、； XML-like  |  hook  | **** |

### 

1. **Markdown  token**， `str(dict)` ， XML  chat template
2. **hook **
3. ** Markdown formatter **，

## 

### Phase 1: formatter 

- [x]  `ToolYamlSchema`  `formatter` 
- [x]  `Tool` / `Tool.from_yaml()`  formatter ， Python `Tool(...)`  formatter 
- [x]  formatter resolver， builtin alias  import path（ `markdown` / `xml`）
- [x]  Markdown formatter， XML formatter  opt-in
- [x]  image-like / multimodal image  formatter bypass （ MCP tool  Python tool）

### Phase 2: after-tool 

- [x]  `AfterToolHookInput` / `HookResult`， `llm_tool_output`
- [x] formatter  after-tool middleware ， `llm_tool_output`
- [x]  `LongToolOutputMiddleware`， `llm_tool_output` 
- [x]  `tool_output` ， LLM-oriented  raw output
- [x]  AgentEventsMiddleware / LoggingMiddleware 

### Phase 3: ToolResultBlock 

- [x] `ToolResultBlock`  `llm_tool_output`
- [x]  `fallback_text=str(content)`  repr 
- [x]  AgentTool  custom formatter
- [x]  Bash / MCP /  formatter（ `run_shell_command`  Claude Code  formatter）

### 

|  |  |
|------|------|
| `nexau/archs/tool/tool.py` | Tool YAML schema、formatter 、Tool  |
| `nexau/archs/main_sub/execution/hooks.py` | after-tool hook / `llm_tool_output` |
| `nexau/archs/main_sub/execution/tool_executor.py` |  raw output / llm output  middleware |
| `nexau/archs/main_sub/execution/middleware/long_tool_output.py` |  formatter  |
| `nexau/archs/main_sub/execution/executor.py` | `ToolResultBlock`  `llm_tool_output` |
| `nexau/core/messages.py` | `coerce_tool_result_content()`  repr  |
| `nexau/archs/tool/formatters/` |  formatter  |

## 

### 

- `ToolYamlSchema`  `formatter` 
-  Python `Tool(...)`  formatter  `markdown`
- formatter resolver ： → `markdown`、builtin alias（`markdown` / `xml`）、import path
-  Markdown formatter  Dict、 `result` Dict、、
-  Markdown formatter  display-only  `content` / `result`  Dict，
- MCP tool / Python tool  image-like output  bypass  formatter
- `LongToolOutputMiddleware`  `llm_tool_output` ， `tool_output`

### 

- Sub-agent tool： `result` ，LLM  formatter  Dict repr
- `LongToolOutputMiddleware` + formatter：formatter  LLM ，middleware ， LLM  formatter 
-  formatter：YAML  custom formatter ，LLM  Markdown
- `run_shell_command`：LLM  Claude Code  shell （stdout / stderr / background info）， metadata-heavy dict  XML
- AgentEventsMiddleware  raw `tool_output` ， `llm_tool_output` 

### 

-  Sub-agent ， tool_result  `{'status': ...}`  repr
- ，LLM  Markdown / custom formatter ， dict 

## 

1. builtin formatter alias  `markdown` / `xml`， formatter  `markdown`
2.  Python  `Tool(...)`  `formatter` ， Markdown formatter
3.  MCP tool  Python tool， / image-like multimodal ， **bypass  formatter**
4. after-tool  **`tool_output` + `llm_tool_output` **， middleware 
5. display-only ， `content`  `result` ， LLM-facing output
6. `run_shell_command`  shell formatter， Claude Code BashTool  LLM stdout / stderr / background 

## 

1.  `plain` formatter，builtin alias ？
2. AgentEventsMiddleware  raw output  llm output？
3. `llm_tool_output`  tracing ， formatter ？

## 

- Claude Code (`~/claude_code_2188`)  per-tool tool-result formatting 
- NexAU `nexau/archs/tool/tool.py` — tool YAML 
- NexAU `nexau/archs/main_sub/execution/hooks.py` — middleware hook 
- NexAU `nexau/archs/main_sub/execution/tool_executor.py` — after-tool middleware 
- NexAU `nexau/archs/main_sub/execution/executor.py` — `ToolResultBlock` 
- NexAU `nexau/core/messages.py` — `coerce_tool_result_content()`