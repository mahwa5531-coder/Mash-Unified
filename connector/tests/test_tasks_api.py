from pathlib import Path
import pytest
import httpx
from app.main import app, lifespan
from nexau.archs.sandbox.local_sandbox import LocalSandbox

@pytest.mark.anyio
async def test_active_tasks_endpoint_lists_background_tasks():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            # 1. Spawn a background task using LocalSandbox
            s = LocalSandbox(work_dir=Path.cwd())
            res_cmd = s.execute_shell("echo testing_task_api", background=True)
            pid = res_cmd.background_pid
            assert pid is not None

            # 2. Query /api/tasks
            res = await client.get("/api/tasks")
            assert res.status_code == 200
            data = res.json()
            assert "tasks" in data
            pids = [t["pid"] for t in data["tasks"]]
            assert pid in pids, f"PID {pid} must be listed in /api/tasks!"


@pytest.mark.anyio
async def test_session_scoped_tasks_listed_in_tasks_endpoint():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            session_id = "test-session-tasks-scoped"
            s = LocalSandbox(sandbox_id=session_id, work_dir=Path.cwd())
            res_cmd = s.execute_shell("echo testing_scoped_session", background=True)
            pid = res_cmd.background_pid
            assert pid is not None

            # Query with session_id
            res = await client.get(f"/api/tasks?session_id={session_id}")
            assert res.status_code == 200
            data = res.json()
            pids = [t["pid"] for t in data["tasks"]]
            assert pid in pids

            # Query without session_id (should also aggregate all registered sessions)
            res_all = await client.get("/api/tasks")
            assert res_all.status_code == 200
            pids_all = [t["pid"] for t in res_all.json()["tasks"]]
            assert pid in pids_all

            LocalSandbox.clear_session_tasks(session_id)
