# Permission types for tool permission management.
# RFC-0019:
# exceptiontype ToolOutcome class.
# Tool function raise AskPermission / PermissionDenied
# Executor exception ToolOutcome .

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from nexau.archs.main_sub.execution.tool_executor import ToolExecutionResult


class AskPermission(Exception):  # noqa: N818 - signal, not error
    """Tool function allow/deny  raise. 

    RFC-0019: Ask exception

     prompt ()  permission_key ( allow ) . 
    tool_call_id / tool_name  executor . 
    """

    def __init__(self, *, prompt: str, permission_key: str) -> None:
        self.prompt = prompt
        self.permission_key = permission_key
        super().__init__(prompt)


class PermissionDenied(Exception):  # noqa: N818 - signal, not error
    """Tool function deny  raise. 

    RFC-0019: Deny exception
    """

    def __init__(self, *, reason: str, permission_key: str) -> None:
        self.reason = reason
        self.permission_key = permission_key
        super().__init__(reason)


class PendingPermissionsError(Exception):
    """agent.run()  pending_tool_calls  raise. 

    RFC-0019: 

     run. 
    """

    def __init__(self, *, session_id: str, pending: dict[str, Any]) -> None:
        self.session_id = session_id
        self.pending = pending
        super().__init__(
            f"Session {session_id} has {len(pending)} pending permission request(s). Resolve all decisions before starting a new run."
        )


# ---------------------------------------------------------------------------
# ToolOutcome: Executor tool ToolOutcome
# ---------------------------------------------------------------------------


@dataclass
class AllowOutcome:
    """Tool . 

    RFC-0019:  - Allow
    """

    tool_call_id: str
    result: ToolExecutionResult


@dataclass
class DenyOutcome:
    """Tool  deny . 

    RFC-0019:  - Deny
    """

    tool_call_id: str
    reason: str
    permission_key: str


@dataclass
class AskOutcome:
    """Tool . 

    RFC-0019:  - Ask

,  resume  tool. 
    """

    tool_call_id: str
    tool_name: str
    prompt: str
    permission_key: str
    parameters: dict[str, Any] = field(default_factory=lambda: {})