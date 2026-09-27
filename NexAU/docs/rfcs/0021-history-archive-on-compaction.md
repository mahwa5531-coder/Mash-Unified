# RFC-0021:  sandbox

- ****: draft
- ****: P2
- ****: `architecture`, `dx`
- ****: NexAU (`ContextCompactionMiddleware`, sandbox)
- ****: 2026-04-27
- ****: 2026-04-27

## 

`ContextCompactionMiddleware` ——。 RFC "" +  boundary  **append  sandbox  `transcript.jsonl`**， summary 。Agent  `Read`/`Grep` ，。 append-only ，。

## 

：

- `SlidingWindowCompaction`  summary，；
- `ToolResultCompaction`  tool result ，；
- `UserModelFullTraceAdaptiveCompaction` ，。

 tool result ，—— summary （）。

NexAU  `AgentRunActionModel`  DB  APPEND ，：

1.  DB  + ；
2.  agent ""，；
3.  session ，。

****： sandbox，agent 。

## 

1. （`SlidingWindowCompaction` / `ToolResultCompaction` / `UserModelFullTraceAdaptiveCompaction`）；
2. （agent  `Read`/`Grep` ）；
3.  agent  /  session （sandbox  per-agent， sandbox ）；
4.  `AgentRunActionModel` ；
5.  FTS / （，agent  `Grep`）。

## 

### 

```
 messages_before
        │
        │ ContextCompactionMiddleware._compact_messages()
        │
        ├─→ compaction_strategy.compact() → messages_after
        │
        ├─→ removed = messages_before − messages_after  ( message_id ，)
        │
        ├─→ HistoryArchiveWriter.write_round(removed, ...)
        │     └─ append  {sandbox_tmp}/.nexau_history_archive/<namespace>/transcript.jsonl
        │           ├─ N :  Message JSON
        │           └─ 1 : {"_boundary": {round, compacted_at, ...}}
        │
        └─→ inject_archive_hint(messages_after) →  summary 
```

### 

#### 

 agent  sandbox  `.nexau_history_archive/<namespace>/transcript.jsonl`。Sandbox  `sandbox.get_temp_dir()` ，。

```
{sandbox_tmp}/.nexau_history_archive/{namespace}/
  transcript.jsonl     # append-only, 
```

#### ： +  boundary

`transcript.jsonl` ：

**A.  Message** —— `Message.model_dump_json()` ：

```json
{"id": "uuid-...", "role": "user", "content": [...], "metadata": {...}, "created_at": "..."}
```

**B. Boundary ** ——  `_boundary`  key （`Message` ）：

```json
{"_boundary": {
  "round": 1,
  "compacted_at": "2026-04-27T10:30:00Z",
  "agent_id": "agent_xxx",
  "run_id": "run_xxx",
  "trigger_reason": "token_threshold_75pct",
  "strategy": "SlidingWindowCompaction",
  "tokens_before": 150000,
  "tokens_after": 30000,
  "removed_message_count": 47,
  "first_message_id": "uuid",
  "last_message_id": "uuid",
  "summary_message_id": "uuid",
  "preview": "first 300 chars of first removed user/assistant message..."
}}
```

 `if "_boundary" in obj:` 。`preview`  agent `Grep _boundary` 。

#### ImageBlock: base64  `images/` 

 text/tool message  transcript.jsonl 。 `ImageBlock`  `base64` data， dump  transcript （ 1MB  → base64 ~1.4MB →  1.4MB）。

：

- **URL ImageBlock**：， transcript.jsonl （，）
- **Base64 ImageBlock**：
  1.  base64 ， `{archive_dir}/images/{message_id}-{block_idx}.{ext}`（`ext`  `mime_type` ：jpg/png/gif/webp/...， → `bin`）
  2.  message  ImageBlock ****（`model_copy(deep=True)`， message ）， `base64` 、`url = "file:images/{...}.{ext}"`
  3.  transcript.jsonl

：

```
{sandbox_tmp}/.nexau_history_archive/{namespace}/
  transcript.jsonl              # message  + boundary 
  images/                       #  base64 ImageBlock 
    {msg_id_1}-{idx}.png
    {msg_id_2}-{idx}.jpg
```

`BoundaryRecord`  `extracted_images: int` （boundary ，）。

：
- ：/decode  block （fallback inline）， `logger.warning`，
- ：`removed`  `Message` （agent  active context ， mutate）
- ： base64  `images/` 、

#### ： append

 N ：

1. `before_ids = {m.id for m in messages_before}`
2. `after_ids = {m.id for m in compaction_strategy.compact(messages_before)}`
3. `removed = [m for m in messages_before if m.id not in after_ids]`
4. **append** N  Message JSON + 1  `_boundary`  `transcript.jsonl`

****：

|  |  |
|---|---|
| **append-only ** | ， |
| **** | removed ， summary  transcript（ id ） |
| **** |  append， manifest/round ；， |
| **** |  `_boundary`  max round， = max+1 |
| **agent ** |  summary hint ， `search_file_content` grep |

> ****： `sandbox.write_file()`  read+rewrite append（ sandbox ）。 IO ∝ ， session  MB ，。 sandbox  `append_file()` API，。

#### Summary 

 `save_history` ，**** summary ， agent ：

```
📁 [Archive] {N} earlier message(s) archived across {M} compaction round(s) (latest: round {R}).
To recall earlier conversation, use your file tools on `{transcript_path}`:
  • `search_file_content` with dir_path `{archive_dir}` to grep for keywords (each matched line is a serialized Message)
  • `read_file` on `{transcript_path}` for full chronological view
  • Boundary lines `{"_boundary": ...}` mark each compaction round
```

`ToolResultCompaction`  summary —— `Role.FRAMEWORK` 。

 hint opt-out ——" agent"； agent 。

#### （`CompactionConfig`）

```python
save_history: bool = True
"""（ Opt-out: ）。

 ``{sandbox.get_temp_dir()}/.nexau_history_archive/<namespace>/``,
,  config —— 。

, summary ""。
"""
```

> ： `ARCHIVE_SUBDIR = ".nexau_history_archive"`，** config **。：(1) ；(2) ， /  `"../foo"`  `"/tmp/leak"`  sandbox。

#### 

：`ContextCompactionMiddleware._compact_messages()`。（`before_model` / `after_model` / `wrap_model_call` ） `_maybe_archive_compaction()`：

1.  `save_history` flag  `agent_state` 
2.  removed 
3.  lazy  `HistoryArchiveWriter`
4.  `write_round()`
5.  hint

`HistoryArchiveWriter`（`history_archive.py`）：

```python
class HistoryArchiveWriter:
    @classmethod
    def from_sandbox(cls, *, agent_state: Any, subdir: str) -> "HistoryArchiveWriter | None":
        """ agent_state  sandbox;  None。"""

    def write_round(
        self,
        *,
        removed: list[Message],
        tokens_before: int | None,
        tokens_after: int | None,
        trigger_reason: str,
        strategy_name: str,
        run_id: str | None,
        agent_id: str | None,
    ) -> BoundaryRecord | None:
        """append removed messages + 1 boundary  transcript.jsonl。"""
```

### 

```yaml
# agent.yaml
middlewares:
  - import: nexau.archs.main_sub.execution.middleware.context_compaction:ContextCompactionMiddleware
    params:
      max_context_tokens: 200000
      auto_compact: true
      threshold: 0.75
      compaction_strategy: "llm_summary"
      keep_iterations: 3
      # ——  RFC  (,  hint )
      save_history: true
```

 3 ：

```
{sandbox_tmp}/.nexau_history_archive/{namespace}/transcript.jsonl
  #  1  5  Message JSON
  # 1  _boundary (round=1)
  #  2  4  Message JSON ( round 1 produced summary)
  # 1  _boundary (round=2)
  #  3  6  Message JSON ( round 2 produced summary)
  # 1  _boundary (round=3)
```

Agent  turn  summary  hint， hint  `search_file_content` 。

## 

### 

**A. : `round_NNNN.jsonl` + `manifest.jsonl`** （，）：
-  round  +  manifest ；
- ：；manifest ""；
- ：（1）" Read manifest  Read round "；（2）manifest  read+rewrite， IO；（3）round ， agent ；（4）。
- ：****。append-only  prefix，；agent 。

**B.  `recall_history` **：
- ：（list_rounds / get_round / search_text / get_messages）， token cap、；
- ：（1） agent ；（2） agent  `Read`/`Grep` ；（3）。
- ：****。Agent  `Read`/`Grep`，。

**C.  `AgentRunActionModel` **：
- ： session DB；
- ：（1）DB  grep；（2） APPEND/REPLACE ；（3）（SQL/JSONL/Memory/Remote）。
- ：****。，DB 。

**D. NEXAU_HOME  sandbox**：
- ： agent ；
- ：（1）" agent "， agent ；（2） sandbox ；（3）。
- ：****。

### 

1.  IO。 `sandbox.write_file()` read+rewrite append，IO ∝ 。 session 、 MB ，； session  `append_file()` API。
2. Sandbox （degrade gracefully）， `logger.warning` 。
3.  messages  `id`，—— message id（ summary message），。

## 

### 

- [x] Phase 1: （`CompactionConfig` ）
- [x] Phase 2: `HistoryArchiveWriter`  + 
- [x] Phase 3: `ContextCompactionMiddleware`  + hint 
- [x] Phase 4: （ +  + ）

### 

- `nexau/archs/main_sub/execution/middleware/context_compaction/config.py` — 
- `nexau/archs/main_sub/execution/middleware/context_compaction/middleware.py` —  + hint 
- `nexau/archs/main_sub/execution/middleware/context_compaction/history_archive.py` — 
- `tests/unit/test_history_archive.py` — 
- `tests/scripts/test_history_archive_e2e.py` —  LLM e2e 

## 

### 

- `test_writes_messages_then_boundary_line`： `transcript.jsonl`  N  Message + 1  `_boundary`
- `test_round_numbers_increment`： boundary  round 
- `test_transcript_is_append_only`： 2  1  prefix（）
- `test_resume_after_existing_transcript`： transcript  round 1  boundary，writer  = 2
- `test_diff_excludes_kept_messages`： messages  id ； summary id  before_ids，
- `test_creates_archive_dir` / `test_returns_none_when_*`：`get_sandbox`  None  graceful degrade
- `test_summary_id_recorded` / `test_no_summary_id_when_absent`：boundary  `summary_message_id` 
- `test_preview_skips_system_role` / `test_preview_truncated_to_300`：preview 
- `test_hint_mentions_path_and_search_tools`：hint  +  (`search_file_content` / `read_file`)

### 

`tests/unit/test_history_archive.py::TestMiddlewareArchiveIntegration` 4  middleware  writer ：

- `test_maybe_archive_writes_diff_and_injects_hint`： + summary hint 
- `test_maybe_archive_skipped_when_flag_false`：flag 
- `test_no_summary_falls_back_to_framework_message`： summary  framework 
- `test_multiple_rounds_append_to_same_file`： transcript 

### 

```bash
NEXAU_LOG_LEVEL=DEBUG \
  uv run python tests/scripts/test_history_archive_e2e.py
#  hint  Archive dir
grep -c '"_boundary"' "$ARCHIVE_DIR/transcript.jsonl"   #  == 
```

：

1.  agent  2-3 
2.  turn " X "
3.  agent  hint  `search_file_content` / `read_file` 

## 

1.  MB  read+rewrite ： `sandbox.write_file()` ，IO ∝ 。 session ， `BaseSandbox`  `append_file()` API。。
2.  sandbox （ session transcript  session ）——/。
3.  `HistoryArchivedEvent`  UI ？，。

## 

- RFC-0004: 
- RFC-0016: Micro-compact（）
- `nexau/archs/main_sub/execution/middleware/context_compaction/` 
- `nexau/archs/tool/builtin/session_tools/save_memory.py`（sandbox ）
- Claude Code  transcript （`~/.claude/projects/{proj}/{sessionId}.jsonl` + `SystemCompactBoundaryMessage`）—— 