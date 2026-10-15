from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from nexau.archs.session import AgentRunActionKey, AgentRunActionService
from nexau.archs.session.id_generator import generate_run_id, generate_session_id
from nexau.archs.session.models import AgentRunActionModel, SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.steering import clear_steering_messages

from app.models.project import ProjectModel
from app.paths import safe_rmtree_session_brain, scaffold_session_storage, validate_safe_id
from app.services.session_transcript import (
    _get_engine,
    _parse_epoch_seconds,
    generate_clean_session_title,
)

logger = logging.getLogger(__name__)


def _validate_id(ident: str | None, field: str = "session_id") -> None:
    if ident:
        try:
            validate_safe_id(ident, field)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e


def abort_session_execution(session_id: str, user_id: str = "default_user") -> None:
    clear_steering_messages(session_id)
    try:
        from app.routers.chat import get_sse_server
        srv = get_sse_server()
        if srv and hasattr(srv, "handle_stop_request"):
            import asyncio
            coro = srv.handle_stop_request(session_id=session_id, user_id=user_id, force=True)
            try:
                asyncio.get_running_loop().create_task(coro)
            except RuntimeError:
                asyncio.run(coro)
    except Exception as e:
        logger.warning(f"Error aborting execution for session {session_id}: {e}")


async def list_all_sessions(engine: Any, include_benchmarks: bool = False) -> dict[str, list[dict]]:
    eng = _get_engine(engine)
    if not eng:
        return {"sessions": []}
    try:
        db_sessions = await eng.find_many(SessionModel)
        session_stats: dict[str, dict[str, Any]] = {}
        try:
            async_eng = getattr(getattr(eng, "_inner", None), "_engine", None)
            if async_eng:
                from sqlalchemy import text
                async with async_eng.connect() as conn:
                    session_stats = {r[0]: {"count": r[1], "last_action_time": r[2]} for r in (await conn.execute(text("SELECT session_id, count(*), max(created_at_ns) FROM agent_run_actions GROUP BY session_id"))).fetchall()}
        except Exception:
            pass

        bench = ("benchmark", "bench", "par_", "subfunc_", "eval", "tatqa", "gaia", "stataudit", "l4_", "ssc_cgl", "unbiased", "qa_report", "nlp_batch")
        seen_sids, result = set(), []
        for s in db_sessions:
            sid = s.session_id
            if sid in seen_sids or (not include_benchmarks and any(p in sid.lower() for p in bench)):
                continue
            seen_sids.add(sid)
            ctx, stats = s.context or {}, session_stats.get(sid, {"count": 0, "last_action_time": None})
            msg_count = stats["count"]
            last_view_sec = _parse_epoch_seconds(ctx.get("last_user_view_time"))
            latest_sec = max(_parse_epoch_seconds(s.updated_at), _parse_epoch_seconds(ctx.get("updated_at")), _parse_epoch_seconds(stats.get("last_action_time")), _parse_epoch_seconds(s.created_at))
            updated_iso = datetime.fromtimestamp(latest_sec, tz=UTC).isoformat() if latest_sec > 0 else (s.updated_at.isoformat() if isinstance(s.updated_at, datetime) else str(s.updated_at or ""))
            ws = ctx.get("workspace_uri", "No Repo")
            sec = ctx.get("section") or ("workspace" if ws not in ("No Repo", "", None) else "conversation")

            result.append({
                "session_id": sid, "project_id": ctx.get("project_id"),
                "title": generate_clean_session_title(ctx.get("title") or ctx.get("custom_title") or f"Session {sid[:8]}", sid),
                "custom_title": ctx.get("custom_title"), "workspace_uri": ws, "working_directory": ctx.get("working_directory", ws),
                "section": sec, "message_count": msg_count, "total_tokens": ctx.get("total_tokens") or 0,
                "last_user_view_time": ctx.get("last_user_view_time"), "has_unread": (msg_count > 0 and last_view_sec > 0.0 and latest_sec > (last_view_sec + 3.0)),
                "updated_at": updated_iso, "created_at": s.created_at.isoformat() if isinstance(s.created_at, datetime) else str(s.created_at or ""),
                "_sort_key": latest_sec,
            })
        result.sort(key=lambda x: x.pop("_sort_key", 0.0), reverse=True)
        return {"sessions": result}
    except Exception as e:
        logger.warning(f"Error listing sessions: {e}")
        return {"sessions": []}


async def list_project_sessions(engine: Any, project_id: str) -> dict[str, list[dict]]:
    eng = _get_engine(engine)
    p = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("id", project_id)) or await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("name", project_id))
    t_id, t_name = (p.id if p else project_id), (p.name if p else project_id).lower()
    all_s = await eng.find_many(SessionModel)
    return {"sessions": [s for s in all_s if (s.context or {}).get("project_id") == t_id or ((s.context or {}).get("project_id") and str((s.context or {}).get("project_id")).lower() == t_name) or ((s.context or {}).get("workspace_uri", "").lower() == t_name)]}


async def create_new_session(
    engine: Any, user_id: str = "default_user", session_id: str | None = None,
    project_id: str | None = None, title: str = "New Chat",
    workspace_uri: str | None = None, section: str | None = None,
) -> dict[str, str]:
    _validate_id(session_id, "session_id")
    _validate_id(project_id, "project_id")
    eng, project = _get_engine(engine), None
    if project_id:
        project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("id", project_id)) or await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("name", project_id))
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    sid = session_id or generate_session_id()
    brain_path = scaffold_session_storage(sid, project.id if project else project_id)
    has_ws = workspace_uri not in ("No Repo", "", None) or project or project_id
    sec, ws_uri = section or ("workspace" if has_ws else "conversation"), workspace_uri or (project.name if project else "No Repo")
    work_dir = project.local_folder_path if project else (ws_uri if ws_uri != "No Repo" else None)
    if work_dir and os.path.exists(work_dir):
        out = os.path.join(work_dir, "NexAU_Outputs" if (os.path.exists(os.path.join(work_dir, "NexAU_Outputs")) and not os.path.exists(os.path.join(work_dir, "Audit_Deliverables"))) else "Audit_Deliverables")
        try:
            os.makedirs(out, exist_ok=True)
        except Exception:
            pass

    ctx = {"project_id": project.id if project else project_id, "title": title, "custom_title": title, "workspace_uri": ws_uri, "working_directory": work_dir, "section": sec, "brain_directory": str(brain_path), "scratch_directory": str(brain_path / "scratch")}
    from app.routers.chat import get_sse_server
    sm = getattr(get_sse_server(), "_session_manager", None) if get_sse_server else None
    if sm:
        _, sess = await sm.register_agent(user_id=user_id, session_id=sid, agent_name="nexau_main_auditor", is_root=True)
        sess.context = ctx
        await sm._update_session(sess)
    else:
        await eng.create(SessionModel(user_id=user_id, session_id=sid, context=ctx))
    return {"status": "success", "session_id": sid}


async def delete_existing_session(engine: Any, session_id: str) -> dict[str, str]:
    _validate_id(session_id, "session_id")
    eng = _get_engine(engine)
    if not eng:
        raise HTTPException(status_code=500, detail="Database engine unavailable")
    s = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    if not s:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")
    await eng.delete(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", session_id))
    await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    clear_steering_messages(session_id)
    try:
        safe_rmtree_session_brain(session_id, (s.context or {}).get("brain_directory"))
    except Exception as e:
        logger.warning(f"Session brain cleanup warning for {session_id}: {e}")
    return {"status": "success", "session_id": session_id}


async def rename_existing_session(engine: Any, session_id: str, title: str) -> dict[str, Any]:
    _validate_id(session_id, "session_id")
    eng, title_val = _get_engine(engine), (title.strip() if title else "Untitled Session")
    if eng:
        try:
            s = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
            if not s:
                return {"status": "not_found", "message": f"Session {session_id} does not exist"}
            ctx = dict(s.context or {})
            ctx["custom_title"] = ctx["title"] = title_val
            s.context = ctx
            await eng.update(s)
        except Exception as e:
            logger.warning(f"Rename session error: {e}")
    return {"status": "success", "custom_title": title}


async def mark_session_as_viewed(engine: Any, session_id: str) -> dict[str, Any]:
    _validate_id(session_id, "session_id")
    eng, now_iso = _get_engine(engine), datetime.now(UTC).isoformat()
    if eng:
        try:
            s = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
            if s:
                ctx = dict(s.context or {})
                ctx["last_user_view_time"] = now_iso
                s.context = ctx
                await eng.update(s)
        except Exception as e:
            logger.warning(f"Error updating session view time: {e}")
    return {"status": "success", "session_id": session_id, "last_user_view_time": now_iso, "has_unread": False}


async def undo_session_turn(engine: Any, session_id: str, from_turn: int = 0) -> dict[str, Any]:
    _validate_id(session_id, "session_id")
    eng = _get_engine(engine)
    if not eng:
        return {"status": "success", "deleted": 0}
    try:
        actions = sorted(await eng.find_many(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", session_id)), key=lambda a: getattr(a, "created_at_ns", 0) or 0)
        user_turn_count, target_run_id = 0, None
        for a in actions:
            act = getattr(a, "action_type", "")
            if (act.value if hasattr(act, "value") else str(act)) not in ("append", "replace"):
                continue
            msgs = a.append_messages or a.replace_messages or []
            if any(getattr(m, "role", None) == "user" or (isinstance(m, dict) and m.get("role") == "user") for m in msgs):
                if user_turn_count >= from_turn:
                    target_run_id = getattr(a, "run_id", "")
                    break
                user_turn_count += 1
        if not target_run_id:
            return {"status": "success", "deleted": 0}
        s = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
        uid, root_agent = (s.user_id if s and s.user_id else "default_user"), (s.root_agent_id if s and s.root_agent_id else "main_agent")
        undo_id = generate_run_id()
        await AgentRunActionService(engine=eng).persist_undo(key=AgentRunActionKey(user_id=uid, session_id=session_id, agent_id=root_agent), run_id=undo_id, root_run_id=undo_id, undo_before_run_id=target_run_id)
        return {"status": "success", "deleted": 1, "undone_run_id": target_run_id}
    except Exception as e:
        logger.warning(f"Undo error for session {session_id}: {e}")
        return {"status": "success", "deleted": 0}


async def fork_session(engine: Any, session_id: str, user_id: str = "default_user", title: str | None = None) -> dict[str, Any]:
    _validate_id(session_id, "session_id")
    eng = _get_engine(engine)
    src = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    if not src:
        raise HTTPException(status_code=404, detail=f"Source session '{session_id}' not found")
    new_sid, ctx = generate_session_id(), dict(src.context or {})
    fork_title = title or f"Fork of {ctx.get('title') or session_id[:8]}"
    ctx["title"] = ctx["custom_title"] = fork_title
    brain_path = scaffold_session_storage(new_sid, ctx.get("project_id"))
    ctx["brain_directory"], ctx["scratch_directory"] = str(brain_path), str(brain_path / "scratch")
    await eng.create(SessionModel(user_id=user_id, session_id=new_sid, context=ctx))
    actions = sorted(await eng.find_many(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", session_id)), key=lambda x: getattr(x, "created_at_ns", 0) or 0)
    for a in actions:
        await eng.create(AgentRunActionModel(
            user_id=user_id, session_id=new_sid, agent_id=a.agent_id, run_id=generate_run_id(),
            root_run_id=a.root_run_id, action_type=a.action_type, append_messages=a.append_messages, replace_messages=a.replace_messages,
        ))
    return {"status": "success", "session_id": new_sid, "forked_from": session_id, "title": fork_title}
