import os
import sys
import json
import sqlite3
import asyncio
from pathlib import Path
import httpx

# Ensure paths
backend_dir = Path(__file__).resolve().parent.parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

try:
    from app.main import app, lifespan
except ImportError:
    from backend.app.main import app, lifespan

from nexau.archs.platform.path_helpers import get_database_path
DB_PATH = get_database_path()

def query_db(query: str, params: tuple = ()):
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return rows

async def run_full_backend_audit():
    print("=" * 80)
    print("STARTING COMPREHENSIVE NEXAU BACKEND ENDPOINTS AUDIT & DB VERIFICATION")
    print("=" * 80, flush=True)

    results = []

    def record_result(category: str, endpoint: str, status: str, details: str = ""):
        results.append({
            "category": category,
            "endpoint": endpoint,
            "status": status,
            "details": details
        })
        print(f"[{status.upper():6}] {category:20} | {endpoint:35} | {details}", flush=True)

    # Use AsyncClient with lifespan context
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=60.0) as client:
            
            # -------------------------------------------------------------
            # GROUP 1: Projects Router (/api/projects)
            # -------------------------------------------------------------
            print("\n>>> Testing Group 1: Projects Router (/api/projects)", flush=True)
            test_user = "audit_user_test"
            test_project_dir = str(Path(__file__).parent / "test_scratch_project")
            project_id = None

            # 1.1 POST /api/projects
            try:
                res = await client.post("/api/projects", json={
                    "user_id": test_user,
                    "name": "Audit Test Project",
                    "local_folder_path": test_project_dir
                })
                if res.status_code == 200:
                    data = res.json()
                    project_id = data.get("id")
                    # DB Verification
                    db_rows = query_db("SELECT id, user_id, name, local_folder_path FROM projects WHERE id = ?", (project_id,))
                    if db_rows and db_rows[0][1] == test_user:
                        record_result("Projects", "POST /api/projects", "PASS", f"Created project {project_id}, verified in SQLite projects table")
                    else:
                        record_result("Projects", "POST /api/projects", "FAIL", "Record not found in DB")
                else:
                    record_result("Projects", "POST /api/projects", "FAIL", f"HTTP {res.status_code}: {res.text}")
            except Exception as e:
                record_result("Projects", "POST /api/projects", "ERROR", str(e))

            # 1.2 GET /api/projects/{user_id}
            try:
                res = await client.get(f"/api/projects/{test_user}")
                if res.status_code == 200:
                    data = res.json()
                    found = any(p.get("id") == project_id for p in data.get("projects", []))
                    if found:
                        record_result("Projects", "GET /api/projects/{user_id}", "PASS", f"Found project {project_id} for user {test_user}")
                    else:
                        record_result("Projects", "GET /api/projects/{user_id}", "FAIL", "Created project not listed")
                else:
                    record_result("Projects", "GET /api/projects/{user_id}", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Projects", "GET /api/projects/{user_id}", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 2: Sessions Router (/api/sessions)
            # -------------------------------------------------------------
            print("\n>>> Testing Group 2: Sessions Router & Top-Level Session APIs", flush=True)
            test_session_id = f"test_sess_{int(asyncio.get_event_loop().time() * 1000)}"

            # 2.1 POST /api/sessions
            try:
                res = await client.post("/api/sessions", json={
                    "user_id": test_user,
                    "project_id": project_id,
                    "title": "Initial Audit Session"
                })
                if res.status_code == 200:
                    record_result("Sessions API", "POST /api/sessions", "PASS", "Session validation endpoint OK")
                else:
                    record_result("Sessions API", "POST /api/sessions", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions API", "POST /api/sessions", "ERROR", str(e))

            # 2.2 GET /api/sessions/project/{project_id}
            try:
                res = await client.get(f"/api/sessions/project/{project_id}")
                if res.status_code == 200:
                    record_result("Sessions API", "GET /api/sessions/project/{id}", "PASS", f"Listed sessions for project {project_id}")
                else:
                    record_result("Sessions API", "GET /api/sessions/project/{id}", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions API", "GET /api/sessions/project/{id}", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 3: Core SSE Stream Bridge (POST /stream)
            # -------------------------------------------------------------
            print("\n>>> Testing Group 3: Core SSE Stream Bridge (POST /stream)", flush=True)
            streamed_events = []
            try:
                async with client.stream("POST", "/stream", json={
                    "session_id": test_session_id,
                    "messages": "Calculate 15 * 6 and respond in exactly 1 line.",
                    "context": {
                        "title": "Arithmetic Test",
                        "custom_title": "Math Verification",
                        "workspace_uri": test_project_dir,
                        "project_id": project_id
                    }
                }) as stream_res:
                    if stream_res.status_code == 200:
                        async for line in stream_res.aiter_lines():
                            if line.startswith("data:"):
                                try:
                                    ev = json.loads(line[5:].strip())
                                    streamed_events.append(ev)
                                except:
                                    pass
                        
                        # DB Verification for Session and AgentRunActionModel
                        db_session = query_db("SELECT session_id, context FROM sessions WHERE session_id = ?", (test_session_id,))
                        db_actions = query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))
                        
                        action_count = db_actions[0][0] if db_actions else 0
                        if db_session and action_count > 0:
                            record_result("Streaming Bridge", "POST /stream", "PASS", f"Streamed {len(streamed_events)} SSE events, created {action_count} DB actions in SQLite")
                        else:
                            record_result("Streaming Bridge", "POST /stream", "WARN", f"Streamed OK but DB check: session={bool(db_session)}, actions={action_count}")
                    else:
                        record_result("Streaming Bridge", "POST /stream", "FAIL", f"HTTP {stream_res.status_code}")
            except Exception as e:
                record_result("Streaming Bridge", "POST /stream", "ERROR", str(e))

            # 2.4 GET /sessions (Top-Level Session List)
            try:
                res = await client.get("/sessions")
                if res.status_code == 200:
                    data = res.json()
                    sessions_list = data.get("sessions", [])
                    found = any(s.get("session_id") == test_session_id for s in sessions_list)
                    if found:
                        record_result("Sessions Bridge", "GET /sessions", "PASS", f"Found session {test_session_id} with formatted metadata")
                    else:
                        record_result("Sessions Bridge", "GET /sessions", "FAIL", "Created session not found in list")
                else:
                    record_result("Sessions Bridge", "GET /sessions", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions Bridge", "GET /sessions", "ERROR", str(e))

            # 2.5 GET /sessions/{session_id}/transcript
            try:
                res = await client.get(f"/sessions/{test_session_id}/transcript")
                if res.status_code == 200:
                    data = res.json()
                    lines = data.get("lines", [])
                    if len(lines) > 0:
                        record_result("Transcript Bridge", "GET /sessions/{id}/transcript", "PASS", f"Reconstructed {len(lines)} transcript turns from event store")
                    else:
                        record_result("Transcript Bridge", "GET /sessions/{id}/transcript", "WARN", "0 lines returned from transcript")
                else:
                    record_result("Transcript Bridge", "GET /sessions/{id}/transcript", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Transcript Bridge", "GET /sessions/{id}/transcript", "ERROR", str(e))

            # 2.6 POST /sessions/{session_id}/view
            try:
                res = await client.post(f"/sessions/{test_session_id}/view")
                if res.status_code == 200 and res.json().get("status") == "success":
                    record_result("Sessions Bridge", "POST /sessions/{id}/view", "PASS", "Marked session viewed")
                else:
                    record_result("Sessions Bridge", "POST /sessions/{id}/view", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions Bridge", "POST /sessions/{id}/view", "ERROR", str(e))

            # 2.7 POST /sessions/{session_id}/rename
            try:
                res = await client.post(f"/sessions/{test_session_id}/rename", json={"custom_title": "Renamed Test Title"})
                if res.status_code == 200:
                    # Verify in SQLite DB context column
                    db_sess = query_db("SELECT context FROM sessions WHERE session_id = ?", (test_session_id,))
                    if db_sess:
                        ctx = json.loads(db_sess[0][0]) if isinstance(db_sess[0][0], str) else db_sess[0][0]
                        if ctx.get("custom_title") == "Renamed Test Title":
                            record_result("Sessions Bridge", "POST /sessions/{id}/rename", "PASS", "Updated title verified directly in SQLite session context")
                        else:
                            record_result("Sessions Bridge", "POST /sessions/{id}/rename", "FAIL", f"DB context mismatch: {ctx}")
                    else:
                        record_result("Sessions Bridge", "POST /sessions/{id}/rename", "FAIL", "Session not found in DB")
                else:
                    record_result("Sessions Bridge", "POST /sessions/{id}/rename", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions Bridge", "POST /sessions/{id}/rename", "ERROR", str(e))

            # 2.8 GET /api/sessions/{user_id}/{session_id}/history
            try:
                res = await client.get(f"/api/sessions/{test_user}/{test_session_id}/history")
                if res.status_code == 200:
                    msgs = res.json().get("messages", [])
                    record_result("Sessions API", "GET /api/sessions/{u}/{s}/history", "PASS", f"Retrieved {len(msgs)} messages from session history")
                else:
                    record_result("Sessions API", "GET /api/sessions/{u}/{s}/history", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Sessions API", "GET /api/sessions/{u}/{s}/history", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 4: Auxiliary Bridge Endpoints
            # -------------------------------------------------------------
            print("\n>>> Testing Group 4: Auxiliary Bridge Endpoints", flush=True)

            # 4.1 GET /files/content
            try:
                test_file = Path(__file__)
                res = await client.get(f"/files/content?path={test_file}")
                if res.status_code == 200 and "run_full_backend_audit" in res.json().get("content", ""):
                    record_result("File Reader", "GET /files/content", "PASS", "Successfully read local disk file content")
                else:
                    record_result("File Reader", "GET /files/content", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("File Reader", "GET /files/content", "ERROR", str(e))

            # 4.2 GET /tasks/{task_id}/log
            try:
                res = await client.get("/tasks/task_123/log")
                if res.status_code == 200:
                    record_result("Task Logs", "GET /tasks/{id}/log", "PASS", res.json().get("content", ""))
                else:
                    record_result("Task Logs", "GET /tasks/{id}/log", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Task Logs", "GET /tasks/{id}/log", "ERROR", str(e))

            # 4.3 POST /approve
            try:
                res = await client.post("/approve", json={
                    "session_id": test_session_id,
                    "action": "proceed",
                    "feedback": "Approved by auditor"
                })
                if res.status_code == 200 and res.json().get("MANUAL_APPROVAL"):
                    record_result("Approval Bridge", "POST /approve", "PASS", "Plan approved successfully")
                else:
                    record_result("Approval Bridge", "POST /approve", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Approval Bridge", "POST /approve", "ERROR", str(e))

            # 4.4 POST /stop
            try:
                res = await client.post("/stop", json={
                    "session_id": test_session_id,
                    "user_id": "default_user",
                    "force": True
                })
                if res.status_code == 200:
                    record_result("Stop Bridge", "POST /stop", "PASS", f"Stop response: {res.json()}")
                else:
                    record_result("Stop Bridge", "POST /stop", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Stop Bridge", "POST /stop", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 5: Chat Router (/api/chat)
            # -------------------------------------------------------------
            print("\n>>> Testing Group 5: Chat Router (/api/chat)", flush=True)

            # 5.1 POST /api/chat/{session_id}/stop
            try:
                res = await client.post(f"/api/chat/{test_session_id}/stop")
                if res.status_code == 200:
                    record_result("Chat API", "POST /api/chat/{id}/stop", "PASS", "Stop handler OK")
                else:
                    record_result("Chat API", "POST /api/chat/{id}/stop", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Chat API", "POST /api/chat/{id}/stop", "ERROR", str(e))

            # 5.2 POST /api/chat/{session_id}/approve
            try:
                res = await client.post(f"/api/chat/{test_session_id}/approve", json={
                    "user_id": "default_user",
                    "action": "proceed"
                })
                if res.status_code == 200:
                    record_result("Chat API", "POST /api/chat/{id}/approve", "PASS", "Approve handler OK")
                else:
                    record_result("Chat API", "POST /api/chat/{id}/approve", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Chat API", "POST /api/chat/{id}/approve", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 6: Artifacts & Uploads Routers
            # -------------------------------------------------------------
            print("\n>>> Testing Group 6: Artifacts & Uploads Routers", flush=True)

            # 6.1 POST /api/uploads/{session_id}
            uploaded_file_path = None
            try:
                files = {"file": ("audit_sample.csv", b"sku,qty,cost\nSKU_1,100,25.5\nSKU_2,200,30.0", "text/csv")}
                res = await client.post(f"/api/uploads/{test_session_id}", files=files)
                if res.status_code == 200 and res.json().get("status") == "success":
                    uploaded_file_path = res.json().get("path")
                    if os.path.exists(uploaded_file_path):
                        record_result("Uploads API", "POST /api/uploads/{id}", "PASS", f"File saved on disk at: {uploaded_file_path}")
                    else:
                        record_result("Uploads API", "POST /api/uploads/{id}", "FAIL", "Saved file not found on disk")
                else:
                    record_result("Uploads API", "POST /api/uploads/{id}", "FAIL", f"HTTP {res.status_code}: {res.text}")
            except Exception as e:
                record_result("Uploads API", "POST /api/uploads/{id}", "ERROR", str(e))

            # 6.2 GET /api/artifacts/{user_id}/{session_id}
            try:
                res = await client.get(f"/api/artifacts/{test_user}/{test_session_id}")
                if res.status_code == 200:
                    record_result("Artifacts API", "GET /api/artifacts/{u}/{s}", "PASS", f"Artifact listing OK: {res.json()}")
                else:
                    record_result("Artifacts API", "GET /api/artifacts/{u}/{s}", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Artifacts API", "GET /api/artifacts/{u}/{s}", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 7: System & Tasks Routers
            # -------------------------------------------------------------
            print("\n>>> Testing Group 7: System & Tasks Routers", flush=True)

            # 7.1 GET /api/subagents
            try:
                res = await client.get("/api/subagents")
                if res.status_code == 200 and "subagents" in res.json():
                    record_result("System API", "GET /api/subagents", "PASS", f"Subagents: {res.json().get('subagents')}")
                else:
                    record_result("System API", "GET /api/subagents", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("System API", "GET /api/subagents", "ERROR", str(e))

            # 7.2 GET /api/capabilities
            try:
                res = await client.get("/api/capabilities")
                if res.status_code == 200 and "capabilities" in res.json():
                    record_result("System API", "GET /api/capabilities", "PASS", f"Capabilities: {len(res.json().get('capabilities'))} capabilities reported")
                else:
                    record_result("System API", "GET /api/capabilities", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("System API", "GET /api/capabilities", "ERROR", str(e))

            # 7.3 GET /api/tasks/{task_id}/stream (Streaming)
            try:
                res = await client.get("/api/tasks/task_abc_456/stream")
                if res.status_code == 200 and "data:" in res.text:
                    record_result("Tasks API", "GET /api/tasks/{id}/stream (SSE)", "PASS", "Streamed live task progress events")
                else:
                    record_result("Tasks API", "GET /api/tasks/{id}/stream (SSE)", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Tasks API", "GET /api/tasks/{id}/stream (SSE)", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 8: Multi-Agent Team Routers (/team/*)
            # -------------------------------------------------------------
            print("\n>>> Testing Group 8: Multi-Agent Team Routers (/team/*)", flush=True)

            # 8.1 POST /team/tasks
            task_id = None
            try:
                res = await client.post("/team/tasks", json={
                    "user_id": test_user,
                    "session_id": test_session_id,
                    "title": "Audit Revenue Subledger",
                    "description": "Perform reconciliation of revenue subledger against G/L",
                    "priority": 1
                })
                if res.status_code == 200:
                    data = res.json()
                    task_id = data.get("task_id")
                    record_result("Team API", "POST /team/tasks", "PASS", f"Created team task {task_id}")
                else:
                    record_result("Team API", "POST /team/tasks", "FAIL", f"HTTP {res.status_code}: {res.text}")
            except Exception as e:
                record_result("Team API", "POST /team/tasks", "ERROR", str(e))

            # 8.2 GET /team/tasks
            try:
                res = await client.get(f"/team/tasks?user_id={test_user}&session_id={test_session_id}")
                if res.status_code == 200:
                    tasks_list = res.json()
                    found = any(t.get("task_id") == task_id for t in tasks_list)
                    if found:
                        record_result("Team API", "GET /team/tasks", "PASS", f"Listed {len(tasks_list)} tasks on shared board")
                    else:
                        record_result("Team API", "GET /team/tasks", "FAIL", "Created task not listed")
                else:
                    record_result("Team API", "GET /team/tasks", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Team API", "GET /team/tasks", "ERROR", str(e))

            # 8.3 POST /team/tasks/claim
            if task_id:
                try:
                    res = await client.post("/team/tasks/claim", json={
                        "user_id": test_user,
                        "session_id": test_session_id,
                        "task_id": task_id,
                        "assignee_agent_id": "auditor_subagent_1"
                    })
                    if res.status_code == 200 and res.json().get("status") == "claimed":
                        record_result("Team API", "POST /team/tasks/claim", "PASS", f"Task {task_id} claimed by auditor_subagent_1")
                    else:
                        record_result("Team API", "POST /team/tasks/claim", "FAIL", f"HTTP {res.status_code}: {res.text}")
                except Exception as e:
                    record_result("Team API", "POST /team/tasks/claim", "ERROR", str(e))

            # 8.4 PATCH /team/tasks/{task_id}
            if task_id:
                try:
                    res = await client.patch(
                        f"/team/tasks/{task_id}?user_id={test_user}&session_id={test_session_id}",
                        json={"status": "completed", "result_summary": "Reconciliation verified without variances"}
                    )
                    if res.status_code == 200 and res.json().get("status") == "completed":
                        record_result("Team API", "PATCH /team/tasks/{id}", "PASS", f"Task {task_id} status updated to completed")
                    else:
                        record_result("Team API", "PATCH /team/tasks/{id}", "FAIL", f"HTTP {res.status_code}")
                except Exception as e:
                    record_result("Team API", "PATCH /team/tasks/{id}", "ERROR", str(e))

            # 8.5 POST /team/message (Intra-team Message Bus)
            try:
                res = await client.post("/team/message", json={
                    "user_id": test_user,
                    "session_id": test_session_id,
                    "from_agent_id": "auditor_subagent_1",
                    "content": "Revenue verification completed successfully."
                })
                if res.status_code == 200:
                    record_result("Team API", "POST /team/message", "PASS", f"Message broadcasted: {res.json()}")
                else:
                    record_result("Team API", "POST /team/message", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Team API", "POST /team/message", "ERROR", str(e))

            # 8.6 GET /team/teammates & GET /team/status
            try:
                res = await client.get(f"/team/status?user_id={test_user}&session_id={test_session_id}")
                if res.status_code == 200:
                    record_result("Team API", "GET /team/status", "PASS", f"Team status: {res.json()}")
                else:
                    record_result("Team API", "GET /team/status", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Team API", "GET /team/status", "ERROR", str(e))

            # -------------------------------------------------------------
            # GROUP 9: Undo & Cascade Deletion Testing with Direct SQLite Validation
            # -------------------------------------------------------------
            print("\n>>> Testing Group 9: Undo & Cascade Deletion DB Integrity", flush=True)

            # 9.1 DELETE /sessions/{session_id}/undo
            try:
                before_actions = query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))[0][0]
                res = await client.request("DELETE", f"/sessions/{test_session_id}/undo", json={"from_turn": 1})
                after_actions = query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))[0][0]
                if res.status_code == 200:
                    record_result("Undo Bridge", "DELETE /sessions/{id}/undo", "PASS", f"Actions before={before_actions}, after={after_actions}")
                else:
                    record_result("Undo Bridge", "DELETE /sessions/{id}/undo", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Undo Bridge", "DELETE /sessions/{id}/undo", "ERROR", str(e))

            # 9.2 DELETE /sessions/{session_id} (Cascade Deletion)
            try:
                res = await client.delete(f"/sessions/{test_session_id}")
                if res.status_code == 200:
                    sess_in_db = query_db("SELECT count(*) FROM sessions WHERE session_id = ?", (test_session_id,))[0][0]
                    actions_in_db = query_db("SELECT count(*) FROM agent_run_actions WHERE session_id = ?", (test_session_id,))[0][0]
                    if sess_in_db == 0 and actions_in_db == 0:
                        record_result("Deletion Bridge", "DELETE /sessions/{id}", "PASS", "Session & all associated agent_run_actions fully purged from SQLite")
                    else:
                        record_result("Deletion Bridge", "DELETE /sessions/{id}", "FAIL", f"Orphan records remain in DB: sessions={sess_in_db}, actions={actions_in_db}")
                else:
                    record_result("Deletion Bridge", "DELETE /sessions/{id}", "FAIL", f"HTTP {res.status_code}")
            except Exception as e:
                record_result("Deletion Bridge", "DELETE /sessions/{id}", "ERROR", str(e))

            # 9.3 DELETE /api/projects/{project_id}
            if project_id:
                try:
                    res = await client.delete(f"/api/projects/{project_id}")
                    if res.status_code == 200:
                        proj_in_db = query_db("SELECT count(*) FROM projects WHERE id = ?", (project_id,))[0][0]
                        if proj_in_db == 0:
                            record_result("Projects", "DELETE /api/projects/{id}", "PASS", f"Project {project_id} deleted from DB")
                        else:
                            record_result("Projects", "DELETE /api/projects/{id}", "FAIL", "Project row still present in DB")
                    else:
                        record_result("Projects", "DELETE /api/projects/{id}", "FAIL", f"HTTP {res.status_code}")
                except Exception as e:
                    record_result("Projects", "DELETE /api/projects/{id}", "ERROR", str(e))

    # Clean up test files
    if uploaded_file_path and os.path.exists(uploaded_file_path):
        try:
            os.remove(uploaded_file_path)
        except:
            pass

    print("\n" + "=" * 80, flush=True)
    print("AUDIT SUMMARY:", flush=True)
    pass_cnt = sum(1 for r in results if r["status"] == "PASS")
    fail_cnt = sum(1 for r in results if r["status"] in ("FAIL", "ERROR"))
    warn_cnt = sum(1 for r in results if r["status"] == "WARN")
    print(f"TOTAL ENDPOINTS TESTED: {len(results)}", flush=True)
    print(f"PASSED: {pass_cnt} | FAILED: {fail_cnt} | WARNINGS: {warn_cnt}", flush=True)
    print("=" * 80, flush=True)

if __name__ == "__main__":
    asyncio.run(run_full_backend_audit())
