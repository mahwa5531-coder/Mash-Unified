# RFC-0024: Agent Plugin 

- ****: draft
- ****: P1
- ****: `architecture`, `dx`, `security`, `mcp`, `middleware`, `skills`
- ****: `nexau/archs/main_sub/`, `nexau/archs/tool/`, `docs/`, `tests/`
- ****: 2026-05-07
- ****: 2026-05-13

## 

NexAU  plugin  (MCP / Skill / Middleware / sub-agent / ToolSearch / LoadSkill), " AgentConfig" 。 RFC  `plugin.yaml` manifest + `PluginAdapter`,plugin  `mcp_servers / middlewares / skills / sub_agents / tools`,runtime 。

:

1.  ESLint —— plugin ,agent YAML ;
2. manifest  VSCode extension —— `engines` + `config` + `contributes`;
3.  (ToolSearch), (LoadSkill);
4. plugin  agent ****,/ plugin ;
5.  fail-fast, prefix / alias / on-off。

## 

NexAU  (`mcp_servers` / `skills` / `middlewares` / `sub_agents` / `ToolSearch` / `LoadSkill`) , YAML 。 ""、"" , YAML ,、、。

:plugin  " YAML",;MCP tool  `ToolSearch`  token ;,。

2026-05-08  plugin (),:

1. Agent  ——  / MCP / middleware / skill / sub-agent;
2.  —— ;
3.  —— plugin  `plugin.yaml`  schema, form;
4. Runtime  —— agent YAML  plugin , adapter 。

## 

### 

1.  `plugin.yaml` manifest , VSCode extension;
2. `PluginAdapter`  plugin contributions  `AgentConfig`,runtime ;
3. plugin  schema  adapter ,;
4. `use:`  scheme  (Phase 1  `path:`), plugin (registry / git / archive) 。

### 

1.  MCP, RPC;
2.  plugin store / marketplace /  CLI;
3. :plugin pack (`extends`)、activation events、 plugin  (`${config.<other>.*}`)、MCP discovered tool  per-call 、partial load、 `use:` scheme;
4.  plugin  agent  ( alias / );
5.  `SubAgentConfigEntry` schema ( sub-agent params , schema , [schema.py:39](https://github.com/china-qijizhifeng/nexau/blob/main/nexau/archs/main_sub/config/schema.py#L39)  `TODO(hanzhenhua)`);
6. plugin  contribute `tracers / token_counter / before_*_hooks / after_*_hooks` (application-level  plugin scope);
7. 、secret、sandbox enforcement;
8.  RFC。

### 

```mermaid
flowchart LR
    subgraph Package["Plugin "]
        Manifest["plugin.yaml"]
        Assets["middlewares / skills /<br/>sub_agents / tools"]
    end
    subgraph Adapter["PluginAdapter ()"]
        Parse[" + "]
        Expand[" contributions"]
    end
    subgraph NexAU[""]
        Config["AgentConfig"]
        Reg["ToolRegistry /<br/>MiddlewareManager /<br/>SkillRegistry"]
    end
    Manifest --> Parse --> Expand
    Assets --> Expand
    Expand --> Config --> Reg

    style Package fill:#E0F2FE,stroke:#06B6D4
    style Adapter fill:#FEF3C7,stroke:#F59E0B
    style NexAU fill:#D1FAE5,stroke:#10B981
```

Plugin , `system_prompt_suffix / mcp_servers / middlewares / skills / sub_agents / tools`,runtime  plugin。

### 

| # |  |  |
|---|---|---|
| 1 | Plugin , runtime  |  runtime primitive  |
| 2 | manifest  VSCode  (`engines` / `config` / `contributes`) | plugin.yaml ;`contributes` ;`config.properties` ↔ agent yaml `plugins[].config`  VSCode `contributes.configuration` ↔ `settings.json`, NexAU  |
| 3 | `contributes.*`  nexau  (`yaml_path` / `binding` / `extra_kwargs` / `type` / `command` / `args` / `config_path` / `import`) | adapter  loader, schema |
| 4 |  (`ToolSearch`), (`LoadSkill`) | plugin , LLM payload  |
| 5 | : `use:`  agent yaml  → fail-fast |  trace /  / MCP  / prompt ;/ plugin  |
| 6 | sub-agent YAML  `plugins`  | plugin , scope /  / MCP server N  |
| 7 | `use:`  scheme  (`<scheme>:<body>`);Phase 1  `path:`(resolver: ) |  plugin (`pkg:` / `git+https:` / `https:`)  Phase 1 ;`use:` "resolver strategy" |
| 8 |  fail-fast, prefix / alias / on-off | ,Phase 2  |
| 9 | plugin manifest  (`${config.project_id}`) |  agent yaml  `${env.NAME}` / `${variables.foo}` , YAML  |
| 10 | plugin  `system_prompt_fragment`, adapter  `system_prompt_suffix` | ,; plugin  always-on , prompt suffix , `system_prompt_type: file/jinja`  |

## 

### Plugin 

```text
my-plugin/
├── plugin.yaml                          # 
├── middlewares/<file>.py
├── skills/<name>/SKILL.md
├── sub_agents/<name>.yaml
└── tools/<name>/
    ├── <name>.tool.yaml
    └── handler.py
```

 `plugin.yaml`。 manifest  adapter 。

> : `system_prompt_fragment`  always-on prompt, plugin , persona /  / 。 `contributes.skills[*]`, token。

### plugin.yaml manifest

```yaml
type: plugin
name: north.customer-service             # , scoped
version: "1.0.0"
description: 

engines:
  nexau: ">=0.3.0,<0.5.0"                # NexAU 

config:
  properties:
    project_id:
      type: string
      required: true
      description: Project ID
    region:
      type: string
      enum: [shanghai, beijing]
      default: shanghai
    limit:
      type: integer
      default: 8

system_prompt_fragment: |
  You are using the customer-service plugin for ${config.region}.
  Follow the escalation and audit policy from this plugin.

contributes:
  mcp_servers:                            #  = AgentConfigSchema.mcp_servers
    - name: customer-service/runtime
      type: stdio
      command: uv
      args: ["run", "${plugin.dir}/tools/runtime_server.py"]
      env:
        REGION: ${config.region}

  tools:                                  #  = ToolConfigEntry
    - name: query_order
      yaml_path: ${plugin.dir}/tools/query_order/query_order.tool.yaml
      binding: tools.query_order.handler:query_order
      extra_kwargs:
        project_id: ${config.project_id}

  skills:                                 # name + path (path  SKILL.md)
    - name: customer-service/main
      path: skills/main

  sub_agents:                             #  = SubAgentConfigEntry
    - name: escalation
      config_path: sub_agents/escalation.yaml

  middlewares:                            #  = HookImportConfig + name
    - name: customer-service/audit
      import: ./middlewares/audit.py:AuditMiddleware
      params:
        project_id: ${config.project_id}
```

#### 

|  |  |  |
|---|---|---|
| `type` |  |  `plugin`, `type: agent`  |
| `name` |  | plugin ID, |
| `version` |  | semver |
| `description` |  |  /  |
| `engines.nexau` |  | NexAU  (semver range) |
| `config.properties` |  |  schema, § |
| `system_prompt_fragment` |  | plugin  always-on prompt , `system_prompt_suffix` |
| `contributes` |  | plugin  |

#### `contributes` 

|  |  schema |  |
|---|---|---|
| `mcp_servers[]` | `AgentConfigSchema.mcp_servers`  `MCPServerConfig` (name / type / command / args / url / headers / env / timeout / disable_parallel / permissions / tool_permissions) | `args`  `${plugin.dir}` `${config.*}` |
| `tools[]` | `ToolConfigEntry` (name / yaml_path / binding / lazy / as_skill / defer_loading / extra_kwargs) | `yaml_path`  plugin  tool YAML, `${plugin.dir}` |
| `skills[]` | `{ name, path }` | path  `SKILL.md`,plugin  |
| `sub_agents[]` | `SubAgentConfigEntry` (name / config_path) | config_path  plugin ; sub-agent YAML  `${plugin.dir}` |
| `middlewares[]` | `HookImportConfig` (import / params) + `name` () | `import`  plugin  Python  |

#### 

-  plugin ,;
-  `command`, `${plugin.dir}` ;
- plugin  namespace:`${plugin.dir}` (plugin )  `${config.<name>}` (manifest `config.properties` );
- `${plugin.dir}`  ( MCP `args`、tool `yaml_path`), `system_prompt` ;
- plugin-contributed sub-agent YAML  agent YAML, `${config.<name>}`, `${plugin.dir}`;
- `${config.<name>}`  → fail-fast;
- `${config.<name>}`  plugin , plugin  config。

### `use:` 

agent yaml  `plugins[].use: <scheme>:<body>`  plugin。scheme  **resolver strategy** ( plugin ),。

Phase 1 **** `path:` scheme, YAML  `use` , `:`  YAML 。

| Scheme | Resolver | body |
|---|---|---|
| `path:` |  resolve, |  (`./` `../`, agent yaml )  (`/`) |

 scheme (`pkg:` / `git+https:` / `https:` ) Phase 1 :`Plugin URI scheme '<scheme>' is not supported in Phase 1`。 RFC。

### Agent YAML 

```yaml
type: agent
name: support_agent
llm_config:
  model: gpt-4o-mini
plugins:
  - use: "path:./plugins/north.customer-service"
    config:
      project_id: "proj_xxx"
      region: shanghai
      limit: 8
```

:****。manifest  `contributes.*`  `AgentConfig`, per-capability `on/off`、alias 。

#### 

1. **agent yaml **:`plugins[].config`  `${env.NAME}` / `${variables.foo}`, plugin ;
2. **plugin manifest **:adapter  `resolved config` , manifest  `${config.<name>}`  `${plugin.dir}`;plugin-contributed sub-agent YAML inline  `${config.<name>}`。

 `${env.NAME}` , prompt  command args。

#### 

Phase 1 。 namespace ,。

|  |  |  |  |  |
|---|---|---|---|---|
| agent yaml  | `${env.NAME}` | `os.environ["NAME"]` | agent YAML  ( `plugins[].config`) | , fail-fast |
| agent yaml  | `${variables.foo.bar}` | agent YAML  `variables`  | agent YAML  ( `plugins[].config`) | , scalar ; `variables`  `AgentConfig` |
| plugin manifest  | `${plugin.dir}` | `use:` resolver  plugin  |  plugin  `plugin.yaml` contributions |  plugin  / ;adapter ; sub-agent YAML |
| plugin manifest  | `${config.<name>}` |  plugin  `plugins[].config` + manifest default |  plugin  `plugin.yaml` contributions  plugin-contributed sub-agent YAML inline  | `<name>`  manifest `config.properties`; plugin |

:

- `${workspace.*}` / `${rootDir}` / `${cwd}`: Phase 1  workspace , CLI、 artifact、sub-agent ;
- `${agent.*}`: agent metadata  plugin manifest, plugin  agent ;
- `${this_file_dir}`:  agent YAML loader , plugin manifest 。

###  schema

`config.properties`  VSCode `package.json contributes.configuration`, adapter ,。

|  |  |
|---|---|
| `type` | `string` / `integer` / `number` / `boolean` / `string_array` |
| `required` |  `plugins[].config`  |
| `default` | , `type` |
| `description` | , prompt |
| `enum` | , `string`  |

:

|  |  |  |
|---|---|---|
| MCP server `env` / `args` |  | `contributes.mcp_servers[*]` |
| tool `extra_kwargs` |  tool , | `contributes.tools[*]` ( `ToolConfigEntry.extra_kwargs` ) |
| middleware `params` | runtime  | `contributes.middlewares[*]` ( `HookImportConfig.params` ) |

 tool `extra_kwargs`  key  tool  `input_schema` ;,adapter fail-fast。

### Sub-agent 

#### sub-agent YAML  `plugins`  → 

 sub-agent YAML  plugin  (via `contributes.sub_agents`)  agent yaml  declare (via top-level `sub_agents`), `plugins`  sub-agent :

- ;
-  contributions;
-  YAML  main agent  sub-agent;
- adapter  `plugins` , INFO  log (`sub_agent_load plugins_ignored=<n>`),""。

:plugin , scope、、MCP server N 、trace  plugin agent path 。

#### plugin-contributed sub-agent  config 

`contributes.sub_agents[*].config_path`  YAML  plugin 。adapter  plugin `resolved config` ,**inline ** `${config.<key>}`, `AgentConfig.from_yaml()`。sub-agent YAML  `${plugin.dir}`, agent YAML, plugin  agent 。**** `SubAgentConfigEntry` schema 。

#### agent yaml  declare  sub-agent → Phase 1  plugin config

main agent yaml  `sub_agents[].config_path`  YAML ,Phase 1  sub-agent  main  plugin config。: `SubAgentConfigEntry` (`extra="forbid"` +  `name + config_path`)  params , schema  ([schema.py:39](https://github.com/china-qijizhifeng/nexau/blob/main/nexau/archs/main_sub/config/schema.py#L39)  TODO), RFC 。

 sub-agent  plugin , `contributes.sub_agents`  ( plugin-contributed ), sub-agent YAML 。

### 

|  | plugin  |  |
|---|---|---|
| `mcp_servers` / `skills` / `sub_agents` / `tools` | plugin  |  plugin  → fail-fast |
| `middlewares` | plugin  `plugins[]`  + manifest , YAML `middlewares`  plugin middleware  | plugin middleware  fail-fast |
|  `system_prompt_fragment` | plugin fragment  `plugins[]`  `system_prompt_suffix`; YAML `system_prompt_suffix`  plugin fragment  | — |
| `system_prompt` / `llm_config` / `sandbox_config` / `before_*_hooks` / `after_*_hooks` / `tracers` / `token_counter` | plugin  contribute | — |

: YAML  plugin ; fail-fast, prefix。

### 

Phase 1  strict fail-fast, `AgentConfig.from_yaml(..., options=AgentConfigLoadOptions(strict=...))` :

- `strict=True` ():plugin contribution  /  `ConfigError`;
- `strict=False`:plugin contribution  /  warning, contribution, `skipped_components` 。

 contract / safety  `strict=False` , fail-fast:

- `plugin.yaml`  schema ;
- `engines.nexau`  NexAU ;
- plugin  plugin ;
- `plugins[].config` 、;
- `${config.<name>}` ;
- tool / middleware / skill / sub-agent / MCP server ;
-  `use:`  agent yaml  ();
- `plugins[].use`  scheme;
- plugin  contribute  (`tracers` / `token_counter` / `before_*_hooks` / `after_*_hooks`)。

 partial load / graceful degradation  Phase 1 ; agent config loader  `strict=False` 。

###  / 

:**plugin  `AgentConfig`  name  manifest `contributes.*.name` ,adapter **。 plugin , adapter  magic。

:

- `plugin.name` ,**** scoped  (`north.customer-service` / `north/customer-service`),;
- **Tool name**: plugin  ( `query_order`), manifest  `<plugin>/`  —— tool name , prompt noise  tool ;
- **Skill / Middleware / Sub-agent / MCP server name**:  registry key,**** plugin  manifest  `<plugin>/<resource>`  ( `customer-service/main`) ; convention  schema ,manifest  `main` ,plugin ;
- adapter ****,manifest  —— , trace / log / config  manifest ;
-  name  ( vs plugin、plugin vs plugin) → fail-fast,、 `source_id` ( §Source ID  Observability)  ( manifest name、, plugin);
- per-capability `on/off`、alias、 prefix  RFC,。

### Source ID  Observability

`source_id`  adapter , resource name  ——  resource name  `<plugin>/` ,trace / log / debug  plugin。

:

```
source_id = plugin:<plugin_name>:<kind>:<resource_name>     # plugin 
source_id = local:<kind>:<resource_name>                    #  YAML 
```

 `<kind>` ∈ { `tool`, `skill`, `middleware`, `sub_agent`, `mcp_server` };`plugin_name`  plugin manifest  `name`;`resource_name`  manifest `contributes.*[i].name`  YAML 。

:

- adapter  contribution  `source_id`, resource name ;
-  ( plugin )  `source_id = local:<kind>:<name>`, plugin / ****, conditional ;
-  `nexau.archs.tracer`: tool span  `attributes["source_id"]`  tool  source_id;agent / sub_agent span  `attributes["plugin_sources"]`  span  plugin source_id  ();
- : plugin  log  `extra={"source_id": ...}`, grep / filter " plugin ";
- `source_id`  ASCII , ≤ 256;
- `source_id` **** ( tool description / system prompt / tool_call_response), trace 。

## 

|  |  |  |
|---|---|---|
|  plugin RPC /  MCP server / Plugin  runtime primitive |  | 、、 |
| Manifest + adapter  AgentConfig |  | 、、 |
|  nexau flat  plugin.yaml |  | , contribution  |
|  plugin  (alias) |  |  instance ,trace /  /  / prompt  |
| sub-agent YAML  declare plugins |  |  scope /  / N  MCP / trace  agent path |
| `plugins[].path`  |  |  source  breaking change |
| `use:`  scheme  (`path:` ) |  | , cleaner,scheme  resolver strategy  |
|  MCP prompts  Skill |  | MCP prompts , |

:

-  `ToolSearch`;
- middleware ,;
- manifest schema , breaking change ;
- plugin.yaml (VSCode )  agent.yaml (flat) , plugin , mental model 。

## 

### Step 1: Schema  manifest 

-  `AgentConfigSchema`  `plugins` , `PluginEntryConfig { use, config }`;
-  `nexau/archs/main_sub/plugin/manifest.py` (pydantic schema for `plugin.yaml`);
-  `PluginAdapter`,`use:`  `path:` scheme;
- 、`config.properties` 、`${env}` / `${variables}` / `${config.*}` / `${plugin.dir}` ;
- `PluginAdapter`  `AgentConfigLoadOptions.strict`, tools / skills / sub_agents / hooks ;
-  `AgentConfigSchema`  unknown top-level field `extra="forbid"`, NexAU  `plugins`  fail-fast。

### Step 2: Contributions 

-  `system_prompt_fragment`  `system_prompt_suffix`, `system_prompt`;
- `contributes.{mcp_servers, tools, skills, sub_agents, middlewares}` , schema;
- plugin-contributed sub-agent YAML  inline  `${config.<key>}`;
- sub-agent  YAML  `plugins` , INFO log;
-  YAML  plugin ,。

### Step 3:  / metadata / 

- tool / middleware / skill / sub-agent / mcp_server  fail-fast;
- : `use:`  → fail-fast;
-  scheme ;
-  §Source ID  Observability :adapter  plugin /  `source_id`,tracer  tool span `attributes["source_id"]` / agent span `attributes["plugin_sources"]` ,plugin  log  `extra={"source_id": ...}`;
-  fixture plugin 。

###  RFC  ( RFC )

 `use:` scheme / per-capability `on/off` / alias / plugin pack (`extends`) / activation events /  plugin `${config.<other>.*}`  / MCP discovered tool  per-call  / partial load / `SubAgentConfigEntry` params 。

## 

### 

- `plugins` schema : `use` /  scheme /  `use:`  → fail-fast;
- `engines.nexau`  → fail-fast;
- manifest 、、;
- `plugins[].config`  `config.properties` : /  /  / enum / ;
- :agent yaml  `${env}/${variables}` ,plugin manifest  `${config.*}` ;
- `${config.<name>}`  → fail-fast;
- plugin manifest  `${...}` → fail-fast;
- `PluginAdapter`  `system_prompt_fragment`  `contributes.{mcp_servers, tools, skills, sub_agents, middlewares}`  schema;
- `system_prompt_fragment`  agent `system_prompt` / `system_prompt_suffix` , system prompt ;
- plugin-contributed sub-agent YAML  `${config.<key>}`  inline ;
- `AgentConfigLoadOptions(strict=False)` ,plugin contribution  /  warning + skip, manifest schema / engine / config  /  fail-fast;
- sub-agent YAML  `plugins` , INFO log;
- tool `extra_kwargs`  `input_schema`  → fail-fast;
- plugin  contribute `tracers` / `token_counter` / `before_*_hooks` / `after_*_hooks` → fail-fast;
-  fail-fast ( vs plugin、plugin vs plugin)。

### 

- fixture plugin  agent yaml `plugins` , skill / sub-agent / middleware / MCP server / tool ;
- plugin tool  `ToolSearch` ;
- plugin-contributed sub-agent  plugin `${config.<key>}`;
-  plugin +  tool,:tool span  `attributes["source_id"]`  ( conditional); plugin tool  `plugin:` , tool  `local:` ;agent span  `attributes["plugin_sources"]`  plugin source_id ;`source_id`  tool description  tool_call_response ;
-  `use:`  agent yaml  → 。

### 

1.  `north.customer-service` fixture plugin;
2. agent yaml  `use: "path:./..."` + `config` ;
3.  plugin ;
4.  trace  plugin / tool / middleware / sub-agent 。

## 

|  |  |
|---|---|
| `nexau/archs/main_sub/config/base.py` | `AgentConfigBase`  `plugins`  |
| `nexau/archs/main_sub/config/schema.py` |  `PluginEntryConfig` (use + config);`AgentConfigSchema`  `plugins` |
| `nexau/archs/main_sub/config/config.py` | builder  plugin contributions |
| `nexau/archs/main_sub/plugin/manifest.py` |  manifest schema |
| `nexau/archs/main_sub/plugin/adapter.py` |  `PluginAdapter` |
| `docs/advanced-guides/skills.md` / `hooks.md` / `mcp.md` |  plugin  |

## 

- [ESLint: Create / Configure Plugins](https://eslint.org/docs/latest/extend/plugins)
- [VSCode Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [VSCode Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [MCP 2025-06-18 Overview](https://modelcontextprotocol.io/specification/2025-06-18/basic/index)
- [RFC-0005: Tool Search](./0005-tool-search.md)
- [RFC-0006:  Structured Tool Calling  Provider ](./0006-neutral-structured-tool-calling.md)
- [RFC-0015: Sub-agent ](./0015-sub-agent-config.md)
- [RFC-0019: MCP ](./0019-mcp-tool-permissions.md)