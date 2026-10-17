"""Chat permissions service.

Encapsulates tool permission configuration, native NexAU SessionManager
permission rule synchronization, preemptive steer handling, and manual
tool approval resolution.
"""

from __future__ import annotations

import copy
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Tools that require interactive user approval in 'default' permission mode.
SENSITIVE_TOOLS: frozenset[str] = frozenset({
    "run_shell_command",
    "write_file",
    "replace_file_content",
    "web_fetch",
})


def apply_permission_mode_to_tools(tools: list[Any], mode: str) -> list[Any]:
    """Return shallow copies of tools with permissions configured for the mode.

    Modes:
      - "turbo": all tools allowed without prompts ({"allow": ["**"], "deny": []})
      - "review": all tools require confirmation ({"allow": [], "deny": []})
      - "default": sensitive tools require confirmation, safe tools auto-allowed.

    The original tool objects are NOT mutated.
    """
    if not tools:
        return []

    clean_mode = (mode or "default").strip().lower()
    configured_tools: list[Any] = []
    for tool in tools:
        t_copy = copy.copy(tool)
        if clean_mode == "turbo":
            t_copy.permissions = {"allow": ["**"], "deny": []}
        elif clean_mode == "review":
            t_copy.permissions = {"allow": [], "deny": []}
        else:
            # "default": sensitive operations ask for approval; read-only tools run automatically
            tool_name = getattr(tool, "name", "")
            if tool_name in SENSITIVE_TOOLS:
                t_copy.permissions = {"allow": [], "deny": []}
            else:
                t_copy.permissions = {"allow": ["**"], "deny": []}
        configured_tools.append(t_copy)
    return configured_tools


async def init_session_permissions(
    sm: Any,
    user_id: str,
    session_id: str,
    tools: list[Any],
    mode: str = "default",
) -> None:
    """Initialize session permission rules directly via NexAU's SessionManager.

    Delegates directly to sm.init_permission_rules_from_config without raw SQL deletes.
    """
    if not sm or not session_id or not tools:
        return

    configured_tools = apply_permission_mode_to_tools(tools, mode) if mode else tools
    await sm.init_permission_rules_from_config(
        user_id=user_id,
        session_id=session_id,
        tools=configured_tools,
    )


async def handle_preemptive_steer(
    sm: Any,
    user_id: str,
    session_id: str,
    user_prompt: str,
) -> bool:
    """Auto-deny pending tool calls when a user sends a new steer prompt.

    Avoids PendingPermissionsError when a user steers the conversation mid-approval.
    Returns True if any pending tool calls were auto-denied, False otherwise.
    """
    if not sm or not session_id or not user_prompt or not user_prompt.strip():
        return False

    try:
        pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id)
        if pending and any(v.get("decision") is None for v in pending.values()):
            prompt_text = user_prompt.strip()
            for ptc in pending.values():
                if ptc.get("decision") is None:
                    ptc["decision"] = "deny"
                    ptc["feedback"] = f"Superseded by user message: {prompt_text}"
            await sm.update_pending_tool_calls(
                user_id=user_id,
                session_id=session_id,
                pending_tool_calls=pending,
            )
            logger.info("Auto-denied pending tool calls in session %s due to user steer prompt.", session_id)
            return True
    except Exception as steer_err:
        logger.warning("Error resolving preemptive steer for session %s: %s", session_id, steer_err)

    return False


async def resolve_tool_approval(
    sm: Any,
    user_id: str,
    session_id: str,
    tool_call_id: str | None,
    action: str,
    feedback: str | None = None,
) -> dict[str, Any]:
    """Resolve pending tool approval and persist permanent allow rules in NexAU.

    Handles decision mapping ('allow', 'allow_once', 'deny'), fuzzy tool call ID matching,
    permanent user rule saving, and pending tool calls update.
    """
    raw_action = (action or "proceed").strip().lower()
    if raw_action in ("allow", "always_allow"):
        decision = "allow"
    elif raw_action in ("deny", "reject"):
        decision = "deny"
    else:
        decision = "allow_once"

    if not sm or not session_id:
        return {
            "status": "success",
            "MANUAL_APPROVAL": True,
            "action": action,
            "execution_mode": action,
            "tool_call_id": tool_call_id,
        }

    try:
        pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id)
        if not pending:
            return {
                "status": "success",
                "MANUAL_APPROVAL": True,
                "action": action,
                "execution_mode": action,
                "tool_call_id": tool_call_id,
                "detail": "No pending tool calls to resolve",
            }

        target_tc_id = tool_call_id
        if not target_tc_id and len(pending) == 1:
            target_tc_id = next(iter(pending.keys()))

        # Match raw vs run_-prefixed tool_call_id
        matched_id = target_tc_id
        if target_tc_id and target_tc_id not in pending:
            for pk in pending.keys():
                if target_tc_id.endswith(f"_{pk}") or pk.endswith(f"_{target_tc_id}") or pk == target_tc_id:
                    matched_id = pk
                    break

        if matched_id and matched_id in pending:
            entry = pending[matched_id]
            entry["decision"] = decision
            if feedback:
                entry["feedback"] = feedback

            # "allow" persists permanently to SQLite permission_rules table
            if decision == "allow":
                await sm.save_permission_rule(
                    user_id=user_id,
                    session_id=session_id,
                    tool_name=entry.get("tool_name", ""),
                    rule_content=entry.get("permission_key", ""),
                    behavior="allow",
                    source="user",
                )

            await sm.update_pending_tool_calls(
                user_id=user_id,
                session_id=session_id,
                pending_tool_calls=pending,
            )
        else:
            matched_id = tool_call_id
    except Exception as ex:
        logger.warning("Error resolving permission for session %s: %s", session_id, ex)
        matched_id = tool_call_id

    return {
        "status": "success",
        "MANUAL_APPROVAL": True,
        "action": action,
        "execution_mode": action,
        "tool_call_id": matched_id,
    }


async def has_pending_undecided_tool_calls(
    sm: Any,
    user_id: str,
    session_id: str,
) -> bool:
    """Check if session currently has undecided pending tool calls."""
    if not sm or not session_id:
        return False
    try:
        pending = await sm.get_pending_tool_calls(user_id=user_id, session_id=session_id)
        return bool(pending and any(v.get("decision") is None for v in pending.values()))
    except Exception as err:
        logger.debug("Error checking pending tool calls: %s", err)
        return False


def get_session_permission_mode(session_context: dict[str, Any] | None) -> str:
    """Extract permission mode ('turbo', 'default', 'review') from session context."""
    if not session_context:
        return "default"
    mode = str(session_context.get("permission_mode") or "default").strip().lower()
    return mode if mode in ("turbo", "default", "review") else "default"


# Aliases for architectural compatibility across milestones and survey
configure_tools_for_permission_mode = apply_permission_mode_to_tools
sync_session_permission_rules = init_session_permissions
resolve_preemptive_steer = handle_preemptive_steer
