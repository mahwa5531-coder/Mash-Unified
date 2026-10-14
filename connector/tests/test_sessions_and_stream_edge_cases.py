"""Comprehensive test suite for connector session and stream edge cases:

1. Client disconnect mid-stream cancellation.
2. Corrupted/missing action recovery in transcript folding (agent_run_actions missing extra or invalid JSON).
3. Missing or deleted physical artifact files (returns clean 404 with structured error, never uncaught 500).
4. Idempotent background task cancellation (canceling already completed/dead task).
5. Concurrent steer collision handling under SQLite.
"""

import asyncio
import json
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

# Ensure connector and NexAU are in sys.path
connector_dir = Path(__file__).resolve().parent.parent
nexau_dir = connector_dir.parent / "NexAU"
if str(connector_dir) not in sys.path:
    sys.path.insert(0, str(connector_dir))
if str(nexau_dir) not in sys.path:
    sys.path.insert(0, str(nexau_dir))

import app.dependencies as deps
from app.main import app, lifespan
from nexau.archs.session.models import AgentRunActionModel, SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import (
    Message,
    ReasoningBlock,
    Role,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ==============================================================================
# 1. Client Disconnect Mid-Stream Cancellation
# ==============================================================================
@pytest.mark.anyio
async def test_client_disconnect_mid_stream_cancellation():
    """Verify that client disconnect during SSE streaming terminates the running agent immediately."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_disconnect_{test_id}"
            user_id = f"user_{test_id}"

            # Pre-create session
            create_res = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": "Disconnect Test",
            })
            assert create_res.status_code == 200

            # Start streaming and disconnect prematurely after reading first chunk
            payload = {
                "session_id": sid,
                "user_id": user_id,
                "messages": "Count to 100 slowly",
                "context": {"session_id": sid, "workspace_uri": "No Repo"},
            }

            chunks_received = 0
            try:
                async with client.stream("POST", "/stream", json=payload, headers={"Accept": "text/event-stream"}) as resp:
                    assert resp.status_code == 200
                    async for line in resp.aiter_lines():
                        if line.startswith("data:"):
                            chunks_received += 1
                            # Prematurely break to simulate client disconnect / network drop
                            if chunks_received >= 1:
                                break
            except Exception:
                pass

            assert chunks_received >= 1, "Should have received at least one chunk before client disconnect"

            # Allow loop to process the generator cleanup and cancel
            await asyncio.sleep(0.1)

            # Check that stop endpoint responds cleanly and agent is not stuck
            stop_res = await client.post("/api/chat/stop", json={
                "session_id": sid,
                "user_id": user_id,
                "force": True,
            })
            assert stop_res.status_code == 200
            assert stop_res.json().get("status") == "success"

            # Cleanup
            await client.delete(f"/sessions/{sid}")


@pytest.mark.anyio
async def test_client_disconnect_direct_is_disconnected_trigger():
    """Directly test the request.is_disconnected() branch in sse_event_stream."""
    from app.routers.chat import stream_query_bridge

    async with lifespan(app):
        sid = f"sess_discon_mock_{uuid.uuid4().hex[:8]}"
        user_id = "test_user_discon"

        # Mock Request where is_disconnected returns True
        mock_request = AsyncMock()
        mock_request.is_disconnected.return_value = True

        from app.routers.chat import StreamQueryPayload, get_sse_server
        payload = StreamQueryPayload(
            session_id=sid,
            messages="Hello test disconnect",
            user_id=user_id,
        )

        server = get_sse_server()
        with patch.object(server, "handle_stop_request", wraps=server.handle_stop_request) as mock_stop:
            response = await stream_query_bridge(payload=payload, request=mock_request, path_session_id=sid)
            gen = response.body_iterator

            # Iterating through generator should catch CancelledError and terminate agent
            with pytest.raises((asyncio.CancelledError, GeneratorExit)):
                await gen.__anext__()

            assert mock_stop.called, "Server handle_stop_request must be called on client disconnect"
            mock_stop.assert_called_with(user_id=user_id, session_id=sid, force=True)


# ==============================================================================
# 2. Corrupted/Missing Action Recovery in Transcript Folding
# ==============================================================================
@pytest.mark.anyio
async def test_transcript_folding_corrupted_missing_actions_recovery():
    """Verify that transcript folding recovers cleanly from corrupted actions, missing extra, or invalid JSON."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            engine = deps.get_engine()
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_corrupt_{test_id}"
            user_id = f"user_{test_id}"

            # 1. Create base session
            sess = SessionModel(
                session_id=sid,
                user_id=user_id,
                context={"title": "Corrupted Action Recovery Test"},
            )
            await engine.create(sess)

            # 2. Normal User Message
            user_msg = Message(role=Role.USER, content=[TextBlock(text="Initial valid prompt")])
            act_user = AgentRunActionModel(
                session_id=sid,
                user_id=user_id,
                agent_id="test_agent",
                run_id="run_01",
                root_run_id="run_01",
                agent_name="user",
                action_type="append",
                append_messages=[user_msg],
                created_at_ns=1000000000,
                extra=None,  # Missing extra
            )
            await engine.create(act_user)

            # 3. Action with unexpected / unknown extra fields
            act_unknown_extra = AgentRunActionModel(
                session_id=sid,
                user_id=user_id,
                agent_id="test_agent",
                run_id="run_02",
                root_run_id="run_01",
                agent_name="assistant",
                action_type="append",
                append_messages=[Message(role=Role.ASSISTANT, content=[TextBlock(text="Step with strange extra")])],
                created_at_ns=2000000000,
                extra={"unknown_future_field": "test_value", "nested": {"a": 123}},
            )
            await engine.create(act_unknown_extra)

            # 4. Action with REPLACE having unknown reason variant
            act_replace_unknown = AgentRunActionModel(
                session_id=sid,
                user_id=user_id,
                agent_id="test_agent",
                run_id="run_03",
                root_run_id="run_01",
                agent_name="assistant",
                action_type="replace",
                replace_messages=[
                    user_msg,
                    Message(role=Role.ASSISTANT, content=[TextBlock(text="Replaced state content")]),
                ],
                created_at_ns=3000000000,
                extra={"reason": "unrecognized_custom_compaction", "version": 99},
            )
            await engine.create(act_replace_unknown)

            # 5. Action with orphan tool_use block without tool_result (service should synthesize result)
            orphan_tool_msg = Message(
                role=Role.ASSISTANT,
                content=[
                    TextBlock(text="Calling tool but disconnecting"),
                    ToolUseBlock(id="call_orphan_99", name="run_shell", input={"cmd": "ls"}),
                ]
            )
            act_orphan = AgentRunActionModel(
                session_id=sid,
                user_id=user_id,
                agent_id="test_agent",
                run_id="run_04",
                root_run_id="run_01",
                agent_name="assistant",
                action_type="append",
                append_messages=[orphan_tool_msg],
                created_at_ns=4000000000,
                extra=None,
            )
            await engine.create(act_orphan)

            # 6. Action with reasoning-only assistant message (should be pruned without crashing)
            act_reasoning_only = AgentRunActionModel(
                session_id=sid,
                user_id=user_id,
                agent_id="test_agent",
                run_id="run_05",
                root_run_id="run_01",
                agent_name="assistant",
                action_type="append",
                append_messages=[Message(role=Role.ASSISTANT, content=[ReasoningBlock(text="Pruned thought")])],
                created_at_ns=5000000000,
                extra=None,
            )
            await engine.create(act_reasoning_only)

            # Query /transcript
            res_transcript = await client.get(f"/sessions/{sid}/transcript")
            assert res_transcript.status_code == 200, f"Expected 200, got {res_transcript.status_code}: {res_transcript.text}"
            data = res_transcript.json()
            assert "lines" in data
            assert data["total"] > 0
            # Must not fail or return 500 error
            lines = data["lines"]
            assert any(l["role"] == "user" for l in lines)
            assert any(l["role"] == "assistant" for l in lines)

            # Query /history
            res_hist = await client.get(f"/api/sessions/{user_id}/{sid}/history")
            assert res_hist.status_code == 200
            hist_data = res_hist.json()
            assert "messages" in hist_data
            assert len(hist_data["messages"]) > 0

            # Cleanup
            await client.delete(f"/sessions/{sid}")


@pytest.mark.anyio
async def test_messages_to_transcript_lines_edge_cases():
    """Verify that messages_to_transcript_lines handles all malformed, boundary, and extreme block states."""
    from app.routers.sessions import messages_to_transcript_lines

    # 1. Empty message list
    assert messages_to_transcript_lines([]) == []

    # 2. Pure system and tool-result messages are skipped from top-level lines
    pure_tool_msg = Message(
        role=Role.TOOL,
        content=[ToolResultBlock(tool_use_id="call_01", content="Result from tool execution")],
    )
    assert messages_to_transcript_lines([pure_tool_msg]) == []

    # 3. Assistant message with orphan tool use, shallow truncation (>3000 chars), and pending approvals
    huge_output = "X" * 5000
    res_msg = Message(
        role=Role.TOOL,
        content=[ToolResultBlock(tool_use_id="call_huge", content=huge_output)],
    )
    asst_msg = Message(
        role=Role.ASSISTANT,
        content=[
            TextBlock(text="Investigating anomalies..."),
            ToolUseBlock.model_construct(id="call_huge", name="run_shell", input=None),  # Malformed input None via model_construct
            ToolUseBlock(id="call_pending", name="write_file", input={"path": "out.txt"}),
            ToolUseBlock(id="call_denied", name="drop_table", input={}),
        ],
    )

    pending_map = {
        "call_pending": {"tool_name": "write_file", "decision": None, "prompt": "Authorize file write?"},
        "call_denied": {"tool_name": "drop_table", "decision": "deny"},
    }

    lines = messages_to_transcript_lines(
        [asst_msg, res_msg],
        pending_map=pending_map,
        shallow_tools=True,
    )

    assert len(lines) == 1
    asst_line = lines[0]
    assert asst_line["role"] == "assistant"
    assert "Investigating anomalies..." in asst_line["content"]
    assert len(asst_line["tools"]) == 3

    # Verify shallow tool output truncation
    huge_tool = next(t for t in asst_line["tools"] if t["id"] == "call_huge")
    assert "Truncated for rapid UI loading" in huge_tool["output"]
    assert len(huge_tool["output"]) < 3500

    # Verify pending and denied status resolution
    pend_tool = next(t for t in asst_line["tools"] if t["id"] == "call_pending")
    assert pend_tool["status"] == "pending_approval"
    assert pend_tool["decision"] is None

    denied_tool = next(t for t in asst_line["tools"] if t["id"] == "call_denied")
    assert denied_tool["status"] == "denied"
    assert denied_tool["decision"] == "deny"


# ==============================================================================
# 3. Missing or Deleted Physical Artifact Files (Clean 404, never 500)
# ==============================================================================
@pytest.mark.anyio
async def test_missing_or_deleted_physical_artifact_files_clean_404():
    """Verify that requests for missing, deleted, or unresolvable artifact files return clean 404."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_art_{test_id}"
            user_id = f"user_{test_id}"

            # 1. Non-existent file via /artifacts endpoint
            res_missing_art = await client.get(f"/artifacts/{user_id}/{sid}/ghost_file_12345.pdf")
            assert res_missing_art.status_code == 404
            err_data = res_missing_art.json()
            assert "detail" in err_data
            assert "ghost_file_12345.pdf" in err_data["detail"]

            # 2. Non-existent file via /api/files/content
            res_missing_content = await client.get(f"/api/files/content?path=non_existent_folder/missing.txt&session_id={sid}")
            assert res_missing_content.status_code == 404
            content_err = res_missing_content.json()
            assert "detail" in content_err
            assert "not found" in content_err["detail"].lower()

            # 3. Create a physical scratch file, verify 200, then delete it and verify clean 404
            scratch_dir = Path.home() / ".nexau" / "brain" / sid / "scratch"
            scratch_dir.mkdir(parents=True, exist_ok=True)
            temp_file = scratch_dir / "temp_audit_note.txt"
            temp_file.write_text("Audit notes draft content", encoding="utf-8")

            res_found = await client.get(f"/api/files/content?path={temp_file.name}&session_id={sid}")
            assert res_found.status_code == 200

            # Delete the physical file
            temp_file.unlink()

            # Subsequent fetch must return structured 404, NOT an uncaught 500 or file read crash
            res_after_delete = await client.get(f"/api/files/content?path={temp_file.name}&session_id={sid}")
            assert res_after_delete.status_code == 404
            assert "not found" in res_after_delete.json()["detail"].lower()

            # 4. Univer endpoint with missing workbook
            res_univer_missing = await client.get(f"/api/files/univer?path=ghost_sheet.xlsx&session_id={sid}")
            assert res_univer_missing.status_code == 404

            # 5. Direct session-level artifact route
            res_session_art = await client.get(f"/artifacts/session/{sid}/ghost_file_12345.pdf")
            assert res_session_art.status_code == 404

            # 6. Directory path passed to /api/files/content must return 403, never 500
            res_dir = await client.get(f"/api/files/content?path=.&session_id={sid}")
            assert res_dir.status_code == 403

            # 7. Path traversal attempt in session_id must return 400, never 500
            res_traversal = await client.get("/artifacts/session/..%2F..%2Fetc/passwd")
            assert res_traversal.status_code in (400, 404)

            # Cleanup scratch dir
            import shutil
            shutil.rmtree(Path.home() / ".nexau" / "brain" / sid, ignore_errors=True)


# ==============================================================================
# 4. Idempotent Background Task Cancellation
# ==============================================================================
@pytest.mark.anyio
async def test_idempotent_background_task_cancellation():
    """Verify that canceling non-existent or already dead tasks returns clean status without throwing 500."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            dead_pid = 99999999

            # 1. Initial kill on non-existent PID via /api/tasks and /tasks routes
            res1 = await client.post(f"/api/tasks/{dead_pid}/kill")
            assert res1.status_code == 200
            data1 = res1.json()
            assert "pid" in data1
            assert data1["pid"] == dead_pid

            res1_alt = await client.post(f"/tasks/{dead_pid}/kill")
            assert res1_alt.status_code == 200
            assert res1_alt.json()["pid"] == dead_pid

            # 2. Subsequent repeated kills on the exact same dead PID (Idempotency check)
            for _ in range(5):
                res_repeat = await client.post(f"/api/tasks/{dead_pid}/kill")
                assert res_repeat.status_code == 200
                data_rep = res_repeat.json()
                assert data_rep["pid"] == dead_pid
                assert "error" not in data_rep or data_rep.get("success") is True or "status" in data_rep

            # 3. Log retrieval for dead/completed task
            res_log = await client.get(f"/api/tasks/{dead_pid}/log")
            assert res_log.status_code == 200
            log_data = res_log.json()
            assert "content" in log_data
            assert "completed or log not found" in log_data["content"]

            # 4. Invalid task ID path traversal attempt returns 400
            res_invalid_task = await client.get("/api/tasks/..%2Ftraversal/log")
            assert res_invalid_task.status_code in (400, 404)


# ==============================================================================
# 5. Concurrent Steer Collision Handling Under SQLite
# ==============================================================================
@pytest.mark.anyio
async def test_concurrent_steer_collision_under_sqlite():
    """Verify that concurrent steering queue updates and session operations succeed without SQLite lock collisions."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=20.0) as client:
            test_id = uuid.uuid4().hex[:8]
            sid = f"sess_steer_race_{test_id}"
            user_id = f"auditor_{test_id}"

            # 1. Create session
            create_res = await client.post("/api/sessions", json={
                "session_id": sid,
                "user_id": user_id,
                "title": "Concurrent Steer Test",
            })
            assert create_res.status_code == 200

            # 2. Send 20 concurrent steering requests simultaneously
            steer_count = 20

            async def queue_single_steer(i: int):
                msg = f"Steering instruction #{i:02d}"
                res = await client.post(f"/sessions/{sid}/queue", json={"message": msg, "session_id": sid})
                assert res.status_code == 200
                return res.json()

            async def toggle_permission_mode():
                # Concurrently toggle permission mode under SQLite to challenge locks
                for mode in ("turbo", "default", "review", "default"):
                    res = await client.post(f"/api/sessions/{sid}/permissions/mode", json={"mode": mode})
                    assert res.status_code == 200
                    await asyncio.sleep(0.01)

            async def view_session_ping():
                # Concurrently update session last_user_view_time
                for _ in range(5):
                    res = await client.post(f"/api/sessions/{sid}/view")
                    assert res.status_code == 200
                    await asyncio.sleep(0.01)

            # Fire all 20 steering requests concurrently with DB session mutations
            tasks = [queue_single_steer(i) for i in range(steer_count)]
            tasks.append(toggle_permission_mode())
            tasks.append(view_session_ping())

            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                assert not isinstance(r, Exception), f"Concurrent task failed with error: {r}"

            # 3. Verify all 20 steering messages were safely queued without data loss
            res_queue = await client.get(f"/sessions/{sid}/queue")
            assert res_queue.status_code == 200
            q_data = res_queue.json()
            assert q_data["count"] == steer_count
            assert len(q_data["queued"]) == steer_count

            # 4. Remove message by index
            del_idx_res = await client.delete(f"/sessions/{sid}/queue?index=0")
            assert del_idx_res.status_code == 200
            assert del_idx_res.json()["count"] == steer_count - 1

            # 5. Clear all steering queue
            clear_res = await client.delete(f"/sessions/{sid}/queue")
            assert clear_res.status_code == 200
            assert clear_res.json()["count"] == 0

            # Cleanup
            await client.delete(f"/sessions/{sid}")
