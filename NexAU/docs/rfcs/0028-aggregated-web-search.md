# RFC-0028:  Web 

- ****: draft
- ****: P1
- ****: `builtin-tools`, `dx`, ``
- ****: NexAU runtime（`nexau/archs/tool/builtin/web_tools/`、`config.py` ）
- ****: 2026-07-30
- ****: 2026-07-30

## 

** Serper** ****： `web_search`
， Serper /  /  AI  / ，
`SEARCH_PROVIDER` ， RFC-0197  runtime 。

** RFC  `google_web_search`**， examples / docs /  Agent 
，`SERPER_API_KEY` 。

## 

 `nexau/archs/tool/builtin/web_tools/web_tool.py`  `SerperSearch` ：

```python
class SerperSearch:
    def __init__(self, ...):
        api_key = os.getenv("SERPER_API_KEY")
        if not api_key:
            raise ValueError("Serper API key is required")
        self.base_url = "https://google.serper.dev/"
```

：

1. ** / **。Serper  Google，；
    NexAU 。
2. ****。（、 AI ）、
   、，（ < 1s、Serper 1~2s）。
3. ****。Serper 「」「」，
   ；，Serper  `gl` / `hl` / `location` 。
   ****。

、、。****。

## 

### 

：

```text
                      ┌──────────────────────────────────┐
  Agent  ─────────►│ web_search(query, ...19 )   │  
                      └───────────────┬──────────────────┘
                                      │  SEARCH_PROVIDER 
                      ┌───────────────▼──────────────────┐
                      │ SearchProviderBase               │   /  /
                      │   ···     │   / 
                      └───┬────────┬────────┬────────┬───┘
                          │        │        │        │
                     Serper     Seed     Baidu   XiaoBei   
                    (Google) () (AI) ()     "+"
```

**Provider（） Engine（）**，：
（Serper  Google），，
`SEARCH_ENGINE`  `google` / `bing` / `baidu`。

### 

#### 1. 

`nexau/archs/tool/builtin/web_tools/aggregated_search.py`， `web_search()`，
 `google_web_search` （gemini-cli ）：

```python
{"content": ..., "returnDisplay": ..., "sources": [...], "provider": "Seed"}
# ：{"content": ..., "returnDisplay": ..., "error": {"message": ..., "type": ...}}
```

** system prompt ** `google_web_search` 。

#### 2. 

|  |  |  |  |
|---|---|---|---|
| `SEARCH_PROVIDER` |  | `Serper` | `Serper` / `Seed` / `Baidu` / `XiaoBei` |
| `SEARCH_API_KEY` |  | — | ； `SERPER_API_KEY`（） |
| `SEARCH_ENGINE` |  |  | ， |
| `SEARCH_BASE_URL` |  |  | （ / ） |
| `SEARCH_TIMEOUT` |  | `30` |  |
| `SEARCH_MAX_RETRIES` |  | `3` | ****（）， 1 |

****，
`SEARCH_` + （ `search_` ），
`content_format` → `SEARCH_CONTENT_FORMAT`。

：** >  > **。

> ⚠️ 「」「」，
> `None` 。 schema （
> `content_format="text"`），，。

#### 3. （RFC-0197）

****： `read_file` / `run_shell_command` 「」，
。， Agent 
「 Key」——，。：

```python
# nexau/archs/main_sub/config/config.py
_CONDITIONAL_BUILTIN_TOOL_BINDINGS = (
    (
        "web_search",
        "nexau.archs.tool.builtin.web_tools:web_search",
        ("SEARCH_API_KEY", "SERPER_API_KEY"),   # 
    ),
)
```

：** `web_search`，**。

>  snake_case（ `read_file` / `write_file`  runtime ），
>  examples  `WebSearch.tool.yaml`—— 4 
> `google_web_search` ，RFC-0197  schema 
> `.tool.yaml` ，。

schema  RFC-0197 ：
`nexau/archs/tool/builtin/schemas/web_search.tool.yaml`。

 RFC-0197 ，**agent **，runtime ——
 `WebSearch`  Agent 。

#### 4. 

，****：

1. ****：；
2. ****：Serper / XiaoBei ， query  Google 
   ， `sites`  `site:` 。 XiaoBei  `arxiv.org` 
    1/28  20/20， 33s → 6s；
3. ****： `warning`。
   （" `authority_only`"）。

 Provider  `IGNORED_PARAMS`，。

### 

```yaml
# agent.yaml —— ；，
# WebSearch  runtime （RFC-0197  +  RFC ）
```

```bash
# ，
SEARCH_PROVIDER=Seed
SEARCH_API_KEY=< Key>

# ：
SEARCH_AUTHORITY_ONLY=true
SEARCH_INDUSTRY=gov
```

## 

### 

**A.  `SerperSearch` 。** ：`google_web_search`  10+ 
examples / docs ， patch  `google_web_search._web_search` 
，； `web_search()` （`{"status": ..., "results": ...}`）
。

**B. **（`serper_search` / `doubao_search` …）。：
，`description` ； `agent.yaml`。

**C.  MCP 。** ：，；
 MCP ""。

### 

1. ****： 1500 （）。：
   ///， Provider  60~120 。
2. ****（19 ）：。： `query` ，
    `google_web_search` 。
3. ****： `full_content`  no-op（
   `snippet`  `content` ）。： docstring 
   tool schema，。

## 

### 

|  |  |  |
|---|---|---|
| P1 | `aggregated_search.py` +  Provider +  |  PR |
| P2 | `schemas/web_search.tool.yaml` +  |  PR |
| P3 | examples / docs  `WebSearch` |  PR |
| P4 | `google_web_search`  deprecated（） |  PR |

### 

- `nexau/archs/tool/builtin/web_tools/aggregated_search.py`（）
- `nexau/archs/tool/builtin/web_tools/__init__.py`（ `web_search`）
- `nexau/archs/tool/builtin/schemas/web_search.tool.yaml`（）
- `nexau/archs/main_sub/config/config.py`（ `_CONDITIONAL_BUILTIN_TOOL_BINDINGS` ）
- `tests/unit/test_config.py`、`tests/unit/test_plugin_adapter_quickstart.py`（）
- `tests/unit/test_builtin_tools/test_aggregated_search.py`（）
- `tests/integration/test_config_integration.py`（）

## 

| # |  |  |  |
|---|---|---|---|
| 1 | `query`  /  | `error.type == "INVALID_QUERY"`， |  |
| 2 |  `SEARCH_API_KEY`  `SERPER_API_KEY` | `error.type == "WEB_SEARCH_CONFIG_ERROR"`， |  |
| 3 | `SEARCH_PROVIDER`  | `WEB_SEARCH_CONFIG_ERROR`， |  |
| 4 |  `SERPER_API_KEY`（） | ，provider  `Serper` | （） |
| 5 |  mock transport |  URL /  /  | （） |
| 6 |  | ****， `caplog`  warning |  |
| 7 |  | ； | （） |
| 8 | （`SEARCH_NUM_RESULTS=abc`） |  + warning， |  |
| 9 |  5xx /  | ， `SEARCH_MAX_RETRIES`  `WEB_SEARCH_FAILED` | （ mock ） |
| 9b | `SEARCH_MAX_RETRIES`  `0` /  |  1，**** |  |
| 10 |  4xx（ 429） | ****， | （ 1 ） |
| 11 |  HTTP 200  `ResponseMetadata.Error`  | / |  |
| 12 |  0  | **** `sources == []`， error |  |
| 13 |  `SEARCH_API_KEY`（ `SERPER_API_KEY`）|  `web_search`  agent  | （）|
| 14 |  | **** `web_search` |  |
| 15 | agent  `web_search` | runtime ****（ RFC-0197 dedup ）|  |

****（ mock transport / patch），CI  API Key。

 NAC beta ：Serper /  /  / 
（、、、）。

## 

1. ** `google_web_search` ？**  RFC （），
   。P4 。
2. ~~`XiaoBei` ~~ —— ****（， Key ）。
3. ** provider  /  failover**：，
   。 failover ， RFC。

## 

- RFC-0197（NAC ）— runtime  `.tool.yaml` schema 
- [Serper API](https://serper.dev/playground)
- [ Custom ](https://docs.volcengine.com/docs/87772/2272953)
- [ AI ](https://cloud.baidu.com/doc/qianfan-api/s/Wmbq4z7e5)
- [](https://search.xiaobei.top/docs)