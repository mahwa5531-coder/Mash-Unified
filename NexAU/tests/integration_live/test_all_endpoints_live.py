import os
import sys
import json
import sqlite3
import asyncio
from pathlib import Path
import httpx
import pytest

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from nexau_ui_backend.main import app, lifespan

DB_PATH = Path.home() / ".nexau" / "nexau.db"

def query_db(query: str, params: tuple = ()):
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return rows

@pytest.mark.anyio
async def test_full_endpoint_suite_live():
    """Run full 26-endpoint battery test with direct SQLite verification."""
    results = []

    def record_result(category: str, endpoint: str, status: str, details: str = ""):
        results.append({
            "category": category,
            "endpoint": endpoint,
            "status": status,
            "details": details
        })
        print(f"[{status.upper():6}] {category:20} | {endpoint:35} | {details}", flush=True)

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=60.0) as client:
            
            test_user = "prod_audit_user"
            test_project_dir = str(Path(__file__).parent.parent / "test_scratch_project")
            os.makedirs(test_project_dir, exist_ok=True)
            project_id = None

            # GROUP 1: Projects Router
            res = await client.post("/api/projects", json={
                "user_id": test_user,
                "name": "Production Audit Project",
                "local_folder_path": test_project_dir
            })
            assert res.status_code == 200
            project_id = res.json().get("id")
            db_rows = query_db("SELECT id, user_id, name, local_folder_path FROM projects WHERE id = ?", (project_id,))
            assert db_rows and db_rows[0][1] == test_user
            record_result("Projects", "POST /api/projects", "PASS", f"Created project {project_id}")

            res = await client.get(f"/api/projects/{test_user}")
            assert res.status_code == 200
            assert any(p.get("id") == project_id for p in res.json().get("projects", []))
            record_result("Projects", "GET /api/projects/{user_id}", "PASS", f"Found project {project_id}")

            # GROUP 2: Sessions Router
            test_session_id = f"prod_sess_{int(asyncio.get_event_loop().time() * 1000)}"
            res = await client.post("/api/sessions", json={
                "user_id": test_user,
                "project_id": project_id,
                "title": "Production Validation Session"
            })
            assert res.status_code == 200
            record_result("Sessions API", "POST /api/sessions", "PASS", "Session created successfully")

            res = await client.get(f"/api/sessions/project/{project_id}")
            assert res.status_code == 200
            record_result("Sessions API", "GET /api/sessions/project/{id}", "PASS", "Listed project sessions")

            # GROUP 3: Core SSE Stream Bridge
            streamed_events = []
            async with client.stream("POST", "/stream", json={
                "session_id": test_session_id,
                "messages": "Calculate 25 * 4 and respond in exactly 1 line.",
                "context": {
                    "title": "Math Verification Turn",
                    "custom_title": "Production Test Math",
                    "workspace_uri": test_project_dir,
                    "project_id": project_id
                }
            }) as stream_res:
                assert stream_res.status_code == 200
                async for line in stream_res.aiter_lines():
                    if line.startswith("data:"):
                        try:
                            streamed_events.append(json.loads(line[5:].strip()))
                        except:
                            pass
            
            db_session = query_db("SELECT session_id, context FROM sessions WHERE session_id = ?", (test_session_id,))
            db_actions = query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))
            assert db_session and db_actions[0][0] > 0
            record_result("Streaming Bridge", "POST /stream", "PASS", f"Streamed {len(streamed_events)} events")

            # GET /sessions
            res = await client.get("/sessions")
            assert res.status_code == 200
            sessions_list = res.json().get("sessions", [])
            found_s = next((s for s in sessions_list if s.get("session_id") == test_session_id), None)
            assert found_s is not None
            record_result("Sessions Bridge", "GET /sessions", "PASS", f"Found session: msg_count={found_s.get('message_count')}")

            # POST /sessions/{id}/view
            res = await client.post(f"/sessions/{test_session_id}/view")
            assert res.status_code == 200
            record_result("View Tracking", "POST /sessions/{id}/view", "PASS", "Recorded view time")

            # POST /sessions/{id}/rename
            res = await client.post(f"/sessions/{test_session_id}/rename", json={"custom_title": "Production Validated Title"})
            assert res.status_code == 200
            db_sess = query_db("SELECT context FROM sessions WHERE session_id = ?", (test_session_id,))
            ctx = json.loads(db_sess[0][0]) if isinstance(db_sess[0][0], str) else db_sess[0][0]
            assert ctx.get("custom_title") == "Production Validated Title"
            record_result("Sessions Bridge", "POST /sessions/{id}/rename", "PASS", "Title updated in SQLite")

            # GET /sessions/{id}/transcript
            res = await client.get(f"/sessions/{test_session_id}/transcript")
            assert res.status_code == 200
            record_result("Transcript Bridge", "GET /sessions/{id}/transcript", "PASS", f"Reconstructed {len(res.json().get('lines', []))} lines")

            # GET /api/sessions/{u}/{s}/history
            res = await client.get(f"/api/sessions/{test_user}/{test_session_id}/history")
            assert res.status_code == 200
            record_result("Sessions API", "GET /api/sessions/{u}/{s}/history", "PASS", "Retrieved history")

            # Subagents
            res = await client.get(f"/api/sessions/{test_session_id}/subagents")
            assert res.status_code == 200
            record_result("Subagents API", "GET /api/sessions/{id}/subagents", "PASS", "Listed subagents")

            res = await client.get(f"/api/sessions/{test_session_id}/subagents/agent_dummy_sub/transcript")
            assert res.status_code == 200
            record_result("Subagents API", "GET /api/.../{sid}/transcript", "PASS", "Retrieved subagent transcript")

            # Artifacts & Files
            res = await client.get(f"/api/artifacts/session/{test_session_id}")
            assert res.status_code == 200
            record_result("Artifacts API", "GET /api/artifacts/session/{id}", "PASS", "Listed artifacts")

            res = await client.get(f"/files/content?path={Path(__file__)}")
            assert res.status_code == 200 and "test_full_endpoint_suite_live" in res.json().get("content", "")
            record_result("Files API", "GET /files/content", "PASS", "Read local disk file")

            # Uploads
            files = {"file": ("production_ledger.csv", b"account,desc,amount\n4000,Service Revenue,125000\n", "text/csv")}
            res = await client.post(f"/api/uploads/{test_session_id}", files=files)
            assert res.status_code == 200
            up_path = res.json().get("path")
            assert os.path.exists(up_path)
            record_result("Uploads API", "POST /api/uploads/{id}", "PASS", "Uploaded file saved")

            res = await client.get(f"/api/uploads/{test_session_id}")
            assert res.status_code == 200 and len(res.json().get("uploads", [])) > 0
            record_result("Uploads API", "GET /api/uploads/{id}", "PASS", "Listed uploads")

            # Skills & Models
            res = await client.get("/api/skills")
            assert res.status_code == 200 and len(res.json().get("skills", [])) > 0
            record_result("Skills API", "GET /api/skills", "PASS", "Discovered skills")

            res = await client.get("/api/models")
            assert res.status_code == 200 and len(res.json().get("models", [])) > 0
            record_result("Models API", "GET /api/models", "PASS", "Listed models")

            # System & Tasks
            res = await client.get("/api/subagents")
            assert res.status_code == 200
            record_result("System API", "GET /api/subagents", "PASS", "System subagents OK")

            res = await client.get("/api/capabilities")
            assert res.status_code == 200
            record_result("System API", "GET /api/capabilities", "PASS", "Capabilities OK")

            res = await client.get("/tasks/task_audit_prod/log")
            assert res.status_code == 200
            record_result("Task Logs", "GET /tasks/{id}/log", "PASS", "Task log OK")

            # Approvals & Stop
            res = await client.post("/approve", json={"session_id": test_session_id, "action": "proceed", "feedback": "OK"})
            assert res.status_code == 200 and res.json().get("MANUAL_APPROVAL")
            record_result("Approval API", "POST /approve", "PASS", "Approved")

            res = await client.post("/stop", json={"session_id": test_session_id, "user_id": "default_user", "force": True})
            assert res.status_code == 200
            record_result("Stop API", "POST /stop", "PASS", "Stop OK")

            # Undo & Cascade Deletion
            res = await client.request("DELETE", f"/sessions/{test_session_id}/undo", json={"from_turn": 1})
            assert res.status_code == 200
            record_result("Undo Bridge", "DELETE /sessions/{id}/undo", "PASS", "Undo OK")

            res = await client.delete(f"/sessions/{test_session_id}")
            assert res.status_code == 200
            assert query_db("SELECT count(*) FROM sessions WHERE session_id = ?", (test_session_id,))[0][0] == 0
            assert query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))[0][0] == 0
            record_result("Cascade Deletion", "DELETE /sessions/{id}", "PASS", "Purged session & actions")

            res = await client.delete(f"/api/projects/{project_id}")
            assert res.status_code == 200
            assert query_db("SELECT count(*) FROM projects WHERE id = ?", (project_id,))[0][0] == 0
            record_result("Projects", "DELETE /api/projects/{id}", "PASS", "Purged project")

            if os.path.exists(up_path):
                try:
                    os.remove(up_path)
                except:
                    pass

if __name__ == "__main__":
    asyncio.run(test_full_endpoint_suite_live())
