import os
import sys
import tempfile
import asyncio
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
async def test_deferred_project_registration():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=10.0) as client:
            with tempfile.TemporaryDirectory(prefix="nexau_test_proj_") as tmp_dir:
                tmp_path = str(Path(tmp_dir).resolve())
                folder_name = Path(tmp_dir).name

                # 1. Verify select-folder
                sel_res = await client.post("/api/system/select-folder", json={"folder_path": tmp_path})
                assert sel_res.status_code == 200
                sel_data = sel_res.json()
                assert sel_data["status"] == "success"
                assert sel_data["folder_name"] == folder_name

                # Verify no project or session exists yet in DB
                proj_res = await client.get("/api/projects")
                assert proj_res.status_code == 200
                projects_before = proj_res.json().get("projects", [])
                assert not any(p["local_folder_path"] == tmp_path for p in projects_before)

                # 2. Simulate user first prompt using streaming request
                test_sid = f"test_reg_{folder_name}"
                stream_payload = {
                    "session_id": test_sid,
                    "messages": "Hello from newly selected project",
                    "context": {
                        "workspace_uri": tmp_path,
                        "working_directory": tmp_path,
                        "section": "workspace",
                        "title": "New Project Session",
                    },
                    "user_id": "test_auditor",
                }

                async with client.stream("POST", "/api/chat/stream", json=stream_payload) as stream_res:
                    assert stream_res.status_code == 200
                    # Read at least one chunk to ensure server processed the initial request
                    async for chunk in stream_res.aiter_raw():
                        if chunk:
                            break

                # 3. Verify ProjectModel and SessionModel are registered
                proj_res_after = await client.get("/api/projects")
                projects_after = proj_res_after.json().get("projects", [])
                norm_tmp = os.path.normpath(tmp_path).lower()
                matching_proj = next((p for p in projects_after if os.path.normpath(p.get("local_folder_path", "")).lower() == norm_tmp), None)
                assert matching_proj is not None, "Project should be automatically registered in DB upon first message send!"
                assert matching_proj["name"] == folder_name

                sess_res = await client.get("/api/sessions")
                assert sess_res.status_code == 200
                sessions_list = sess_res.json().get("sessions", [])
                matching_sess = next((s for s in sessions_list if s["session_id"] == test_sid), None)
                assert matching_sess is not None, "Session must be registered in DB upon first message send!"
                assert matching_sess["workspace_uri"] == folder_name
                assert matching_sess["section"] == "workspace"

                # Cleanup
                await client.delete(f"/api/sessions/{test_sid}")


if __name__ == "__main__":
    asyncio.run(test_deferred_project_registration())
    print("TEST PASSED: Project deferred registration verified successfully!")
