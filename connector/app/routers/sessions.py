import logging
import os
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException
from nexau.archs.session import AgentRunActionKey, AgentRunActionService
from nexau.archs.session.id_generator import generate_run_id, generate_session_id
from nexau.archs.session.models import AgentRunActionModel, SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.steering import (
    clear_steering_messages,
    peek_steering_messages,
    queue_steering_message,
)
from nexau.core.messages import Message, TextBlock, ToolResultBlock, ToolUseBlock
from pydantic import BaseModel

from app.dependencies import DatabaseEngineDep
from app.models.project import ProjectModel
from app.paths import (
    safe_rmtree_session_brain,
    validate_safe_id,
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


class RenameSessionPayload(BaseModel):
    custom_title: str | None = None
    title: str | None = None

    @property
    def effective_title(self) -> str:
        return (self.custom_title or self.title or "").strip()



class UndoPayload(BaseModel):
    from_turn: int = 0


class SteeringQueuePayload(BaseModel):
    message: str
    session_id: str | None = None


def _get_engine(engine: Any = None):
    if engine is not None:
        return engine
    from app.dependencies import _engine as global_eng
    return global_eng


def generate_clean_session_title(raw_text: str, sid: str = "") -> str:
    """ponytail: concise session title generator without over-engineered regex soup."""
    if not raw_text or not isinstance(raw_text, str):
        return f"Session {sid[:8]}" if sid else "New Session"
    t = raw_text.strip().strip("\"'` \t\n\r")
    if not t:
        return f"Session {sid[:8]}" if sid else "New Session"

    # If starts with path or contains file separator, extract basename
    if re.match(r'^([a-zA-Z]:[\\/]|/)', t) or "\\" in t:
        parts = [p for p in re.split(r'[\\/]', t) if p]
        if parts:
            t = parts[-1].strip("\"'` \t\n\r,:;-")

    # Strip conversational filler prefixes
    filler_re = (
        r'^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|'
        r'i want to\s+|i need to\s+|tell me about\s+|what is\s+|how to\s+)+'
    )
    t = re.sub(filler_re, '', t, flags=re.IGNORECASE).strip()
    t = re.sub(r'[?!.:;]+$', '', t).strip()
    if not t:
        return f"Session {sid[:8]}" if sid else "New Session"

    if len(t) > 34:
        sp = t[:34].rfind(" ")
        t = (t[:sp] if sp > 12 else t[:34]).rstrip() + "..."
    return t[:1].upper() + t[1:]


def clean_user_steering_envelope(text: str) -> str:
    """ponytail: Strip internal mid-flight steering protocol envelope from user prompt text."""
    if not text or not isinstance(text, str):
        return text or ""
    if "<USER_STEERING>" in text or "[USER MID-FLIGHT INSTRUCTION]:" in text or "</USER_STEERING>" in text:
        steering_pat = (
            r'<USER_STEERING>\s*(?:\[USER MID-FLIGHT INSTRUCTION\]:)?\s*([\s\S]*?)'
            r'(?:\s*Adapt your current plan and respond to this instruction immediately\.?)?\s*</USER_STEERING>'
        )
        m = re.search(steering_pat, text, re.IGNORECASE)
        if m and m.group(1).strip():
            return m.group(1).strip()
        cleaned = re.sub(r'</?USER_STEERING>', '', text, flags=re.IGNORECASE)
        cleaned = re.sub(r'\[USER MID-FLIGHT INSTRUCTION\]:\s*', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'Adapt your current plan and respond to this instruction immediately\.?', '', cleaned, flags=re.IGNORECASE)
        return cleaned.strip()
    return text


def clean_protocol_sentinels(text: str) -> str:
    """ponytail: strip [DONE]/[END] protocol sentinels, prompt tags, and heading wrappers."""
    if not text or not isinstance(text, str):
        return text or ""
    sentinel_pat = r'</?(?:user[\s_]+message|assistant[\s_]+message|task_result|user_rules|user_information|identity)>\s*'
    cleaned = re.sub(sentinel_pat, '', text, flags=re.IGNORECASE)
    cleaned = re.sub(r'^(?:#+\s*)?(?:User|Assistant)\s+Message\s*:\s*$', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r'(?:^|\n)\s*\[(?:DONE|END|done|end)\]\s*(?=\n|$)', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'(\s*\[(?:DONE|END|done|end)\]\s*)+$', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _parse_epoch_seconds(val: Any) -> float:
    """Parse any datetime, ISO string, timestamp (ns, ms, sec) into unix epoch float seconds (UTC)."""
    if not val:
        return 0.0
    now = datetime.now(UTC).timestamp()
    parsed = 0.0
    if isinstance(val, (int, float)):
        # Range classification:
        # > 1e16 -> nanoseconds (e.g. 1.7e18 / 1e9 = 1.7e9)
        # > 1e13 -> microseconds (e.g. 1.7e15 / 1e6 = 1.7e9)
        # > 1e10 -> milliseconds (e.g. 1.7e12 / 1e3 = 1.7e9)
        # > 1e8  -> seconds (e.g. 1.7e9)
        if val > 1e16:
            parsed = float(val) / 1e9
        elif val > 1e13:
            parsed = float(val) / 1e6
        elif val > 1e10:
            parsed = float(val) / 1e3
        elif val > 1e8:
            parsed = float(val)
        else:
            return 0.0
    elif isinstance(val, datetime):
        if val.tzinfo is None:
            parsed = val.astimezone(UTC).timestamp()
        else:
            parsed = val.timestamp()
    else:
        try:
            s = str(val).strip().replace(" ", "T")
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                parsed = dt.astimezone(UTC).timestamp()
            else:
                parsed = dt.timestamp()
        except Exception:
            try:
                num = float(val)
                return _parse_epoch_seconds(num)
            except Exception:
                return 0.0

    # Guard against corrupt future dates (e.g. 2033 or beyond): clamp to now + 60s
    if parsed > (now + 60.0):
        parsed = now
    return parsed


# ──────────────────────────────────────────────
# List Sessions (Both /sessions and /api/sessions)
# ──────────────────────────────────────────────
@router.get("/sessions")
@router.get("/api/sessions")
async def list_sessions(
    engine: DatabaseEngineDep,
    include_benchmarks: bool = False,
):
    """Top-level session list with live view-tracking, unread indicators, and section classification."""
    eng = _get_engine(engine)
    if not eng:
        return {"sessions": []}
    try:
        db_sessions = await eng.find_many(SessionModel)

        # Build action and message count map per session using fast aggregate index scan
        session_stats: dict[str, dict[str, Any]] = {}
        try:
            # ponytail: Fast aggregate query avoiding O(N*M) memory load of all action rows
            async_engine = getattr(getattr(eng, "_inner", None), "_engine", None)
            if async_engine:
                from sqlalchemy import text
                async with async_engine.connect() as conn:
                    query = text("SELECT session_id, count(*), max(created_at_ns) FROM agent_run_actions GROUP BY session_id")
                    q_res = await conn.execute(query)
                    for row in q_res.fetchall():
                        session_stats[row[0]] = {"count": row[1], "last_action_time": row[2]}
        except Exception:
            pass

        bench_patterns = (
            "benchmark", "bench", "par_", "subfunc_", "eval", "tatqa",
            "gaia", "stataudit", "l4_", "ssc_cgl", "unbiased", "qa_report",
            "nlp_batch"
        )

        seen_sids = set()
        result = []
        for s in db_sessions:
            sid = s.session_id
            if sid in seen_sids:
                continue
            if not include_benchmarks and any(p in sid.lower() for p in bench_patterns):
                continue
            seen_sids.add(sid)

            ctx = s.context or {}
            stats = session_stats.get(sid, {"count": 0, "last_action_time": None})
            msg_count = stats["count"]
            last_view_time = ctx.get("last_user_view_time")

            # Parse timestamps as epoch seconds
            last_view_sec = _parse_epoch_seconds(last_view_time)
            s_upd_sec = _parse_epoch_seconds(s.updated_at)
            ctx_upd_sec = _parse_epoch_seconds(ctx.get("updated_at"))
            action_sec = _parse_epoch_seconds(stats.get("last_action_time"))
            created_sec = _parse_epoch_seconds(s.created_at)

            latest_activity_sec = max(s_upd_sec, ctx_upd_sec, action_sec, created_sec)
            if latest_activity_sec > 0:
                updated_iso = datetime.fromtimestamp(latest_activity_sec, tz=UTC).isoformat()
            else:
                updated_iso = s.updated_at.isoformat() if isinstance(s.updated_at, datetime) else str(s.updated_at or "")

            # Determine has_unread status:
            # Has unread activity only if messages exist and valid last_view_time is recorded and activity happened after
            has_unread = False
            if msg_count > 0 and last_view_sec > 0.0:
                if latest_activity_sec > (last_view_sec + 3.0):
                    has_unread = True

            stored_section = ctx.get("section")
            workspace_uri = ctx.get("workspace_uri", "No Repo")
            if stored_section:
                section = stored_section
            else:
                is_workspace = workspace_uri not in ("No Repo", "", None)
                section = "workspace" if is_workspace else "conversation"

            result.append({
                "session_id": sid,
                "project_id": ctx.get("project_id"),
                "title": generate_clean_session_title(ctx.get("title") or ctx.get("custom_title") or f"Session {sid[:8]}", sid),
                "custom_title": ctx.get("custom_title"),
                "workspace_uri": workspace_uri,
                "working_directory": ctx.get("working_directory", workspace_uri),
                "section": section,
                "message_count": msg_count,
                "total_tokens": ctx.get("total_tokens") or 0,
                "last_user_view_time": last_view_time,
                "has_unread": has_unread,
                "updated_at": updated_iso,
                "created_at": s.created_at.isoformat() if isinstance(s.created_at, datetime) else str(s.created_at or ""),
                "_sort_key": latest_activity_sec,
            })

        # Sort newest updated sessions first
        result.sort(key=lambda x: x.get("_sort_key", 0.0), reverse=True)
        for item in result:
            item.pop("_sort_key", None)
        return {"sessions": result}
    except Exception as e:
        logger.warning(f"Error listing sessions: {e}")
        return {"sessions": []}


# ──────────────────────────────────────────────
# Create Session
# ──────────────────────────────────────────────
@router.post("/sessions")
@router.post("/api/sessions")
async def create_session(
    request: CreateSessionRequest,
    engine: DatabaseEngineDep,
):
    if request.session_id:
        try:
            validate_safe_id(request.session_id, "session_id")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    project = None
    if request.project_id:
        try:
            validate_safe_id(request.project_id, "project_id")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("id", request.project_id))
        if not project:
            project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("name", request.project_id))
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    session_id = request.session_id or generate_session_id()
    from app.paths import scaffold_session_storage
    brain_path = scaffold_session_storage(session_id, project.id if project else request.project_id)

    has_workspace = request.workspace_uri not in ("No Repo", "", None) or project or request.project_id
    section = request.section or ("workspace" if has_workspace else "conversation")
    workspace_uri = request.workspace_uri or (project.name if project else "No Repo")
    working_directory = project.local_folder_path if project else (workspace_uri if workspace_uri != "No Repo" else None)

    # Ensure deliverables folder exists inside project directory
    if working_directory and os.path.exists(working_directory):
        deliverables_dir = os.path.join(working_directory, "Audit_Deliverables")
        legacy_dir = os.path.join(working_directory, "NexAU_Outputs")
        outputs_dir = legacy_dir if (os.path.exists(legacy_dir) and not os.path.exists(deliverables_dir)) else deliverables_dir
        try:
            os.makedirs(outputs_dir, exist_ok=True)
        except Exception:
            pass

    context_data = {
        "project_id": project.id if project else request.project_id,
        "title": request.title,
        "custom_title": request.title,
        "workspace_uri": workspace_uri,
        "working_directory": working_directory,
        "section": section,
        "brain_directory": str(brain_path),
        "scratch_directory": str(brain_path / "scratch"),
    }

    # Step 2: Use native SessionManager.register_agent() to guarantee AgentModel
    # and root_agent_id are tracked atomically in SQLite
    from app.routers.chat import get_sse_server
    sm = None
    try:
        server = get_sse_server()
        sm = getattr(server, "_session_manager", None)
    except Exception:
        pass

    if sm:
        _agent_id, session = await sm.register_agent(
            user_id=request.user_id,
            session_id=session_id,
            agent_name="nexau_main_auditor",
            is_root=True,
        )
        session.context = context_data
        await sm._update_session(session)
    else:
        session = SessionModel(
            user_id=request.user_id,
            session_id=session_id,
            context=context_data,
        )
        await eng.create(session)
    return {"status": "success", "session_id": session_id}


# ──────────────────────────────────────────────
# Project Sessions
# ──────────────────────────────────────────────
@router.get("/api/sessions/project/{project_id}")
@router.get("/sessions/project/{project_id}")
async def list_sessions_by_project(
    project_id: str,
    engine: DatabaseEngineDep,
):
    eng = _get_engine(engine)
    project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("id", project_id))
    if not project:
        project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("name", project_id))
    target_id = project.id if project else project_id
    target_name = (project.name if project else project_id).lower()

    all_sessions = await eng.find_many(SessionModel)
    matching = [
        s for s in all_sessions
        if (s.context or {}).get("project_id") == target_id
        or ((s.context or {}).get("project_id") and str((s.context or {}).get("project_id")).lower() == target_name)
        or ((s.context or {}).get("workspace_uri", "").lower() == target_name)
    ]
    return {"sessions": matching}


# ──────────────────────────────────────────────
# Transcript & History (Both /sessions and /api/sessions)
# ──────────────────────────────────────────────
def get_tool_action_type(t_name: str) -> str:
    t_lower = t_name.lower()
    if any(k in t_lower for k in ("view", "read", "list", "fetch", "cat")):
        return "read"
    if any(k in t_lower for k in ("write", "replace", "edit", "patch")):
        return "edit"
    if any(k in t_lower for k in ("search", "find", "grep", "glob")):
        return "search"
    if any(k in t_lower for k in ("shell", "command", "bash", "terminal", "run")):
        return "command"
    return "action"


def messages_to_transcript_lines(
    messages: list[Message],
    pending_map: dict | None = None,
    shallow_tools: bool = False,
) -> list[dict]:
    # 1. Index all tool results by tool_use_id
    tool_results: dict[str, str] = {}
    for m in messages:
        for b in m.content:
            if isinstance(b, ToolResultBlock):
                content_str = b.content if isinstance(b.content, str) else str(b.content)
                if shallow_tools and len(content_str) > 3000:
                    content_str = content_str[:3000] + f"\n... [Truncated for rapid UI loading; {len(content_str)} total characters]"
                tool_results[str(b.tool_use_id)] = content_str

    lines = []
    for msg in messages:
        role_str = msg.role.value if hasattr(msg.role, "value") else str(msg.role).lower()
        if role_str in ("system", "tool"):
            # Tool results are merged directly into the assistant tool call below
            continue

        text_parts = []
        thoughts = []
        tools = []
        steps = []
        step_idx = 0

        for b in msg.content:
            if isinstance(b, TextBlock):
                text_parts.append(b.text)
                steps.append({
                    "id": f"step_{step_idx}",
                    "step_index": step_idx,
                    "type": "text",
                    "content": b.text,
                    "status": "completed",
                })
                step_idx += 1
            elif hasattr(b, "thinking") and b.thinking:
                th = b.thinking
                thoughts.append(th)
                steps.append({
                    "id": f"step_{step_idx}",
                    "step_index": step_idx,
                    "type": "thinking",
                    "content": th,
                    "status": "completed",
                })
                step_idx += 1
            elif getattr(b, "type", "") in ("thinking", "reasoning"):
                t_text = getattr(b, "text", "") or getattr(b, "thinking", "")
                if t_text:
                    thoughts.append(t_text)
                    steps.append({
                        "id": f"step_{step_idx}",
                        "step_index": step_idx,
                        "type": "thinking",
                        "content": t_text,
                        "status": "completed",
                    })
                    step_idx += 1
            elif isinstance(b, ToolUseBlock):
                tc_id = str(b.id)
                tc_name = str(b.name)
                t_args = b.input if isinstance(b.input, dict) else {}
                tool_action = get_tool_action_type(tc_name)

                is_pending = bool(pending_map and tc_id in pending_map and not pending_map[tc_id].get("decision"))
                decision_val = pending_map.get(tc_id, {}).get("decision") if pending_map else None
                tool_status = "pending_approval" if is_pending else ("denied" if decision_val == "deny" else "completed")
                output_val = tool_results.get(tc_id, "")

                tool_obj = {
                    "id": tc_id,
                    "name": tc_name,
                    "args": t_args,
                    "output": output_val,
                    "status": tool_status,
                    "decision": decision_val,
                    "toolSummary": t_args.get("toolSummary") or (pending_map.get(tc_id, {}).get("prompt") if pending_map else None),
                    "toolAction": t_args.get("toolAction"),
                    "action_type": tool_action,
                }
                tools.append(tool_obj)
                steps.append({
                    "id": tc_id or f"step_{step_idx}",
                    "step_index": step_idx,
                    "type": "tool",
                    "tool_call_id": tc_id,
                    "name": tc_name,
                    "args": t_args,
                    "output": output_val,
                    "status": tool_status,
                    "action_type": tool_action,
                })
                step_idx += 1

        combined_text = "\n\n".join(text_parts).strip()
        if not combined_text and not tools and not thoughts:
            continue

        ts_str = getattr(msg, "created_at", None)
        if isinstance(ts_str, datetime):
            ts_str = ts_str.isoformat()
        elif not ts_str:
            ts_str = datetime.now(UTC).isoformat()
        else:
            ts_str = str(ts_str)

        lines.append({
            "role": role_str,
            "content": combined_text,
            "thoughts": thoughts,
            "tools": tools,
            "steps": steps,
            "created_at": ts_str,
            "timestamp": ts_str,
        })
    return lines


@router.get("/sessions/{session_id}/transcript")
@router.get("/api/sessions/{session_id}/transcript")
async def get_transcript(
    session_id: str,
    engine: DatabaseEngineDep,
    limit: int | None = None,
    offset: int = 0,
    shallow_tools: bool = False,
):
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    if not eng:
        return {"lines": [], "total": 0}
    try:
        session_obj = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
        pending_map = (getattr(session_obj, "pending_tool_calls", None) or {}) if session_obj else {}
        user_id = session_obj.user_id if (session_obj and session_obj.user_id) else "default_user"

        agent_run_service = AgentRunActionService(engine=eng)
        key = AgentRunActionKey(user_id=user_id, session_id=session_id, agent_id="")
        messages = await agent_run_service.load_messages(key=key)

        lines = messages_to_transcript_lines(messages, pending_map=pending_map, shallow_tools=shallow_tools)
        total_lines = len(lines)
        if limit is not None and limit > 0:
            start_idx = max(0, total_lines - limit - offset)
            end_idx = total_lines - offset if offset > 0 else total_lines
            lines = lines[start_idx:end_idx]

        return {"lines": lines, "total": total_lines}
    except Exception as e:
        logger.warning(f"Error loading transcript: {e}")
        return {"lines": [], "total": 0}


# Alias for backwards compatibility
get_session_transcript_bridge = get_transcript


@router.get("/api/sessions/{user_id}/{session_id}/history")
@router.get("/sessions/{user_id}/{session_id}/history")
async def get_history(
    user_id: str,
    session_id: str,
    engine: DatabaseEngineDep,
):
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    agent_run_service = AgentRunActionService(engine=eng)
    key = AgentRunActionKey(user_id=user_id, session_id=session_id, agent_id="")
    messages = await agent_run_service.load_messages(key=key)
    return {"messages": messages}


# ──────────────────────────────────────────────
# Subagents Breakdown
# ──────────────────────────────────────────────
@router.get("/api/sessions/{session_id}/subagents")
@router.get("/sessions/{session_id}/subagents")
async def list_subagents(
    session_id: str,
    engine: DatabaseEngineDep,
):
    """List all sub-agents that ran in this session with status and run statistics."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    actions = await eng.find_many(
        AgentRunActionModel,
        filters=ComparisonFilter.eq("session_id", session_id),
    )
    actions = sorted(actions, key=lambda a: getattr(a, "created_at_ns", 0) or 0)

    subagents_map: dict[str, dict[str, Any]] = {}
    for a in actions:
        agent_id = a.agent_id
        if agent_id and agent_id not in ("main_auditor", "main_agent", "default_user", "root"):
            if agent_id not in subagents_map:
                subagents_map[agent_id] = {
                    "sub_agent_id": agent_id,
                    "action_count": 0,
                    "message_count": 0,
                    "first_seen_ns": getattr(a, "created_at_ns", 0),
                    "last_seen_ns": getattr(a, "created_at_ns", 0),
                    "status": "completed",
                }
            item = subagents_map[agent_id]
            item["action_count"] += 1
            if a.append_messages:
                item["message_count"] += len(a.append_messages)
            item["last_seen_ns"] = getattr(a, "created_at_ns", 0)

    return {"session_id": session_id, "subagents": list(subagents_map.values())}


@router.get("/api/sessions/{session_id}/subagents/{sub_agent_id}/transcript")
@router.get("/sessions/{session_id}/subagents/{sub_agent_id}/transcript")
async def get_subagent_transcript(
    session_id: str,
    sub_agent_id: str,
    engine: DatabaseEngineDep,
):
    """Get the full step-by-step execution transcript for a specific sub-agent."""
    try:
        validate_safe_id(session_id, "session_id")
        validate_safe_id(sub_agent_id, "sub_agent_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    actions = await eng.find_many(
        AgentRunActionModel,
        filters=ComparisonFilter.eq("session_id", session_id),
    )
    sub_actions = [a for a in actions if a.agent_id == sub_agent_id]
    sub_actions = sorted(sub_actions, key=lambda a: getattr(a, "created_at_ns", 0) or 0)

    messages = []
    for a in sub_actions:
        if a.append_messages:
            messages.extend(a.append_messages)

    return {
        "session_id": session_id,
        "sub_agent_id": sub_agent_id,
        "messages": messages,
        "lines": messages,
        "action_count": len(sub_actions),
    }


# ──────────────────────────────────────────────
# Mark Viewed
# ──────────────────────────────────────────────
@router.post("/sessions/{session_id}/view")
@router.post("/api/sessions/{session_id}/view")
async def mark_session_viewed(
    session_id: str,
    engine: DatabaseEngineDep,
):
    """Update the last_user_view_time timestamp when user views a session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    now_iso = datetime.now(UTC).isoformat()
    if eng:
        try:
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
            if session:
                ctx = dict(session.context or {})
                ctx["last_user_view_time"] = now_iso
                session.context = ctx
                await eng.update(session)
                return {"status": "success", "session_id": session_id, "last_user_view_time": now_iso, "has_unread": False}
        except Exception as e:
            logger.warning(f"Error updating session view time: {e}")
    return {"status": "success", "session_id": session_id, "last_user_view_time": now_iso, "has_unread": False}


# ──────────────────────────────────────────────
# Rename Session
# ──────────────────────────────────────────────
@router.post("/sessions/{session_id}/rename")
@router.post("/api/sessions/{session_id}/rename")
@router.patch("/sessions/{session_id}/rename")
@router.patch("/api/sessions/{session_id}/rename")
async def rename_session(
    session_id: str,
    payload: RenameSessionPayload,
    engine: DatabaseEngineDep,
):
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    title_val = payload.effective_title or "Untitled Session"
    if eng:
        try:
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
            if session:
                ctx = dict(session.context or {})
                ctx["custom_title"] = title_val
                ctx["title"] = title_val
                session.context = ctx
                await eng.update(session)
            else:
                # ponytail: don't upsert phantom sessions on rename (C-07)
                return {"status": "not_found", "message": f"Session {session_id} does not exist"}
        except Exception as e:
            logger.warning(f"Rename session error: {e}")
    return {"status": "success", "custom_title": payload.custom_title}


# ──────────────────────────────────────────────
# Session History Undo
# ──────────────────────────────────────────────
@router.delete("/sessions/{session_id}/undo")
@router.delete("/api/sessions/{session_id}/undo")
async def undo_session(
    session_id: str,
    payload: UndoPayload,
    engine: DatabaseEngineDep,
):
    """Event-sourced undo (RFC-0022): records an UNDO action to revert conversation state without deleting DB records."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    if not eng:
        return {"status": "success", "deleted": 0}
    try:
        actions = await eng.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", session_id),
        )
        actions = sorted(actions, key=lambda a: getattr(a, "created_at_ns", 0) or 0)

        user_turn_count = 0
        target_run_id = None
        for action in actions:
            act_type = getattr(action, "action_type", "")
            act_type_str = act_type.value if hasattr(act_type, "value") else str(act_type)
            if act_type_str not in ("append", "replace"):
                continue

            msgs = action.append_messages or action.replace_messages or []
            has_user = any(
                getattr(m, "role", None) == "user" or (isinstance(m, dict) and m.get("role") == "user")
                for m in msgs
            )
            if has_user:
                if user_turn_count >= payload.from_turn:
                    target_run_id = getattr(action, "run_id", "")
                    break
                user_turn_count += 1

        if not target_run_id:
            return {"status": "success", "deleted": 0}

        session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
        user_id = session.user_id if session and session.user_id else "default_user"
        root_agent_id = session.root_agent_id if session and session.root_agent_id else "main_agent"

        key = AgentRunActionKey(user_id=user_id, session_id=session_id, agent_id=root_agent_id)
        undo_run_id = generate_run_id()

        service = AgentRunActionService(engine=eng)
        await service.persist_undo(
            key=key,
            run_id=undo_run_id,
            root_run_id=undo_run_id,
            undo_before_run_id=target_run_id,
        )

        return {"status": "success", "deleted": 1, "undone_run_id": target_run_id}
    except Exception as e:
        logger.warning(f"Undo error for session {session_id}: {e}")
        return {"status": "success", "deleted": 0}


# ──────────────────────────────────────────────
# Mid-flight Steering Queue
# ──────────────────────────────────────────────
@router.post("/sessions/{session_id}/queue")
@router.post("/api/sessions/{session_id}/queue")
async def queue_session_steering(session_id: str, payload: SteeringQueuePayload):
    """Queue a mid-flight steering message for an actively running session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    msg = payload.message.strip()
    if not msg:
        return {"status": "error", "message": "Empty message"}
    queue_steering_message(session_id, msg)
    return {
        "status": "queued",
        "session_id": session_id,
        "message": msg,
        "total_queued": len(peek_steering_messages(session_id)),
    }


@router.get("/sessions/{session_id}/queue")
@router.get("/api/sessions/{session_id}/queue")
async def get_session_queue(session_id: str):
    """Inspect currently queued steering messages for a session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    queued = peek_steering_messages(session_id)
    return {"session_id": session_id, "queued": queued, "count": len(queued)}


@router.delete("/sessions/{session_id}/queue")
@router.delete("/api/sessions/{session_id}/queue")
async def clear_session_queue(session_id: str, index: int | None = None):
    """Clear all queued steering messages for a session, or delete a single message by index."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if index is not None:
        try:
            from nexau.archs.session.steering import remove_steering_message
            remove_steering_message(session_id, index)
        except Exception:
            pass
        queued = peek_steering_messages(session_id)
        return {"status": "success", "session_id": session_id, "queued": queued, "count": len(queued)}
    clear_steering_messages(session_id)
    return {"status": "success", "session_id": session_id, "queued": [], "count": 0}


# ──────────────────────────────────────────────
# Delete Session (with Physical Brain rmtree)
# ──────────────────────────────────────────────
@router.delete("/sessions/{session_id}")
@router.delete("/api/sessions/{session_id}")
@router.delete("/api/sessions/{user_id}/{session_id}")
@router.delete("/sessions/{user_id}/{session_id}")
async def delete_session(
    session_id: str,
    engine: DatabaseEngineDep,
    user_id: str | None = None,
):
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    if not eng:
        raise HTTPException(status_code=500, detail="Database engine unavailable")

    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found")

    brain_dir = (session.context or {}).get("brain_directory")
    await eng.delete(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", session_id))
    await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    clear_steering_messages(session_id)

    try:
        safe_rmtree_session_brain(session_id, brain_dir)
    except Exception as e:
        logger.warning(f"Session brain cleanup warning for {session_id}: {e}")

    return {"status": "success", "session_id": session_id}
