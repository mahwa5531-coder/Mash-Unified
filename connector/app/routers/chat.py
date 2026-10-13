import asyncio
import copy
import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.sandbox.base_sandbox import LocalSandboxConfig
from nexau.archs.session.id_generator import generate_session_id
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.transports.http.sse_server import SSETransportServer
from pydantic import BaseModel

from app.dependencies import get_engine
from app.models.project import ProjectModel
from app.paths import (
    resolve_deliverables_dir,
    resolve_sandbox_work_dir,
    validate_safe_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_sse_server: SSETransportServer | None = None


def get_sse_server() -> SSETransportServer:
    if _sse_server is None:
        raise HTTPException(status_code=503, detail="SSETransportServer not initialized")
    return _sse_server


class StreamQueryPayload(BaseModel):
    session_id: str | None = None
    messages: str = ""
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
    from app.paths import scaffold_session_storage, scaffold_workspace_storage

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

        now_utc = datetime.now(UTC)
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
                    "permission_mode": resolved_context.get("permission_mode", "default"),
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
            if resolved_context.get("permission_mode"):
                ctx["permission_mode"] = resolved_context["permission_mode"]
            elif not ctx.get("permission_mode"):
                ctx["permission_mode"] = "default"
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
    try:
        validate_safe_id(sid, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    resolved_context = payload.context or {}
    workspace_target = resolved_context.get("workspace_uri", "No Repo")
    resolved_context["_raw_message"] = payload.messages  # for title extraction

    # Ensure live valid token for cloud gateway dispatch FIRST before any database state is written (DEF-10)
    from app.routers.auth import ensure_valid_token
    live_token = await ensure_valid_token()
    mash_env = os.getenv("MASH_ENV", "production").lower()
    auth_required = os.getenv("MASH_AUTH_REQUIRED", "").lower() in ("true", "1", "yes") or mash_env == "production"
    if auth_required and (not live_token or live_token == "bearer-pending-auth"):
        raise HTTPException(status_code=401, detail="Authentication required. Please sign in to MASH.")

    try:
        eng = get_engine()
    except Exception:
        eng = None

    await _ensure_project_and_context(eng, user_id, sid, resolved_context, workspace_target)
    resolved_context.pop("_raw_message", None)

    # Clean user prompt: keep raw message unmutated. Editor context is handled natively via Jinja system prompt.
    user_prompt = payload.messages

    effective_agent_config = server._default_agent_config

    if live_token and effective_agent_config and effective_agent_config.llm_config:
        target_model = effective_agent_config.llm_config.model or "mash/auto"
        if effective_agent_config.llm_config.api_key != live_token or effective_agent_config.llm_config.model != target_model:
            new_llm = copy.copy(effective_agent_config.llm_config)
            new_llm.api_key = live_token
            new_llm.model = target_model
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

    # Configure tool permissions according to session permission_mode
    perm_mode = str(resolved_context.get("permission_mode") or "default").lower()
    if effective_agent_config and effective_agent_config.tools:
        configured_tools = []
        for t in effective_agent_config.tools:
            t_copy = copy.copy(t)
            if perm_mode == "turbo":
                t_copy.permissions = {"allow": ["**"], "deny": []}
            elif perm_mode == "review":
                t_copy.permissions = {"allow": [], "deny": []}
            else:
                # "default": sensitive operations ask for approval; read-only tools run automatically
                if t.name in ("run_shell_command", "write_file", "replace_file_content", "web_fetch"):
                    t_copy.permissions = {"allow": [], "deny": []}
                else:
                    t_copy.permissions = {"allow": ["**"], "deny": []}
            configured_tools.append(t_copy)
        effective_agent_config = effective_agent_config.model_copy(update={"tools": configured_tools})

    # Wire permission mode into SQLite permission_rules so NexAU's executor honors it (Chain 4)
    sm = getattr(server, "_session_manager", None)
    if sm and sid and configured_tools:
        try:
            if eng:
                from nexau.archs.session.models.permission_rule import PermissionRuleModel
                from nexau.archs.session.orm import AndFilter
                await eng.delete_many(
                    PermissionRuleModel,
                    filters=AndFilter(filters=[
                        ComparisonFilter.eq("user_id", user_id),
                        ComparisonFilter.eq("session_id", sid),
                        ComparisonFilter.eq("source", "config"),
                    ]),
                )
            await sm.init_permission_rules_from_config(
                user_id=user_id,
                session_id=sid,
                tools=configured_tools,
            )
        except Exception as perm_err:
            logger.debug("Error initializing permission rules from config: %s", perm_err)

    # When resuming on approval without new user text, pass message=[] (empty list)
    # so NexAU does not append an empty user bubble to history (Chain 3)
    effective_message: str | list = user_prompt if user_prompt.strip() else []

    async def sse_event_stream():
        # ponytail: 15s SSE heartbeat comment keeps wire alive during long tool runs (>60s)
        event_iter = server.handle_streaming_request(
            message=effective_message,
            user_id=user_id,
            agent_config=effective_agent_config,
            session_id=sid,
            context=resolved_context,
            variables=ContextValue(template={k: v if isinstance(v, str) else json.dumps(v) for k, v in resolved_context.items()}),
        ).__aiter__()

        # ponytail: shield-and-re-await pattern prevents 15s SSE heartbeat timeout
        # from cancelling the underlying NexAU generator during long model/tool runs (Blocker B-4)
        anext_task = asyncio.ensure_future(event_iter.__anext__())

        try:
            while True:
                if await request.is_disconnected():
                    anext_task.cancel()
                    raise asyncio.CancelledError("Client disconnected")

                try:
                    event = await asyncio.wait_for(asyncio.shield(anext_task), timeout=15.0)
                    yield f"data: {event.model_dump_json()}\n\n"
                    anext_task = asyncio.ensure_future(event_iter.__anext__())
                except TimeoutError:
                    yield ": heartbeat\n\n"
                except StopAsyncIteration:
                    try:
                        sm = getattr(server, "_session_manager", None)
                        if sm and sid:
                            pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=sid)
                            if pending:
                                for ptc_id, ptc_val in pending.items():
                                    if not ptc_val.get("decision"):
                                        pending_event = {
                                            "type": "TOOL_CALL_PENDING_APPROVAL",
                                            "tool_call_id": ptc_id,
                                            "tool_name": ptc_val.get("tool_name", "action"),
                                            "prompt": ptc_val.get("prompt", ""),
                                            "permission_key": ptc_val.get("permission_key", ""),
                                            "parameters": ptc_val.get("parameters", {}),
                                        }
                                        yield f"data: {json.dumps(pending_event)}\n\n"
                    except Exception as pend_err:
                        logger.debug("Error checking pending tool calls: %s", pend_err)
                    break
        except (asyncio.CancelledError, GeneratorExit):
            if not anext_task.done():
                anext_task.cancel()
            # ponytail: Client disconnected mid-stream — terminate running agent immediately to prevent wasted execution/token burn
            logger.info("Client disconnected from stream for session %s. Terminating running agent immediately.", sid)
            try:
                await server.handle_stop_request(user_id=user_id, session_id=sid, force=True)
            except Exception as stop_err:
                logger.warning("Error stopping agent on client disconnect: %s", stop_err)
            raise
        finally:
            if not anext_task.done():
                anext_task.cancel()
            # ponytail: only app-specific post-stream work — sync last_user_view_time
            # so the sidebar's "unread" blue dot doesn't false-fire. NexAU has no UI concept of "unread".
            try:
                if eng:
                    async def _shielded_view_sync():
                        cur_sess = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", sid))
                        if cur_sess:
                            now_utc = datetime.now(UTC)
                            cur_sess.updated_at = now_utc
                            ctx = dict(cur_sess.context or {})
                            ctx["updated_at"] = now_utc.isoformat()
                            cur_sess.context = ctx
                            await eng.update(cur_sess)
                    await asyncio.shield(_shielded_view_sync())
            except (asyncio.CancelledError, Exception) as ex:
                logger.debug("Session update skipped or cancelled: %s", ex)

            # ponytail: clear consumed mid-flight steering mailbox so stale instructions don't leak into NEXT run (Issue E-1)
            try:
                from nexau.archs.session.steering import clear_steering_messages
                clear_steering_messages(sid)
            except Exception:
                pass

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
    if sid:
        try:
            validate_safe_id(sid, "session_id")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
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
    action: str  # "proceed", "reject", "allow", "allow_once", "deny"
    tool_call_id: str | None = None
    feedback: str | None = None
    user_id: str | None = "default_user"


class PermissionModePayload(BaseModel):
    mode: str  # "turbo" | "default" | "review"


@router.post("/approve")
@router.post("/api/chat/approve")
@router.post("/sessions/{session_id}/approve")
@router.post("/api/chat/{session_id}/approve")
async def approve_plan_bridge(
    payload: PlanApprovalPayload,
    session_id: str | None = None,
):
    """Bridge for tool permission resolution and manual plan approval.
    
    Wires directly to NexAU's SessionManager to update pending tool calls and
    persist user rules into SQLite's permission_rules table.
    """
    sid = session_id or payload.session_id or ""
    if sid:
        try:
            validate_safe_id(sid, "session_id")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    uid = payload.user_id or "default_user"
    raw_action = (payload.action or "proceed").lower()

    # Map frontend / test actions to NexAU permission decisions
    if raw_action in ("allow", "always_allow"):
        decision = "allow"
    elif raw_action in ("deny", "reject"):
        decision = "deny"
    else:
        decision = "allow_once"

    # Wire to NexAU SessionManager when session ID is provided
    try:
        server = get_sse_server()
        sm = getattr(server, "_session_manager", None)
        if sm and sid:
            pending = await sm.get_pending_tool_calls(user_id=uid, session_id=sid)
            if pending:
                target_tc_id = payload.tool_call_id
                if not target_tc_id and len(pending) == 1:
                    target_tc_id = next(iter(pending.keys()))

                # ponytail: match raw vs run_-prefixed tool_call_id (Blocker B-2)
                if target_tc_id and target_tc_id not in pending:
                    for pk in pending.keys():
                        if target_tc_id.endswith(f"_{pk}") or pk.endswith(f"_{target_tc_id}") or pk == target_tc_id:
                            target_tc_id = pk
                            break

                if target_tc_id and target_tc_id in pending:
                    entry = pending[target_tc_id]
                    entry["decision"] = decision
                    if payload.feedback:
                        entry["feedback"] = payload.feedback

                    # "allow" persists permanently to SQLite permission_rules table
                    if decision == "allow":
                        await sm.save_permission_rule(
                            user_id=uid,
                            session_id=sid,
                            tool_name=entry.get("tool_name", ""),
                            rule_content=entry.get("permission_key", ""),
                            behavior="allow",
                            source="user",
                        )

                    await sm.update_pending_tool_calls(
                        user_id=uid,
                        session_id=sid,
                        pending_tool_calls=pending,
                    )
    except Exception as ex:
        logger.warning("Error resolving permission for session %s: %s", sid, ex)

    # Return structure preserves MANUAL_APPROVAL and execution_mode for existing tests
    return {
        "status": "success",
        "MANUAL_APPROVAL": True,
        "action": payload.action,
        "execution_mode": payload.action,
        "tool_call_id": payload.tool_call_id,
    }


@router.post("/api/sessions/{session_id}/permissions/mode")
@router.post("/sessions/{session_id}/permissions/mode")
async def update_session_permission_mode(session_id: str, payload: PermissionModePayload):
    """Set the runtime tool permission mode for a session ('turbo', 'default', 'review')."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = get_engine()
    if not eng:
        raise HTTPException(status_code=500, detail="Database engine unavailable")

    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    clean_mode = payload.mode.lower()
    if clean_mode not in ("turbo", "default", "review"):
        raise HTTPException(status_code=400, detail="Mode must be 'turbo', 'default', or 'review'")

    ctx = dict(session.context or {})
    ctx["permission_mode"] = clean_mode
    session.context = ctx
    await eng.update(session)
    return {"status": "success", "session_id": session_id, "permission_mode": clean_mode}


@router.get("/api/sessions/{session_id}/permissions")
@router.get("/sessions/{session_id}/permissions")
async def get_session_permissions(session_id: str, user_id: str = "default_user"):
    """Retrieve active permission mode and any pending tool calls for a session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = get_engine()
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None
    ctx = session.context or {} if session else {}
    server = get_sse_server()
    sm = getattr(server, "_session_manager", None)
    pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id) if sm else {}

    return {
        "session_id": session_id,
        "permission_mode": ctx.get("permission_mode", "default"),
        "pending_tool_calls": pending or {},
    }
