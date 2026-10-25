# Copyright (c) Mash. All rights reserved.
"""Shielded SSE streamer service and payload schemas for Mash Desktop Connector.

Manages 15-second heartbeat keepalive shield, client disconnect cancellation,
typed TOOL_CALL_PENDING_APPROVAL event dispatching, and shielded post-stream
view synchronization.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.steering import clear_steering_messages
from pydantic import BaseModel

from app.dependencies import get_engine
from app.paths import validate_safe_id
from app.services.chat_permissions import (
    apply_permission_mode_to_tools,
    handle_preemptive_steer,
    has_pending_undecided_tool_calls,
    init_session_permissions,
)
from app.services.chat_session_prep import setup_sandbox_and_model

logger = logging.getLogger(__name__)

__all__ = [
    "build_shielded_chat_stream", "generate_chat_sse_stream", "create_chat_event_stream",
    "stream_chat_query", "check_session_id", "StreamQueryPayload", "StopPayload",
    "PlanApprovalPayload", "PermissionModePayload",
]


class StreamQueryPayload(BaseModel):
    session_id: str | None = None
    messages: str = ""
    message: str | None = None
    context: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None
    user_id: str | None = "default_user"
    client_request_id: str | None = None


# ponytail: in-memory turn idempotency registry to deduplicate retried /stream requests
@dataclass
class _TurnExecutionRecord:
    session_id: str
    status: str  # "executing" | "completed" | "cancelled" | "failed"
    done_event: asyncio.Event = field(default_factory=asyncio.Event)
    created_at: float = field(default_factory=time.time)


_request_idempotency_store: dict[str, _TurnExecutionRecord] = {}


def _cleanup_idempotency_store() -> None:
    now = time.time()
    stale = [k for k, v in _request_idempotency_store.items() if now - v.created_at > 600.0]
    for k in stale:
        _request_idempotency_store.pop(k, None)


class StopPayload(BaseModel):
    session_id: str | None = None
    user_id: str = "default_user"
    agent_id: str | None = None
    force: bool = True
    timeout: float | None = 15.0


class PlanApprovalPayload(BaseModel):
    session_id: str | None = None
    action: str
    tool_call_id: str | None = None
    feedback: str | None = None
    user_id: str | None = "default_user"


class PermissionModePayload(BaseModel):
    mode: str


def check_session_id(val: str | None, name: str = "session_id") -> None:
    """Validate safe ID format, raising HTTP 400 on traversal or invalid chars."""
    if val:
        try:
            validate_safe_id(val, name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


async def generate_chat_sse_stream(
    request: Request | Any = None,
    agent: Any = None,
    run_kwargs: dict[str, Any] | None = None,
    user_id: str = "default_user",
    session_id: str = "",
    sm: Any = None,
    eng: Any = None,
    last_run_id_hint: str | None = None,
    client_request_id: str | None = None,
    **extra: Any,
) -> AsyncIterator[str]:
    """Shielded SSE event generator supporting 15s keepalive and disconnect cancellation."""
    kwargs = run_kwargs or {}
    if "context" in kwargs and "variables" not in kwargs and isinstance(kwargs["context"], dict):
        kwargs["variables"] = ContextValue(template={k: v if isinstance(v, str) else json.dumps(v) for k, v in kwargs["context"].items()})

    sm = sm if sm is not None else getattr(agent, "_session_manager", None)
    if eng is None:
        with contextlib.suppress(Exception):
            eng = get_engine()

    if hasattr(agent, "handle_streaming_request"):
        event_iter = agent.handle_streaming_request(**kwargs).__aiter__()
    else:
        event_iter = getattr(agent, "stream_run", agent)(**kwargs).__aiter__()

    # ponytail: shield-and-re-await pattern prevents 15s timeout from cancelling underlying task
    anext_task = asyncio.ensure_future(event_iter.__anext__())
    last_run_id = last_run_id_hint
    run_started_emitted = False
    pending_flushed = False

    try:
        while True:
            if request is not None and await request.is_disconnected():
                anext_task.cancel()
                raise asyncio.CancelledError("Client disconnected")

            try:
                event = await asyncio.wait_for(asyncio.shield(anext_task), timeout=15.0)
                if hasattr(event, "run_id") and event.run_id:
                    last_run_id = event.run_id
                data_str = event.model_dump_json() if hasattr(event, "model_dump_json") else (event if isinstance(event, str) else json.dumps(event))

                # Extract event type for protocol ordering and error interception
                event_type = getattr(event, "type", None)
                if not event_type and isinstance(event, dict):
                    event_type = event.get("type")
                if not event_type and isinstance(data_str, str) and data_str.strip().startswith("{"):
                    with contextlib.suppress(Exception):
                        event_type = json.loads(data_str).get("type")

                # B-04/B-05: Handle empty / whitespace-only model completion error cleanly
                if event_type == "RUN_ERROR":
                    err_msg = getattr(event, "message", None) or ""
                    if not err_msg and isinstance(data_str, str) and "No response content or tool calls" in data_str:
                        err_msg = "No response content or tool calls"
                    if "No response content or tool calls" in str(err_msg):
                        notice = "The model returned an empty response. Please rephrase your query or provide more context."
                        run_id = getattr(event, "run_id", None) or last_run_id or f"run_{session_id[:8]}"
                        if not run_started_emitted:
                            yield f"data: {json.dumps({'type': 'RUN_STARTED', 'run_id': run_id, 'session_id': session_id})}\n\n"
                            run_started_emitted = True
                        yield f"data: {json.dumps({'type': 'TEXT_MESSAGE_CONTENT', 'delta': notice, 'run_id': run_id, 'message_id': f'msg_{session_id[:8]}'})}\n\n"
                        yield f"data: {json.dumps({'type': 'RUN_FINISHED', 'run_id': run_id, 'session_id': session_id, 'result': notice})}\n\n"
                        anext_task = asyncio.ensure_future(event_iter.__anext__())
                        continue

                # B-01: On stream resume, ensure RUN_STARTED precedes tool execution result or content
                if not run_started_emitted:
                    if event_type == "RUN_STARTED":
                        run_started_emitted = True
                    elif event_type in ("TOOL_CALL_RESULT", "TOOL_CALL_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_START", "THINKING_START", "THINKING_CONTENT"):
                        run_id = getattr(event, "run_id", None) or last_run_id or f"run_{session_id[:8]}"
                        yield f"data: {json.dumps({'type': 'RUN_STARTED', 'run_id': run_id, 'session_id': session_id})}\n\n"
                        run_started_emitted = True

                # B-01: Flush TOOL_CALL_PENDING_APPROVAL before yielding RUN_FINISHED
                if event_type == "RUN_FINISHED" and sm and session_id and not pending_flushed:
                    with contextlib.suppress(Exception):
                        for ptc_id, ptc in (await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id) or {}).items():
                            if not ptc.get("decision"):
                                yield f"data: {json.dumps({'type': 'TOOL_CALL_PENDING_APPROVAL', 'tool_call_id': ptc_id, 'run_id': ptc.get('run_id') or last_run_id or 'run', 'tool_name': ptc.get('tool_name') or 'action', 'prompt': ptc.get('prompt', ''), 'permission_key': ptc.get('permission_key', ''), 'parameters': ptc.get('parameters', {})})}\n\n"
                        pending_flushed = True

                if isinstance(data_str, str) and (data_str.startswith("data:") or data_str.startswith(":")):
                    yield data_str if data_str.endswith("\n\n") else f"{data_str}\n\n"
                else:
                    yield f"data: {data_str}\n\n"
                anext_task = asyncio.ensure_future(event_iter.__anext__())
            except TimeoutError:
                yield ": heartbeat\n\n"
            except StopAsyncIteration:
                if client_request_id and client_request_id in _request_idempotency_store:
                    rec = _request_idempotency_store[client_request_id]
                    rec.status = "completed"
                    rec.done_event.set()
                if sm and session_id and not pending_flushed:
                    with contextlib.suppress(Exception):
                        for ptc_id, ptc in (await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id) or {}).items():
                            if not ptc.get("decision"):
                                yield f"data: {json.dumps({'type': 'TOOL_CALL_PENDING_APPROVAL', 'tool_call_id': ptc_id, 'run_id': ptc.get('run_id') or last_run_id or 'run', 'tool_name': ptc.get('tool_name') or 'action', 'prompt': ptc.get('prompt', ''), 'permission_key': ptc.get('permission_key', ''), 'parameters': ptc.get('parameters', {})})}\n\n"
                        pending_flushed = True
                break
    except (asyncio.CancelledError, GeneratorExit):
        if client_request_id and client_request_id in _request_idempotency_store:
            rec = _request_idempotency_store[client_request_id]
            if rec.status == "executing":
                rec.status = "cancelled"
                rec.done_event.set()
        if not anext_task.done():
            anext_task.cancel()
        logger.info("Client disconnected from stream for session %s. Stopping agent.", session_id)
        if agent is not None:
            with contextlib.suppress(Exception):
                if hasattr(agent, "handle_stop_request"):
                    await agent.handle_stop_request(user_id=user_id, session_id=session_id, force=True)
                elif hasattr(agent, "stop"):
                    await agent.stop()
        raise
    except Exception:
        if client_request_id and client_request_id in _request_idempotency_store:
            rec = _request_idempotency_store[client_request_id]
            if rec.status == "executing":
                rec.status = "failed"
                rec.done_event.set()
        raise
    finally:
        if client_request_id and client_request_id in _request_idempotency_store:
            rec = _request_idempotency_store[client_request_id]
            if rec.status == "executing":
                rec.status = "completed"
                rec.done_event.set()
        if not anext_task.done():
            anext_task.cancel()
        if eng and session_id:
            with contextlib.suppress(Exception):
                async def _sync():
                    if cur := await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)):
                        now = datetime.now(UTC)
                        cur.updated_at = now
                        ctx = dict(cur.context or {})
                        ctx["updated_at"] = ctx["last_user_view_time"] = now.isoformat()
                        cur.context = ctx
                        await eng.update(cur)
                await asyncio.shield(_sync())
        if session_id:
            with contextlib.suppress(Exception):
                clear_steering_messages(session_id)


def build_shielded_chat_stream(
    request: Request, agent: Any, run_kwargs: dict[str, Any], user_id: str, session_id: str,
    sm: Any = None, eng: Any = None, as_generator: bool = False,
    client_request_id: str | None = None,
) -> StreamingResponse | AsyncIterator[str]:
    """Build and return a FastAPI StreamingResponse wrapping the shielded SSE generator."""
    gen = generate_chat_sse_stream(
        request=request, agent=agent, run_kwargs=run_kwargs, user_id=user_id,
        session_id=session_id, sm=sm, eng=eng, client_request_id=client_request_id,
    )
    return gen if as_generator else StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})


create_chat_event_stream = generate_chat_sse_stream


async def stream_chat_query(
    request: Request, payload: StreamQueryPayload, server: Any,
    path_session_id: str | None = None, ensure_context_fn: Any = None,
) -> StreamingResponse:
    """Prepare context, sandbox, permissions, and stream chat response."""
    sid = (path_session_id or payload.session_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id is required")
    user_id = payload.user_id or "default_user"
    check_session_id(sid)
    resolved_context = payload.context or {}
    user_prompt = (payload.messages or payload.message or "").strip()
    resolved_context["_raw_message"] = user_prompt

    # ponytail: handle client_request_id turn idempotency across /stream retries
    req_id = payload.client_request_id
    if req_id:
        _cleanup_idempotency_store()
        existing = _request_idempotency_store.get(req_id)
        if existing:
            if existing.status == "completed":
                logger.info("Request %s already completed for session %s. Returning idempotent completion frame.", req_id, sid)
                async def _completed_stream():
                    yield f"data: {json.dumps({'type': 'STATUS', 'status': 'already_completed'})}\n\n"
                    yield "data: [DONE]\n\n"
                return StreamingResponse(_completed_stream(), media_type="text/event-stream")

            if existing.status == "executing":
                logger.info("Request %s is currently executing for session %s. Yielding in-flight wait without duplicate execution.", req_id, sid)
                async def _in_flight_stream():
                    try:
                        while not existing.done_event.is_set():
                            if request is not None and await request.is_disconnected():
                                break
                            try:
                                await asyncio.wait_for(existing.done_event.wait(), timeout=5.0)
                            except TimeoutError:
                                yield ": heartbeat\n\n"
                        if existing.status == "failed":
                            yield f"data: {json.dumps({'type': 'RUN_ERROR', 'message': 'Original execution failed'})}\n\n"
                        elif existing.status == "cancelled":
                            yield f"data: {json.dumps({'type': 'RUN_ERROR', 'message': 'Original execution cancelled'})}\n\n"
                        else:
                            yield f"data: {json.dumps({'type': 'STATUS', 'status': 'already_completed'})}\n\n"
                        yield "data: [DONE]\n\n"
                    except (asyncio.CancelledError, GeneratorExit):
                        pass
                return StreamingResponse(_in_flight_stream(), media_type="text/event-stream")

        _request_idempotency_store[req_id] = _TurnExecutionRecord(session_id=sid, status="executing")

    try:
        from app.routers.auth import ensure_valid_token
        live_token = await ensure_valid_token()
        if not live_token or live_token == "bearer-pending-auth":
            raise HTTPException(status_code=401, detail="Authentication required. Please sign in to MASH.")

        eng = None
        with contextlib.suppress(Exception):
            eng = get_engine()

        ws_target = resolved_context.get("workspace_uri", "No Repo")
        if ensure_context_fn:
            await ensure_context_fn(eng, user_id, sid, resolved_context, ws_target, sse_server=server)
        resolved_context.pop("_raw_message", None)

        cfg = setup_sandbox_and_model(server._default_agent_config, resolved_context, live_token)
        mode = str(resolved_context.get("permission_mode") or "default").lower()
        if cfg and cfg.tools:
            cfg = cfg.model_copy(update={"tools": apply_permission_mode_to_tools(cfg.tools, mode)})

        sm = getattr(server, "_session_manager", None)
        if sm and sid:
            if cfg and cfg.tools:
                await init_session_permissions(sm, user_id, sid, cfg.tools, mode)
            if user_prompt:
                await handle_preemptive_steer(sm, user_id, sid, user_prompt)
            elif await has_pending_undecided_tool_calls(sm, user_id, sid):
                async def waiting():
                    yield f"data: {json.dumps({'type': 'STATUS', 'status': 'waiting_for_remaining_approvals'})}\n\n"
                return StreamingResponse(waiting(), media_type="text/event-stream")

        with contextlib.suppress(Exception):
            await server.handle_stop_request(user_id=user_id, session_id=sid, force=True, timeout=1.0)

        run_kwargs = {"message": user_prompt or [], "user_id": user_id, "agent_config": cfg, "session_id": sid, "context": resolved_context}
        if payload.variables:
            run_kwargs["variables"] = payload.variables
        return build_shielded_chat_stream(request, server, run_kwargs, user_id, sid, sm=sm, eng=eng, client_request_id=req_id)
    except Exception:
        if req_id and req_id in _request_idempotency_store:
            _request_idempotency_store.pop(req_id, None)
        raise
