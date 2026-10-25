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
