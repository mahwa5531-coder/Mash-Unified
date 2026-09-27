# NexAU 

， RFC-0019（Windows ） RFC-0020（Windows CI /  / ）。

（OpenAI Codex CLI —  Linux / macOS / Windows  Rust ）， NexAU  Python 。

---

##  1：，

****： API，。

****：

-  `nexau/archs/platform/`（），。
- ：
  - **shell backend**：Unix bash、Windows PowerShell  backend、Windows Git Bash  backend 
  - **process compat**：、、
  - **path helpers**：、、Python  ↔ PowerShell / Git Bash 
  - **optional Git Bash setup**： Git Bash backend 、、
- `local_sandbox.py`、`run_shell_command.py`、，。

```python
# ❌ 
if sys.platform == "win32":
    process = subprocess.Popen([git_bash, "-c", cmd], ...)
else:
    process = subprocess.Popen(cmd, shell=True, ...)

# ✅ 
from nexau.archs.platform import shell_backend
process = shell_backend.execute(cmd, cwd=cwd, envs=envs, background=background)
```

****：Codex `sleep-inhibitor`  —  `inhibit()` API， `linux_inhibitor` / `macos` / `windows_inhibitor` / `dummy` 。

---

##  2：，

****：Python  `#[cfg]`，，。

****：

- ， `execute_bash()` / `_graceful_kill()`  `sys.platform`。
- ，，。

```python
# ❌ 
def _graceful_kill(self, process):
    if sys.platform == "win32":
        process.terminate()
    else:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)

# ✅ 
_process_killer = WindowsProcessKiller() if sys.platform == "win32" else PosixProcessKiller()

def _graceful_kill(self, process):
    _process_killer.graceful_kill(process)
```

****：Codex `exit_status.rs` — Unix  signal → 128+signal，Windows  exit code ，，。

---

##  3：，

****：""（、）， API（`killpg` vs `TerminateProcess`）。

****：

- ****（capability），****（implementation）。
- ，。

|  | Unix  | Windows  |
|------|----------|-------------|
|  | `SIGTERM` → wait → `SIGKILL`（process group） | `terminate()` → wait → `kill()` |
|  | `start_new_session=True` | `CREATE_NEW_PROCESS_GROUP`  |
|  | `tempfile.mkdtemp()` | `tempfile.mkdtemp()` |
| Shell  | `bash -c "command"` |  `pwsh.exe` / `powershell.exe`， `cmd.exe` ； Git Bash  `git-bash.exe -c "command"` |

****：Codex `sandboxing/manager.rs` —  `MacosSeatbelt | LinuxSeccomp | WindowsRestrictedToken` ，""。

---

##  4：，

****：，，。

**（）**：

1. **** → 
2. ** fallback** →  + 
3. ** fallback** →  + 
4. **** → ，

**NexAU **：

|  |  |
|------|---------|
| `rg` (ripgrep)  |  Python fallback grep |
| `ffmpeg`  | ， |
|  PowerShell 、Git Bash  | ； Git Bash / bash-only  →  →  |
| WSL1 /  | ， |

```python
# ❌ 
try:
    result = run_with_rg(pattern)
except Exception:
    return []  # 

# ✅ 
if rg_available(sandbox):
    result = run_with_rg(pattern)
else:
    logger.info("ripgrep not found, falling back to Python grep")
    result = python_grep(pattern)
```

****：Codex WSL1 fail-closed、`sleep-inhibitor` dummy backend、Windows sandbox  README。

---

##  5：

****：、、， Windows 。

****：

### 5.1 

NexAU  Windows ：

|  |  |  |
|------|------|---------|
| Python  | `C:\Users\wn\AppData\Local\Temp\nexau_xxx` | `pathlib`、`subprocess.Popen(cwd=...)`、Python  API |
| PowerShell / cmd  | `C:\Users\wn\AppData\Local\Temp\nexau_xxx` | Windows  shell backend  |
| Git Bash POSIX  | `/c/Users/wn/AppData/Local/Temp/nexau_xxx` |  Git Bash  |

### 5.2 

- Python  Python （`pathlib` / `os.path`）。
- PowerShell / `cmd.exe`  Windows ， backend-aware quoting。
- Git Bash  helper  POSIX 。
- `subprocess.Popen`  `cwd`  Python 。
-  Python  ↔ shell backend  helper ；PowerShell / `cmd.exe`  Git Bash 。
- `shlex.quote()` / command building ，。
-  `/tmp` —  `tempfile.gettempdir()`  `tempfile.mkdtemp()`。
- E2B  Linux （`/tmp`、`/home/user`）， Windows 。

### 5.3 

-  `filepath:lineNumber:content` ， Windows （`C:\path:42:content`  `:` ）。
-  shell （ `ls` ） Python  API —  Python （`pathlib.glob()`、`os.listdir()`）。

```python
# ❌  /tmp
BASH_TOOL_RESULTS_BASE_PATH = "/tmp/nexau_bash_tool_results"

# ✅ 
import tempfile
BASH_TOOL_RESULTS_BASE_PATH = str(Path(tempfile.gettempdir()) / "nexau_bash_tool_results")

# ❌  ls  Python 
ls_result = sandbox.execute_bash(f"ls -1 {tmp_dir}/frame_*.jpg | sort")
frame_paths = ls_result.stdout.splitlines()
for path in frame_paths:
    sandbox.read_file(path)  # ls  Python 

# ✅  Python （ Local / ）
frame_paths = sorted(Path(tmp_dir).glob("frame_*.jpg"))
for path in frame_paths:
    sandbox.read_file(str(path))
```

> ： `Path(tmp_dir).glob(...)`  **LocalSandbox** “”。
>  E2B / Remote Sandbox，（ sandbox  list/read ），、。
 
****：Codex `tui/markdown_render.rs:810` —  `C:/...` ；`windows-sandbox-rs/path` — 。
---

##  6：，

****： 1  — ""，""。

****：

- （sandbox、、）** import** `os.killpg`、`os.getpgid`、`signal.SIGKILL`  API。
-  `nexau/archs/platform/` 。
- （ `cleanup_manager.py`  signal ），，。

```python
# ❌  POSIX API
import os, signal
pgid = os.getpgid(process.pid)      # Windows: AttributeError
os.killpg(pgid, signal.SIGTERM)     # Windows: not available

# ✅ 
from nexau.archs.platform.process_compat import graceful_kill
graceful_kill(process, grace_period=5.0)
```

****：Codex `windows-sandbox-rs` —  crate， ACL、token、process、ConPTY、path normalization  10+ ，core  Windows API。

---

##  7：、、

****：，CI /  /  / 。

****：

### 7.1 CI

- Windows CI  required check 。
- Windows CI  Windows  +  setup action， `make`  `curl | sh`。
- Windows CI  PowerShell backend；Git Bash  backend， runner ，。

### 7.2 

-  fixture / marker / helper （ `tests/conftest.py`  `tests/utils/platform.py`）， `skipif`。
- （、、shell、） fixture 。
- （`rg` 、`ffmpeg` 、 Git Bash ）。
- Windows CI  Linux CI 。

### 7.3 

- 。
- Windows ，README / Getting Started 。

****：Codex `cargo-bin` —  Windows path length ；CI 。

---

## Checklist（）

，：

- [ ] ，
- [ ] ，
- [ ] ""， API
- [ ] ，
- [ ]  `tempfile` / `pathlib`， `/tmp`
- [ ]  Python ↔ shell backend  helper ， PowerShell / Git Bash 
- [ ]  Windows （`C:\...`  `:`）
- [ ]  shell  Python  API
- [ ]  marker / fixture， `skipif`
- [ ] 