import asyncio
import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(tags=["tasks"])


def _find_sandbox_for_pid(pid: int | None) -> tuple[Any | None, Any | None]:
    """Locate the session LocalSandbox owning ``pid`` without constructing idle sandboxes."""
    if pid is None:
        return None, None
    from nexau.archs.sandbox.local_sandbox import LocalSandbox

    for sid, tasks in list(LocalSandbox._registry_by_session.items()):
        if pid in tasks:
            sb = LocalSandbox(sandbox_id=sid)
            return sb, sb.list_background_tasks().get(pid)
    return None, None


@router.get("/tasks")
async def list_active_tasks(session_id: str | None = None):
    """List all active background tasks and recent session tasks for isolated viewing."""
    tasks_list = []
    seen_commands = set()

    try:
        from nexau.archs.sandbox.base_sandbox import SandboxStatus
        from nexau.archs.sandbox.local_sandbox import LocalSandbox
        from nexau.archs.session.models import SessionModel
        from nexau.archs.session.orm import ComparisonFilter

        from app.dependencies import get_engine

        target_sids = (
            [session_id]
            if session_id
            else [sid for sid, tasks in list(LocalSandbox._registry_by_session.items()) if tasks]
        )
        # Skip idle/missing sessions so querying /tasks never allocates or pollutes _registry_by_session.
        active_sids = [sid for sid in target_sids if LocalSandbox._registry_by_session.get(sid)]
        if not active_sids:
            return {"tasks": tasks_list}

        session_work_dir = None
        if session_id:
            try:
                eng = get_engine()
                if eng:
                    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
                    if session and session.context:
                        session_work_dir = session.context.get("working_directory")
            except Exception:
                pass

        for sid in active_sids:
            sandbox = LocalSandbox(
                sandbox_id=sid,
                work_dir=Path(session_work_dir) if session_work_dir else Path.cwd(),
            )
            bg_tasks = sandbox.list_background_tasks()
            for pid, info in bg_tasks.items():
                task_sid = info.get("sandbox_id", "")
                if session_id and task_sid and task_sid != session_id:
                    continue

                task_cwd = info.get("cwd", "")
                if session_work_dir and task_cwd:
                    try:
                        if Path(task_cwd).resolve() != Path(session_work_dir).resolve():
                            continue
                    except Exception:
                        pass

                cmd_result = sandbox.get_background_task_status(pid)
                status = "running"
                if info.get("status") == "killed":
                    status = "killed"
                elif cmd_result.status == SandboxStatus.SUCCESS:
                    status = "completed"
                elif cmd_result.status == SandboxStatus.ERROR:
                    status = "failed"
                else:
                    status = info.get("status", "running")
                cmd = info.get("command", "")
                seen_commands.add(cmd)
                tasks_list.append({
                    "pid": pid,
                    "command": cmd,
                    "status": status,
                    "duration_ms": cmd_result.duration_ms,
                    "cwd": task_cwd,
                })
    except Exception:
        pass

    return {"tasks": tasks_list}


@router.post("/tasks/{pid}/kill")
async def kill_task(pid: int):
    """Terminate an active background task by its PID."""
    try:
        import sys

        from nexau.archs.sandbox.base_sandbox import SandboxStatus

        sandbox, _ = _find_sandbox_for_pid(pid)
        is_known = sandbox is not None
        is_success = False
        if sandbox is not None:
            res = sandbox.kill_background_task(pid)
            is_success = (res.status == SandboxStatus.SUCCESS)

        # Fallback taskkill direct OS tree kill only if pid belongs to sandbox
        if not is_success and is_known and sys.platform == "win32":
            import subprocess

            import psutil
            if psutil.pid_exists(pid):
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                is_success = True

        # Return "killed" on success, "failed" on failure
        return {"success": is_success, "pid": pid, "status": "killed" if is_success else "failed"}
    except Exception as e:
        return {"success": False, "pid": pid, "status": "failed", "error": str(e)}


def _normalize_task_id(raw_id: str) -> tuple[int | None, str]:
    # strictly reject path traversal, slashes, and null bytes
    if not raw_id or any(c in raw_id for c in ("/", "\\", "\x00", "..")):
        raise ValueError(f"Invalid task_id: {raw_id!r}")
    clean = raw_id.strip()
    for prefix in ("task-", "task_", "pid-", "pid_"):
        if clean.lower().startswith(prefix):
            clean = clean[len(prefix):]
    if not clean or any(c in clean for c in (".", "/", "\\", "\x00")):
        raise ValueError(f"Invalid task_id: {raw_id!r}")
    pid = int(clean) if clean.isdigit() else None
    return pid, clean


def _find_task_log_candidates(clean_id: str) -> list[Path]:
    from app.paths import get_mash_home, get_nexau_home

    task_root = (Path.cwd() / ".system_generated" / "tasks").resolve()
    candidate_paths = [
        task_root / f"task-{clean_id}.log",
        task_root / f"{clean_id}.log",
    ]
    # Search configured MASH_HOME/NEXAU_HOME first, then default Path.home() layouts
    # so custom homes work and patched Path.home() / legacy layouts resolve in .mash -> .nexau order.
    raw_bases = [
        get_mash_home() / "brain",
        get_nexau_home() / "brain",
        Path.home() / ".mash" / "brain",
        Path.home() / ".nexau" / "brain",
    ]
    seen_bases: set[Path] = set()
    for brain_base in raw_bases:
        try:
            b_resolved = brain_base.resolve()
        except Exception:
            continue
        if b_resolved in seen_bases or not b_resolved.is_dir():
            continue
        seen_bases.add(b_resolved)
        try:
            with os.scandir(b_resolved) as entries:
                for entry in entries:
                    if entry.is_dir():
                        tasks_dir = Path(entry.path) / ".system_generated" / "tasks"
                        candidate_paths.append(tasks_dir / f"task-{clean_id}.log")
                        candidate_paths.append(tasks_dir / f"{clean_id}.log")
        except OSError:
            continue
    return candidate_paths


@router.get("/tasks/{task_id:path}/log")
async def get_task_log(task_id: str):
    """Return task execution log content for the UI viewer as JSON."""
    try:
        pid, clean = _normalize_task_id(task_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Check active session sandboxes first if task_id is an active PID
    try:
        if pid is not None:
            active_sb, active_info = _find_sandbox_for_pid(pid)
            if active_sb is not None:
                status_res = active_sb.get_background_task_status(pid)
                combined = (status_res.stdout or "") + ("\n" + status_res.stderr if status_res.stderr else "")
                if combined.strip():
                    return {"content": combined}
                if active_info and active_info.get("task_log_path"):
                    log_path = Path(active_info["task_log_path"])
                    if log_path.exists() and log_path.is_file():
                        return {"content": log_path.read_text(encoding="utf-8", errors="replace")}
    except Exception:
        pass

    candidate_paths = _find_task_log_candidates(clean)

    for p in candidate_paths:
        if p.exists() and p.is_file():
            try:
                return {"content": p.read_text(encoding="utf-8", errors="replace")}
            except Exception:
                pass
    return {"content": f"[INFO] Background task {clean} completed or log not found."}


@router.get("/tasks/{task_id:path}/stream")
async def stream_task_log(task_id: str, request: Request):
    """Stream live task terminal logs as SSE (OpenHands pattern)."""
    try:
        pid, clean = _normalize_task_id(task_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # tail active sandbox stdout/stderr or task log file asynchronously with chunk deltas
    async def generate():
        from nexau.archs.sandbox.base_sandbox import SandboxStatus

        sandbox, active_info = _find_sandbox_for_pid(pid)

        # 1. If active sandbox process:
        if active_info:
            out_dir = active_info.get("std_output_dir")
            stdout_path = Path(f"{out_dir}/stdout.txt") if out_dir else None
            stderr_path = Path(f"{out_dir}/stderr.txt") if out_dir else None
            task_log_path = Path(active_info["task_log_path"]) if active_info.get("task_log_path") else None

            out_offset = 0
            err_offset = 0
            log_offset = 0

            while True:
                if await request.is_disconnected():
                    break

                # Tail stdout
                if stdout_path and stdout_path.exists():
                    try:
                        with open(stdout_path, encoding="utf-8", errors="replace") as f:
                            f.seek(out_offset)
                            chunk = f.read()
                            if chunk:
                                out_offset = f.tell()
                                yield f'data: {json.dumps({"content": chunk, "status": "running", "stream": "stdout"})}\n\n'
                    except Exception:
                        pass

                # Tail stderr
                if stderr_path and stderr_path.exists():
                    try:
                        with open(stderr_path, encoding="utf-8", errors="replace") as f:
                            f.seek(err_offset)
                            chunk = f.read()
                            if chunk:
                                err_offset = f.tell()
                                yield f'data: {json.dumps({"content": chunk, "status": "running", "stream": "stderr"})}\n\n'
                    except Exception:
                        pass

                # Fallback to task_log_path if stdout/stderr not available
                if not stdout_path and task_log_path and task_log_path.exists():
                    try:
                        with open(task_log_path, encoding="utf-8", errors="replace") as f:
                            f.seek(log_offset)
                            chunk = f.read()
                            if chunk:
                                log_offset = f.tell()
                                yield f'data: {json.dumps({"content": chunk, "status": "running"})}\n\n'
                    except Exception:
                        pass

                # Check process status
                cmd_result = sandbox.get_background_task_status(pid)
                is_finished = active_info.get("finished", False) or cmd_result.status in (SandboxStatus.SUCCESS, SandboxStatus.ERROR)

                if is_finished:
                    # Flush any remaining unread bytes
                    if stdout_path and stdout_path.exists():
                        try:
                            with open(stdout_path, encoding="utf-8", errors="replace") as f:
                                f.seek(out_offset)
                                chunk = f.read()
                                if chunk:
                                    yield f'data: {json.dumps({"content": chunk, "status": "running", "stream": "stdout"})}\n\n'
                        except Exception:
                            pass
                    if stderr_path and stderr_path.exists():
                        try:
                            with open(stderr_path, encoding="utf-8", errors="replace") as f:
                                f.seek(err_offset)
                                chunk = f.read()
                                if chunk:
                                    yield f'data: {json.dumps({"content": chunk, "status": "running", "stream": "stderr"})}\n\n'
                        except Exception:
                            pass

                    status_str = "completed" if cmd_result.status == SandboxStatus.SUCCESS else "failed"
                    yield f'data: {json.dumps({"content": "", "status": status_str})}\n\n'
                    yield "data: [DONE]\n\n"
                    break

                await asyncio.sleep(0.15)
            return

        # 2. Not active or already completed: check disk logs
        candidate_paths = _find_task_log_candidates(clean)

        target_file = next((p for p in candidate_paths if p.exists()), None)
        if target_file:
            try:
                content = target_file.read_text(encoding="utf-8", errors="replace")
                chunk_size = 4096
                for i in range(0, len(content), chunk_size):
                    if await request.is_disconnected():
                        break
                    yield f'data: {json.dumps({"content": content[i:i+chunk_size], "status": "completed"})}\n\n'
                yield f'data: {json.dumps({"content": "", "status": "completed"})}\n\n'
                yield "data: [DONE]\n\n"
                return
            except Exception:
                pass

        yield f'data: {json.dumps({"content": f"[INFO] Background task {task_id} completed or log not found.\\n", "status": "completed"})}\n\n'
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
