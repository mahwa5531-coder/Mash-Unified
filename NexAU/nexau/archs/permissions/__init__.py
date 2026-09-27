# Tool permission management primitives.
# RFC-0019:
# exceptiontype, ToolOutcome class, helper function.

from .helpers import check_path_permission, check_permission, check_shell_permission, check_url_permission
from .types import (
    AllowOutcome,
    AskOutcome,
    AskPermission,
    DenyOutcome,
    PendingPermissionsError,
    PermissionDenied,
)

__all__ = [
    "AskPermission",
    "PermissionDenied",
    "PendingPermissionsError",
    "AllowOutcome",
    "DenyOutcome",
    "AskOutcome",
    "check_permission",
    "check_path_permission",
    "check_shell_permission",
    "check_url_permission",
]