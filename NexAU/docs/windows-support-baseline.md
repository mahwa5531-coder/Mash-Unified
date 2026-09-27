# Windows （RFC-0020 / T1）

> 。
>
> RFC-0020 T1  Windows ，
> CI、， workflow、。

## 1. 

RFC-0020 ：

- **Supported OS**: Windows 10、Windows 11
- **Default shell backend**: PowerShell（`pwsh.exe` → `powershell.exe` → `cmd.exe`）
- **Optional shell backend**: Git Bash（Git for Windows，bash-compatible mode）
- **Primary entrypoint**: `nexau`
- **Compatible entrypoints to keep validated**:
  - `npm run run-agent` / `npm run agent`
  - legacy `nexau-cli`
  - Windows （ `run-agent.cmd`）
- **Windows official support boundary**: `Windows 10 / 11 + default PowerShell backend`
- **Git Bash compatibility boundary**: explicit Git Bash backend or bash-only command scenarios only

### 

 RFC-0020  Windows ：

- PowerShell  bash-only 、bash heredoc  POSIX 
-  Git Bash 
- WSL 
- E2B SaaS / Self-host  Linux “Windows ”
- `rg`、`ffmpeg`、Node.js 
- Makefile /  Windows 

---

## 2. Windows Required Checks 

Windows CI  ****  required checks， Linux-only job。
 required checks **、**， workflow  RFC-0020 T2 。

### 2.1  required checks

| Check  | Runner |  |  |  |
| --- | --- | --- | --- | --- |
| `windows-quality` | `windows-latest` |  | Python / `uv` / Node.js 、 PowerShell backend 、lint、format-check、typecheck | E2B SaaS / Self-host、 |
| `windows-target-tests` | `windows-latest` |  | Windows  pytest 、 helper、/、shell backend 、 |  Linux-only  |
| `windows-entrypoint-smoke` | `windows-latest` |  |  smoke / integration、 PowerShell 、 Git Bash （fail-fast、、） | 、 |

### 2.2 Required checks 

1. ****： 3  Windows checks  PR ， job。
2. ** Linux-only job**：`test-saas`、`test-selfhost`  Linux runner， Windows required checks 。
3. ****：CI  PowerShell backend；Git Bash  backend， runner ，。
4. ****：CI 、 shell backend 、 Git Bash backend 、、 smoke 。
5. ** skip **： skip / marker ， CI 。

---

## 3.  shell backend 

RFC-0020  ****  ** shell backend **。
，。

，，：

- `powershell-default-healthy`
- `git-bash-explicit-healthy`
- `git-bash-explicit-missing`
- `git-bash-explicit-unusable`

### 3.1 

|  |  /  |  |  |  |
| --- | --- | --- | --- | --- |
| Python CLI  | `nexau ...` | Windows smoke / integration | T4 |  |
| npm /  | `npm run agent` / `npm run run-agent` / `run-agent.cmd` | Windows smoke / integration | T4 | ， |
| legacy wrapper | `nexau-cli` | Windows smoke / integration | T4 |  RFC |

### 3.2  shell backend 

|  |  |  |  |  |
| --- | --- | --- | --- | --- |
| PowerShell  | `pwsh.exe`  | CI +  + smoke | T2 / T3 / T4 |  |
| PowerShell  |  `powershell.exe` |  + integration | T3 / T4 |  backend fallback |
| PowerShell  |  `cmd.exe` |  + integration | T3 / T4 | ， shell |
| Git Bash  |  backend  | CI +  + smoke | T2 / T3 / T4 |  Git Bash / bash-only  |
| Git Bash  |  backend  fail-fast |  + integration | T3 / T4 | ， |
| Git Bash  |  /  |  + integration | T3 / T4 |  missing ，、 |
| Git Bash  |  |  + integration | T3 / T4 |  |
| Git Bash  |  /  Git Bash  | integration | T4 |  |

---

## 4. 

，“”：

|  |  |  |  |
| --- | --- | --- | --- |
| （Windows  ↔ PowerShell / Git Bash ） |  | T3 |  `/tmp` ， backend  |
| （、、） |  +  pytest  | T3 / T2 | Windows / POSIX  |
| `rg`  fallback |  +  pytest  | T3 / T2 |  |
| `ffmpeg`  |  +  pytest  | T3 / T2 |  |
| （ `python3` / `sys.executable` / shell path） |  +  pytest  | T3 / T2 |  Windows  |
|  active shell backend | smoke / integration | T4 |  `shell=True` →  shell  |
|  |  +  | T5 | README / docs / Windows  |

---

## 5. T2 / T3 / T4 / T5 

### T2（Windows CI）

- Workflow / job  required checks ， RFC-0020 。
- Windows job  2 。
- CI ，“Windows + PowerShell ，Git Bash ”“ Windows shell ”。

### T3（）

- marker / fixture / helper ， 3、4 。
- 、、， `windows-target-tests`  `windows-entrypoint-smoke`。

### T4（ shell backend ）

-  smoke / integration  3  shell backend 。
- “ Git Bash  fail-fast + ”； PowerShell  Git Bash 。

### T5（Windows ）

- `docs/windows.md`、`README.md`、`README_CN.md`、`docs/getting-started.md`、`docs/index.md` ， 1 。
-  `Windows 10 / 11 + default PowerShell backend`， Git Bash  bash-compatible backend； shell、runner 。

---

## 6. （T1 ）

 RFC-0020 T1 ：

- `.github/workflows/ci.yml`  Ubuntu runner  `lint`、`typecheck`、`test-saas`、`test-selfhost`。
- Windows required checks ****， T2 。
- `pytest.ini`  marker， Windows ， T3 。
- README / Getting Started / docs index  Windows ， T5 。

，：

1.  T2  required checks ；
2.  T3 ；
3.  T4  / shell backend ；
4.  T5 。