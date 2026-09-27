import os
import sys
import shutil
import uuid
from pathlib import Path
import pytest
import httpx

# Ensure project root and backend are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
backend_dir = Path(__file__).resolve().parent.parent.parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.main import app, lifespan
except ImportError:
    from backend.app.main import app, lifespan
from nexau.archs.platform.path_helpers import (
    get_nexau_home,
    get_database_path,
    get_session_brain_dir,
    get_project_cache_dir,
    get_brain_dir,
)

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

from unittest.mock import patch

def test_path_helpers_resolution():
    """Verify that path helpers return the exact expected directory structure."""
    home = get_nexau_home()
    assert home == Path.home() / ".nexau"
    
    db_path = get_database_path()
    assert db_path == home / "database" / "nexau.db"
    
    proj_id = "test_proj_123"
    sess_id = "test_sess_456"
    
    # 1. Project-scoped session (flat brain layout matching Antigravity)
    proj_brain = get_session_brain_dir(sess_id, proj_id)
    assert proj_brain == home / "brain" / sess_id
    
    # 2. Standalone session (flat brain layout matching Antigravity)
    standalone_brain = get_session_brain_dir(sess_id, None)
    assert standalone_brain == home / "brain" / sess_id
    
    # 3. Project cache
    proj_cache = get_project_cache_dir(proj_id)
    assert proj_cache == home / "brain" / proj_id / "cache"
    
    # 4. Backward compatible get_brain_dir
    assert get_brain_dir(sess_id, proj_id) == proj_brain
    assert get_brain_dir(sess_id, None) == standalone_brain


@pytest.mark.anyio
async def test_storage_scaffold_lifecycle_live():
    """Verify end-to-end FastAPI creation, scaffolding, upload, artifact serving, and deletion."""
    async def _mock_stream(*args, **kwargs):
        from nexau.archs.llm.llm_aggregators.events import TextMessageContentEvent
        yield TextMessageContentEvent(message_id="m1", delta="initialized")

    with patch("nexau.archs.transports.http.sse_server.SSETransportServer.handle_streaming_request", side_effect=_mock_stream):
        async with lifespan(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
                test_run_id = uuid.uuid4().hex[:8]
                user_id = f"auditor_{test_run_id}"
                sess_proj_id = f"sess_p_{test_run_id}"
                sess_standalone_id = f"sess_s_{test_run_id}"
                
                # 1. Create Project
                workspace = str(Path(os.getcwd()) / f"temp_ws_{test_run_id}")
                os.makedirs(workspace, exist_ok=True)
                
                res_p = await client.post("/api/projects", json={
                    "user_id": user_id,
                    "name": f"Audit {test_run_id}",
                    "local_folder_path": workspace
                })
                assert res_p.status_code == 200
                proj_id = res_p.json()["id"]
                
                # 2. Trigger Project Session Stream
                res_stream_p = await client.post("/stream", json={
                    "session_id": sess_proj_id,
                    "messages": "Initialize project audit plan",
                    "context": {
                        "user_id": user_id,
                        "project_id": proj_id,
                        "workspace_uri": workspace,
                    }
                })
                assert res_stream_p.status_code == 200
                
                proj_brain = get_session_brain_dir(sess_proj_id, proj_id)
                assert proj_brain.exists()
                assert (proj_brain / ".system_generated" / "logs").exists()
                assert (proj_brain / ".system_generated" / "tasks").exists()
                assert (proj_brain / ".system_generated" / "messages").exists()
                assert (proj_brain / ".user_uploaded").exists()
                assert (proj_brain / "media").exists()
                assert (proj_brain / "scratch").exists()
                
                # 3. Trigger Standalone Session Stream
                res_stream_s = await client.post("/stream", json={
                    "session_id": sess_standalone_id,
                    "messages": "Standalone quick query",
                    "context": {
                        "user_id": user_id,
                    }
                })
                assert res_stream_s.status_code == 200
                
                standalone_brain = get_session_brain_dir(sess_standalone_id, None)
                assert standalone_brain.exists()
                assert "brain" in str(standalone_brain)
                
                # 4. Upload File
                test_csv = b"ColA,ColB\nVal1,Val2\n"
                res_up = await client.post(
                    f"/api/uploads/{sess_proj_id}",
                    files={"file": ("sample.csv", test_csv, "text/csv")}
                )
                assert res_up.status_code == 200
                assert (proj_brain / ".user_uploaded" / "sample.csv").exists()
                
                # 5. Create Artifacts and Query
                (proj_brain / "task.md").write_text("# Task List\n- [x] Step 1\n", encoding="utf-8")
                res_art = await client.get(f"/api/artifacts/{user_id}/{sess_proj_id}")
                assert res_art.status_code == 200
                assert "task.md" in res_art.json()["files"]
                
                res_art_content = await client.get(f"/api/artifacts/{user_id}/{sess_proj_id}/task.md")
                assert res_art_content.status_code == 200
                assert "Task List" in res_art_content.text
                
                # 6. Delete Standalone Session -> Wipes directory
                res_del_s = await client.delete(f"/sessions/{sess_standalone_id}")
                assert res_del_s.status_code == 200
                assert not standalone_brain.exists()
                
                # 7. Delete Project -> Wipes project directory
                res_del_p = await client.delete(f"/api/projects/{proj_id}")
                assert res_del_p.status_code == 200
                assert not (get_nexau_home() / "projects" / proj_id).exists()
                
                if os.path.exists(workspace):
                    shutil.rmtree(workspace, ignore_errors=True)
