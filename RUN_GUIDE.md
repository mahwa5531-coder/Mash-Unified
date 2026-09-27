# Mash / NexAU Platform: Production Deployment & Run Guide

## Overview

Mash is an enterprise-grade AI Audit Operating System combining:
- **Connector**: Desktop FastAPI server (`http://localhost:8000`) bridging the UI to NexAU agent runtime via SSE streaming, SQLite persistence, and sandboxed tools.
- **Frontend**: Next.js (React 19 / Tailwind CSS) desktop-grade chat interface (`http://localhost:3000`) supporting thought trees, tool invocation cards, and live artifact preview.
- **AI Core**: Native NexAU runtime with dynamic thinking budget allocation and automatic context compaction.

## Installation (First Time Setup)

Clone the repository and install all dependencies:

### 1. Python Environment (NexAU & Connector Backend):
```cmd
pip install -r requirements.txt
```

### 2. Frontend (Next.js & UI):
```cmd
cd frontend
npm install
cd ..
```

---

## Quick Start (Single Click)

### Windows Command Prompt / Double-Click:
Double-click `run_mash.bat` in the root folder, or run:
```cmd
run_mash.bat
```

### Windows PowerShell:
Right-click `start_mash.ps1` -> Run with PowerShell, or run:
```powershell
.\start_mash.ps1
```

Both launchers automatically:
1. Verify Python 3.11+ and Node.js 18+ in PATH.
2. Launch the Desktop Connector on `http://localhost:8000`.
3. Launch the Next.js frontend on `http://localhost:3000`.
4. Open your browser directly to `http://localhost:3000`.
5. Gracefully terminate both processes when you close or press Enter.

---

## Manual Startup

If you prefer launching each component in individual terminal tabs:

### 1. Start Desktop Connector:
```cmd
cd connector
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2. Start Frontend:
```cmd
cd frontend
npm run dev
```
Open `http://localhost:3000`.

---

## Architecture & Registered Tools

The agent environment is equipped with 11 production-hardened tools:

| Tool Name | Capability & File Mapping |
|:---|:---|
| `view_file` | Read text/code slices (1-indexed, max 800 lines), directories, Calamine/DuckDB tabular data. |
| `write_file` | Create new artifact reports or project files with parameter aliasing (`TargetFile`, `CodeContent`). |
| `replace_file_content` | Surgical multi-line block replacements (prevents rewriting entire files). |
| `run_shell_command` | Execute shell commands in sandbox with timeout and background task tracking. |
| `background_task_manage_tool` | List, inspect status, or kill active background tasks (`action`, `pid`). |
| `search_file_content` | Fast ripgrep pattern search across codebase with `Query` and `SearchPath` aliases. |
| `audit_skill_tool` | Domain engine for executing domain audit procedures and regulatory checks. |
| `ask_user` | Interactive structured questions for clarifying user requirements. |
| `save_memory` | Long-term memory store for cross-session knowledge retention. |
| `web_search` | Real-time Google search for current external information. |
| `web_fetch` | Markdown scraper for web documentation and URLs. |

---

## Verification & Self-Checks

To run the automated verification suite:

```cmd
C:\Python313\python.exe scratch/test_full_system_verification.py
```
This tests:
- Tool schema registration and bindings.
- Universal parameter aliasing resilience.
- Zero-phantom tool invariants in system prompt.
- SQLite WAL database query execution.
- FastAPI route contracts.
