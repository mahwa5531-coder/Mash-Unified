"""
Test suite for session isolation, concurrency, race conditions, and new workspace/history features.
Uses httpx and ASGI Transport.
"""

import asyncio
import json
import time
import httpx
from pathlib import Path
import pytest
import sys

# Ensure roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

async def http_get(client: httpx.AsyncClient, endpoint: str) -> dict:
    resp = await client.get(endpoint)
    return resp.json()

async def http_post(client: httpx.AsyncClient, endpoint: str, data: dict) -> dict:
    resp = await client.post(endpoint, json=data)
    return resp.json()


async def run_list_projects_endpoint(client: httpx.AsyncClient):
    print("[1] Testing GET /api/projects...")
    res = await http_get(client, "/api/projects")
    assert "projects" in res, f"Expected 'projects' in response, got {res}"
    print(f"    Passed! Total projects in DB: {len(res['projects'])}")


async def run_quickstart_folder_endpoint(client: httpx.AsyncClient):
    print("[2] Testing POST /api/system/quickstart-folder...")
    res = await http_post(client, "/api/system/quickstart-folder", {})
    assert res.get("status") == "success"
    assert "Quickstart" in res.get("folder_name", "")
    assert res.get("folder_path")
    print(f"    Passed! Quickstart path: {res['folder_path']}")


async def run_folder_selection_validation(client: httpx.AsyncClient):
    print("[3] Testing POST /api/system/select-folder with path...")
    cwd = str(Path.cwd().resolve())
    res = await http_post(client, "/api/system/select-folder", {"folder_path": cwd})
    assert res.get("status") == "success"
    assert res.get("folder_path") == cwd
    print(f"    Passed! Validated folder: {res['folder_name']}")


async def run_concurrent_session_creation(client: httpx.AsyncClient):
    print("[4] Testing concurrent session creation (5 simultaneous requests)...")
    
    tasks = []
    created_ids = []
    
    for i in range(5):
        sid = f"test_race_{int(time.time()*1000)}_{i}"
        created_ids.append(sid)
        is_workspace = (i % 2 == 0)
        repo_name = "Mash" if is_workspace else "No Repo"
        section = "workspace" if is_workspace else "conversation"
        
        payload = {
            "session_id": sid,
            "title": f"Concurrent Test {i}",
            "workspace_uri": repo_name,
            "section": section,
        }
        tasks.append(http_post(client, "/sessions", payload))
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for idx, r in enumerate(results):
        assert not isinstance(r, Exception), f"Session creation task {idx} failed: {r}"
        assert r.get("status") in ("success", "created"), f"Unexpected result {r}"

    print(f"    Passed! 5 concurrent sessions successfully created with 0 exceptions.")

    # Verify isolation in database
    all_sessions = (await http_get(client, "/sessions")).get("sessions", [])
    sess_map = {s["session_id"]: s for s in all_sessions}

    for i in range(5):
        sid = created_ids[i]
        assert sid in sess_map, f"Session {sid} not found in /sessions list!"
        item = sess_map[sid]
        if i % 2 == 0:
            assert item["section"] == "workspace", f"Expected workspace, got {item['section']}"
            assert item["workspace_uri"] == "Mash", f"Expected Mash, got {item['workspace_uri']}"
        else:
            assert item["section"] == "conversation", f"Expected conversation, got {item['section']}"
            assert item["workspace_uri"] == "No Repo", f"Expected No Repo, got {item['workspace_uri']}"

    print("    Passed! Session isolation verified: workspace and standalone sessions never contaminated each other.")
    return created_ids


async def run_conversation_history_format(client: httpx.AsyncClient):
    print("[5] Testing Conversation History formatting and fields...")
    res = await http_get(client, "/sessions")
    sessions = res.get("sessions", [])
    assert len(sessions) > 0, "Expected non-empty sessions"

    for s in sessions[:10]:
        assert "session_id" in s
        assert "title" in s
        assert "workspace_uri" in s
        assert "section" in s
        assert s["section"] in ("workspace", "conversation"), f"Invalid section {s['section']}"
        # Ensure titles are non-empty and sanitized
        assert len(s["title"].strip()) > 0
        assert not s["title"].startswith("{")  # Ensure no raw JSON leaking into title

    print(f"    Passed! Verified {min(10, len(sessions))} session records conform to History formatting.")


async def cleanup_test_sessions(client: httpx.AsyncClient, session_ids: list[str]):
    print("[6] Cleaning up test sessions...")
    for sid in session_ids:
        try:
            await client.delete(f"/sessions/{sid}")
        except Exception:
            pass
    print("    Cleanup finished.")


@pytest.mark.anyio
async def test_session_isolation_and_concurrency():
    print("=" * 60)
    print("NEXAU WORKBENCH TEST: SESSION ISOLATION & CONCURRENCY")
    print("=" * 60)
    
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            await run_list_projects_endpoint(client)
            await run_quickstart_folder_endpoint(client)
            await run_folder_selection_validation(client)
            test_ids = await run_concurrent_session_creation(client)
            await run_conversation_history_format(client)
            await cleanup_test_sessions(client, test_ids)
    
    print("=" * 60)
    print("ALL TESTS PASSED WITH 100% SUCCESS!")
    print("=" * 60)
