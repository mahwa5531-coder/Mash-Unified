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


def _async_test_client():
    import httpx
    from app.main import app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_tasks_endpoints_skip_idle_sandboxes_and_avoid_registry_pollution(monkeypatch: pytest.MonkeyPatch):
    """Querying /tasks, /kill, or /log for idle or missing sessions must not construct LocalSandbox."""
    from nexau.archs.sandbox.local_sandbox import LocalSandbox

    idle_keys = [f"idle-perf-session-{i}" for i in range(25)]
    isolated_registry = {k: {} for k in idle_keys}
    monkeypatch.setattr(LocalSandbox, "_registry_by_session", isolated_registry)

    init_calls: list[str | None] = []
    orig_post_init = LocalSandbox.__post_init__

    def _counting_post_init(self):
        init_calls.append(self.sandbox_id)
        return orig_post_init(self)

    monkeypatch.setattr(LocalSandbox, "__post_init__", _counting_post_init)

    async with _async_test_client() as client:
        res_all = await client.get("/api/tasks")
        assert res_all.status_code == 200
        assert res_all.json() == {"tasks": []}
        res_missing = await client.get("/api/tasks?session_id=nonexistent-idle-sid")
        assert res_missing.status_code == 200
        assert res_missing.json() == {"tasks": []}
        res_kill = await client.post("/api/tasks/99999998/kill")
        assert res_kill.status_code == 200
        assert res_kill.json()["success"] is False
        res_log = await client.get("/api/tasks/99999998/log")
        assert res_log.status_code == 200

    assert init_calls == [], f"Expected zero LocalSandbox allocations for idle/missing sessions, got {init_calls}"
    assert "nonexistent-idle-sid" not in isolated_registry
    assert "default" not in isolated_registry


@pytest.mark.anyio
async def test_stream_task_log_resolves_session_scoped_task_and_validates_id(tmp_path):
    """GET /api/tasks/{pid}/stream must find tasks scoped to non-default session IDs."""
    import sys
    from nexau.archs.sandbox.local_sandbox import LocalSandbox

    sid = "sess-stream-scope-test"
    LocalSandbox.clear_session_tasks(sid)
    sb = LocalSandbox(sandbox_id=sid, work_dir=tmp_path)
    cmd = f'"{sys.executable}" -c "import time; print(\'stream_scope_ok\', flush=True); time.sleep(0.2)"'
    res = sb.execute_bash(cmd, background=True)
    pid = getattr(res, "background_pid", None)
    assert pid is not None

    try:
        async with _async_test_client() as client:
            bad_res = await client.get("/api/tasks/evil..path/stream")
            assert bad_res.status_code == 400

            body_chunks: list[str] = []
            async with client.stream("GET", f"/api/tasks/{pid}/stream") as stream_res:
                assert stream_res.status_code == 200
                async for line in stream_res.aiter_text():
                    body_chunks.append(line)
                    if "[DONE]" in line:
                        break
            full_stream = "".join(body_chunks)
            assert "stream_scope_ok" in full_stream
    finally:
        try:
            sb.kill_background_task(pid)
        finally:
            LocalSandbox.clear_session_tasks(sid)


@pytest.mark.anyio
async def test_find_task_log_candidates_respects_mash_home(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """GET /api/tasks/{id}/log resolves logs inside configured MASH_HOME."""
    custom_home = tmp_path / "custom_mash_home"
    log_dir = custom_home / "brain" / "sess-custom-home" / ".system_generated" / "tasks"
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / "task-777888.log").write_text("custom mash home log content", encoding="utf-8")

    monkeypatch.setenv("MASH_HOME", str(custom_home))
    async with _async_test_client() as client:
        res = await client.get("/api/tasks/777888/log")
        assert res.status_code == 200
        assert res.json()["content"] == "custom mash home log content"


@pytest.mark.anyio
async def test_delete_session_clears_background_tasks_registry(tmp_path):
    """Deleting a session stops its background tasks and clears _registry_by_session[session_id]."""
    import sys
    from app.main import app, lifespan
    from nexau.archs.sandbox.local_sandbox import LocalSandbox

    async with lifespan(app):
        async with _async_test_client() as client:
            sess_res = await client.post("/api/sessions", json={"title": "DeleteTasksCleanup", "working_directory": str(tmp_path)})
            assert sess_res.status_code == 200
            session_id = sess_res.json()["session_id"]

            sb = LocalSandbox(sandbox_id=session_id, work_dir=tmp_path)
            res = sb.execute_bash(f'"{sys.executable}" -c "import time; time.sleep(30)"', background=True)
            pid = getattr(res, "background_pid", None)
            assert pid is not None
            assert pid in LocalSandbox._registry_by_session.get(session_id, {})

            del_res = await client.delete(f"/api/sessions/{session_id}")
            assert del_res.status_code == 200
            assert session_id not in LocalSandbox._registry_by_session
