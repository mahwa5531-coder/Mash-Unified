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
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import Message, TextBlock, ToolResultBlock, ToolUseBlock

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
        r"</?(?:user[\s_]+message|assistant[\s_]+message|task_result|user_rules|user_information|"
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
) -> list[dict]:
    # 1. Index all tool results by tool_use_id
    tool_results: dict[str, str] = {}
    for m in messages:
        for b in m.content:
            if isinstance(b, ToolResultBlock):
                content_str = b.content if isinstance(b.content, str) else str(b.content)
                if shallow_tools and len(content_str) > 3000:
                    content_str = content_str[:3000] + f"\n... [Truncated for rapid UI loading; {len(content_str)} total characters]"
                tool_results[str(b.tool_use_id)] = redact_sensitive_content(content_str)

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
                tool_status = "pending_approval" if is_pending else ("denied" if is_denied else "completed")
                summary_raw = t_args.get("toolSummary") or (pending_map.get(tc_id, {}).get("prompt") if pending_map else None)
                summary_str = redact_sensitive_content(str(summary_raw)) if summary_raw else None
                action_str = t_args.get("toolAction")

                tools.append({
                    "id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "decision": decision_val,
                    "toolSummary": summary_str,
                    "toolAction": action_str, "action_type": tool_action,
                })
                steps.append({
                    "id": f"step_{msg_idx}_{step_idx}", "step_index": step_idx, "type": "tool",
                    "tool_call_id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "decision": decision_val, "action_type": tool_action,
                    "toolSummary": summary_str, "toolAction": action_str,
                })
                step_idx += 1

        combined_text = redact_sensitive_content("\n\n".join(text_parts).strip())
        if not combined_text and not tools and not thoughts:
            continue

        ts = getattr(msg, "created_at", None)
        ts_str = ts.isoformat() if isinstance(ts, datetime) else (datetime.now(UTC).isoformat() if not ts else str(ts))

        lines.append({
            "role": role_str, "content": combined_text, "thoughts": thoughts,
            "tools": tools, "steps": steps, "created_at": ts_str, "timestamp": ts_str,
        })
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
