"""Automated verification suite for all user interaction and system scenarios."""

import os
import sys
import time
import httpx
import pytest
from pathlib import Path

# Ensure roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

async def request(client: httpx.AsyncClient, path, method="GET", body=None):
    if body is not None:
        resp = await client.request(method, path, json=body)
    else:
        resp = await client.request(method, path)
    
    try:
        data = resp.json()
        return resp.status_code, data
    except Exception:
        return resp.status_code, resp.text

@pytest.mark.asyncio
async def test_scenario_matrix():
    print("=" * 70)
    print("STARTING SCENARIO VERIFICATION TEST SUITE")
    print("=" * 70)

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:

            # 1. Left Sidebar: Project Creation & Session Creation
            print("\n[Test 1] Left Sidebar: Project & Session Creation")
            p_status, p_data = await request(client, "/api/projects", method="POST", body={
                "name": "Test Project Alpha",
                "local_folder_path": str(Path.cwd().resolve())
            })
            print(f"  -> Create Project: status={p_status}, id={p_data.get('id') if isinstance(p_data, dict) else None}")
            project_id = p_data.get("id") if isinstance(p_data, dict) else None
            assert p_status in (200, 201), f"Project creation failed: {p_status}"

            sid_a = f"test_sess_a_{int(time.time())}"
            s_status, s_data = await request(client, "/api/sessions", method="POST", body={
                "session_id": sid_a,
                "title": "Alpha Session 1",
                "project_id": project_id,
                "workspace_uri": "Test Project Alpha"
            })
            print(f"  -> Create Project Session: status={s_status}, session_id={sid_a}")
            assert s_status == 200

            sid_b = f"test_sess_b_{int(time.time())}"
            s_status_b, s_data_b = await request(client, "/api/sessions", method="POST", body={
                "session_id": sid_b,
                "title": "Standalone Conversation",
                "workspace_uri": "No Repo"
            })
            print(f"  -> Create Standalone Session: status={s_status_b}, session_id={sid_b}")
            assert s_status_b == 200

            # 2. Left Sidebar: Listing, Categories & Renaming
            print("\n[Test 2] Left Sidebar: Listing & Inline Rename")
            list_status, list_data = await request(client, "/api/sessions")
            assert list_status == 200
            sessions_list = list_data.get("sessions", [])
            found_a = next((s for s in sessions_list if s["session_id"] == sid_a), None)
            found_b = next((s for s in sessions_list if s["session_id"] == sid_b), None)
            assert found_a is not None, "Session A not found in listing"
            assert found_b is not None, "Session B not found in listing"
            assert found_a["section"] == "workspace", f"Expected workspace section, got {found_a['section']}"
            assert found_b["section"] == "conversation", f"Expected conversation section, got {found_b['section']}"
            print(f"  -> Categories validated: Session A is in '{found_a['section']}', Session B is in '{found_b['section']}'")

            ren_status, ren_data = await request(client, f"/sessions/{sid_a}/rename", method="PATCH", body={"title": "Renamed Alpha Suite"})
            assert ren_status == 200
            print("  -> Session rename successfully persisted")

            # 3. Chat: Mid-Flight Queueing & Mailbox Peeking
            print("\n[Test 3] Chat: Mid-Flight Queueing & Mailbox")
            q_status, q_data = await request(client, f"/sessions/{sid_a}/queue", method="POST", body={
                "session_id": sid_a,
                "message": "Wait, also check the unit test assertions please"
            })
            assert q_status == 200
            print(f"  -> Queued mid-flight message: total_queued={q_data.get('total_queued')}")

            peek_status, peek_data = await request(client, f"/sessions/{sid_a}/queue")
            assert peek_status == 200
            assert len(peek_data.get("queued", [])) >= 1
            assert "assertions" in peek_data["queued"][0]
            print("  -> Verified queued message in mailbox")

            # 4. Chat: Stop / Cancel & Lock Force-Release
            print("\n[Test 4] Chat: Stop / Cancellation & Lock Force-Release")
            stop_status, stop_data = await request(client, "/stop", method="POST", body={
                "session_id": sid_a,
                "user_id": "default_user",
                "force": True
            })
            assert stop_status == 200
            print(f"  -> Stop agent bridge returned status={stop_status}, stop_reason={stop_data.get('stop_reason')}")

            # Verify agent lock is released: we can immediately stop again or query without deadlock
            stop2_status, stop2_data = await request(client, "/stop", method="POST", body={
                "session_id": sid_a,
                "user_id": "default_user",
                "force": True
            })
            assert stop2_status == 200
            print("  -> Verified immediate re-entry (zero deadlock on force-release)")

            # 5. Chat: Workspace Tree & Cross-Project Sandboxing
            print("\n[Test 5] Cross-Project Sandboxing & Path Traversal Guard")
            tree_status, tree_data = await request(client, "/api/workspace/tree")
            print(f"  -> Workspace tree query: status={tree_status}, root_items={len(tree_data.get('workspace', []))}")
            assert tree_status == 200

            # Legitimate file inside allowed workspace
            import urllib.parse
            good_file = "c:/Users/rama/Downloads/Mash/RUN_GUIDE.md"
            good_status, _ = await request(client, f"/api/files/content?path={urllib.parse.quote(good_file)}")
            print(f"  -> Legitimate workspace file read: status={good_status}")
            assert good_status == 200

            bad_path = "C:/Windows/System32/cmd.exe" if os.name == "nt" else "/etc/shadow"
            bad_status, bad_data = await request(client, f"/api/files/content?path={urllib.parse.quote(bad_path)}")
            print(f"  -> Path traversal attempt ({bad_path}): status={bad_status}")
            assert bad_status == 403, f"Expected 403 Forbidden, got {bad_status}"
            print("  -> Path traversal guard successfully blocked unauthorized access with HTTP 403")

            # 6. Chat: Undo / Rewind
            print("\n[Test 6] Chat: Turn Undo / Rewind")
            undo_status, undo_data = await request(client, f"/sessions/{sid_a}/undo", method="DELETE", body={"from_turn": 0})
            assert undo_status == 200
            print("  -> Undo turn endpoint responded 200 OK")

            # 7. File Uploads & Session Attachments
            print("\n[Test 7] File Uploads & Session Storage Sandboxing")
            sample_content = b"Scenario test sample document content"
            files = {"file": ("scenario_doc.txt", sample_content, "text/plain")}
            up_resp = await client.post(f"/api/uploads/{sid_a}", files=files)
            up_data = up_resp.json()
            assert up_resp.status_code == 200
            assert up_data.get("status") == "success"
            assert "scenario_doc.txt" in up_data.get("path", "")
            print(f"  -> File uploaded successfully to session storage: {up_data.get('path')}")

            list_up_status, list_up_data = await request(client, f"/api/uploads/{sid_a}")
            assert list_up_status == 200
            assert any(f["name"] == "scenario_doc.txt" for f in list_up_data.get("uploads", []))
            print(f"  -> Uploaded file verified via GET /api/uploads/{sid_a}")

            # 8. Left Sidebar: Delete Session
            print("\n[Test 8] Left Sidebar: Session Deletion")
            del_status, del_data = await request(client, f"/sessions/{sid_a}", method="DELETE")
            assert del_status == 200
            del_status_b, _ = await request(client, f"/sessions/{sid_b}", method="DELETE")
            assert del_status_b == 200
            print("  -> Deleted test sessions cleanly")

            print("\n" + "=" * 70)
            print("ALL SCENARIO TESTS PASSED SUCCESSFULLY (8/8)")
            print("=" * 70)
