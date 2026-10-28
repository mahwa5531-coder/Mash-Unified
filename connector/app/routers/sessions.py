from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from nexau.archs.session.steering import (
    clear_steering_messages,
    peek_steering_messages,
    queue_steering_message,
    remove_steering_message,
)
from pydantic import BaseModel

from app.dependencies import DatabaseEngineDep
from app.paths import validate_safe_id
from app.services.session_lifecycle import (
    create_new_session,
    delete_existing_session,
    fork_session,
    list_all_sessions,
    list_project_sessions,
    mark_session_as_viewed,
    rename_existing_session,
    undo_session_turn,
)
from app.services.session_subagents import (
    get_subagent_transcript_messages,
    get_subagents_summary,
)
from app.services.session_transcript import (
    _get_engine,
    _parse_epoch_seconds,
    clean_protocol_sentinels,
    clean_user_steering_envelope,
    generate_clean_session_title,
    load_session_history,
    load_session_transcript,
    messages_to_transcript_lines,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sessions"])


class CreateSessionRequest(BaseModel):
    user_id: str = "default_user"
    session_id: str | None = None
    project_id: str | None = None
    title: str = "New Chat"
    workspace_uri: str | None = None
    section: str | None = None

    @property
    def clean_title(self) -> str:
        # QA-11: defense-in-depth HTML tag stripping
        t = re.sub(r'<[^>]*>', '', self.title or "").strip()
        return t or "New Chat"


class RenameSessionPayload(BaseModel):
    custom_title: str | None = None
    title: str | None = None

    @property
    def effective_title(self) -> str:
        raw = (self.custom_title or self.title or "").strip()
        # QA-11: defense-in-depth HTML tag stripping
        return re.sub(r'<[^>]*>', '', raw).strip()


class UndoPayload(BaseModel):
    from_turn: int = 0


class SteeringQueuePayload(BaseModel):
    message: str
    session_id: str | None = None


class ForkSessionPayload(BaseModel):
    user_id: str = "default_user"
    title: str | None = None


@router.get("/sessions")
@router.get("/api/sessions")
async def list_sessions(engine: DatabaseEngineDep, include_benchmarks: bool = False) -> dict[str, Any]:
    return await list_all_sessions(engine=engine, include_benchmarks=include_benchmarks)


@router.post("/sessions")
@router.post("/api/sessions")
async def create_session(request: CreateSessionRequest, engine: DatabaseEngineDep) -> dict[str, str]:
    return await create_new_session(
        engine=engine, user_id=request.user_id, session_id=request.session_id,
        project_id=request.project_id, title=request.clean_title,
        workspace_uri=request.workspace_uri, section=request.section,
    )


@router.get("/api/sessions/project/{project_id}")
@router.get("/sessions/project/{project_id}")
async def list_sessions_by_project(project_id: str, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await list_project_sessions(engine=engine, project_id=project_id)


@router.get("/sessions/{session_id}/transcript")
@router.get("/api/sessions/{session_id}/transcript")
async def get_transcript(
    session_id: str, engine: DatabaseEngineDep,
    limit: int | None = None, offset: int = 0, shallow_tools: bool = False,
) -> dict[str, Any]:
    return await load_session_transcript(engine=engine, session_id=session_id, limit=limit, offset=offset, shallow_tools=shallow_tools)


get_session_transcript_bridge = get_transcript


@router.get("/api/sessions/{user_id}/{session_id}/history")
@router.get("/sessions/{user_id}/{session_id}/history")
async def get_history(user_id: str, session_id: str, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await load_session_history(engine=engine, user_id=user_id, session_id=session_id)


@router.get("/api/sessions/{session_id}/subagents")
@router.get("/sessions/{session_id}/subagents")
async def list_subagents(session_id: str, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await get_subagents_summary(engine=engine, session_id=session_id)


@router.get("/api/sessions/{session_id}/subagents/{sub_agent_id}/transcript")
@router.get("/sessions/{session_id}/subagents/{sub_agent_id}/transcript")
async def get_subagent_transcript(session_id: str, sub_agent_id: str, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await get_subagent_transcript_messages(engine=engine, session_id=session_id, sub_agent_id=sub_agent_id)


@router.post("/sessions/{session_id}/view")
@router.post("/api/sessions/{session_id}/view")
async def mark_session_viewed(session_id: str, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await mark_session_as_viewed(engine=engine, session_id=session_id)


@router.post("/sessions/{session_id}/rename")
@router.post("/api/sessions/{session_id}/rename")
@router.patch("/sessions/{session_id}/rename")
@router.patch("/api/sessions/{session_id}/rename")
async def rename_session(session_id: str, payload: RenameSessionPayload, engine: DatabaseEngineDep) -> dict[str, Any]:
    return await rename_existing_session(engine=engine, session_id=session_id, title=payload.effective_title)


@router.delete("/sessions/{session_id}/undo")
@router.delete("/api/sessions/{session_id}/undo")
# ponytail: B-14 default payload allows DELETE without request body
async def undo_session(session_id: str, engine: DatabaseEngineDep, payload: UndoPayload = UndoPayload()) -> dict[str, Any]:
    return await undo_session_turn(engine=engine, session_id=session_id, from_turn=payload.from_turn)


@router.post("/sessions/{session_id}/queue")
@router.post("/api/sessions/{session_id}/queue")
async def queue_session_steering(session_id: str, payload: SteeringQueuePayload) -> dict[str, Any]:
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    msg = payload.message.strip()
    if not msg:
        return {"status": "error", "message": "Empty message"}
    queue_steering_message(session_id, msg)
    return {"status": "queued", "session_id": session_id, "message": msg, "total_queued": len(peek_steering_messages(session_id))}


@router.get("/sessions/{session_id}/queue")
@router.get("/api/sessions/{session_id}/queue")
async def get_session_queue(session_id: str) -> dict[str, Any]:
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    queued = peek_steering_messages(session_id)
    return {"session_id": session_id, "queued": queued, "count": len(queued)}


@router.delete("/sessions/{session_id}/queue")
@router.delete("/api/sessions/{session_id}/queue")
async def clear_session_queue(session_id: str, index: int | None = None) -> dict[str, Any]:
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if index is not None:
        try:
            remove_steering_message(session_id, index)
        except Exception:
            pass
        queued = peek_steering_messages(session_id)
        return {"status": "success", "session_id": session_id, "queued": queued, "count": len(queued)}
    clear_steering_messages(session_id)
    return {"status": "success", "session_id": session_id, "queued": [], "count": 0}


@router.delete("/sessions/{session_id}")
@router.delete("/api/sessions/{session_id}")
@router.delete("/api/sessions/{user_id}/{session_id}")
@router.delete("/sessions/{user_id}/{session_id}")
async def delete_session(session_id: str, engine: DatabaseEngineDep, user_id: str | None = None) -> dict[str, Any]:
    return await delete_existing_session(engine=engine, session_id=session_id)


@router.post("/sessions/{session_id}/fork")
@router.post("/api/sessions/{session_id}/fork")
async def fork_session_endpoint(
    session_id: str, engine: DatabaseEngineDep, payload: ForkSessionPayload | None = None,
) -> dict[str, Any]:
    uid = payload.user_id if payload else "default_user"
    fork_title = payload.title if payload else None
    return await fork_session(engine=engine, session_id=session_id, user_id=uid, title=fork_title)


__all__ = [
    "CreateSessionRequest",
    "ForkSessionPayload",
    "RenameSessionPayload",
    "SteeringQueuePayload",
    "UndoPayload",
    "_get_engine",
    "_parse_epoch_seconds",
    "clean_protocol_sentinels",
    "clean_user_steering_envelope",
    "clear_session_queue",
    "create_session",
    "delete_session",
    "fork_session_endpoint",
    "generate_clean_session_title",
    "get_history",
    "get_session_queue",
    "get_session_transcript_bridge",
    "get_subagent_transcript",
    "get_transcript",
    "list_sessions",
    "list_sessions_by_project",
    "list_subagents",
    "mark_session_viewed",
    "messages_to_transcript_lines",
    "queue_session_steering",
    "rename_session",
    "router",
    "undo_session",
]
