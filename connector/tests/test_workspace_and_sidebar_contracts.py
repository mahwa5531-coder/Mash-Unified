"""Tests verifying workspace and sidebar data integrity contracts:

1. Workspace path conflict detection (preventing accidental project hijacking).
2. Workspace creation idempotency on matching path.
3. Isolated workspace deletion preventing cross-project session data loss.
4. Session rename validation and status reporting.
"""

import os
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest

# Ensure connector and NexAU are in sys.path
connector_dir = Path(__file__).resolve().parent.parent
nexau_dir = connector_dir.parent / "NexAU"
if str(connector_dir) not in sys.path:
    sys.path.insert(0, str(connector_dir))
if str(nexau_dir) not in sys.path:
    sys.path.insert(0, str(nexau_dir))

from app.main import app, lifespan


@asynccontextmanager
async def _managed_lifespan(app):
    """Test-scoped lifespan wrapper that disposes aiosqlite threads cleanly."""
    async with lifespan(app):
        try:
            yield
        finally:
            if hasattr(app.state, "engine") and app.state.engine:
                try:
                    inner = getattr(app.state.engine, "_inner", app.state.engine)
                    raw_eng = getattr(inner, "_engine", None)
                    if raw_eng and hasattr(raw_eng, "dispose"):
                        await raw_eng.dispose()
                except Exception:
                    pass


@pytest.mark.anyio
async def test_workspace_conflict_and_idempotency_contracts(tmp_path):
    """Verify duplicate workspace names at different paths return 409, while same path is idempotent."""
    async with _managed_lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            test_id = uuid.uuid4().hex[:8]
            ws_name = f"Workspace_{test_id}"
            path_a = str(tmp_path / "ClientA" / ws_name)
            path_b = str(tmp_path / "ClientB" / ws_name)
            os.makedirs(path_a, exist_ok=True)
            os.makedirs(path_b, exist_ok=True)

            # 1. Create initial workspace at path_a
            res1 = await client.post("/api/projects", json={
                "name": ws_name,
                "local_folder_path": path_a,
            })
            assert res1.status_code == 200
            data1 = res1.json()
            proj_id1 = data1["id"]

            # 2. Idempotent create at path_a returns existing project
            res_same = await client.post("/api/projects", json={
                "name": ws_name,
                "local_folder_path": path_a,
            })
            assert res_same.status_code == 200
            assert res_same.json()["id"] == proj_id1

            # 3. Attempt to create workspace with same name at path_b must return 409 Conflict
            res_conflict = await client.post("/api/projects", json={
                "name": ws_name,
                "local_folder_path": path_b,
            })
            assert res_conflict.status_code == 409
            detail = res_conflict.json().get("detail", "")
            assert "already exists at" in detail

            # Cleanup
            del_res = await client.delete(f"/api/projects/{proj_id1}")
            assert del_res.status_code == 200


@pytest.mark.anyio
async def test_workspace_deletion_isolation_contract(tmp_path):
    """Verify deleting workspace A strictly preserves sessions in workspace B even if names match."""
    async with _managed_lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            test_id = uuid.uuid4().hex[:8]
            name_a = f"ProjectA_{test_id}"
            name_b = f"ProjectB_{test_id}"
            path_a = str(tmp_path / name_a)
            path_b = str(tmp_path / name_b)
            os.makedirs(path_a, exist_ok=True)
            os.makedirs(path_b, exist_ok=True)

            # Create projects
            res_a = await client.post("/api/projects", json={"name": name_a, "local_folder_path": path_a})
            assert res_a.status_code == 200
            proj_a_id = res_a.json()["id"]

            res_b = await client.post("/api/projects", json={"name": name_b, "local_folder_path": path_b})
            assert res_b.status_code == 200
            proj_b_id = res_b.json()["id"]

            # Create session for project A
            sid_a = f"sess_a_{test_id}"
            await client.post("/api/sessions", json={
                "session_id": sid_a,
                "user_id": "test_user",
                "title": "Session A",
                "workspace_uri": path_a,
                "section": "workspace",
            })

            # Create session for project B
            sid_b = f"sess_b_{test_id}"
            await client.post("/api/sessions", json={
                "session_id": sid_b,
                "user_id": "test_user",
                "title": "Session B",
                "workspace_uri": path_b,
                "section": "workspace",
            })

            # Delete project A
            del_a = await client.delete(f"/api/projects/{proj_a_id}")
            assert del_a.status_code == 200
            del_a_data = del_a.json()
            assert del_a_data["status"] == "success"
            assert "Local files preserved" in del_a_data["message"]
            assert del_a_data["deleted_project_id"] == proj_a_id

            # Project B must still exist
            list_res = await client.get("/api/projects")
            assert list_res.status_code == 200
            remaining_projects = [p["id"] for p in list_res.json()["projects"]]
            assert proj_b_id in remaining_projects
            assert proj_a_id not in remaining_projects

            # Session B must still exist in session list
            sessions_res = await client.get("/api/sessions")
            assert sessions_res.status_code == 200
            session_ids = [s["session_id"] for s in sessions_res.json().get("sessions", [])]
            assert sid_b in session_ids

            # Cleanup project B
            await client.delete(f"/api/projects/{proj_b_id}")
            await client.delete(f"/api/sessions/{sid_b}")


@pytest.mark.anyio
async def test_session_rename_validation_contract():
    """Verify session rename rejects missing sessions and updates valid sessions."""
    async with _managed_lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_rename_{test_id}"

            # Rename on non-existent session must return 404
            res_404 = await client.patch(f"/api/sessions/{sid}/rename", json={"title": "New Title"})
            assert res_404.status_code == 404

            # Create session
            create_res = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": "test_user",
                "title": "Initial Title",
            })
            assert create_res.status_code == 200

            # Rename existing session
            rename_res = await client.patch(f"/api/sessions/{sid}/rename", json={"title": "Updated Title"})
            assert rename_res.status_code == 200
            assert rename_res.json()["status"] == "success"

            # Check that title was updated in session listing
            sess_list = await client.get("/api/sessions")
            assert sess_list.status_code == 200
            matched = [s for s in sess_list.json().get("sessions", []) if s["session_id"] == sid]
            assert len(matched) == 1
            assert matched[0]["custom_title"] == "Updated Title"

            # Cleanup
            await client.delete(f"/api/sessions/{sid}")
