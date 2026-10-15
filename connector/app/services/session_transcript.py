from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from nexau.archs.session import AgentRunActionKey, AgentRunActionService
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
    """ponytail: strip [DONE]/[END]/[VERIFIED]/[empty] protocol sentinels, prompt tags, and heading wrappers."""
    if not text or not isinstance(text, str):
        return text or ""
    sentinel_pat = r"</?(?:user[\s_]+message|assistant[\s_]+message|task_result|user_rules|user_information|identity|system_prompt)>\s*"
    cleaned = re.sub(sentinel_pat, "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(?:#+\s*)?(?:User|Assistant)\s+Message\s*:\s*$", "", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"\[(?:VERIFIED|empty)\]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?:^|\n)\s*\[(?:DONE|END|done|end)\]\s*(?=\n|$)", "", cleaned, flags=re.IGNORECASE)
    return re.sub(r"(\s*\[(?:DONE|END|done|end)\]\s*)+$", "", cleaned, flags=re.IGNORECASE).strip()


def generate_clean_session_title(raw_text: str, sid: str = "") -> str:
    """ponytail: concise session title generator without tag or bracket leakage."""
    fallback = f"Session {sid[:8]}" if sid else "New Session"
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
    if len(t) > 34:
        sp = t[:34].rfind(" ")
        t = (t[:sp] if sp > 12 else t[:34]).rstrip() + "..."
    return t[:1].upper() + t[1:]


def _parse_epoch_seconds(val: Any) -> float:
    """Parse any datetime, ISO string, timestamp (ns, ms, sec) into unix epoch float seconds (UTC)."""
    if not val:
        return 0.0
    now = datetime.now(UTC).timestamp()
    if isinstance(val, (int, float)):
        p = float(val) / (1e9 if val > 1e16 else (1e6 if val > 1e13 else (1e3 if val > 1e10 else 1.0))) if val > 1e8 else 0.0
    elif isinstance(val, datetime):
        p = val.timestamp() if val.tzinfo else val.astimezone(UTC).timestamp()
    else:
        try:
            dt = datetime.fromisoformat(str(val).strip().replace(" ", "T"))
            p = dt.timestamp() if dt.tzinfo else dt.astimezone(UTC).timestamp()
        except Exception:
            try:
                return _parse_epoch_seconds(float(val))
            except Exception:
                return 0.0
    return now if p > (now + 60.0) else p


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
            continue

        text_parts, thoughts, tools, steps = [], [], [], []
        step_idx = 0

        for b in msg.content:
            if isinstance(b, TextBlock):
                text_parts.append(b.text)
                steps.append({"id": f"step_{step_idx}", "step_index": step_idx, "type": "text", "content": b.text, "status": "completed"})
                step_idx += 1
            elif hasattr(b, "thinking") and b.thinking:
                th = b.thinking
                thoughts.append(th)
                steps.append({"id": f"step_{step_idx}", "step_index": step_idx, "type": "thinking", "content": th, "status": "completed"})
                step_idx += 1
            elif getattr(b, "type", "") in ("thinking", "reasoning"):
                t_text = getattr(b, "text", "") or getattr(b, "thinking", "")
                if t_text:
                    thoughts.append(t_text)
                    steps.append({"id": f"step_{step_idx}", "step_index": step_idx, "type": "thinking", "content": t_text, "status": "completed"})
                    step_idx += 1
            elif isinstance(b, ToolUseBlock):
                tc_id, tc_name = str(b.id), str(b.name)
                t_args = b.input if isinstance(b.input, dict) else {}
                tool_action = get_tool_action_type(tc_name)

                is_pending = bool(pending_map and tc_id in pending_map and not pending_map[tc_id].get("decision"))
                decision_val = pending_map.get(tc_id, {}).get("decision") if pending_map else None
                tool_status = "pending_approval" if is_pending else ("denied" if decision_val == "deny" else "completed")
                output_val = tool_results.get(tc_id, "")

                tools.append({
                    "id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "decision": decision_val,
                    "toolSummary": t_args.get("toolSummary") or (pending_map.get(tc_id, {}).get("prompt") if pending_map else None),
                    "toolAction": t_args.get("toolAction"), "action_type": tool_action,
                })
                steps.append({
                    "id": tc_id or f"step_{step_idx}", "step_index": step_idx, "type": "tool",
                    "tool_call_id": tc_id, "name": tc_name, "args": t_args, "output": output_val,
                    "status": tool_status, "action_type": tool_action,
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
