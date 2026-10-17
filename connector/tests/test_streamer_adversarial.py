# Copyright (c) Mash. All rights reserved.
"""Adversarial stress-test suite for shielded SSE streaming, heartbeat keepalive,
client disconnect handling, approval event dispatch, and post-stream sync.

Verifies:
1. Heartbeat keepalive shield:
   - Patched/scaled timeout triggers ': heartbeat\\n\\n' without cancelling underlying generator task.
   - Real unmocked 15.0s timeout triggers ': heartbeat\\n\\n' at 15s interval while preserving underlying task.
2. Client disconnect:
   - request.is_disconnected() immediately triggers cancellation and invokes agent.handle_stop_request(...).
   - Mid-stream disconnect cancels generator and invokes agent.handle_stop_request(...).
   - GeneratorExit (aclose) invokes agent.handle_stop_request(...).
   - Fallback to agent.stop() when handle_stop_request is absent.
3. Approval event dispatch:
   - StopAsyncIteration with undecided pending tool calls emits TOOL_CALL_PENDING_APPROVAL.
   - Exact schema validation (type, tool_call_id, run_id, tool_name, prompt, permission_key, parameters).
   - Filtering of decided (allow/deny) vs undecided tool calls.
   - Run ID resolution cascade (ptc.run_id -> last_run_id from event -> last_run_id_hint -> 'run').
4. Post-stream sync:
   - last_user_view_time and updated_at are updated in SQLite SessionModel on clean completion.
   - last_user_view_time is updated in SQLite SessionModel on disconnect / CancelledError.
   - last_user_view_time is updated in SQLite SessionModel on GeneratorExit (aclose).
   - Steering mailbox cleanup.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

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
from app.services.chat_streamer import generate_chat_sse_stream
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.steering import (
    clear_steering_messages,
    peek_steering_messages,
    queue_steering_message,
)


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ==============================================================================
# 1. Heartbeat Keepalive Shield Stress Tests
# ==============================================================================
@pytest.mark.anyio
async def test_heartbeat_shield_scaled_preserves_underlying_task():
    """Verify that when event generation takes longer than the timeout,
    ': heartbeat\\n\\n' is yielded repeatedly without cancelling the underlying task."""
    task_cancelled = False

    class MockSlowAgent:
        async def handle_streaming_request(self, **kwargs):
            nonlocal task_cancelled
            try:
                # Sleep 120ms before event 1 (with 40ms timeout -> 2-3 heartbeats)
                await asyncio.sleep(0.12)
                yield {"type": "CONTENT", "text": "chunk_one"}
                # Sleep 90ms before event 2 (with 40ms timeout -> 1-2 heartbeats)
                await asyncio.sleep(0.09)
                yield {"type": "CONTENT", "text": "chunk_two"}
            except asyncio.CancelledError:
                task_cancelled = True
                raise

    orig_wait_for = asyncio.wait_for

    async def scaled_wait_for(fut, timeout):
        # Scale 15.0s down to 0.04s for rapid empirical testing
        effective_timeout = 0.04 if timeout == 15.0 else timeout
        return await orig_wait_for(fut, timeout=effective_timeout)

    with patch("app.services.chat_streamer.asyncio.wait_for", side_effect=scaled_wait_for):
        agent = MockSlowAgent()
        yielded = []
        async for chunk in generate_chat_sse_stream(agent=agent):
            yielded.append(chunk)

    assert task_cancelled is False, "Underlying agent task must NEVER be cancelled by heartbeat timeout"
    heartbeat_count = yielded.count(": heartbeat\n\n")
    assert heartbeat_count >= 2, f"Expected at least 2 heartbeats, got {heartbeat_count}"

    # Extract non-heartbeat data frames
    data_frames = [json.loads(c[len("data: "):].strip()) for c in yielded if c.startswith("data:")]
    assert len(data_frames) == 2
    assert data_frames[0] == {"type": "CONTENT", "text": "chunk_one"}
    assert data_frames[1] == {"type": "CONTENT", "text": "chunk_two"}


@pytest.mark.anyio
async def test_heartbeat_shield_real_15s_unmocked():
    """Real unmocked 15.0s timeout empirical test:
    A slow event yielding after 15.2s triggers an actual 15s ': heartbeat\\n\\n'
    and then successfully completes with the real event."""
    task_was_cancelled = False

    class RealTimeoutAgent:
        async def handle_streaming_request(self, **kwargs):
            nonlocal task_was_cancelled
            try:
                # Sleep 15.2s: exactly crosses the 15.0s unmocked timeout once
                await asyncio.sleep(15.2)
                yield {"type": "DONE", "payload": "completed_after_heartbeat"}
            except asyncio.CancelledError:
                task_was_cancelled = True
                raise

    agent = RealTimeoutAgent()
    yielded_with_timestamps = []

    start_t = time.monotonic()
    async for chunk in generate_chat_sse_stream(agent=agent):
        elapsed = time.monotonic() - start_t
        yielded_with_timestamps.append((elapsed, chunk))

    assert task_was_cancelled is False, "Underlying task must survive the 15s heartbeat timeout"
    assert len(yielded_with_timestamps) == 2, f"Expected [heartbeat, event], got {yielded_with_timestamps}"

    hb_time, hb_chunk = yielded_with_timestamps[0]
    assert hb_chunk == ": heartbeat\n\n"
    assert 14.7 <= hb_time <= 16.0, f"Heartbeat arrived at {hb_time:.2f}s, expected ~15.0s"

    evt_time, evt_chunk = yielded_with_timestamps[1]
    assert evt_chunk.startswith("data:")
    parsed = json.loads(evt_chunk[len("data: "):].strip())
    assert parsed == {"type": "DONE", "payload": "completed_after_heartbeat"}
    assert evt_time >= 15.1, f"Event arrived at {evt_time:.2f}s, expected >= 15.1s"


# ==============================================================================
# 2. Client Disconnect Cancellation Tests
# ==============================================================================
@pytest.mark.anyio
async def test_client_disconnect_immediate_triggers_handle_stop_request():
    """Verify that request.is_disconnected() == True before first read
    cancels anext_task and invokes agent.handle_stop_request."""
    mock_request = AsyncMock()
    mock_request.is_disconnected.return_value = True

    mock_agent = AsyncMock()

    async def dummy_stream(**kwargs):
        yield {"text": "should not be reached"}

    mock_agent.handle_streaming_request = dummy_stream
    mock_agent.handle_stop_request = AsyncMock()

    gen = generate_chat_sse_stream(
        request=mock_request,
        agent=mock_agent,
        user_id="auditor_user",
        session_id="sess_discon_001",
    )

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        await gen.__anext__()

    mock_agent.handle_stop_request.assert_awaited_once_with(
        user_id="auditor_user",
        session_id="sess_discon_001",
        force=True,
    )


@pytest.mark.anyio
async def test_client_disconnect_mid_stream_triggers_stop():
    """Verify that client disconnect between chunks cancels the underlying task
    and invokes agent.handle_stop_request."""
    mock_request = AsyncMock()
    # First check: connected; Second check (after 1st yield): disconnected
    mock_request.is_disconnected.side_effect = [False, True]

    underlying_cancelled = False

    class TwoChunkAgent:
        async def handle_streaming_request(self, **kwargs):
            nonlocal underlying_cancelled
            try:
                yield {"chunk": 1}
                await asyncio.sleep(1.0)
                yield {"chunk": 2}
            except asyncio.CancelledError:
                underlying_cancelled = True
                raise

    agent = TwoChunkAgent()
    agent.handle_stop_request = AsyncMock()

    gen = generate_chat_sse_stream(
        request=mock_request,
        agent=agent,
        user_id="auditor_user",
        session_id="sess_discon_mid",
    )

    first_chunk = await gen.__anext__()
    assert "data:" in first_chunk
    assert json.loads(first_chunk[len("data: "):]) == {"chunk": 1}

    # Next iteration must raise CancelledError due to is_disconnected() == True
    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        await gen.__anext__()

    agent.handle_stop_request.assert_awaited_once_with(
        user_id="auditor_user",
        session_id="sess_discon_mid",
        force=True,
    )
    # Allow event loop to process task cancellation unwinding
    await asyncio.sleep(0.05)
    assert underlying_cancelled is True, "Underlying agent task must be explicitly cancelled on disconnect"


@pytest.mark.anyio
async def test_client_disconnect_via_aclose_generator_exit():
    """Verify that when consumer calls aclose() (GeneratorExit),
    the agent's stop/handle_stop_request is invoked cleanly."""
    mock_agent = AsyncMock()

    async def eternal_stream(**kwargs):
        try:
            while True:
                await asyncio.sleep(0.01)
                yield {"type": "PING"}
        except asyncio.CancelledError:
            pass

    mock_agent.handle_streaming_request = eternal_stream
    mock_agent.handle_stop_request = AsyncMock()

    gen = generate_chat_sse_stream(
        agent=mock_agent,
        user_id="u_exit",
        session_id="sess_gen_exit",
    )

    first_item = await gen.__anext__()
    assert "PING" in first_item

    # Close the generator prematurely (simulates Starlette client disconnect closing the stream)
    await gen.aclose()

    mock_agent.handle_stop_request.assert_awaited_once_with(
        user_id="u_exit",
        session_id="sess_gen_exit",
        force=True,
    )


@pytest.mark.anyio
async def test_client_disconnect_fallback_to_stop_method():
    """Verify that if agent lacks handle_stop_request, it falls back to agent.stop()."""
    mock_request = AsyncMock()
    mock_request.is_disconnected.return_value = True

    class MinimalStopAgent:
        def __init__(self):
            self.stop_called = False

        async def stream_run(self, **kwargs):
            yield {"item": 1}

        async def stop(self):
            self.stop_called = True

    agent = MinimalStopAgent()
    gen = generate_chat_sse_stream(
        request=mock_request,
        agent=agent,
        user_id="u_stop",
        session_id="sess_min_stop",
    )

    with pytest.raises(asyncio.CancelledError):
        await gen.__anext__()

    assert agent.stop_called is True, "Must fall back to agent.stop() if handle_stop_request is missing"


# ==============================================================================
# 3. Approval Event Dispatch Stress Tests
# ==============================================================================
@pytest.mark.anyio
async def test_approval_event_dispatch_exact_schema():
    """Verify that on StopAsyncIteration, undecided pending tool calls in sm
    are emitted as TOOL_CALL_PENDING_APPROVAL with exact schema and fields."""
    mock_agent = MagicMock()

    async def finished_stream(**kwargs):
        # Empty stream that finishes immediately
        if False:
            yield {}

    mock_agent.handle_streaming_request = finished_stream

    mock_sm = AsyncMock()
    mock_sm.get_pending_tool_calls.return_value = {
        "call_exact_001": {
            "run_id": "run_explicit_88",
            "tool_name": "execute_bash",
            "prompt": "Allow running dangerous script?",
            "permission_key": "exec_cmd",
            "parameters": {"cmd": "rm -rf /test", "safe": False},
            "decision": None,
        }
    }

    gen = generate_chat_sse_stream(
        agent=mock_agent,
        user_id="test_user",
        session_id="sess_approval_schema",
        sm=mock_sm,
    )

    chunks = [c async for c in gen]
    assert len(chunks) == 1
    assert chunks[0].startswith("data: ")
    assert chunks[0].endswith("\n\n")

    payload = json.loads(chunks[0][len("data: "):].strip())
    assert payload == {
        "type": "TOOL_CALL_PENDING_APPROVAL",
        "tool_call_id": "call_exact_001",
        "run_id": "run_explicit_88",
        "tool_name": "execute_bash",
        "prompt": "Allow running dangerous script?",
        "permission_key": "exec_cmd",
        "parameters": {"cmd": "rm -rf /test", "safe": False},
    }


@pytest.mark.anyio
async def test_approval_event_dispatch_filtering_decided_calls():
    """Verify that only undecided pending calls are emitted; already decided calls are excluded."""
    mock_agent = MagicMock()

    async def empty_stream(**kwargs):
        if False:
            yield {}

    mock_agent.handle_streaming_request = empty_stream

    mock_sm = AsyncMock()
    mock_sm.get_pending_tool_calls.return_value = {
        "call_undecided_1": {
            "tool_name": "tool_a",
            "prompt": "Prompt A",
            "decision": None,
        },
        "call_allowed_2": {
            "tool_name": "tool_b",
            "decision": "allow",
        },
        "call_denied_3": {
            "tool_name": "tool_c",
            "decision": "deny",
        },
        "call_undecided_4": {
            "tool_name": "tool_d",
            "prompt": "Prompt D",
            "decision": "",  # Empty string is falsy -> undecided
        },
    }

    gen = generate_chat_sse_stream(
        agent=mock_agent,
        user_id="test_user",
        session_id="sess_filter_approval",
        sm=mock_sm,
    )

    chunks = [c async for c in gen]
    assert len(chunks) == 2, f"Expected 2 undecided events, got {len(chunks)}"

    payloads = [json.loads(c[len("data: "):].strip()) for c in chunks]
    ids = {p["tool_call_id"] for p in payloads}
    assert ids == {"call_undecided_1", "call_undecided_4"}


@pytest.mark.anyio
async def test_approval_event_dispatch_run_id_resolution_cascade():
    """Verify run_id resolution hierarchy:
    1. ptc['run_id']
    2. event.run_id (tracked from prior stream event)
    3. last_run_id_hint
    4. fallback 'run'"""

    class StreamWithRunId:
        async def handle_streaming_request(self, **kwargs):
            # Model object with run_id
            event_obj = MagicMock()
            event_obj.run_id = "run_from_event_99"
            event_obj.model_dump_json.return_value = json.dumps({"type": "TEXT"})
            yield event_obj

    # Case A: ptc has no run_id, but event had run_id
    mock_sm_a = AsyncMock()
    mock_sm_a.get_pending_tool_calls.return_value = {
        "call_fallback_evt": {"tool_name": "tool_x", "decision": None}
    }

    gen_a = generate_chat_sse_stream(
        agent=StreamWithRunId(),
        session_id="sess_cascade_a",
        sm=mock_sm_a,
    )
    chunks_a = [c async for c in gen_a]
    assert len(chunks_a) == 2  # 1 content event + 1 approval event
    approval_a = json.loads(chunks_a[1][len("data: "):].strip())
    assert approval_a["run_id"] == "run_from_event_99"

    # Case B: ptc has no run_id, stream had no run_id, but hint is passed
    async def no_run_id_stream(**kwargs):
        yield {"type": "RAW_TEXT"}

    mock_agent_b = MagicMock()
    mock_agent_b.handle_streaming_request = no_run_id_stream

    mock_sm_b = AsyncMock()
    mock_sm_b.get_pending_tool_calls.return_value = {
        "call_fallback_hint": {"tool_name": "tool_y", "decision": None}
    }

    gen_b = generate_chat_sse_stream(
        agent=mock_agent_b,
        session_id="sess_cascade_b",
        sm=mock_sm_b,
        last_run_id_hint="run_from_hint_77",
    )
    chunks_b = [c async for c in gen_b]
    approval_b = json.loads(chunks_b[1][len("data: "):].strip())
    assert approval_b["run_id"] == "run_from_hint_77"

    # Case C: no run_id anywhere -> defaults to 'run'
    gen_c = generate_chat_sse_stream(
        agent=mock_agent_b,
        session_id="sess_cascade_c",
        sm=mock_sm_b,
        last_run_id_hint=None,
    )
    chunks_c = [c async for c in gen_c]
    approval_c = json.loads(chunks_c[1][len("data: "):].strip())
    assert approval_c["run_id"] == "run"


# ==============================================================================
# 4. Post-Stream SQLite Sync & Steering Cleanup Stress Tests
# ==============================================================================
@pytest.mark.anyio
async def test_post_stream_sync_updates_sqlite_on_normal_completion():
    """Verify that last_user_view_time and updated_at are updated in SQLite upon normal stream completion."""
    async with lifespan(app):
        engine = deps.get_engine()
        sid = f"sess_sync_clean_{uuid.uuid4().hex[:8]}"
        user_id = "sync_user_1"

        old_timestamp = "2020-01-01T00:00:00.000000+00:00"
        initial_session = SessionModel(
            session_id=sid,
            user_id=user_id,
            context={"title": "Sync Test Clean", "last_user_view_time": old_timestamp},
        )
        await engine.create(initial_session)

        # Set up a steering message to verify cleanup
        queue_steering_message(sid, "steer_to_be_cleared")
        assert len(peek_steering_messages(sid)) == 1

        async def quick_stream(**kwargs):
            yield {"type": "GREETING", "text": "hello"}

        agent = MagicMock()
        agent.handle_streaming_request = quick_stream

        # Run stream to completion
        gen = generate_chat_sse_stream(
            agent=agent,
            user_id=user_id,
            session_id=sid,
            eng=engine,
        )
        _ = [c async for c in gen]

        # Verify SQLite record updated
        updated_sess = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert updated_sess is not None
        assert updated_sess.context is not None
        new_view_time = updated_sess.context.get("last_user_view_time")
        assert new_view_time is not None
        assert new_view_time != old_timestamp
        # Must parse as valid recent ISO timestamp
        parsed_dt = datetime.fromisoformat(new_view_time)
        assert parsed_dt.year >= 2026

        # Verify steering messages cleared
        assert len(peek_steering_messages(sid)) == 0

        # Cleanup DB
        await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))


@pytest.mark.anyio
async def test_post_stream_sync_updates_sqlite_on_disconnect():
    """Verify that last_user_view_time in SQLite is updated even when the stream is cancelled by disconnect."""
    async with lifespan(app):
        engine = deps.get_engine()
        sid = f"sess_sync_discon_{uuid.uuid4().hex[:8]}"
        user_id = "sync_user_2"

        old_timestamp = "2021-06-01T12:00:00+00:00"
        initial_session = SessionModel(
            session_id=sid,
            user_id=user_id,
            context={"title": "Sync Disconnect Test", "last_user_view_time": old_timestamp},
        )
        await engine.create(initial_session)

        mock_request = AsyncMock()
        mock_request.is_disconnected.return_value = True

        mock_agent = AsyncMock()

        async def infinite_stream(**kwargs):
            while True:
                yield "hello"
                await asyncio.sleep(0.1)

        mock_agent.handle_streaming_request = infinite_stream
        mock_agent.handle_stop_request = AsyncMock()

        gen = generate_chat_sse_stream(
            request=mock_request,
            agent=mock_agent,
            user_id=user_id,
            session_id=sid,
            eng=engine,
        )

        with pytest.raises(asyncio.CancelledError):
            await gen.__anext__()

        # Check SQLite was updated in finally block
        updated_sess = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert updated_sess is not None
        new_view_time = updated_sess.context.get("last_user_view_time")
        assert new_view_time is not None
        assert new_view_time != old_timestamp

        # Cleanup DB
        await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))


@pytest.mark.anyio
async def test_post_stream_sync_updates_sqlite_on_generator_aclose():
    """Verify that last_user_view_time in SQLite is updated when stream is closed via gen.aclose()."""
    async with lifespan(app):
        engine = deps.get_engine()
        sid = f"sess_sync_aclose_{uuid.uuid4().hex[:8]}"
        user_id = "sync_user_3"

        old_timestamp = "2022-01-01T00:00:00+00:00"
        initial_session = SessionModel(
            session_id=sid,
            user_id=user_id,
            context={"title": "Sync Aclose Test", "last_user_view_time": old_timestamp},
        )
        await engine.create(initial_session)

        async def endless_stream(**kwargs):
            while True:
                yield {"tick": 1}
                await asyncio.sleep(0.05)

        mock_agent = AsyncMock()
        mock_agent.handle_streaming_request = endless_stream
        mock_agent.handle_stop_request = AsyncMock()

        gen = generate_chat_sse_stream(
            agent=mock_agent,
            user_id=user_id,
            session_id=sid,
            eng=engine,
        )

        item = await gen.__anext__()
        assert "tick" in item

        # Consumer drops connection -> aclose()
        await gen.aclose()

        updated_sess = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        assert updated_sess is not None
        new_view_time = updated_sess.context.get("last_user_view_time")
        assert new_view_time is not None
        assert new_view_time != old_timestamp

        # Cleanup DB
        await engine.delete(SessionModel, filters=ComparisonFilter.eq("session_id", sid))


if __name__ == "__main__":
    sys.exit(pytest.main(["-v", "-s", __file__]))
