from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from nexau.archs.session.models import AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter

from app.paths import validate_safe_id

logger = logging.getLogger(__name__)


def _get_engine(engine: Any = None) -> Any:
    if engine is not None:
        return engine
    from app.dependencies import _engine as global_eng
    return global_eng


async def get_subagents_summary(engine: Any, session_id: str) -> dict[str, Any]:
    """List all sub-agents that ran in this session with status and run statistics."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    if not eng:
        return {"session_id": session_id, "subagents": []}

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


async def get_subagent_transcript_messages(engine: Any, session_id: str, sub_agent_id: str) -> dict[str, Any]:
    """Get the full step-by-step execution transcript for a specific sub-agent."""
    try:
        validate_safe_id(session_id, "session_id")
        validate_safe_id(sub_agent_id, "sub_agent_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    if not eng:
        return {"session_id": session_id, "sub_agent_id": sub_agent_id, "messages": [], "lines": [], "action_count": 0}

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
