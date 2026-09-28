import os
import json
import asyncio
from pathlib import Path
from typing import Any
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter(tags=["tasks"])


@router.get("/tasks")
@router.get("/api/tasks")
async def list_active_tasks(session_id: str | None = None):
    """List all active background tasks and recent session tasks for isolated viewing."""
    tasks_list = []
    seen_commands = set()

    try:
        from nexau.archs.tool.builtin._sandbox_utils import get_sandbox
        from nexau.archs.sandbox.base_sandbox import SandboxStatus
        sandbox = get_sandbox(None)
        bg_tasks = sandbox.list_background_tasks()
        for pid, info in bg_tasks.items():
            cmd_result = sandbox.get_background_task_status(pid)
            status = "running"
            if cmd_result.status == SandboxStatus.SUCCESS:
                status = "completed"
            elif cmd_result.status == SandboxStatus.ERROR:
                status = "failed"
            cmd = info.get("command", "")
            seen_commands.add(cmd)
            tasks_list.append({
                "pid": pid,
                "command": cmd,
                "status": status,
                "duration_ms": cmd_result.duration_ms,
                "cwd": info.get("cwd", ""),
            })
    except Exception:
        pass

    return {"tasks": tasks_list}


@router.post("/tasks/{pid}/kill")
@router.post("/api/tasks/{pid}/kill")
async def kill_task(pid: int):
    """Terminate an active background task by its PID."""
    try:
        from nexau.archs.tool.builtin._sandbox_utils import get_sandbox
        from nexau.archs.sandbox.base_sandbox import SandboxStatus
        import sys, subprocess
        sandbox = get_sandbox(None)
        res = sandbox.kill_background_task(pid)
        is_success = (res.status == SandboxStatus.SUCCESS)

        # Fallback direct OS tree kill if sandbox did not find it or to guarantee shutdown
        if not is_success and sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            is_success = True

        return {"success": is_success, "pid": pid, "status": str(res.status) if is_success else "killed"}
    except Exception as e:
        import sys, subprocess
        if sys.platform == "win32":
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                return {"success": True, "pid": pid, "status": "killed"}
            except Exception:
                pass
        return {"success": False, "pid": pid, "error": str(e)}


def _normalize_task_id(raw_id: str) -> tuple[int | None, str]:
    clean = raw_id.replace("\\", "/").split("/")[-1]
    for prefix in ("task-", "task_", "pid-", "pid_"):
        if clean.lower().startswith(prefix):
            clean = clean[len(prefix):]
    pid = int(clean) if clean.isdigit() else None
    return pid, clean


@router.get("/tasks/{task_id:path}/log")
@router.get("/api/tasks/{task_id:path}/log")
async def get_task_log(task_id: str):
    """Return task execution log content for the UI viewer as JSON."""
    pid, clean = _normalize_task_id(task_id)

    # Check active sandbox directly first if task_id is an active PID
    try:
        from nexau.archs.tool.builtin._sandbox_utils import get_sandbox
        sandbox = get_sandbox(None)
        if pid is not None:
            if pid in sandbox.list_background_tasks():
                status_res = sandbox.get_background_task_status(pid)
                combined = (status_res.stdout or "") + ("\n" + status_res.stderr if status_res.stderr else "")
                if combined.strip():
                    return {"content": combined}
    except Exception:
        pass

    candidate_paths = [
        Path.cwd() / ".system_generated" / "tasks" / f"task-{clean}.log",
        Path.cwd() / ".system_generated" / "tasks" / f"{clean}.log",
        Path.cwd() / ".system_generated" / "tasks" / f"task-{task_id}.log",
        Path.cwd() / ".system_generated" / "tasks" / f"{task_id}.log",
    ]
    import glob
    for base in [Path.home() / ".nexau" / "brain", Path.home() / ".gemini" / "antigravity" / "brain"]:
        for p_str in glob.glob(str(base / "*" / ".system_generated" / "tasks" / f"task-{clean}.log")):
            candidate_paths.append(Path(p_str))
        for p_str in glob.glob(str(base / "*" / ".system_generated" / "tasks" / f"{clean}.log")):
            candidate_paths.append(Path(p_str))

    for p in candidate_paths:
        if p.exists():
            try:
                return {"content": p.read_text(encoding="utf-8", errors="replace")}
            except Exception:
                pass
    return {"content": f"[INFO] Background task {task_id} completed or log not found."}


@router.get("/tasks/{task_id:path}/stream")
@router.get("/api/tasks/{task_id:path}/stream")
async def stream_task_log(task_id: str, request: Request):
    """Stream live task terminal logs as SSE (OpenHands pattern)."""
    # ponytail: tail active sandbox stdout/stderr or task log file asynchronously with chunk deltas
    async def generate():
        from nexau.archs.tool.builtin._sandbox_utils import get_sandbox
        from nexau.archs.sandbox.base_sandbox import SandboxStatus

        pid, clean = _normalize_task_id(task_id)
        sandbox = None
        try:
            sandbox = get_sandbox(None)
        except Exception:
            pass

        active_info = None
        if sandbox and pid is not None:
            active_info = sandbox.list_background_tasks().get(pid)

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
                        with open(stdout_path, "r", encoding="utf-8", errors="replace") as f:
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
                        with open(stderr_path, "r", encoding="utf-8", errors="replace") as f:
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
                        with open(task_log_path, "r", encoding="utf-8", errors="replace") as f:
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
                            with open(stdout_path, "r", encoding="utf-8", errors="replace") as f:
                                f.seek(out_offset)
                                chunk = f.read()
                                if chunk:
                                    yield f'data: {json.dumps({"content": chunk, "status": "running", "stream": "stdout"})}\n\n'
                        except Exception:
                            pass
                    if stderr_path and stderr_path.exists():
                        try:
                            with open(stderr_path, "r", encoding="utf-8", errors="replace") as f:
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
        candidate_paths = [
            Path.cwd() / ".system_generated" / "tasks" / f"task-{clean}.log",
            Path.cwd() / ".system_generated" / "tasks" / f"{clean}.log",
            Path.cwd() / ".system_generated" / "tasks" / f"task-{task_id}.log",
            Path.cwd() / ".system_generated" / "tasks" / f"{task_id}.log",
        ]
        import glob
        for base in [Path.home() / ".nexau" / "brain", Path.home() / ".gemini" / "antigravity" / "brain"]:
            for p_str in glob.glob(str(base / "*" / ".system_generated" / "tasks" / f"task-{clean}.log")):
                candidate_paths.append(Path(p_str))
            for p_str in glob.glob(str(base / "*" / ".system_generated" / "tasks" / f"{clean}.log")):
                candidate_paths.append(Path(p_str))

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