# RFC-0006: FrameworkContext — 

- ****: draft
- ****: P1
- ****: `architecture`, `dx`, `type-safety`
- ****: nexau-core (tool, agent, middleware)
- ****: 2026-03-07
- ****: 2026-03-07

## 

 `AgentState`  `FrameworkContext`， API， `GlobalStorage`  KV、`inspect.signature()` 、`getattr` 。

## 

 `AgentState` ：

### 1. GlobalStorage  Service Locator

```python
# tool_executor.py —  Any，
tracer: BaseTracer | None = agent_state.get_global_value("tracer")

# skill.py — key ，
skills: dict[str, Skill] = agent_state.get_global_value("skill_registry", {})
```

`GlobalStorage`  agent ， `tracer`、`skill_registry` ，：
-  `Any`
- key ， IDE 
- ，

### 2.  inspect 

```python
# tool.py L198-210 — 
sig = inspect.signature(self.implementation)
if "agent_state" not in sig.parameters:
    filtered_params.pop("agent_state", None)
if "global_storage" in sig.parameters:
    filtered_params["global_storage"] = agent_state.global_storage
```

 `agent_state`（ `state`、`ctx` ），。，。

### 3. getattr 

```python
# recall_sub_agent_tool.py — 
executor = getattr(agent_state, "_executor", None)
subagent_manager = getattr(executor, "subagent_manager", None)
```

 sub-agent， `AgentState`  API， `getattr` 。

### 4. extra_kwargs 

`extra_kwargs` （`base_url`、`api_key`），（ `tool_registry`）。，。

## 

### 

 `FrameworkContext` ，/。：

1. **，** —  `ctx.tools.search()`， `ToolRegistry`
2. **** — 
3. ** API** — （`tools`、`skills`、`agents`、`sandbox`、`variables`），IDE 
4. **** —  `ctx: FrameworkContext` ， `agent_state` + `global_storage` + `extra_kwargs` 

### 

#### FrameworkContext 

```python
class FrameworkContext:
    """Typed framework context for tool and middleware authors.

    RFC-0006:  AgentState，。
     ctx: FrameworkContext 。
     API ，IDE  ctx.tools.  tools 。
    """

    # ══════════════════════════════════════
    # ══════════════════════════════════════
    agent_name: str
    agent_id: str
    run_id: str
    root_run_id: str

    # ══════════════════════════════════════
    #  API
    # ══════════════════════════════════════
    tools: ToolsAPI
    skills: SkillsAPI
    agents: AgentsAPI
    sandbox: SandboxAPI
    variables: VariablesAPI
    history: HistoryAPI       # RFC-0026 ：typed history （compaction / /clear /  /undo）

    # ══════════════════════════════════════
    # Team（， property）
    # ══════════════════════════════════════
    @property
    def team_state(self) -> AgentTeamState | None: ...

    # ══════════════════════════════════════
    # Tracing（）
    # ══════════════════════════════════════
    @property
    def tracer(self) -> BaseTracer | None: ...

    # ══════════════════════════════════════
    # ══════════════════════════════════════
    @property
    def parent(self) -> FrameworkContext | None: ...

    # ══════════════════════════════════════
    # （ agent ）
    # ══════════════════════════════════════
    @property
    def global_storage(self) -> GlobalStorage: ...
```

####  API 

```python
class ToolsAPI:
    """Tools management API.

    RFC-0006:  ToolRegistry，
    """

    def search(self, *, query: str, max_results: int = 5) -> list[Tool]:
        """Search deferred tools and inject matches.

        ， LLM  function call。
         "+keyword" 。
        """
        ...

    def add(self, *, tool: Tool) -> None:
        """Dynamically add an eager tool to the current execution.

         ToolRegistry， Executor 。
        Runtime-added deferred tools are not supported.
        """
        ...

    def get(self, *, name: str) -> Tool | None:
        """Look up a tool by name."""
        ...


class SkillsAPI:
    """Skills management API.

    RFC-0006:  get_global_value("skill_registry")
    """

    def get(self, name: str) -> Skill | None:
        """Look up a skill by name."""
        ...

    def list(self) -> list[str]:
        """List all available skill names."""
        ...


class AgentsAPI:
    """Sub-agent invocation API.

    RFC-0006:  getattr(agent_state, "_executor").subagent_manager
    """

    def call(self, name: str, message: str) -> str:
        """Call a sub-agent by name and return its response."""
        ...


class SandboxAPI:
    """Sandbox access API.

    RFC-0006:  sandbox  sandbox env 
    """

    def get(self) -> BaseSandbox | None:
        """Get the sandbox for file/shell operations."""
        ...

    def get_env(self, key: str, default: str | None = None) -> str | None:
        """Get a sandbox environment variable."""
        ...

    @property
    def all_env(self) -> dict[str, str]:
        """All sandbox environment variables."""
        ...


class VariablesAPI:
    """Runtime variables access API.

    RFC-0006: 
    """

    def get(self, key: str, default: str | None = None) -> str | None:
        """Get a runtime variable."""
        ...

    @property
    def all(self) -> dict[str, str]:
        """All runtime variables."""
        ...


class HistoryAPI:
    """Write-side typed-event API for agent history.

    RFC-0026:  RFC-0022 Phase 3  ``agent_state.history`` 。
    Middleware /  ``ctx.history.replace(messages, extra=variant)``
    emit  typed REPLACE event（compaction / ``/clear`` / 
    ``/compact <focus>``）， HistoryList。

     RPC-friendly： Pydantic （Message +
    ReplaceVariantBase ）， in-process object handle ——
     lambda tool /  middleware  ctx ， RPC stub。

    Narrow first： `replace`。APPEND（ list ）/ UNDO / 
     production caller 。
    """

    def replace(
        self,
        messages: list[Message],
        *,
        extra: ReplaceVariantBase,  # required, kw-only
    ) -> None:
        """Emit a typed REPLACE event."""
        ...
```

#### 

```python
# ── Before ──

# tool_search.py —  ToolRegistry
def tool_search(query: str, tool_registry: ToolRegistry, max_results: int = 5):
    matched = tool_registry.search(query, max_results=max_results)

# skill.py —  GlobalStorage  skill_registry
def load_skill(skill_name: str, agent_state: AgentState):
    skills = agent_state.get_global_value("skill_registry", {})
    skill = skills.get(skill_name)

# recall_sub_agent_tool.py — getattr 
def recall_sub_agent(name: str, message: str, agent_state: AgentState):
    executor = getattr(agent_state, "_executor", None)
    mgr = getattr(executor, "subagent_manager", None)
    result = mgr.call(name, message)

# read_file.py —  sandbox
def read_file(file_path: str, agent_state: AgentState | None = None):
    sandbox = get_sandbox(agent_state)


# ── After ──

# tool_search.py
def tool_search(query: str, ctx: FrameworkContext, max_results: int = 5):
    matched = ctx.tools.search(query=query, max_results=max_results)

# skill.py
def load_skill(skill_name: str, ctx: FrameworkContext):
    skill = ctx.skills.get(skill_name)

# recall_sub_agent_tool.py
def recall_sub_agent(name: str, message: str, ctx: FrameworkContext):
    result = ctx.agents.call(name, message)

# read_file.py
def read_file(file_path: str, ctx: FrameworkContext | None = None):
    sandbox = ctx.sandbox.get() if ctx else None
```

#### 

`Tool.execute()` ：

```python
# Before:  reserved key， inspect
reserved_keys = {"agent_state", "global_storage"}
sig = inspect.signature(self.implementation)
if "agent_state" not in sig.parameters:
    filtered_params.pop("agent_state", None)
if "global_storage" in sig.parameters:
    filtered_params["global_storage"] = agent_state.global_storage

# After:  reserved key
reserved_keys = {"ctx"}
sig = inspect.signature(self.implementation)
if "ctx" in sig.parameters:
    filtered_params["ctx"] = framework_context
```

#### FrameworkContext 

 `Executor`  run ，：

```python
# executor.py
def _build_framework_context(self) -> FrameworkContext:
    return FrameworkContext(
        agent_name=self.agent_name,
        agent_id=self.agent_id,
        run_id=self.run_id,
        root_run_id=self.root_run_id,
        # ，API 
        _tool_registry=self._tool_registry,
        _skill_registry=self._skill_registry,
        _sandbox=self._sandbox,
        _sandbox_manager=self._sandbox_manager,
        _global_storage=self.global_storage,
        _variables=self._variables,
        _team_state=self._team_state,
        _tracer=self._tracer,
        _parent_context=self._parent_framework_context,
    )
```

 API  `FrameworkContext.__init__` ，：

```python
class FrameworkContext:
    def __init__(self, *, _tool_registry, ...):
        self.tools = ToolsAPI(_tool_registry=_tool_registry)
        self.skills = SkillsAPI(_skill_registry=_skill_registry)
        self.agents = AgentsAPI(_executor=_executor)  # Phase 1: not yet implemented
        self.sandbox = SandboxAPI(_sandbox=_sandbox, _sandbox_manager=_sandbox_manager, _variables=_variables)
        self.variables = VariablesAPI(_variables=_variables)
```

#### GlobalStorage 

 GlobalStorage  key：

| Key |  |
|-----|-------|
| `"tracer"` | `ctx.tracer` |
| `"skill_registry"` | `ctx.skills.get()` / `ctx.skills.list()` |
| ~~`"tool_registry"`~~ |  `GlobalStorage` ； `Executor`  `FrameworkContext`  `ctx.tools.search()`  |
| `"parallel_execution_id"` |  Executor ， `BeforeToolHookInput`  |

GlobalStorage ： agent 。

#### extra_kwargs 

|  |  |
|------|------|
| （`base_url`、`api_key`） | `extra_kwargs`（） |
| （registry、sandbox、tracer） | `FrameworkContext`  API（） |
|  agent  | `GlobalStorage`（，） |

### 

####  FrameworkContext

```python
def my_custom_tool(query: str, ctx: FrameworkContext) -> str:
    """A custom tool that uses framework services."""

    #  sandbox
    sandbox = ctx.sandbox.get()
    if sandbox is not None:
        result = sandbox.execute(query)
        return result

    api_key = ctx.variables.get("api_key")

    new_tool = Tool.from_dict(...)
    ctx.tools.add(tool=new_tool)

    #  deferred 
    matched = ctx.tools.search(query="web fetch")

    return "done"
```

#### Middleware  FrameworkContext

```python
class MyMiddleware(Middleware):
    def before_tool(self, hook_input: BeforeToolHookInput) -> HookResult:
        ctx = hook_input.ctx
        tracer = ctx.tracer
        if tracer:
            tracer.start_span("tool_call")
        return HookResult()
```

#### Team  FrameworkContext

```python
def broadcast(message: str, ctx: FrameworkContext) -> str:
    """Broadcast a message to all team members."""
    team = ctx.team_state
    if team is None:
        return "Not in a team context"
    team.message_bus.broadcast(sender=ctx.agent_id, content=message)
    return "Broadcast sent"
```

##  API 

：

|  |  |  |
|----------|--------|------|
| `agent_state.get_sandbox()` | `ctx.sandbox.get()` | ✓ |
| `agent_state.get_sandbox_env(key)` | `ctx.sandbox.get_env(key)` | ✓ |
| `agent_state.all_sandbox_env` | `ctx.sandbox.all_env` | ✓ |
| `agent_state.agent_id` | `ctx.agent_id` | ✓ |
| `agent_state.agent_name` | `ctx.agent_name` | ✓ |
| `agent_state.run_id` | `ctx.run_id` | ✓ |
| `agent_state.root_run_id` | `ctx.root_run_id` | ✓ |
| `agent_state.get_variable(key)` | `ctx.variables.get(key)` | ✓ |
| `agent_state.all_variables` | `ctx.variables.all` | ✓ |
| `agent_state.team_state` | `ctx.team_state` | ✓ |
| `agent_state.parent_agent_state` | `ctx.parent` | ✓ |
| `agent_state.add_tool(tool)` | `ctx.tools.add(tool)` | ✓ |
| `get_global_value("tracer")` | `ctx.tracer` | ✓ |
| `get_global_value("skill_registry")` | `ctx.skills.get(name)` / `.list()` | ✓ |
|  `ToolRegistry`  | `ctx.tools.search()` | ✓ |
| `getattr(agent_state, "_executor").add_tool()` | `ctx.tools.add(tool=tool)` | ✓ |
| `getattr(executor, "subagent_manager")` | `ctx.agents.call(name, msg)` | ✓ |
| `set_global_value("parallel_execution_id")` |  Executor， | ✓ |
| `agent_state.global_storage` | `ctx.global_storage`（） | ✓ |
| `get_context_value("__nexau_full_trace_*")` | ， | ✓ |

## 

### 

####  A： ToolContext

 `ToolContext` dataclass，， `AgentState`。

****：， `AgentState`  `ToolContext` 。 `AgentState`。

####  B： AgentState， typed properties

 `AgentState`  `@property`  typed 。

****： — `AgentState` ""，" + "。。

####  C： API

 `FrameworkContext` （`ctx.search_tools()`、`ctx.get_skill()`）。

****： API ，。 `ctx.tools.`  tools ，。

### 

1. **** —  `agent_state` 
2. **** —  `agent_state`  `ctx` 
3. **** —  API （`ctx.tools.get()` vs `ctx.get_tool()`），

## 

### 

- [ ] Phase 1:  `FrameworkContext`  API （`ToolsAPI`、`SkillsAPI` ）
- [ ] Phase 2: `Tool.execute()`  `ctx` （ `agent_state` ）
- [ ] Phase 3: ：`tool_search`、`load_skill`、`recall_sub_agent`、file/shell tools 
- [ ] Phase 4:  middleware hook  `HookInput`， `ctx` 
- [ ] Phase 5:  GlobalStorage  key（`tracer`、`skill_registry`、`parallel_execution_id`）
- [ ] Phase 6:  `agent_state` （deprecation warning）

### 

- `nexau/archs/main_sub/agent_state.py` —  AgentState， FrameworkContext 
- `nexau/archs/main_sub/agent_context.py` — GlobalStorage 
- `nexau/archs/tool/tool.py` — Tool.execute() 
- `nexau/archs/main_sub/execution/tool_executor.py` — ToolExecutor 
- `nexau/archs/main_sub/execution/executor.py` — Executor 
- `nexau/archs/tool/builtin/` — （）
- `nexau/archs/main_sub/execution/middleware/` — （）
- `nexau/archs/main_sub/team/tools/` — Team （）

## 

### 

- `FrameworkContext`  API 
- `ToolsAPI.search()` / `.add()` / `.get()`  ToolRegistry
- `SkillsAPI.get()` / `.list()`  skill registry
- `AgentsAPI.call()`  SubAgentManager
- `SandboxAPI.get()`  sandbox_manager lazy init
- `Tool.execute()`  `ctx` 
- `ctx`  `agent_state` （`ctx` ）
- `extra_kwargs`  `ctx` 

### 

- ： `ctx.tools.search()`  deferred tool
- ： `ctx.agents.call()`  agent
- ：middleware  `ctx.tracer`  span
- ：team  `ctx.team_state` 

### 

-  `agent_state`  deprecation 
- IDE ：`ctx.tools.`  `search`、`add`、`get`

## 

1. ****：`FrameworkContext` vs `AgentContext` vs `Context` — 
2. **Middleware **：`HookInput`  `agent_state`  `ctx`，
3. **`AgentState` **： `FrameworkContext` 
4. **`get_context_value` / `set_context_value` **： per-execution ， AgentContext。 per-instance  `FrameworkContext._internal_state: dict`

## 

- RFC-0005: Tool Search — （ GlobalStorage ）
- [CLAUDE.md Type Safety Guidelines](../CLAUDE.md) — 