"""
Sandbox helpers for gemini-cli style builtin tools.

These tool implementations route all filesystem and shell operations through
NexAU's BaseSandbox abstraction (e.g. LocalSandbox/E2B).
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.sandbox import BaseSandbox


_DEFAULT_LOCAL_SANDBOX: BaseSandbox | None = None


def get_sandbox(agent_state: AgentState | None) -> BaseSandbox:
    """Get sandbox from agent_state, or fallback to default LocalSandbox singleton."""
    if agent_state is not None:
        sandbox = agent_state.get_sandbox()
        if sandbox is not None:
            return sandbox
    global _DEFAULT_LOCAL_SANDBOX
    if _DEFAULT_LOCAL_SANDBOX is None or getattr(_DEFAULT_LOCAL_SANDBOX, "work_dir", None) != Path.cwd():
        from nexau.archs.sandbox.local_sandbox import LocalSandbox
        _DEFAULT_LOCAL_SANDBOX = LocalSandbox(work_dir=Path.cwd())
    return _DEFAULT_LOCAL_SANDBOX



def resolve_path(path: str, sandbox: BaseSandbox) -> str:
    """Resolve relative paths against sandbox work_dir or session brain uploads."""
    clean = str(path).strip().strip("'\"")
    if clean.startswith("file:///"):
        clean = clean[8:]
    elif clean.startswith("file://"):
        clean = clean[7:]
    clean = unquote(clean)
    if len(clean) >= 3 and clean[0] == "/" and clean[2] == ":":
        clean = clean[1:]

    if Path(clean).is_absolute():
        return clean

    # Resolve relative uploaded files (.user_uploaded/) to session brain directory
    session_id = getattr(sandbox, "sandbox_id", None)
    if session_id:
        try:
            from nexau.archs.platform.path_helpers import get_session_brain_dir
            brain_dir = get_session_brain_dir(session_id)
            if clean.startswith(".user_uploaded") or clean.startswith(".user_uploaded/") or clean.startswith(".user_uploaded\\"):
                brain_target = (brain_dir / clean).resolve()
                return str(brain_target)
            # Fallback to session .user_uploaded folder if not present in sandbox.work_dir
            work_target = Path(str(sandbox.work_dir)) / clean
            if not work_target.exists():
                upload_fallback = (brain_dir / ".user_uploaded" / clean).resolve()
                if upload_fallback.exists():
                    return str(upload_fallback)
        except Exception:
            pass

    return str(Path(str(sandbox.work_dir)) / clean)
