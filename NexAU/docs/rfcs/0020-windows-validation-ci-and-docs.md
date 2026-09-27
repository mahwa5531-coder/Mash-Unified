# RFC-0020: NexAU Windows 、CI 

## 

 RFC-0019 “Windows （ PowerShell，Git Bash ）”，RFC-0020 ： Windows **** CI ，** +  shell backend **（Python CLI、npm/、 PowerShell backend、 Git Bash backend、legacy wrapper）， Windows ， **Windows 10 / Windows 11 + PowerShell  backend**，Git Bash  bash-compatible backend。

## 

RFC-0019 “Windows ”，“”，：

1. ****： Windows CI ， Windows 。
2. ****：，Windows  job，。
3. ****：README / Getting Started /  Windows  shell backend、Git Bash  bash-only ， PowerShell  bash 。
4. ****： shell backend ，，。

 `.github/workflows/ci.yml`  Ubuntu  lint / typecheck / test job，`docs/`  README  Windows ，“Windows ”。

## 

### 

RFC-0020  Windows ：

1. **Windows CI  required checks**：Windows ， Linux-only job； Windows 。
2. ****：、 smoke test  Windows ，、、PowerShell  backend、Git Bash  backend 。
3. ****： ****（`nexau` Python CLI、npm/、legacy `nexau-cli` wrapper） ** shell backend **（ PowerShell backend； Git Bash  / fail-fast  /  / ）。
4. ****： Windows ；README / README_CN / Getting Started / docs index “Windows 10 / 11  PowerShell，Git Bash ”，。

### 

1. **Windows ， Linux-only **
   - Windows CI ，、、、 smoke test。
   -  E2B SaaS / Self-host  Linux 、 Windows  job， Linux runner；RFC-0020  Windows runner。
   - ：**“Windows ” Windows runner **。

2. **Windows CI  Windows ， Makefile **
   - “”。
   -  Windows CI  `make lint` / `make test` ， Windows job  `uv` / `python` / `npm` / PowerShell ；Git Bash  backend 。
   -  Makefile ，。

3. **Windows CI “ runner  +  + backend ”**
   -  GitHub-hosted `windows-latest`  runner ； image ， Windows image 。
   - Python / `uv` / Node.js  Windows  setup action， Linux  `curl | sh`。
   -  Windows required checks  PowerShell backend （`pwsh.exe` → `powershell.exe` → `cmd.exe` ）。
   - Git Bash  CI  bash-compatible backend ； runner  Git for Windows / Git Bash， backend ， mock / 、、、， required check 。

4. **“ + /”**
   -  fixture、helper、marker ， `if platform` 。
   - ，：Windows / POSIX 、PowerShell backend 、Git Bash /、`rg`  fallback、`ffmpeg` 、。
   - 、shell 、， helper ，。
   -  live LLM /  Windows required pytest ； opt-in ， `llm` / `openai` / `chat` ， CI  provider、。

5. **“ + shell backend ”“”**
   - Windows ：、PowerShell  backend 、 Git Bash 、/、 wrapper， RFC-0019 。
   -  RFC-0020  Windows  smoke / integration ，。
   - “ Linux ”。

6. **，**
   - “ Windows ”。
   -  PowerShell  backend、Git Bash  backend、bash-only 、；README ， `rg` / `ffmpeg` / 。
   - ：**Windows  = Windows 10 / Windows 11， PowerShell；Git Bash  bash-compatible backend**。

7. **legacy ， RFC **
   -  `nexau` Python CLI ， `package.json`  `nexau-cli` legacy wrapper。
   - ，，，“”。

###  RFC-0019 

- **RFC-0019 ，RFC-0020 **：`requires: ["0019"]`  Windows CI、 RFC-0019 。
- ****：T1（） RFC-0020 ；T3  marker、fixture、helper 。
- ** RFC-0019 **：T2  required checks ， T4  / shell backend ， RFC-0019  shell backend 、 CLI 。
- ** RFC **：，Windows  shell  RFC-0019 T2；`cli_wrapper.py`  legacy `nexau-cli` wrapper  RFC-0019 T4； Git Bash  fail-fast、 RFC-0019 T6。
- **、**：T5  Windows ， T4 。

### 

RFC-0020  API，：

#### 

：

- **Supported OS**: Windows 10, Windows 11
- **Default shell backend**: PowerShell（`pwsh.exe` → `powershell.exe` → `cmd.exe`）
- **Optional shell backend**: Git Bash（bash-compatible mode）
- **Primary entrypoint**: `nexau`
- **Compatible entrypoints to keep validated**:
  - `npm run run-agent` / `npm run agent`  npm/
  - legacy `nexau-cli`
- **Shell backend chains to keep validated**:
  - PowerShell  backend  /  / `cmd.exe` 
  -  Git Bash backend  / fail-fast  /  / 

#### CI 

- Windows  required checks  PR / merge 。
- Windows job “”。
- Windows job  PowerShell backend ， Git Bash  / 。
-  `posix_only` ， CI ； Linux/macOS 。
- live LLM /  provider ， opt-in ， skip reason ； Windows 。

#### 

-  Windows （：`docs/windows.md`）。
- `README.md`、`README_CN.md`、`docs/getting-started.md`、`docs/index.md`  Windows ，。
-  **Win10 / Win11 +  PowerShell，Git Bash **， RFC 。

### 

```mermaid
flowchart TD
  PR[Pull Request]
  Linux[ Linux/macOS ]

  subgraph WCI[Windows Required Checks]
    W1[ Windows runner ]
    W2[ Python / uv / Node.js]
    W3[ PowerShell backend]
    W4[]
    W5[Windows ]
    W6[ smoke / integration]
    W7[ Git Bash ]

    W1 --> W2 --> W3 --> W4 --> W5
    W5 --> W6
    W5 --> W7
  end

  subgraph DOCS[]
    D1[Windows ]
    D2[README / README_CN / Getting Started / docs index ]
    D1 --> D2
  end

  PR --> Linux
  PR --> WCI
  W6 --> DOCS
  W7 --> DOCS
  Linux --> Merge[ /  Windows ]
  WCI --> Merge
  DOCS --> Merge
```

### 

 RFC ：

1. **Makefile /  Windows **。
2. ** RFC-0019 、 shell backend **。
3. ** `rg`、`ffmpeg`、Node.js **。
4. ** PowerShell  bash-only  Git Bash bash-compatible **。
5. ** Linux-only job  Windows **。

## 

### 

####  A：Windows CI  job，

- ****：，。
- ****：“Windows ”，“”。
- ****：“Windows ”， Windows 。

####  B： `nexau` Python CLI，

- ****：，。
- ****： npm/ legacy wrapper ，。
- ****： shell backend ；，。

####  C： Windows  Getting Started，

- ****：，。
- ****：Windows 、，。
- ****：“ Windows ”。

####  D： Make /  Windows 

- ****： CI、。
- ****：，“”。
- ****：“”。

### 

1. **Windows required checks  CI **。
2. **Windows runner ， Win10 / Win11 **。
3. ** legacy wrapper ，**。
4. ** PowerShell  Git Bash ， shell **。

## 

### 

- ** 1：Windows **
-  Windows 、required checks  /  shell backend ， CI /  / 。
- ** 2：CI **
  -  Windows runner ， marker、fixture、skip ； required checks  RFC-0019 。
- ** 3：**
-  RFC-0019 ， shell backend ， Windows  README / Getting Started 。

### 

#### 

```mermaid
graph TD
  T1[Windows ]
  T2[Windows CI  Required Checks ]
  T3[]
  T4[ shell backend ]
  T5[Windows ]

  T1 --> T2
  T1 --> T5
  T2 --> T4
  T3 --> T4
  T4 --> T5
```

#### 

| ID |  |  | Ref |
| --- | --- | --- | --- |
| T1 | Windows  | - | - |
| T2 | Windows CI  Required Checks  | T1 | - |
| T3 |  shell backend  | - | - |
| T4 |  shell backend  | T2, T3 | `windows-entrypoint-smoke` + CLI entrypoint / shell backend unit tests |
| T5 | Windows  | T1, T4 | `docs/windows.md`, README / README_CN / Getting Started / docs index |

#### 

##### T1：Windows 

****
-  CI、 Windows 。
- ：（Win10 / Win11 +  PowerShell，Git Bash ）、required checks 、 shell backend 。
- 、， RFC 。

****
- ， RFC 。
- Windows 、required checks  /  shell backend 。
- T2  T5 ， CI 。

##### T2：Windows CI  Required Checks 

****
-  GitHub Actions  Windows runner job， required checks。
-  GitHub-hosted `windows-latest`  runner ； image ， image 。
-  Windows  setup action  Python / `uv` / Node.js 、lint / format-check / typecheck / pytest / smoke ， `make` 。
-  PowerShell  backend  CI 、； required checks 。
-  Git Bash backend 、， T4 。
-  RFC-0019 T7  Windows UTF-8  Windows  pytest ， `SKILL.md`  Python `agent_runner` stdio 。

****
- PR  Windows required checks。
- Windows job 、 PowerShell backend 、。
- Windows  pytest  `tests/unit/test_skill.py`  `tests/unit/test_cli_agent_runner_stdio.py`， Windows  GBK  Node CLI / Python runner  surrogate 。
- Windows job “”“ shell backend ”“ Git Bash backend ”“”。
- CI  required check 。
- Windows CI  Linux/macOS ； skip/marker  CI 。

##### T3： shell backend 

****
-  Windows  marker、fixture、helper  skip ，，。
- ，：Windows / POSIX 、PowerShell backend 、Git Bash /、`rg`  fallback、`ffmpeg` 、、UTF-8  stdio 。
-  POSIX 、shell、、。
-  live LLM /  provider ： `llm`  required pytest ， opt-in； `llm` ，。
-  Windows runner ，。
-  helper、 /  / script ， `/tmp` 。

****
- Windows  `xfail` 。
- （、、shell、） fixture / helper / marker ，。
-  skip ；/ reproduction  Windows  skip，/ Windows 。
- RFC-0019 （PowerShell / Git Bash backend、`rg`、`ffmpeg`、）。
- RFC-0019 T7  UTF-8 ， agent runner stdin/stdout reconfigure。
- live LLM /  provider  opt-in  skip reason； Windows required pytest 、 API key 。
-  helper ， Windows  temp/output/script dir ， `/tmp` 。
- Windows runner 。

##### T4： shell backend 

****
-  Windows smoke / integration ：`nexau` Python CLI、npm/、legacy `nexau-cli` wrapper。
-  shell backend ： PowerShell backend ； Git Bash 、fail-fast 、、。
-  Windows  active shell backend， `shell=True` →  shell 。
-  T3 ， shell backend  / 。

****
-  shell backend ，“”。
-  Git Bash  fail-fast、， CI 。
- Windows  active shell backend， `shell=True` →  shell 。
- Windows  smoke test ，、shell backend 。

****
- `windows-entrypoint-smoke`  RFC-0020 T4  backend ， `nexau chat`、`run_agent`、`run-agent.cmd` / npm wrapper、legacy `nexau-cli` 。
- CLI entrypoint preflight  PowerShell / `cmd.exe` backend； `NEXAU_WINDOWS_SHELL_BACKEND=git-bash` ， Git Bash  handoff ， `bash --version` 。
-  PowerShell  Git Bash、 Git Bash  fail-fast、handoff 、 backend ， shell backend  argv / path 。

##### T5：Windows 

****
-  Windows ， PowerShell  backend、Git Bash  backend、bash-only 、。
-  README / README_CN / Getting Started / docs index  Windows 。
- “Win10 / Win11 +  PowerShell，Git Bash ”，。
-  `rg` / `ffmpeg` / Node.js 。
- ， T4 。

****
- `docs/windows.md`  Windows ， Windows 10 / 11 、 PowerShell backend 、 Git Bash backend、bash-only 、。
- README / README_CN / Getting Started / docs index  Windows 。
-  T4 ， `windows-entrypoint-smoke`  / shell backend 。

****
-  README、README_CN  docs  Windows 。
- Windows  PowerShell backend ， Git Bash  bash-compatible mode / bash-only 。
-  Win10 / Win11， Windows 。
- ，“ CI/”。

### 

- `.github/workflows/ci.yml`
- `pyproject.toml`
- `package.json`
- `pytest.ini`
- `tests/conftest.py`
- `tests/unit/**`
- `tests/unit/test_skill.py`
- `tests/unit/test_cli_agent_runner_stdio.py`
- `tests/integration/**`
- `tests/e2e/**`（ smoke / ）
- `nexau/cli/main.py`
- `nexau/cli_wrapper.py`
- `run-agent`（ RFC-0019  Windows ）
- `README.md`
- `README_CN.md`
- `docs/index.md`
- `docs/getting-started.md`
- ：`docs/windows-support-baseline.md`
- ：`docs/windows.md`

## 

### 

1. **Windows required checks**
   - 。
   -  PowerShell backend  Git Bash 。
   -  lint / format-check / typecheck。
   - Windows  pytest 。
   -  smoke / integration 。
   - ：`rg`  fallback、`ffmpeg` 、。
   - RFC-0019 T7 ：`SKILL.md` UTF-8 、Python `agent_runner` stdin/stdout UTF-8 reconfigure。

2. ****
   - ****： helper、 fixture/marker、、/、PowerShell / Git Bash 、UTF-8 、`agent_runner` stdio 。
   - ****：CLI 、、 Git Bash  /  / 、legacy wrapper 、 active shell backend  shell 。
   - ****：Linux / macOS  Windows ； skip / `posix_only`  CI 。

3. ****
   - 
   -  shell backend 
   -  Git Bash backend 
   - 
   -  / stdio 
   -  / shell backend 
   - 
   - 

### 

-  Windows 10  Windows 11 。
-  Git Bash  PowerShell ； Git Bash backend  fail-fast 、。
-  `nexau` 、npm/、legacy wrapper 。
-  README / docs / Windows 。

## 

1. Windows required checks  job， job ，？
2. Win10 / Win11 ，/ runner？
3. legacy `nexau-cli` wrapper ， RFC ？

## 

- `docs/rfcs/0019-windows-support-powershell-default.md`
- `docs/rfcs/meta/0019-windows-support-powershell-default.json`
- `docs/cross-platform-guidelines.md`
- `.github/workflows/ci.yml`
- `pyproject.toml`
- `package.json`
- `run-agent`
- `nexau/cli/main.py`
- `nexau/cli_wrapper.py`
- `tests/conftest.py`
- `tests/unit/test_skill.py`
- `tests/unit/test_cli_agent_runner_stdio.py`
- `docs/windows-support-baseline.md`
- `docs/index.md`
- `docs/getting-started.md`
- `README.md`
- `README_CN.md`