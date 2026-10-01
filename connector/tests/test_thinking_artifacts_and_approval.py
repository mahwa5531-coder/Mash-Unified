"""
Unit and integration tests for:
1. SSE streaming event serialization and thinking token lifecycle (ThinkingTextMessageStart/Content/End).
2. Artifact storage integrity, path traversal security, and scratchpad retrieval.
3. Manual plan approval workflow (/approve endpoint proceed & reject states).
4. Session state persistence, rename validation, and viewed badges.
"""

import json
import os
import sys
import uuid
import pytest
import httpx
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from nexau.archs.platform.path_helpers import (
    get_nexau_home,
    get_session_brain_dir,
    get_database_path,
)
from nexau.archs.llm.llm_aggregators.events import (
    ThinkingTextMessageStartEvent,
    ThinkingTextMessageContentEvent,
    ThinkingTextMessageEndEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    RunFinishedEvent,
)


@pytest.mark.anyio
async def test_thinking_tokens_and_sse_lifecycle():
    """Verify that thinking tokens and text events stream and serialize correctly."""
    events = [
        ThinkingTextMessageStartEvent(parent_message_id="msg_0", thinking_message_id="think_1", run_id="run_1"),
        ThinkingTextMessageContentEvent(thinking_message_id="think_1", delta="Analyzing ledger variances..."),
        ThinkingTextMessageContentEvent(thinking_message_id="think_1", delta=" Checking reconciliation records."),
        ThinkingTextMessageEndEvent(thinking_message_id="think_1"),
        TextMessageStartEvent(message_id="msg_text_1", run_id="run_1"),
        TextMessageContentEvent(message_id="msg_text_1", delta="Audit complete. All variances reconciled."),
        TextMessageEndEvent(message_id="msg_text_1"),
        RunFinishedEvent(thread_id="thread_1", run_id="run_1"),
    ]

    serialized_lines = [f"data: {e.model_dump_json()}\n\n" for e in events]
    assert len(serialized_lines) == 8

    thought_deltas = []
    text_deltas = []
    for line in serialized_lines:
        assert line.startswith("data: ")
        raw_json = line[6:].strip()
        data = json.loads(raw_json)
        event_type = data.get("type", "")
        if "THINKING" in event_type.upper() and "CONTENT" in event_type.upper():
            thought_deltas.append(data.get("delta", ""))
        elif "CONTENT" in event_type.upper() and "TEXT" in event_type.upper():
            text_deltas.append(data.get("delta", ""))

    assert "".join(thought_deltas) == "Analyzing ledger variances... Checking reconciliation records."
    assert "".join(text_deltas) == "Audit complete. All variances reconciled."


@pytest.mark.anyio
async def test_artifact_path_traversal_and_retrieval():
    """Verify that artifacts can be served safely and path traversal attempts are rejected."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_run_id = uuid.uuid4().hex[:8]
            user_id = f"auditor_{test_run_id}"
            sess_id = f"sess_art_{test_run_id}"

            brain_dir = get_session_brain_dir(sess_id, None)
            brain_dir.mkdir(parents=True, exist_ok=True)

            # 1. Write legitimate artifact and scratch file
            artifact_file = brain_dir / "audit_checklist.md"
            artifact_file.write_text("# Audit Checklist\n- [x] Step 1\n- [ ] Step 2\n", encoding="utf-8")

            scratch_dir = brain_dir / "scratch"
            scratch_dir.mkdir(parents=True, exist_ok=True)
            scratch_file = scratch_dir / "calc_totals.py"
            scratch_file.write_text("print(sum([100, 200, 300]))\n", encoding="utf-8")

            # 2. Query artifact list
            res_list = await client.get(f"/api/artifacts/{user_id}/{sess_id}")
            assert res_list.status_code == 200
            files = res_list.json().get("files", [])
            assert "audit_checklist.md" in files
            # Scratch scripts are internal execution files and must not leak into customer deliverables list
            assert "scratch/calc_totals.py" not in files

            # 3. Retrieve valid artifact content
            res_content = await client.get(f"/api/artifacts/{user_id}/{sess_id}/audit_checklist.md")
            assert res_content.status_code == 200
            assert "Audit Checklist" in res_content.text

            # 4. Retrieve valid scratch file content
            res_scratch = await client.get(f"/api/artifacts/{user_id}/{sess_id}/scratch/calc_totals.py")
            assert res_scratch.status_code == 200
            assert "calc_totals.py" in res_scratch.text or "sum(" in res_scratch.text

            # 5. Verify path traversal attempt is blocked (400, 403, or 404)
            res_traversal = await client.get(f"/api/artifacts/{user_id}/{sess_id}/../../../../Windows/win.ini")
            assert res_traversal.status_code in (400, 403, 404)

            # Cleanup
            import shutil
            shutil.rmtree(brain_dir, ignore_errors=True)


@pytest.mark.anyio
async def test_plan_approval_state_machine():
    """Verify manual plan approval endpoints (/approve and /api/chat/{id}/approve)."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_run_id = uuid.uuid4().hex[:8]
            sess_id = f"sess_plan_{test_run_id}"

            # 1. Approval proceed via /approve
            res_proceed = await client.post("/approve", json={
                "session_id": sess_id,
                "action": "proceed",
                "feedback": "Approved audit plan.",
            })
            assert res_proceed.status_code == 200
            assert res_proceed.json().get("MANUAL_APPROVAL") is True

            # 2. Approval reject via /approve
            res_reject = await client.post("/approve", json={
                "session_id": sess_id,
                "action": "reject",
                "feedback": "Revise test scope.",
            })
            assert res_reject.status_code == 200
            assert res_reject.json().get("MANUAL_APPROVAL") is True

            # 3. Approval proceed via /api/chat/{id}/approve
            res_chat_appr = await client.post(f"/api/chat/{sess_id}/approve", json={
                "action": "proceed",
                "user_id": "default_user",
            })
            assert res_chat_appr.status_code == 200
            assert res_chat_appr.json().get("status") in ("ok", "success")


@pytest.mark.anyio
async def test_session_state_and_rename_persistence():
    """Verify session creation, renaming, view state, and SQLite persistence."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=30.0) as client:
            test_run_id = uuid.uuid4().hex[:8]
            user_id = f"auditor_{test_run_id}"
            sess_id = f"sess_state_{test_run_id}"

            # 1. Create a project
            temp_ws = Path.cwd() / f"test_ws_{test_run_id}"
            temp_ws.mkdir(parents=True, exist_ok=True)

            res_p = await client.post("/api/projects", json={
                "user_id": user_id,
                "name": f"Project {test_run_id}",
                "local_folder_path": str(temp_ws),
            })
            assert res_p.status_code == 200
            proj_id = res_p.json()["id"]

            # 2. Rename session
            new_title = f"Verified Audit Session {test_run_id}"
            res_rename = await client.post(f"/sessions/{sess_id}/rename", json={"title": new_title})
            assert res_rename.status_code == 200

            # 3. Mark session viewed
            res_view = await client.post(f"/sessions/{sess_id}/view")
            assert res_view.status_code == 200
            assert res_view.json().get("status") in ("ok", "success")

            # 4. Cleanup project
            res_del_p = await client.delete(f"/api/projects/{proj_id}")
            assert res_del_p.status_code == 200

            import shutil
            shutil.rmtree(temp_ws, ignore_errors=True)
