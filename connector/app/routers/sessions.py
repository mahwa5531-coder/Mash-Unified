import os
import re
import shutil
import uuid
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.dependencies import DatabaseEngineDep, SessionManagerDep, get_engine, _engine
from app.models.project import ProjectModel
from nexau.archs.session import AgentRunActionKey, AgentRunActionService
from nexau.archs.session.agent_run_action_service import reduce_actions_stream
from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.id_generator import generate_session_id, generate_run_id
from nexau.archs.platform.path_helpers import get_session_brain_dir
from nexau.archs.session.steering import queue_steering_message, peek_steering_messages, clear_steering_messages

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
    t = re.sub(r'^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want to\s+|i need to\s+|tell me about\s+|what is\s+|how to\s+)+', '', t, flags=re.IGNORECASE).strip()
    t = re.sub(r'[?!.:;]+$', '', t).strip()
    if not t:
        return f"Session {sid[:8]}" if sid else "New Session"

    if len(t) > 34:
        sp = t[:34].rfind(" ")
        t = (t[:sp] if sp > 12 else t[:34]).rstrip() + "..."
    return t[:1].upper() + t[1:]


def _parse_epoch_seconds(val: Any) -> float:
    """Parse any datetime, ISO string, timestamp (ns, ms, sec) into unix epoch float seconds (UTC)."""
    if not val:
        return 0.0
    if isinstance(val, (int, float)):
        if val > 1e16:
            return float(val) / 1e9
        if val > 1e11:
            return float(val) / 1e3
        return float(val)
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.astimezone().timestamp()
        return val.timestamp()
    try:
        s = str(val).strip().replace(" ", "T")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.astimezone().timestamp()
        return dt.timestamp()
    except Exception:
        try:
            return float(val)
        except Exception:
            return 0.0


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
                    q_res = await conn.execute(text("SELECT session_id, count(*), max(created_at_ns) FROM agent_run_actions GROUP BY session_id"))
                    for row in q_res.fetchall():
                        session_stats[row[0]] = {"count": row[1], "last_action_time": row[2]}
        except Exception:
            pass

        bench_patterns = (
            "benchmark", "bench", "par_", "subfunc_", "eval", "tatqa",
            "gaia", "stataudit", "l4_", "ssc_cgl", "unbiased", "qa_report",
            "nlp_batch"
        )

        result = []
        for s in db_sessions:
            sid = s.session_id
            if not include_benchmarks and any(p in sid.lower() for p in bench_patterns):
                continue

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
                updated_iso = datetime.fromtimestamp(latest_activity_sec, tz=timezone.utc).isoformat()
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
                "total_tokens": msg_count * 150,
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
    eng = _get_engine(engine)
    project = None
    if request.project_id:
        project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("id", request.project_id))
        if not project:
            project = await eng.find_first(ProjectModel, filters=ComparisonFilter.eq("name", request.project_id))
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    session_id = request.session_id or generate_session_id()
    from nexau.archs.platform.path_helpers import scaffold_session_storage
    brain_path = scaffold_session_storage(session_id, project.id if project else request.project_id)

    section = request.section or ("workspace" if request.workspace_uri not in ("No Repo", "", None) or project or request.project_id else "conversation")
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

    session = SessionModel(
        user_id=request.user_id,
        session_id=session_id,
        context={
            "project_id": project.id if project else request.project_id,
            "title": request.title,
            "custom_title": request.title,
            "workspace_uri": workspace_uri,
            "working_directory": working_directory,
            "section": section,
            "brain_directory": str(brain_path),
            "scratch_directory": str(brain_path / "scratch"),
        },
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
@router.get("/sessions/{session_id}/transcript")
@router.get("/api/sessions/{session_id}/transcript")
async def get_transcript(
    session_id: str,
    engine: DatabaseEngineDep,
    limit: int | None = None,
    offset: int = 0,
    shallow_tools: bool = False,
):
    """Retrieve session transcript lines from agent_run_actions with cross-message tool correlation and pagination."""
    eng = _get_engine(engine)
    if not eng:
        return {"lines": [], "total": 0}
    try:
        actions = await eng.find_many(
            AgentRunActionModel,
            filters=ComparisonFilter.eq("session_id", session_id),
        )

        actions_to_process = reduce_actions_stream(actions)

        # Compute accurate run durations from agent_run_actions database timestamps
        run_starts: dict[str, int] = {}
        run_ends: dict[str, int] = {}
        for a in actions_to_process:
            a_type = getattr(a, "action_type", "")
            a_type_str = a_type.value if hasattr(a_type, "value") else str(a_type)
            rid = getattr(a, "run_id", "")
            ns = getattr(a, "created_at_ns", 0) or 0
            if not ns and getattr(a, "created_at", None):
                try:
                    ns = int(a.created_at.timestamp() * 1e9)
                except Exception:
                    pass
            if not rid or not ns:
                continue
            if a_type_str == "run_start":
                if rid not in run_starts or ns < run_starts[rid]:
                    run_starts[rid] = ns
            elif a_type_str == "run_end":
                if rid not in run_ends or ns > run_ends[rid]:
                    run_ends[rid] = ns
            elif a_type_str == "append":
                if rid not in run_starts:
                    run_starts[rid] = ns
                if rid not in run_ends or ns > run_ends[rid]:
                    run_ends[rid] = ns

        run_durations: dict[str, int] = {}
        for rid, s_ns in run_starts.items():
            e_ns = run_ends.get(rid, s_ns)
            if e_ns >= s_ns:
                run_durations[rid] = max(1, round((e_ns - s_ns) / 1e9))

        last_marker_ns_by_run: dict[str, int] = {}
        lines = []
        all_tools_by_id: dict[str, dict] = {}
        all_tool_steps_by_id: dict[str, dict] = {}

        for action in actions_to_process:
            act_type = getattr(action, "action_type", "")
            is_replace = act_type == "replace" or getattr(act_type, "value", "") == "replace"
            rid = getattr(action, "run_id", "")
            current_ns = getattr(action, "created_at_ns", 0) or 0
            if not current_ns and getattr(action, "created_at", None):
                try:
                    current_ns = int(action.created_at.timestamp() * 1e9)
                except Exception:
                    pass

            prev_marker_ns = last_marker_ns_by_run.get(rid, run_starts.get(rid, current_ns))
            step_duration_s = max(1, round((current_ns - prev_marker_ns) / 1e9)) if (current_ns and prev_marker_ns and current_ns > prev_marker_ns) else None
            if current_ns:
                last_marker_ns_by_run[rid] = current_ns

            if is_replace:
                extra = getattr(action, "extra", {}) or {}
                stats = extra.get("stats") if isinstance(extra, dict) else {}
                lines.append({
                    "role": "system",
                    "type": "compaction_boundary",
                    "isCompacted": True,
                    "content": "The server cleared a prefix of the conversation as it grew too large.",
                    "summary": "",
                    "stats": stats,
                })
                msgs = getattr(action, "replace_messages", None) or []
            else:
                msgs = getattr(action, "append_messages", None) or []

            for msg in msgs:
                role = getattr(msg, "role", None) or (msg.get("role") if isinstance(msg, dict) else "assistant")
                if hasattr(role, "value"):
                    role = role.value
                role_str = str(role).lower()

                raw_content = getattr(msg, "content", None) or (msg.get("content") if isinstance(msg, dict) else "")

                text_parts = []
                thoughts = []
                tools = []
                steps = []
                step_idx = 0

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

                if isinstance(raw_content, str):
                    if raw_content:
                        text_parts.append(raw_content)
                        steps.append({
                            "id": f"step_{step_idx}",
                            "step_index": step_idx,
                            "type": "text",
                            "content": raw_content,
                            "status": "completed",
                        })
                        step_idx += 1
                elif isinstance(raw_content, list):
                    for block in raw_content:
                        b_type = getattr(block, "type", None) or (block.get("type") if isinstance(block, dict) else "")
                        if b_type == "text":
                            t_val = getattr(block, "text", None) or (block.get("text") if isinstance(block, dict) else "")
                            if t_val:
                                text_parts.append(str(t_val))
                                steps.append({
                                    "id": f"step_{step_idx}",
                                    "step_index": step_idx,
                                    "type": "text",
                                    "content": str(t_val),
                                    "status": "completed",
                                })
                                step_idx += 1
                        elif b_type in ("reasoning", "thinking"):
                            th_val = (
                                getattr(block, "text", None)
                                or getattr(block, "thinking", None)
                                or (block.get("text") if isinstance(block, dict) else "")
                                or (block.get("thinking") if isinstance(block, dict) else "")
                            )
                            if th_val:
                                thoughts.append(str(th_val))
                                steps.append({
                                    "id": f"step_{step_idx}",
                                    "step_index": step_idx,
                                    "type": "thinking",
                                    "content": str(th_val),
                                    "status": "completed",
                                })
                                step_idx += 1
                        elif b_type in ("tool_use", "tool_call"):
                            t_name = getattr(block, "name", None) or (block.get("name") if isinstance(block, dict) else "action")
                            t_id = str(getattr(block, "id", None) or (block.get("id") if isinstance(block, dict) else ""))
                            t_args = getattr(block, "input", None) or (block.get("input") if isinstance(block, dict) else {})
                            tool_action = get_tool_action_type(str(t_name))
                            tool_obj = {
                                "id": t_id,
                                "name": str(t_name),
                                "args": t_args if isinstance(t_args, dict) else {},
                                "output": "",
                                "status": "completed",
                                "action_type": tool_action,
                            }
                            tools.append(tool_obj)
                            if t_id:
                                all_tools_by_id[t_id] = tool_obj
                            step_tool = {
                                "id": t_id or f"step_{step_idx}",
                                "step_index": step_idx,
                                "type": "tool",
                                "tool_call_id": t_id,
                                "name": str(t_name),
                                "args": t_args if isinstance(t_args, dict) else {},
                                "output": "",
                                "status": "completed",
                                "action_type": tool_action,
                            }
                            steps.append(step_tool)
                            if t_id:
                                all_tool_steps_by_id[t_id] = step_tool
                            step_idx += 1
                        elif b_type in ("tool_result",):
                            r_id = str(getattr(block, "tool_use_id", None) or (block.get("tool_use_id") if isinstance(block, dict) else ""))
                            r_content = str(getattr(block, "content", None) or (block.get("content") if isinstance(block, dict) else ""))
                            if shallow_tools and len(r_content) > 3000:
                                r_content = r_content[:3000] + f"\n... [Truncated for rapid UI loading; {len(r_content)} total characters]"
                            if r_id and r_id in all_tools_by_id:
                                all_tools_by_id[r_id]["output"] = r_content
                                all_tools_by_id[r_id]["status"] = "completed"
                            if r_id and r_id in all_tool_steps_by_id:
                                all_tool_steps_by_id[r_id]["output"] = r_content
                                all_tool_steps_by_id[r_id]["status"] = "completed"
                            else:
                                tools.append({
                                    "id": r_id,
                                    "name": "action",
                                    "output": r_content,
                                    "status": "completed",
                                    "action_type": "action",
                                })
                            for s in steps:
                                if s.get("tool_call_id") == r_id:
                                    s["output"] = r_content
                                    s["status"] = "completed"

                # Support standard OpenAI Chat Completion top-level tool_calls
                openai_tool_calls = getattr(msg, "tool_calls", None) or (msg.get("tool_calls") if isinstance(msg, dict) else None)
                if isinstance(openai_tool_calls, list):
                    for tc in openai_tool_calls:
                        tc_id = str(tc.get("id") or "")
                        tc_func = tc.get("function") or {}
                        tc_name = tc_func.get("name") or tc.get("name") or "action"
                        raw_args = tc_func.get("arguments") or tc.get("args") or {}
                        if isinstance(raw_args, str):
                            try:
                                parsed_args = json.loads(raw_args)
                            except Exception:
                                parsed_args = {}
                        else:
                            parsed_args = raw_args if isinstance(raw_args, dict) else {}
                        tool_obj = {
                            "id": tc_id,
                            "name": str(tc_name),
                            "args": parsed_args,
                            "output": "",
                            "status": "completed",
                        }
                        tools.append(tool_obj)
                        if tc_id:
                            all_tools_by_id[tc_id] = tool_obj

                # Support standard OpenAI Chat Completion reasoning_content / thoughts
                reasoning = (
                    getattr(msg, "reasoning_content", None)
                    or getattr(msg, "reasoning", None)
                    or (msg.get("reasoning_content") if isinstance(msg, dict) else None)
                    or (msg.get("reasoning") if isinstance(msg, dict) else None)
                )
                if reasoning and isinstance(reasoning, str):
                    thoughts.append(reasoning)

                combined_text = "\n".join(text_parts).strip()

                # Support standard OpenAI Chat Completion role == 'tool'
                if role_str == "tool":
                    tc_id = str(getattr(msg, "tool_call_id", None) or (msg.get("tool_call_id") if isinstance(msg, dict) else ""))
                    if tc_id:
                        tool_content = raw_content if isinstance(raw_content, str) else combined_text
                        if shallow_tools and len(tool_content) > 3000:
                            tool_content = tool_content[:3000] + f"\n... [Truncated for rapid UI loading; {len(tool_content)} total characters]"
                        if tc_id in all_tools_by_id:
                            all_tools_by_id[tc_id]["output"] = tool_content
                            all_tools_by_id[tc_id]["status"] = "completed"
                        if tc_id in all_tool_steps_by_id:
                            all_tool_steps_by_id[tc_id]["output"] = tool_content
                            all_tool_steps_by_id[tc_id]["status"] = "completed"
                        else:
                            tools.append({
                                "id": tc_id,
                                "name": "action",
                                "output": tool_content,
                                "status": "completed",
                            })
                    if not combined_text and not tools:
                        continue

                # Defensively isolate compaction continuation summaries from user chat bubbles
                if role_str == "framework" or (isinstance(msg, dict) and msg.get("metadata", {}).get("isSummary")):
                    # Attach summary payload to preceding boundary banner or emit boundary
                    if lines and lines[-1].get("type") == "compaction_boundary":
                        lines[-1]["summary"] = combined_text
                    else:
                        lines.append({
                            "role": "system",
                            "type": "compaction_boundary",
                            "isCompacted": True,
                            "content": "The server cleared a prefix of the conversation as it grew too large.",
                            "summary": combined_text,
                        })
                    continue

                # Defensively filter out internal system notices from user chat bubbles
                if role_str == "user" and combined_text.strip().startswith("[SYSTEM NOTICE:"):
                    continue

                # Sanitize legacy corrupted user messages that have _HANDOFF_SUMMARY_PREFIX prepended
                if role_str == "user" and "The user request for this round is:" in combined_text:
                    parts = combined_text.split("The user request for this round is:", 1)
                    summary_clean = parts[0].strip()
                    user_clean = parts[1].strip()
                    if lines and lines[-1].get("type") == "compaction_boundary":
                        lines[-1]["summary"] = summary_clean
                    else:
                        lines.append({
                            "role": "system",
                            "type": "compaction_boundary",
                            "isCompacted": True,
                            "content": "The server cleared a prefix of the conversation as it grew too large.",
                            "summary": summary_clean,
                        })
                    combined_text = user_clean

                elif role_str == "user" and "Another language model started to solve this problem" in combined_text:
                    # Pure summary message legacy
                    if lines and lines[-1].get("type") == "compaction_boundary":
                        lines[-1]["summary"] = combined_text
                    else:
                        lines.append({
                            "role": "system",
                            "type": "compaction_boundary",
                            "isCompacted": True,
                            "content": "The server cleared a prefix of the conversation as it grew too large.",
                            "summary": combined_text,
                        })
                    continue

                if combined_text or thoughts or tools:
                    created_at_val = getattr(action, "created_at", None)
                    if isinstance(created_at_val, datetime):
                        ts_str = created_at_val.isoformat()
                    elif created_at_val:
                        ts_str = str(created_at_val)
                    elif getattr(action, "created_at_ns", 0):
                        try:
                            ts_str = datetime.fromtimestamp(action.created_at_ns / 1e9).isoformat()
                        except Exception:
                            ts_str = datetime.now().isoformat()
                    else:
                        ts_str = datetime.now().isoformat()

                    line_item = {
                        "role": role_str,
                        "content": combined_text,
                        "thoughts": thoughts,
                        "tools": tools,
                        "steps": steps,
                        "created_at": ts_str,
                        "timestamp": ts_str,
                    }
                    if role_str == "assistant":
                        if rid in run_durations:
                            line_item["total_duration_seconds"] = run_durations[rid]
                        if step_duration_s and (thoughts or not tools):
                            line_item["thinking_duration_seconds"] = step_duration_s
                    lines.append(line_item)

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
    eng = _get_engine(engine)
    actions = await eng.find_many(
        AgentRunActionModel,
        filters=ComparisonFilter.eq("session_id", session_id),
    )
    reduced = reduce_actions_stream(actions)
    messages = []
    for a in reduced:
        if a.append_messages:
            messages.extend(a.append_messages)
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
    eng = _get_engine(engine)
    now_iso = datetime.now(timezone.utc).isoformat()
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
    queued = peek_steering_messages(session_id)
    return {"session_id": session_id, "queued": queued, "count": len(queued)}


@router.delete("/sessions/{session_id}/queue")
@router.delete("/api/sessions/{session_id}/queue")
async def clear_session_queue(session_id: str):
    """Clear all queued steering messages for a session."""
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
    eng = _get_engine(engine)
    if eng:
        try:
            session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
            brain_dir = (session.context or {}).get("brain_directory") if session else None
            project_id = (session.context or {}).get("project_id") if session else None

            await eng.delete(AgentRunActionModel, filters=ComparisonFilter.eq("session_id", session_id))
            await eng.delete(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))

            if not brain_dir:
                brain_dir = str(get_session_brain_dir(session_id, project_id))
            if brain_dir and os.path.exists(brain_dir):
                shutil.rmtree(brain_dir, ignore_errors=True)
        except Exception as e:
            logger.warning(f"Session delete error: {e}")
    return {"status": "success"}