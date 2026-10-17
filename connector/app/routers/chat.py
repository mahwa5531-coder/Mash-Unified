# Copyright (c) Mash. All rights reserved.
"""Thin chat router delegating session prep, permissions, and SSE streaming to services."""

from __future__ import annotations

import contextlib
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.transports.http.sse_server import SSETransportServer

from app.dependencies import get_engine
from app.paths import resolve_deliverables_dir, resolve_sandbox_work_dir
from app.services.chat_permissions import resolve_tool_approval
from app.services.chat_session_prep import ensure_project_and_context
from app.services.chat_streamer import (
    PermissionModePayload,
    PlanApprovalPayload,
    StopPayload,
    StreamQueryPayload,
    stream_chat_query,
)
from app.services.chat_streamer import (
    check_session_id as _check_id,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])
_sse_server: SSETransportServer | None = None


def get_sse_server() -> SSETransportServer:
    if _sse_server is None:
        raise HTTPException(status_code=503, detail="SSETransportServer not initialized")
    return _sse_server


async def _ensure_project_and_context(
    eng: Any, user_id: str, sid: str, resolved_context: dict[str, Any], workspace_target: str, sse_server: Any = None
) -> None:
    server = sse_server if sse_server is not None else _sse_server
    return await ensure_project_and_context(eng, user_id, sid, resolved_context, workspace_target, sse_server=server)


async def stream_query_bridge(payload: StreamQueryPayload, request: Request, path_session_id: str | None = None):
    return await stream_chat_query(request, payload, get_sse_server(), path_session_id, _ensure_project_and_context)


for _p in ("/stream", "/chat", "/api/chat", "/api/chat/stream", "/api/chat/{path_session_id}/stream", "/sessions/{path_session_id}/stream"):
    router.add_api_route(_p, stream_query_bridge, methods=["POST"])


async def stop_agent_bridge(payload: StopPayload | None = None, session_id: str | None = None):
    server = get_sse_server()
    sid = (payload.session_id if payload else None) or session_id or ""
    _check_id(sid)
    uid, stop_reason = payload.user_id if payload else "default_user", "stopped"
    try:
        res = await server.handle_stop_request(
            user_id=uid, session_id=sid, agent_id=payload.agent_id if payload else None,
            force=payload.force if payload is not None else True, timeout=payload.timeout if payload is not None else 15.0,
        )
        stop_reason = getattr(res, "stop_reason", "stopped")
    except Exception as e:
        logger.warning("Stop error: %s", e)
    if sid:
        with contextlib.suppress(Exception):
            from nexau.archs.session.models.agent_lock import AgentLockModel
            await (get_engine()).delete(AgentLockModel, filters=ComparisonFilter.eq("session_id", sid))
    return {"status": "success", "stop_reason": str(stop_reason)}


for _p in ("/stop", "/api/chat/stop", "/sessions/{session_id}/stop", "/api/chat/{session_id}/stop"):
    router.add_api_route(_p, stop_agent_bridge, methods=["POST"])


async def approve_tool_call_bridge(payload: PlanApprovalPayload, session_id: str | None = None):
    sid = session_id or payload.session_id or ""
    _check_id(sid)
    sm = getattr(get_sse_server(), "_session_manager", None)
    return await resolve_tool_approval(
        sm, payload.user_id or "default_user", sid, payload.tool_call_id, payload.action, payload.feedback
    )


approve_plan_bridge = approve_tool_call_bridge
for _p in ("/approve", "/api/chat/approve", "/sessions/{session_id}/approve", "/api/chat/{session_id}/approve"):
    router.add_api_route(_p, approve_tool_call_bridge, methods=["POST"])


async def update_session_permission_mode(session_id: str, payload: PermissionModePayload):
    _check_id(session_id)
    if not (eng := get_engine()):
        raise HTTPException(status_code=500, detail="Database engine unavailable")
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    mode = payload.mode.lower()
    if mode not in ("turbo", "default", "review"):
        raise HTTPException(status_code=400, detail="Mode must be 'turbo', 'default', or 'review'")
    ctx = dict(session.context or {})
    ctx["permission_mode"] = mode
    session.context = ctx
    await eng.update(session)
    return {"status": "success", "session_id": session_id, "permission_mode": mode}


set_session_permission_mode = update_session_permission_mode
for _p in ("/api/sessions/{session_id}/permissions/mode", "/sessions/{session_id}/permissions/mode"):
    router.add_api_route(_p, update_session_permission_mode, methods=["POST"])


async def get_session_permissions(session_id: str, user_id: str = "default_user"):
    _check_id(session_id)
    eng = get_engine()
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None
    ctx = session.context or {} if session else {}
    sm = getattr(get_sse_server(), "_session_manager", None)
    pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id) if sm else {}
    return {"session_id": session_id, "permission_mode": ctx.get("permission_mode", "default"), "pending_tool_calls": pending or {}}


for _p in ("/api/sessions/{session_id}/permissions", "/sessions/{session_id}/permissions"):
    router.add_api_route(_p, get_session_permissions, methods=["GET"])

__all__ = [
    "router", "_sse_server", "get_sse_server", "StreamQueryPayload", "StopPayload",
    "PlanApprovalPayload", "PermissionModePayload", "stream_query_bridge", "stop_agent_bridge",
    "approve_plan_bridge", "approve_tool_call_bridge", "update_session_permission_mode",
    "set_session_permission_mode", "get_session_permissions", "_ensure_project_and_context",
    "resolve_deliverables_dir", "resolve_sandbox_work_dir",
]
