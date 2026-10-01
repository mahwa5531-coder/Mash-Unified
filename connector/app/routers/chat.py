import os
import json
import copy
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.sandbox.base_sandbox import LocalSandboxConfig
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.id_generator import generate_session_id
from nexau.archs.transports.http.sse_server import SSETransportServer
from nexau.archs.platform.path_helpers import resolve_deliverables_dir, resolve_sandbox_work_dir
from app.dependencies import get_engine
from app.models.project import ProjectModel

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_sse_server: SSETransportServer | None = None


def get_sse_server() -> SSETransportServer:
    if _sse_server is None:
        raise HTTPException(status_code=503, detail="SSETransportServer not initialized")
    return _sse_server


class StreamQueryPayload(BaseModel):
    session_id: str | None = None
    messages: str
    context: dict | None = None
    variables: dict | None = None
    user_id: str | None = "default_user"


async def _ensure_project_and_context(
    eng, user_id: str, sid: str, resolved_context: dict, workspace_target: str
) -> None:
    """App-specific prep: auto-create project, scaffold storage, enrich context.

    NexAU handles session creation itself via SessionManager._get_or_create_session().
    This function only prepares the *context dict* that NexAU will store.
    """
    from nexau.archs.platform.path_helpers import scaffold_session_storage, scaffold_workspace_storage

    project_id = resolved_context.get("project_id")

    # Scaffold brain/scratch dirs
    brain_path = scaffold_session_storage(sid, project_id)
    resolved_context["brain_directory"] = str(brain_path)
    resolved_context["scratch_directory"] = str(brain_path / "scratch")
    resolved_context["cache_directory"] = str(brain_path / "cache")
    resolved_context["session_id"] = sid
    if not resolved_context.get("working_directory"):
        resolved_context["working_directory"] = workspace_target

    if workspace_target and workspace_target != "No Repo" and os.path.exists(workspace_target):
        try:
            scaffold_workspace_storage(workspace_target)
        except Exception:
            pass

    if not eng:
        return

    # Auto-create ProjectModel from workspace path (app-specific, NexAU has no project concept)
    try:
        if workspace_target and workspace_target != "No Repo":
            existing_proj = None
            if os.path.exists(workspace_target):
                target_path = str(Path(workspace_target).resolve())
                existing_proj = await eng.find_first(
                    ProjectModel, filters=ComparisonFilter.eq("local_folder_path", target_path)
                )
            if not existing_proj:
                existing_proj = await eng.find_first(
                    ProjectModel, filters=ComparisonFilter.eq("name", workspace_target)
                )
            if not existing_proj and os.path.exists(workspace_target):
                target_path = str(Path(workspace_target).resolve())
                existing_proj = ProjectModel(
                    user_id=user_id, name=Path(target_path).name, local_folder_path=target_path,
                )
                await eng.create(existing_proj)

            if existing_proj:
                project_id = existing_proj.id
                resolved_context["project_id"] = project_id
                resolved_context["workspace_uri"] = existing_proj.name
                resolved_context["working_directory"] = existing_proj.local_folder_path
                brain_path = scaffold_session_storage(sid, project_id)
                resolved_context["brain_directory"] = str(brain_path)
                resolved_context["scratch_directory"] = str(brain_path / "scratch")
    except Exception as e:
        logger.warning("Project auto-create error: %s", e)

    # ponytail: NexAU's _get_or_create_session creates a bare SessionModel with no context.
    # The sidebar needs title, workspace_uri, section, last_user_view_time etc.
    # So we pre-create/update the session with app-specific metadata. When NexAU's
    # _get_or_create_session runs, it'll find our session and reuse it.
    try:
        clean_title = resolved_context.get("_raw_message", "")[:35].replace("\n", " ").strip()
        title_val = resolved_context.get("title") or resolved_context.get("custom_title") or clean_title or f"Session {sid[:8]}"
        resolved_context["title"] = title_val
        resolved_context["custom_title"] = title_val
        if "section" not in resolved_context:
            resolved_context["section"] = "workspace" if workspace_target != "No Repo" else "conversation"

        now_utc = datetime.now(timezone.utc)
        resolved_context["last_user_view_time"] = now_utc.isoformat()

        session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
        if not session:
            session = SessionModel(
                session_id=sid, user_id=user_id,
                created_at=now_utc, updated_at=now_utc,
                context={
                    "title": title_val, "custom_title": title_val,
                    "workspace_uri": resolved_context.get("workspace_uri", workspace_target),
                    "working_directory": resolved_context["working_directory"],
                    "section": resolved_context.get("section"),
                    "project_id": resolved_context.get("project_id"),
                    "brain_directory": resolved_context["brain_directory"],
                    "scratch_directory": resolved_context["scratch_directory"],
                    "updated_at": now_utc.isoformat(),
                    "last_user_view_time": now_utc.isoformat(),
                },
            )
            await eng.create(session)
        else:
            session.updated_at = now_utc
            ctx = dict(session.context or {})
            ctx["updated_at"] = now_utc.isoformat()
            if not ctx.get("title"):
                ctx["title"] = title_val
                ctx["custom_title"] = title_val
            session.context = ctx
            await eng.update(session)
            # Merge stored keys we don't already have
            for k, v in ctx.items():
                if k not in resolved_context:
                    resolved_context[k] = v
    except Exception as e:
        logger.warning("Session context enrichment error: %s", e)


@router.post("/stream")
@router.post("/api/chat/stream")
@router.post("/api/chat/{path_session_id}/stream")
async def stream_query_bridge(
    payload: StreamQueryPayload,
    request: Request,
    path_session_id: str | None = None,
):
    """SSE stream bridge: app-specific prep then clean delegation to NexAU runtime."""
    server = get_sse_server()
    user_id = payload.user_id or "default_user"
    sid = path_session_id or payload.session_id or generate_session_id()

    resolved_context = payload.context or {}
    workspace_target = resolved_context.get("workspace_uri", "No Repo")
    resolved_context["_raw_message"] = payload.messages  # for title extraction

    try:
        eng = get_engine()
    except Exception:
        eng = None

    await _ensure_project_and_context(eng, user_id, sid, resolved_context, workspace_target)
    resolved_context.pop("_raw_message", None)

    # Clean user prompt: keep raw message unmutated. Editor context is handled natively via Jinja system prompt.
    user_prompt = payload.messages

    effective_agent_config = server._default_agent_config
    
    # Ensure live valid token for cloud gateway dispatch
    from app.routers.auth import ensure_valid_token
    live_token = await ensure_valid_token()
    if live_token and effective_agent_config and effective_agent_config.llm_config:
        if effective_agent_config.llm_config.api_key != live_token:
            new_llm = copy.copy(effective_agent_config.llm_config)
            new_llm.api_key = live_token
            effective_agent_config = effective_agent_config.model_copy(update={"llm_config": new_llm})

    # Per-session sandbox work_dir & deliverables binding via NexAU path helpers
    target_work_dir = resolve_sandbox_work_dir(
        resolved_context.get("working_directory"),
        resolved_context.get("scratch_directory"),
        resolved_context.get("brain_directory"),
    )
    resolved_context["outputs_directory"] = str(
        resolve_deliverables_dir(
            resolved_context.get("working_directory"),
            resolved_context.get("brain_directory"),
        )
    )
    cur_sb = getattr(effective_agent_config, "sandbox_config", None)
    new_sb = cur_sb.model_copy(update={"work_dir": target_work_dir}) if cur_sb else LocalSandboxConfig(work_dir=target_work_dir)
    effective_agent_config = effective_agent_config.model_copy(update={"sandbox_config": new_sb})

    # ponytail: NexAU's handle_streaming_request already handles:
    # - Session creation (SessionManager._get_or_create_session)
    # - Agent lifecycle (create, run, stop on disconnect)
    # - Lock acquisition & release (TransportBase.finally: block)
    # - Error events (SSETransportServer._stream_agent_response catches & yields TransportErrorEvent)
    # We just yield events and sync last_user_view_time for the unread badge.

    async def sse_event_stream():
        try:
            async for event in server.handle_streaming_request(
                message=user_prompt,
                user_id=user_id,
                agent_config=effective_agent_config,
                session_id=sid,
                context=resolved_context,
                variables=ContextValue(template={k: v if isinstance(v, str) else json.dumps(v) for k, v in resolved_context.items()}),
            ):
                if await request.is_disconnected():
                    raise asyncio.CancelledError("Client disconnected")
                yield f"data: {event.model_dump_json()}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            # ponytail: Client disconnected mid-stream — terminate running agent immediately to prevent wasted execution/token burn
            logger.info("Client disconnected from stream for session %s. Terminating running agent immediately.", sid)
            try:
                await server.handle_stop_request(user_id=user_id, session_id=sid, force=True)
            except Exception as stop_err:
                logger.warning("Error stopping agent on client disconnect: %s", stop_err)
            raise
        finally:
            # ponytail: only app-specific post-stream work — sync last_user_view_time
            # so the sidebar's "unread" blue dot doesn't false-fire. NexAU has no UI concept of "unread".
            try:
                if eng:
                    async def _shielded_view_sync():
                        cur_sess = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
                        if cur_sess:
                            now_utc = datetime.now(timezone.utc)
                            cur_sess.updated_at = now_utc
                            ctx = dict(cur_sess.context or {})
                            ctx["updated_at"] = now_utc.isoformat()
                            ctx["last_user_view_time"] = now_utc.isoformat()
                            cur_sess.context = ctx
                            await eng.update(cur_sess)
                    await asyncio.shield(_shielded_view_sync())
            except (asyncio.CancelledError, Exception) as ex:
                logger.debug("Session view time update skipped or cancelled: %s", ex)

    return StreamingResponse(
        sse_event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


class StopPayload(BaseModel):
    session_id: str | None = None
    user_id: str = "default_user"
    agent_id: str | None = None
    force: bool = True
    timeout: float | None = 15.0


@router.post("/stop")
@router.post("/api/chat/stop")
@router.post("/sessions/{session_id}/stop")
@router.post("/api/chat/{session_id}/stop")
async def stop_agent_bridge(
    payload: StopPayload | None = None,
    session_id: str | None = None,
):
    """Stop a running agent. NexAU's handle_stop_request does the real work."""
    server = get_sse_server()
    sid = (payload.session_id if payload else None) or session_id or ""
    uid = (payload.user_id if payload else "default_user")
    stop_reason = "stopped"
    try:
        result = await server.handle_stop_request(
            user_id=uid,
            session_id=sid,
            agent_id=payload.agent_id if payload else None,
            force=payload.force if payload is not None else True,
            timeout=payload.timeout if payload is not None else 15.0,
        )
        stop_reason = getattr(result, "stop_reason", "stopped")
    except Exception as e:
        logger.warning("handle_stop_request error for session %s: %s", sid, e)
    # ponytail: removed manual AgentLockModel force-delete that was here.
    # NexAU's TransportBase.handle_streaming_request.finally: already cleans up
    # running agents, and AgentLockService has TTL auto-expiry. The manual delete
    # was racing with NexAU's own cleanup and causing spurious lock errors.
    return {"status": "success", "stop_reason": str(stop_reason)}


class PlanApprovalPayload(BaseModel):
    session_id: str | None = None
    action: str
    feedback: str | None = None


@router.post("/approve")
@router.post("/api/chat/approve")
@router.post("/sessions/{session_id}/approve")
@router.post("/api/chat/{session_id}/approve")
async def approve_plan_bridge(
    payload: PlanApprovalPayload,
    session_id: str | None = None,
):
    return {"status": "success", "MANUAL_APPROVAL": True, "execution_mode": payload.action}