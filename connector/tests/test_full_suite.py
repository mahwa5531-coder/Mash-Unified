import sys
from pathlib import Path
import pytest
import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_full_system_verification():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            # 1. System
            res = await client.get("/api/system/info")
            assert res.status_code == 200
            assert "installation_id" in res.json()

            res = await client.get("/api/capabilities")
            assert res.status_code == 200
            assert len(res.json()["capabilities"]) >= 3

            res = await client.get("/api/skills")
            assert res.status_code == 200
            assert len(res.json()["skills"]) >= 3

            res = await client.get("/api/models")
            assert res.status_code == 200

            # 2. Settings
            res = await client.get("/api/settings")
            assert res.status_code == 200
            assert "user" in res.json()

            # 3. Auth
            res = await client.get("/api/auth/me")
            assert res.status_code == 200

            # 4. Tasks
            res = await client.get("/api/tasks")
            assert res.status_code == 200
            assert "tasks" in res.json()

            # 5. Projects
            proj_res = await client.post("/api/projects", json={
                "user_id": "test_verify_user",
                "name": "Verify Project",
                "local_folder_path": str(Path(__file__).parent / "scratch_proj")
            })
            assert proj_res.status_code == 200
            proj_data = proj_res.json()
            proj_id = proj_data["id"]

            list_proj = await client.get("/api/projects/test_verify_user")
            assert list_proj.status_code == 200
            assert any(p["id"] == proj_id for p in list_proj.json()["projects"])

            # 6. Sessions
            sess_res = await client.post("/api/sessions", json={
                "user_id": "test_verify_user",
                "project_id": proj_id,
                "title": "Verification Session"
            })
            assert sess_res.status_code == 200
            sess_id = sess_res.json()["session_id"]

            list_sess = await client.get("/api/sessions")
            assert list_sess.status_code == 200
            assert "sessions" in list_sess.json()

            # 7. Transcript
            tr_res = await client.get(f"/api/sessions/{sess_id}/transcript")
            assert tr_res.status_code == 200
            assert "lines" in tr_res.json()

            # 8. Workspace tree
            tree_res = await client.get("/api/workspace/tree")
            assert tree_res.status_code == 200
            assert "workspace" in tree_res.json()

            # Cleanup project
            del_res = await client.delete(f"/api/projects/{proj_id}")
            assert del_res.status_code == 200
