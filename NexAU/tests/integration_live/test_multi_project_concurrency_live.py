import os
import sys
import json
import asyncio
from pathlib import Path
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from nexau_ui_backend.main import app, lifespan

@pytest.mark.anyio
async def test_concurrent_multi_project_workflow_live():
    """Verify concurrent multi-project and multi-session execution without collisions."""
    user_id = "multiproject_lead_user"
    base_dir = Path(__file__).parent.parent / "test_scratch_project"
    project_a_dir = str(base_dir / "project_alpha")
    project_b_dir = str(base_dir / "project_beta")
    os.makedirs(project_a_dir, exist_ok=True)
    os.makedirs(project_b_dir, exist_ok=True)

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=90.0) as client:
            
            # 1. Create 2 Independent Projects
            res_a = await client.post("/api/projects", json={"user_id": user_id, "name": "Alpha Client Audit", "local_folder_path": project_a_dir})
            proj_a_id = res_a.json().get("id")
            
            res_b = await client.post("/api/projects", json={"user_id": user_id, "name": "Beta Tax Analytics", "local_folder_path": project_b_dir})
            proj_b_id = res_b.json().get("id")

            # 2. Create Sessions
            sess_a_id = f"sess_alpha_{int(asyncio.get_event_loop().time() * 1000)}"
            sess_b_id = f"sess_beta_{int(asyncio.get_event_loop().time() * 1000)}"

            await client.post("/api/sessions", json={"user_id": user_id, "project_id": proj_a_id, "title": "Alpha Revenue Audit"})
            await client.post("/api/sessions", json={"user_id": user_id, "project_id": proj_b_id, "title": "Beta Expense Reconciliation"})

            # 3. Dispatch Simultaneous Agent Tasks
            async def run_session_stream(session_id: str, prompt: str, proj_id: str, workspace_uri: str):
                events = []
                async with client.stream("POST", "/stream", json={
                    "session_id": session_id,
                    "messages": prompt,
                    "context": {"title": f"Task for {session_id}", "project_id": proj_id, "workspace_uri": workspace_uri, "active_file": "report.py"}
                }) as resp:
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            try:
                                events.append(json.loads(line[5:].strip()))
                            except:
                                pass
                return events

            prompt_a = "Compute 1500 * 4 and return the single line result."
            prompt_b = "Compute 2500 * 3 and return the single line result."

            task_a = run_session_stream(sess_a_id, prompt_a, proj_a_id, project_a_dir)
            task_b = run_session_stream(sess_b_id, prompt_b, proj_b_id, project_b_dir)

            results = await asyncio.gather(task_a, task_b)
            assert len(results[0]) > 0 and len(results[1]) > 0

            # 4. View Tracking & Assertions
            await client.post(f"/sessions/{sess_a_id}/view")
            await client.post(f"/sessions/{sess_b_id}/view")

            all_sessions = (await client.get("/sessions")).json().get("sessions", [])
            s_alpha = next((s for s in all_sessions if s["session_id"] == sess_a_id), None)
            s_beta = next((s for s in all_sessions if s["session_id"] == sess_b_id), None)

            assert s_alpha is not None and s_beta is not None
            assert s_alpha["workspace_uri"] != s_beta["workspace_uri"]

            # 5. Cleanup
            await client.delete(f"/sessions/{sess_a_id}")
            await client.delete(f"/sessions/{sess_b_id}")
            await client.delete(f"/api/projects/{proj_a_id}")
            await client.delete(f"/api/projects/{proj_b_id}")

if __name__ == "__main__":
    asyncio.run(test_concurrent_multi_project_workflow_live())
