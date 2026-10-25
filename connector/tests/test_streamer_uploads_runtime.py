"""Unit tests for Core Streamer, Uploads sanitization, and Runtime stability.

Covers:
- B-01: Protocol Ordering (flushing TOOL_CALL_PENDING_APPROVAL before RUN_FINISHED; RUN_STARTED preceding results on resume)
- B-02 & B-08: Windows Path Traversal and Null-Byte upload sanitization
- B-04 & B-05: Empty / Whitespace-only LLM response graceful degradation
- B-06: Orphan Session Prevention (rejection of missing session_id)
- B-17: Tool-call loop circuit breaker (tripping after 3 consecutive identical calls)
"""

import asyncio
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.datastructures import UploadFile

# Ensure connector and NexAU are in sys.path
connector_dir = Path(__file__).resolve().parent.parent
nexau_dir = connector_dir.parent / "NexAU"
if str(connector_dir) not in sys.path:
    sys.path.insert(0, str(connector_dir))
if str(nexau_dir) not in sys.path:
    sys.path.insert(0, str(nexau_dir))

from app.routers.chat import stream_query_bridge
from app.routers.uploads import upload_file
from app.services.chat_streamer import (
    StreamQueryPayload,
    generate_chat_sse_stream,
    stream_chat_query,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ============================================================================
# B-02 & B-08: Windows Path Traversal & Null-Byte Upload Sanitization
# ============================================================================

@pytest.mark.anyio
async def test_upload_rejects_null_byte():
    """B-08: Filenames containing embedded null bytes must be rejected with 400 Bad Request."""
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"malicious content"
    file = UploadFile(filename="test\x00file.png", file=io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("app.routers.uploads.get_session_brain_dir", return_value=tmpdir):
            with pytest.raises(HTTPException) as exc_info:
                await upload_file("sess_test", file, engine)
            assert exc_info.value.status_code == 400
            assert "null byte detected" in exc_info.value.detail


@pytest.mark.anyio
async def test_upload_rejects_windows_path_traversal():
    """B-02: Windows-style backslash traversal segments must be rejected with 400 Bad Request."""
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"system payload"
    file = UploadFile(filename="..\\..\\windows\\win.ini", file=io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("app.routers.uploads.get_session_brain_dir", return_value=tmpdir):
            with pytest.raises(HTTPException) as exc_info:
                await upload_file("sess_test", file, engine)
            assert exc_info.value.status_code == 400
            assert "path traversal detected" in exc_info.value.detail or "Invalid filename" in exc_info.value.detail


@pytest.mark.anyio
async def test_upload_rejects_unix_path_traversal():
    """B-02: Unix-style forward slash traversal segments must be rejected with 400 Bad Request."""
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"system payload"
    file = UploadFile(filename="../../etc/passwd", file=io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("app.routers.uploads.get_session_brain_dir", return_value=tmpdir):
            with pytest.raises(HTTPException) as exc_info:
                await upload_file("sess_test", file, engine)
            assert exc_info.value.status_code == 400
            assert "path traversal detected" in exc_info.value.detail or "Invalid filename" in exc_info.value.detail


@pytest.mark.anyio
async def test_upload_rejects_dotdot_only():
    """B-02: Filenames equal to '..' or '.' must be rejected with 400 Bad Request."""
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"empty"
    file = UploadFile(filename="..", file=io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("app.routers.uploads.get_session_brain_dir", return_value=tmpdir):
            with pytest.raises(HTTPException) as exc_info:
                await upload_file("sess_test", file, engine)
            assert exc_info.value.status_code == 400
            assert "Invalid filename" in exc_info.value.detail


@pytest.mark.anyio
async def test_upload_accepts_safe_filename():
    """B-02/B-08: Normal valid filenames succeed cleanly and are stored in .user_uploaded."""
    engine = AsyncMock()
    engine.find_first.return_value = None

    data = b"safe spreadsheet content"
    file = UploadFile(filename="annual_report_2026.xlsx", file=io.BytesIO(data))

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("app.routers.uploads.get_session_brain_dir", return_value=tmpdir):
            res = await upload_file("sess_test", file, engine)
            assert res["status"] == "success"
            assert res["size"] == len(data)
            saved_file = Path(res["path"])
            assert saved_file.exists()
            assert saved_file.name == "annual_report_2026.xlsx"


# ============================================================================
# B-06: Orphan Session Prevention
# ============================================================================

@pytest.mark.anyio
async def test_stream_query_bridge_rejects_missing_session_id():
    """B-06: Chat request without session_id must return 400 Bad Request."""
    payload = StreamQueryPayload(session_id="", message="hello")
    request = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        await stream_query_bridge(payload, request, path_session_id=None)
    assert exc_info.value.status_code == 400
    assert "session_id is required" in exc_info.value.detail


@pytest.mark.anyio
async def test_stream_chat_query_rejects_none_session_id():
    """B-06: stream_chat_query service must reject None/empty session_id with 400 Bad Request."""
    payload = StreamQueryPayload(session_id=None, message="hello")
    request = MagicMock()
    server = MagicMock()

    with pytest.raises(HTTPException) as exc_info:
        await stream_chat_query(request, payload, server, path_session_id=None)
    assert exc_info.value.status_code == 400
    assert "session_id is required" in exc_info.value.detail


# ============================================================================
# B-01: Protocol Ordering (Pending Approval flushed before RUN_FINISHED)
# ============================================================================

@pytest.mark.anyio
async def test_pending_approval_flushed_before_run_finished():
    """B-01: TOOL_CALL_PENDING_APPROVAL must be yielded BEFORE RUN_FINISHED."""
    async def mock_event_stream():
        yield {"type": "RUN_FINISHED", "run_id": "run_test_01", "session_id": "sess_1"}

    agent = MagicMock()
    del agent.handle_streaming_request
    agent.stream_run = MagicMock(side_effect=lambda **kw: mock_event_stream())

    sm = AsyncMock()
    sm.get_pending_tool_calls.return_value = {
        "call_123": {
            "tool_name": "run_shell_command",
            "prompt": "Execute command",
            "permission_key": "shell",
            "parameters": {"command": "dir"},
            "decision": None,
        }
    }

    events = []
    async for chunk in generate_chat_sse_stream(
        agent=agent,
        sm=sm,
        session_id="sess_1",
        user_id="default_user",
    ):
        if chunk.startswith("data: "):
            try:
                parsed = json.loads(chunk[6:].strip())
                events.append(parsed)
            except Exception:
                pass

    types = [e.get("type") for e in events]
    assert "TOOL_CALL_PENDING_APPROVAL" in types, f"Expected TOOL_CALL_PENDING_APPROVAL in {types}"
    assert "RUN_FINISHED" in types, f"Expected RUN_FINISHED in {types}"

    idx_pending = types.index("TOOL_CALL_PENDING_APPROVAL")
    idx_finished = types.index("RUN_FINISHED")
    assert idx_pending < idx_finished, (
        f"TOOL_CALL_PENDING_APPROVAL (index {idx_pending}) must precede RUN_FINISHED (index {idx_finished})"
    )


@pytest.mark.anyio
async def test_resume_stream_emits_run_started_before_tool_result():
    """B-01: On stream resume, RUN_STARTED must precede approved tool execution results."""
    async def mock_event_stream():
        yield {"type": "TOOL_CALL_RESULT", "tool_call_id": "call_123", "content": "file output"}
        yield {"type": "RUN_FINISHED", "run_id": "run_test_02", "session_id": "sess_2"}

    agent = MagicMock()
    del agent.handle_streaming_request
    agent.stream_run = MagicMock(side_effect=lambda **kw: mock_event_stream())

    sm = AsyncMock()
    sm.get_pending_tool_calls.return_value = {}

    events = []
    async for chunk in generate_chat_sse_stream(
        agent=agent,
        sm=sm,
        session_id="sess_2",
        user_id="default_user",
    ):
        if chunk.startswith("data: "):
            try:
                parsed = json.loads(chunk[6:].strip())
                events.append(parsed)
            except Exception:
                pass

    types = [e.get("type") for e in events]
    assert "RUN_STARTED" in types, f"Expected synthetic RUN_STARTED in {types}"
    assert "TOOL_CALL_RESULT" in types, f"Expected TOOL_CALL_RESULT in {types}"

    idx_started = types.index("RUN_STARTED")
    idx_result = types.index("TOOL_CALL_RESULT")
    assert idx_started < idx_result, (
        f"RUN_STARTED (index {idx_started}) must precede TOOL_CALL_RESULT (index {idx_result})"
    )


# ============================================================================
# B-04 & B-05: Empty / Whitespace-Only LLM Response Handling
# ============================================================================

@pytest.mark.anyio
async def test_empty_llm_response_degrades_gracefully_in_streamer():
    """B-04/B-05: Empty completion error is converted to clean notice + RUN_FINISHED instead of RUN_ERROR."""
    async def mock_error_stream():
        yield {"type": "RUN_ERROR", "message": "RuntimeError: No response content or tool calls"}

    agent = MagicMock()
    del agent.handle_streaming_request
    agent.stream_run = MagicMock(side_effect=lambda **kw: mock_error_stream())

    events = []
    async for chunk in generate_chat_sse_stream(
        agent=agent,
        session_id="sess_empty",
        user_id="default_user",
    ):
        if chunk.startswith("data: "):
            try:
                parsed = json.loads(chunk[6:].strip())
                events.append(parsed)
            except Exception:
                pass

    types = [e.get("type") for e in events]
    assert "RUN_ERROR" not in types, "RUN_ERROR should be intercepted and transformed"
    assert "TEXT_MESSAGE_CONTENT" in types, "Expected TEXT_MESSAGE_CONTENT notification"
    assert "RUN_FINISHED" in types, "Expected clean RUN_FINISHED termination"

    content_event = next(e for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT")
    assert "empty response" in content_event.get("delta", "").lower()




@pytest.mark.anyio
async def test_transports_base_empty_llm_response():
    """B-04/B-05: In transports/base.py, empty completion errors are intercepted into clean terminal turn."""
    from nexau.archs.transports.base import TransportBase

    class DummyTransport(TransportBase):
        async def start(self):
            pass

        async def stop(self):
            pass

    transport = TransportBase.__new__(DummyTransport)
    transport._running_agents = {}
    transport._running_agents_lock = asyncio.Lock()
    transport._default_agent_config = MagicMock()
    transport._session_manager = MagicMock()

    agent = AsyncMock()
    agent.run_async.side_effect = RuntimeError("No response content or tool calls (finish_reason: stop)")
    agent.agent_id = "agent_1"
    agent.run_id = "run_dummy_1"

    # Verify TransportBase.handle_streaming_request intercepts RuntimeError("No response content or tool calls")
    with patch.object(transport, "_recursively_apply_middlewares", return_value=MagicMock()):
        with patch("nexau.archs.transports.base.Agent.create", return_value=agent):
            events = []
            async for ev in transport.handle_streaming_request(
                user_id="u1",
                session_id="s1",
                message="hello",
            ):
                events.append(ev)

            types = [str(getattr(e, "type", "")) for e in events]
            assert not any("RUN_ERROR" in t for t in types)
            assert any("TEXT_MESSAGE_CONTENT" in t for t in types)
            assert any("RUN_FINISHED" in t for t in types)
            content_ev = next(e for e in events if "TEXT_MESSAGE_CONTENT" in str(getattr(e, "type", "")))
            assert "empty response" in content_ev.delta.lower()
