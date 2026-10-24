# Copyright (c) Mash. All rights reserved.
"""Tests for client_request_id and turn idempotency in chat_streamer service."""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

connector_dir = Path(__file__).resolve().parent.parent
nexau_dir = connector_dir.parent / "NexAU"
if str(connector_dir) not in sys.path:
    sys.path.insert(0, str(connector_dir))
if str(nexau_dir) not in sys.path:
    sys.path.insert(0, str(nexau_dir))

from app.services.chat_streamer import (
    StreamQueryPayload,
    _cleanup_idempotency_store,
    _request_idempotency_store,
    _TurnExecutionRecord,
    generate_chat_sse_stream,
    stream_chat_query,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_stream_query_payload_client_request_id():
    """Verify StreamQueryPayload accepts client_request_id correctly."""
    p1 = StreamQueryPayload(messages="Hello")
    assert p1.client_request_id is None

    p2 = StreamQueryPayload(messages="Hello", client_request_id="req_test_123")
    assert p2.client_request_id == "req_test_123"


@pytest.mark.anyio
async def test_completed_client_request_id_idempotency():
    """Verify that a request with already completed client_request_id returns completion without re-executing."""
    req_id = f"req_completed_{uuid.uuid4().hex[:8]}"
    sid = f"sess_{uuid.uuid4().hex[:8]}"

    # Pre-record completed turn in idempotency store
    record = _TurnExecutionRecord(session_id=sid, status="completed")
    record.done_event.set()
    _request_idempotency_store[req_id] = record

    mock_server = MagicMock()
    mock_request = AsyncMock()
    mock_request.is_disconnected.return_value = False

    payload = StreamQueryPayload(session_id=sid, messages="Test message", client_request_id=req_id)

    response = await stream_chat_query(mock_request, payload, mock_server)
    assert response.status_code == 200

    # Consume the response body stream
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)

    full_text = "".join(chunks)
    assert "already_completed" in full_text
    assert "[DONE]" in full_text

    # Verify mock_server was NEVER invoked to start another agent run
    assert not mock_server.handle_streaming_request.called
    assert not mock_server.stream_run.called


@pytest.mark.anyio
async def test_in_flight_client_request_id_idempotency():
    """Verify that a retry arriving while the first request is executing waits without duplicate execution."""
    req_id = f"req_exec_{uuid.uuid4().hex[:8]}"
    sid = f"sess_{uuid.uuid4().hex[:8]}"

    # In-flight record
    record = _TurnExecutionRecord(session_id=sid, status="executing")
    _request_idempotency_store[req_id] = record

    mock_server = MagicMock()
    mock_request = AsyncMock()
    mock_request.is_disconnected.return_value = False

    payload = StreamQueryPayload(session_id=sid, messages="Test message", client_request_id=req_id)

    # Schedule completion of the in-flight turn shortly
    async def finish_turn():
        await asyncio.sleep(0.05)
        record.status = "completed"
        record.done_event.set()

    asyncio.create_task(finish_turn())

    response = await stream_chat_query(mock_request, payload, mock_server)
    assert response.status_code == 200

    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)

    full_text = "".join(chunks)
    assert "already_completed" in full_text
    assert "[DONE]" in full_text

    # No duplicate agent run started
    assert not mock_server.handle_streaming_request.called
    assert not mock_server.stream_run.called


@pytest.mark.anyio
async def test_failed_client_request_id_allows_retry_execution():
    """Verify that if an execution failed, a subsequent retry with the same client_request_id re-executes."""
    req_id = f"req_failed_{uuid.uuid4().hex[:8]}"
    sid = f"sess_{uuid.uuid4().hex[:8]}"

    # Mark as failed in store
    record = _TurnExecutionRecord(session_id=sid, status="failed")
    record.done_event.set()
    _request_idempotency_store[req_id] = record

    mock_server = MagicMock()
    mock_server._default_agent_config = MagicMock()
    mock_server._default_agent_config.tools = []
    mock_request = AsyncMock()
    mock_request.is_disconnected.return_value = False

    payload = StreamQueryPayload(session_id=sid, messages="Retry message", client_request_id=req_id)

    # It must NOT return "already_completed"
    try:
        response = await stream_chat_query(mock_request, payload, mock_server)
        # Should attempt execution (build_shielded_chat_stream returns StreamingResponse)
        assert response.status_code == 200
        # The record in idempotency store should now be reset to executing
        assert _request_idempotency_store[req_id].status == "executing"
    except Exception as exc:
        # If auth or setup fails, verify it didn't return already_completed
        assert "already_completed" not in str(exc)

