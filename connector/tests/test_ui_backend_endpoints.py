import os
import sys
import json
import sqlite3
import pytest
from pathlib import Path
import httpx

# Ensure project roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
import app.dependencies as deps

from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter

DB_PATH = Path.home() / ".nexau" / "nexau.db"

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_ui_backend_comprehensive_unit_suite():
    """Unit test suite covering all 34 scenarios across all UI backend routers."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            engine = deps.get_engine()
            test_user = "unit_test_user"
            test_proj_dir = str(Path(__file__).parent.parent / "test_scratch_project" / "unit_proj")
            os.makedirs(test_proj_dir, exist_ok=True)
            test_sid = f"unit_test_sess_{os.getpid()}"

            # -------------------------------------------------------------
            # 1. Projects Router Unit Tests
            # -------------------------------------------------------------
            # Create project
            res = await client.post("/api/projects", json={"user_id": test_user, "name": "Unit Project", "local_folder_path": test_proj_dir})
            assert res.status_code == 200
            pid = res.json()["id"]

            # List projects
            res = await client.get(f"/api/projects/{test_user}")
            assert res.status_code == 200
            assert any(p["id"] == pid for p in res.json()["projects"])

            # -------------------------------------------------------------
            # 2. Sessions Router & Subagents Unit Tests
            # -------------------------------------------------------------
            # Create session
            res = await client.post("/api/sessions", json={"user_id": test_user, "project_id": pid, "title": "Unit Session"})
            assert res.status_code == 200

            # List sessions for project
            res = await client.get(f"/api/sessions/project/{pid}")
            assert res.status_code == 200

            # Setup test session in DB for subagent & view testing
            sess_obj = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", test_sid))
            if not sess_obj:
                sess_obj = SessionModel(
                    session_id=test_sid,
                    user_id=test_user,
                    context={"title": "Unit Test Session", "workspace_uri": test_proj_dir}
                )
                await engine.create(sess_obj)

            # Subagents: Empty session
            res = await client.get(f"/api/sessions/{test_sid}/subagents")
            assert res.status_code == 200
            assert res.json()["subagents"] == []

            # Subagents: Add synthetic subagent action
            from nexau.core.messages import Message
            act_sub = AgentRunActionModel(
                session_id=test_sid,
                user_id=test_user,
                agent_id="researcher_sub_01",
                run_id="run_unit_01",
                root_run_id="run_unit_01",
                agent_name="researcher",
                action_type="append",
                append_messages=[Message.assistant("Found 3 revenue files")],
                created_at_ns=1000
            )
            await engine.create(act_sub)

            # Subagents: List with subagent metrics
            res = await client.get(f"/api/sessions/{test_sid}/subagents")
            assert res.status_code == 200
            subs = res.json()["subagents"]
            assert len(subs) == 1
            assert subs[0]["sub_agent_id"] == "researcher_sub_01"
            assert subs[0]["action_count"] == 1

            # Subagents: Subagent transcript
            res = await client.get(f"/api/sessions/{test_sid}/subagents/researcher_sub_01/transcript")
            assert res.status_code == 200
            assert len(res.json()["messages"]) == 1
            assert "Found 3 revenue files" in str(res.json()["messages"][0]["content"])

            # Subagents: Non-existent subagent returns empty transcript cleanly
            res = await client.get(f"/api/sessions/{test_sid}/subagents/non_existent_sub/transcript")
            assert res.status_code == 200
            assert res.json()["messages"] == []

            # Transcript: Verify structured steps and unitised text emission
            res = await client.get(f"/api/sessions/{test_sid}/transcript")
            assert res.status_code == 200
            t_lines = res.json()["lines"]
            assert len(t_lines) >= 1
            assert "steps" in t_lines[0]
            assert any(s.get("type") == "text" for s in t_lines[0]["steps"])

            # -------------------------------------------------------------
            # 3. View Tracking & Unread Status Unit Tests
            # -------------------------------------------------------------
            # View session
            res = await client.post(f"/sessions/{test_sid}/view")
            assert res.status_code == 200
            assert res.json()["has_unread"] is False
            view_time = res.json()["last_user_view_time"]
            assert view_time is not None

            # Check GET /sessions
            res = await client.get("/sessions")
            assert res.status_code == 200
            s_data = next((s for s in res.json()["sessions"] if s["session_id"] == test_sid), None)
            assert s_data is not None
            assert s_data["has_unread"] is False

            # Rename session
            res = await client.post(f"/sessions/{test_sid}/rename", json={"custom_title": "Custom Unit Title"})
            assert res.status_code == 200
            updated_sess = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", test_sid))
            assert (updated_sess.context or {}).get("custom_title") == "Custom Unit Title"

            # -------------------------------------------------------------
            # 4. Artifacts & File Discovery Unit Tests
            # -------------------------------------------------------------
            # Artifacts list
            res = await client.get(f"/api/artifacts/session/{test_sid}")
            assert res.status_code == 200

            # Local file reader (valid workspace path)
            res = await client.get(f"/files/content?path={Path(__file__)}")
            assert res.status_code == 200
            assert "test_ui_backend_comprehensive_unit_suite" in res.json()["content"]

            # Security: Path traversal outside allowed workspace returns 403 Forbidden
            res = await client.get("/files/content?path=C:\\Windows\\win.ini")
            assert res.status_code == 403
            assert "outside authorized workspace" in res.json()["detail"]

            # Security: a broad user Downloads directory is not an application
            # workspace and must not be readable just because it exists locally.
            res = await client.get(f"/files/content?path={Path.home() / 'Downloads'}")
            assert res.status_code == 403
            assert "outside authorized workspace" in res.json()["detail"]

            # -------------------------------------------------------------
            # 5. Uploads Router Unit Tests
            # -------------------------------------------------------------
            # Upload file
            files = {"file": ("unit_test_doc.txt", b"Audit evidence data block", "text/plain")}
            res = await client.post(f"/api/uploads/{test_sid}", files=files)
            assert res.status_code == 200
            up_path = res.json()["path"]
            assert os.path.exists(up_path)

            # List uploads
            res = await client.get(f"/api/uploads/{test_sid}")
            assert res.status_code == 200
            assert any(f["name"] == "unit_test_doc.txt" for f in res.json()["uploads"])

            # Clean up uploaded file
            if os.path.exists(up_path):
                os.remove(up_path)

            # Security: Upload path traversal rejection
            files_traversal = {"file": ("../../../malicious.txt", b"evil", "text/plain")}
            res = await client.post(f"/api/uploads/{test_sid}", files=files_traversal)
            assert res.status_code == 200
            up_path = res.json()["path"]
            assert "malicious.txt" in up_path
            assert ".." not in up_path
            if os.path.exists(up_path):
                os.remove(up_path)

            # -------------------------------------------------------------
            # 6. System Discovery Unit Tests
            # -------------------------------------------------------------
            res = await client.get("/api/skills")
            assert res.status_code == 200
            assert len(res.json()["skills"]) >= 3

            res = await client.get("/api/models")
            assert res.status_code == 200
            assert len(res.json()["models"]) >= 4

            res = await client.get("/api/capabilities")
            assert res.status_code == 200

            res = await client.get("/tasks/task_unit_test/log")
            assert res.status_code == 200

            # Live Terminal SSE Stream Test (OpenHands pattern)
            async with client.stream("GET", "/api/tasks/task_unit_test/stream") as stream_res:
                assert stream_res.status_code == 200
                assert "text/event-stream" in stream_res.headers.get("content-type", "")
                async for chunk in stream_res.aiter_raw():
                    if chunk:
                        assert b"data: " in chunk
                        break


            # -------------------------------------------------------------
            # 7. Undo & Cascade Purge Unit Tests
            # -------------------------------------------------------------
            res = await client.request("DELETE", f"/sessions/{test_sid}/undo", json={"from_turn": 1})
            assert res.status_code == 200

            res = await client.delete(f"/sessions/{test_sid}")
            assert res.status_code == 200

            res = await client.delete(f"/api/projects/{pid}")
            assert res.status_code == 200
