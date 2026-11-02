from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from nexau.archs.session import AgentRunActionKey, AgentRunActionService
from nexau.archs.session.agent_run_action_service import (
    redact_data_structure,
    redact_sensitive_content,
)
import json
from nexau.archs.session.models import AgentRunActionModel, SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, ToolUseBlock

from app.paths import validate_safe_id

logger = logging.getLogger(__name__)


def _get_engine(engine: Any = None) -> Any:
    if engine is not None:
        return engine
    from app.dependencies import _engine as global_eng
    return global_eng


def clean_user_steering_envelope(text: str) -> str:
    """ponytail: Strip internal mid-flight steering protocol envelope from user prompt text."""
    if not text or not isinstance(text, str):
        return text or ""
    if "<USER_STEERING>" in text or "[USER MID-FLIGHT INSTRUCTION]:" in text or "</USER_STEERING>" in text:
        steering_pat = (
            r"<USER_STEERING>\s*(?:\[USER MID-FLIGHT INSTRUCTION\]:)?\s*([\s\S]*?)"
            r"(?:\s*Adapt your current plan and respond to this instruction immediately\.?)?\s*</USER_STEERING>"
        )
        m = re.search(steering_pat, text, re.IGNORECASE)
        if m and m.group(1).strip():
            return m.group(1).strip()
        cleaned = re.sub(r"</?USER_STEERING>", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"\[USER MID-FLIGHT INSTRUCTION\]:\s*", "", cleaned, flags=re.IGNORECASE)
        return re.sub(r"Adapt your current plan and respond to this instruction immediately\.?", "", cleaned, flags=re.IGNORECASE).strip()
    return text


def clean_protocol_sentinels(text: str) -> str:
    """ponytail: strip protocol sentinels, prompt tags, and section wrappers."""
    if not text or not isinstance(text, str):
        return text or ""
    tag_pat = (
        r"</?(?:user[\s_]+message|assistant[\s_]+message|attachments|file|task_result|user_rules|user_information|"
        r"identity|system_prompt|session_mode|file_storage_and_discipline|tool_execution_discipline|"
        r"ui_presentation_format|runtime_context|skills|Skill[A-Za-z0-9_-]+|scratchpad|thought|thinking|"
        r"tool_use|tool_result|tool_name|tool_output|use_parallel_tool_calls|parallel_tool|summary_data_json|empty)>\s*"
    )
    cleaned = re.sub(tag_pat, "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[(?:sub_agent_id|SYSTEM NOTICE):[^\]]*\]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(?:#+\s*)?(?:User|Assistant)\s+Message\s*:\s*$", "", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"\[(?:VERIFIED|empty)\]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?:^|\n)\s*\[(?:DONE|END|done|end)\]\s*(?=\n|$)", "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"(\s*\[(?:DONE|END|done|end)\]\s*)+$", "", cleaned, flags=re.IGNORECASE).strip()


def generate_clean_session_title(raw_text: str, sid: str = "") -> str:
    """ponytail: concise session title generator without tag or bracket leakage."""
    fallback = "New Conversation"
    if not raw_text or not isinstance(raw_text, str) or not raw_text.strip():
        return fallback
    t = clean_protocol_sentinels(clean_user_steering_envelope(raw_text.strip().strip("\"'` \t\n\r")))
    att_m = re.search(r"\[Attached (?:file|files):\s*([^\]]+)\]", t, re.I)
    att_base = [p for p in re.split(r"[\\/]", att_m.group(1).strip()) if p][-1].strip("\"'` \t\n\r,:;-\\]") if att_m else ""
    t = re.sub(r"\[Attached (?:file|files)[^\]]*\]", "", t, flags=re.I).strip()
    filler = r"^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want to\s+|i need to\s+|tell me about\s+|what is\s+|how to\s+|inspect and analyze the attached audit documents:?)+"
    t = re.sub(r"[?!.:;\-\]\)]+$", "", re.sub(filler, "", t.split("\n")[0].strip(), flags=re.I).strip()).strip()
    t = t or att_base
    if not t:
        return fallback
    if re.match(r"^([a-zA-Z]:[\\/]|/)", t) or ("\\" in t and " " not in t):
        parts = [p for p in re.split(r"[\\/]", t) if p]
        t = parts[-1].strip("\"'` \t\n\r,:;-\\]") if parts else t
    if len(t) > 32:
        sp = t[:32].rfind(" ")
        t = (t[:sp] if sp > 12 else t[:32]).rstrip() + "..."
    return t[:1].upper() + t[1:]


def _parse_epoch_seconds(val: Any) -> float:
    if not val:
        return 0.0
    now = datetime.now(UTC).timestamp()
    try:
        if isinstance(val, (int, float)):
            p = float(val) / (1e9 if val > 1e16 else (1e6 if val > 1e13 else (1e3 if val > 1e10 else 1.0))) if val > 1e8 else 0.0
        elif isinstance(val, datetime):
            p = val.timestamp() if val.tzinfo else val.astimezone(UTC).timestamp()
        else:
            dt = datetime.fromisoformat(str(val).strip().replace(" ", "T"))
            p = dt.timestamp() if dt.tzinfo else dt.astimezone(UTC).timestamp()
        return now if p > (now + 60.0) else p
    except Exception:
        try:
            return _parse_epoch_seconds(float(val))
        except Exception:
            return 0.0


def get_tool_action_type(t_name: str) -> str:
    t = t_name.lower()
    for cat, keys in (("read", ("view", "read", "list", "fetch", "cat")), ("edit", ("write", "replace", "edit", "patch")), ("search", ("search", "find", "grep", "glob")), ("command", ("shell", "command", "bash", "terminal", "run"))):
        if any(k in t for k in keys):
            return cat
    return "action"


def messages_to_transcript_lines(
    messages: list[Message],
    pending_map: dict | None = None,
    shallow_tools: bool = False,
    session_id: str | None = None,
) -> list[dict]:
    # 1. Index all tool results by tool_use_id
    tool_results: dict[str, str] = {}
    tool_errors: dict[str, bool] = {}
    for m in messages:
        for b in m.content:
            if isinstance(b, ToolResultBlock):
                content_str = b.content if isinstance(b.content, str) else str(b.content)
                if shallow_tools and len(content_str) > 3000:
                    content_str = content_str[:3000] + f"\n... [Truncated for rapid UI loading; {len(content_str)} total characters]"
                tool_results[str(b.tool_use_id)] = redact_sensitive_content(content_str)
                tool_errors[str(b.tool_use_id)] = bool(getattr(b, "is_error", False))

    lines = []
    for msg_idx, msg in enumerate(messages):
        role_str = msg.role.value if hasattr(msg.role, "value") else str(msg.role).lower()
        if role_str in ("system", "tool"):
            continue

        text_parts, thoughts, tools, steps = [], [], [], []
        step_idx = 0

        for b in msg.content:
            if isinstance(b, TextBlock):
                c_text = redact_sensitive_content(clean_protocol_sentinels(clean_user_steering_envelope(b.text) if role_str == "user" else b.text))
                text_parts.append(c_text)
                steps.append({"id": f"step_{msg_idx}_{step_idx}", "step_index": step_idx, "type": "text", "content": c_text, "status": "completed"})
                step_idx += 1
            elif hasattr(b, "thinking") and b.thinking:
                th = redact_sensitive_content(re.sub(r"</?(?:thought|thinking)>", "", str(b.thinking), flags=re.I).strip())
                thoughts.append(th)
                steps.append({"id": f"step_{msg_idx}_{step_idx}", "step_index": step_idx, "type": "thinking", "content": th, "status": "completed"})
                step_idx += 1
            elif getattr(b, "type", "") in ("thinking", "reasoning"):
                t_text = getattr(b, "text", "") or getattr(b, "thinking", "")
                if t_text:
                    th = redact_sensitive_content(re.sub(r"</?(?:thought|thinking)>", "", str(t_text), flags=re.I).strip())
                    thoughts.append(th)
                    steps.append({"id": f"step_{msg_idx}_{step_idx}", "step_index": step_idx, "type": "thinking", "content": th, "status": "completed"})
                    step_idx += 1
            elif isinstance(b, ToolUseBlock):
                tc_id, tc_name = str(b.id), str(b.name)
                t_args = redact_data_structure(b.input) if isinstance(b.input, dict) else {}
                tool_action = get_tool_action_type(tc_name)

                output_val = tool_results.get(tc_id, "")
                is_pending = bool(pending_map and tc_id in pending_map and not pending_map[tc_id].get("decision"))
                decision_val = pending_map.get(tc_id, {}).get("decision") if pending_map else None
                # ponytail: preserve audit trail of denied tool calls on reload even after pending_tool_calls is cleared
                is_denied = (decision_val == "deny") or ("Permission denied" in str(output_val))
                if is_denied:
                    decision_val = "deny"
                is_failed = tool_errors.get(tc_id, False)
                tool_status = "pending_approval" if is_pending else ("denied" if is_denied else ("failed" if is_failed else "completed"))
                # ponytail: schema normalization boundary - extract canonical tool properties
                summary_raw = (
                    t_args.get("toolSummary")
                    or t_args.get("tool_summary")
                    or t_args.get("summary")
                    or t_args.get("description")
                    or (pending_map.get(tc_id, {}).get("prompt") if pending_map else None)
                )
                summary_str = redact_sensitive_content(str(summary_raw)) if summary_raw else None
                action_str = t_args.get("toolAction") or t_args.get("tool_action")
                cmd_raw = (
                    t_args.get("CommandLine")
                    or t_args.get("command")
                    or t_args.get("cmd")
                    or t_args.get("code")
                    or t_args.get("source_code")
                )
                path_raw = (
                    t_args.get("TargetFile")
                    or t_args.get("AbsolutePath")
                    or t_args.get("file_path")
                    or t_args.get("path")
                    or t_args.get("Path")
                    or t_args.get("target_file")
                    or t_args.get("filepath")
                    or t_args.get("DirectoryPath")
                    or t_args.get("dir_path")
                )

                tool_dict = {
                    "id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "decision": decision_val,
                    "toolSummary": summary_str,
                    "toolAction": action_str, "action_type": tool_action,
                }
                if cmd_raw:
                    tool_dict["command"] = str(cmd_raw)
                if path_raw:
                    tool_dict["path"] = str(path_raw)

                tools.append(tool_dict)
                steps.append({
                    "id": f"step_{msg_idx}_{step_idx}", "step_index": step_idx, "type": "tool",
                    "tool_call_id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "decision": decision_val, "action_type": tool_action,
                    "toolSummary": summary_str, "toolAction": action_str,
                    **({"command": str(cmd_raw)} if cmd_raw else {}),
                    **({"path": str(path_raw)} if path_raw else {}),
                })
                step_idx += 1

        combined_text = redact_sensitive_content("\n\n".join(text_parts).strip())
        if not combined_text and not tools and not thoughts:
            continue

        meta = getattr(msg, "metadata", None) or {}
        ts = getattr(msg, "created_at", None) or (meta.get("created_at") if isinstance(meta, dict) else None)
        ts_str = ts.isoformat() if isinstance(ts, datetime) else (str(ts) if ts else "")

        msg_id = str(getattr(msg, "id", None) or f"msg_{session_id or 'sid'}_{msg_idx}")
        meta = getattr(msg, "metadata", None) or {}
        turn_id = meta.get("turn_id") if isinstance(meta, dict) else None
        if not turn_id:
            turn_id = f"turn_{session_id or 'sid'}_{msg_idx}"

        line_item = {
            "id": msg_id,
            "session_id": session_id or "",
            "turn_id": str(turn_id),
            "role": role_str, "content": combined_text, "thoughts": thoughts,
            "tools": tools, "steps": steps, "created_at": ts_str, "timestamp": ts_str,
        }
        if isinstance(meta, dict):
            if meta.get("status"):
                line_item["status"] = meta["status"]
            if meta.get("thinking_duration_seconds") is not None:
                line_item["thinking_duration_seconds"] = meta["thinking_duration_seconds"]
            if meta.get("total_duration_seconds") is not None:
                line_item["total_duration_seconds"] = meta["total_duration_seconds"]
        lines.append(line_item)
    return lines


async def load_session_transcript(
    engine: Any,
    session_id: str,
    limit: int | None = None,
    offset: int = 0,
    shallow_tools: bool = False,
) -> dict[str, Any]:
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

        # ponytail: Hydrate nanosecond durations, run outcome status, and timestamps from native ledger
        try:
            raw_actions = await eng.find_many(
                AgentRunActionModel,
                filters=ComparisonFilter.eq("session_id", session_id),
            )
            actions = sorted(raw_actions, key=lambda a: getattr(a, "created_at_ns", 0) or 0)
        except Exception as act_err:
            logger.debug(f"Could not load raw actions for session {session_id}: {act_err}")
            actions = []

        if actions:
            run_meta: dict[str, dict[str, Any]] = {}
            msg_to_run: dict[str, str] = {}
            msg_to_created_at: dict[str, Any] = {}

            for a in actions:
                rid = getattr(a, "run_id", None)
                if not rid:
                    continue
                if rid not in run_meta:
                    run_meta[rid] = {
                        "start_ns": None,
                        "end_ns": None,
                        "status": None,
                        "reason": None,
                        "first_asst_ns": None,
                        "timestamps": [],
                    }
                rm = run_meta[rid]
                ans = getattr(a, "created_at_ns", 0) or 0
                if ans > 0:
                    rm["timestamps"].append(ans)

                atype = getattr(a, "action_type", "")
                extra = getattr(a, "extra", None) or {}
                if isinstance(extra, str):
                    try:
                        extra = json.loads(extra)
                    except Exception:
                        extra = {}

                if atype == "run_start":
                    rm["start_ns"] = ans
                elif atype == "run_end":
                    rm["end_ns"] = extra.get("finished_at_ns") or ans
                    rm["status"] = extra.get("status") or "ok"
                    rm["reason"] = extra.get("reason")
                elif atype in ("append", "replace"):
                    app_msgs = getattr(a, "append_messages", None) or getattr(a, "replace_messages", None) or []
                    for m in app_msgs:
                        mid = str(getattr(m, "id", "") or "")
                        if mid:
                            msg_to_run[mid] = rid
                            m_ts = getattr(m, "created_at", None) or getattr(a, "created_at", None)
                            if m_ts:
                                msg_to_created_at[mid] = m_ts
                        m_role = getattr(m, "role", None)
                        if (m_role in ("assistant", Role.ASSISTANT)) and rm["first_asst_ns"] is None and ans > 0:
                            rm["first_asst_ns"] = ans

            for m in messages:
                mid = str(getattr(m, "id", "") or "")
                rid = msg_to_run.get(mid)
                if not isinstance(getattr(m, "metadata", None), dict):
                    m.metadata = {}
                if mid in msg_to_created_at and not getattr(m, "created_at", None):
                    m.created_at = msg_to_created_at[mid]

                if rid and rid in run_meta:
                    rm = run_meta[rid]
                    start = rm["start_ns"] or (rm["timestamps"][0] if rm["timestamps"] else None)
                    end = rm["end_ns"] or (rm["timestamps"][-1] if rm["timestamps"] else None)
                    if start and end and end >= start:
                        m.metadata["total_duration_seconds"] = round((end - start) / 1e9, 2)
                    first_asst = rm["first_asst_ns"]
                    if start and first_asst and first_asst >= start:
                        m.metadata["thinking_duration_seconds"] = round((first_asst - start) / 1e9, 2)
                    if rm.get("status"):
                        raw_st = str(rm["status"]).lower()
                        norm_st = "aborted" if raw_st in ("cancelled", "abort", "aborted") else ("error" if raw_st in ("error", "failed") else "completed")
                        m.metadata["status"] = norm_st
                    else:
                        m.metadata["status"] = "completed" 
                    if rm.get("reason"):
                        m.metadata["reason"] = rm["reason"]
                    m.metadata["run_id"] = rid
                    m.metadata["turn_id"] = f"turn_{rid}"

        lines = messages_to_transcript_lines(messages, pending_map=pending_map, shallow_tools=shallow_tools, session_id=session_id)
        total_lines = len(lines)
        if limit is not None and limit > 0:
            start_idx = max(0, total_lines - limit - offset)
            end_idx = total_lines - offset if offset > 0 else total_lines
            lines = lines[start_idx:end_idx]

        return {"lines": lines, "total": total_lines}
    except Exception as e:
        logger.warning(f"Error loading transcript: {e}")
        return {"lines": [], "total": 0}


async def load_session_history(
    engine: Any,
    user_id: str,
    session_id: str,
) -> dict[str, Any]:
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    agent_run_service = AgentRunActionService(engine=eng)
    key = AgentRunActionKey(user_id=user_id, session_id=session_id, agent_id="")
    messages = await agent_run_service.load_messages(key=key)
    return {"messages": messages}
