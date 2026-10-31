"""Server-owned workspace resolution and file-viewing boundaries."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.models.project import ProjectModel
from app.paths import get_session_brain_dir

APP_WORKSPACE_ROOT = Path(__file__).resolve().parent.parent.parent

_BASE_ROOTS: list[Path] | None = None
_DYNAMIC_ROOTS_CACHE: tuple[float, list[Path]] | None = None


def get_base_allowed_roots() -> list[Path]:
    """Get the immutable base allowed directories (Mash root, NexAU brain)."""
    global _BASE_ROOTS
    if _BASE_ROOTS is None:
        roots = [APP_WORKSPACE_ROOT.resolve()]
        for folder in [".mash", ".nexau"]:
            roots.append((Path.home() / folder / "brain").resolve())
        _BASE_ROOTS = list(dict.fromkeys(roots))
    return _BASE_ROOTS


def is_path_in_base_roots(target_path: Path) -> bool:
    """Blocks forbidden OS system files, checks membership against base roots."""
    try:
        resolved = target_path.resolve()
        # Fast-match against base roots (Mash root, NexAU brain)
        if any(resolved == root or resolved.is_relative_to(root) for root in get_base_allowed_roots()):
            return True
        return False
    except Exception:
        return False


async def resolve_workspace_directory(engine: Any, project_id: str | None) -> Path:
    """Return a local workspace chosen from server-persisted project data only."""
    if not project_id:
        return APP_WORKSPACE_ROOT

    project = await engine.find_first(ProjectModel, filters=ComparisonFilter.eq("id", project_id))
    if project is None:
        # ponytail: never crash the stream if a project was deleted. Fallback to default root.
        return APP_WORKSPACE_ROOT

    workspace = Path(project.local_folder_path).expanduser().resolve()
    if not workspace.is_dir():
        raise HTTPException(status_code=400, detail="Selected workspace folder is unavailable")
    return workspace


async def resolve_session_workspace(engine: Any, session_id: str | None) -> Path:
    """Resolve the working workspace directory for a session or fallback to APP_WORKSPACE_ROOT."""
    if not session_id or engine is None:
        return APP_WORKSPACE_ROOT
    try:
        session = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
        if session and session.context:
            ctx = session.context
            work_dir = ctx.get("working_directory") or ctx.get("workspace_dir") or ctx.get("cwd")
            if work_dir and Path(work_dir).is_dir():
                return Path(work_dir).resolve()
            if ctx.get("project_id"):
                return await resolve_workspace_directory(engine, ctx["project_id"])
    except Exception:
        pass
    return APP_WORKSPACE_ROOT


def invalidate_roots_cache() -> None:
    """Invalidate dynamic workspace roots cache upon project/session changes."""
    global _DYNAMIC_ROOTS_CACHE
    _DYNAMIC_ROOTS_CACHE = None


async def get_allowed_file_roots(engine: Any | None) -> list[Path]:
    """Retrieve all authorized workspace and brain roots with a 30s TTL cache."""
    global _DYNAMIC_ROOTS_CACHE
    import time
    base = get_base_allowed_roots()
    if engine is None:
        return base

    now = time.time()
    if _DYNAMIC_ROOTS_CACHE and (now - _DYNAMIC_ROOTS_CACHE[0]) < 30.0:
        return _DYNAMIC_ROOTS_CACHE[1]

    roots = list(base)
    try:
        projects = await engine.find_many(ProjectModel)
        for project in projects:
            path = Path(project.local_folder_path).expanduser()
            if path.is_dir():
                roots.append(path.resolve())

        sessions = await engine.find_many(SessionModel)
        for session in sessions:
            context = session.context or {}
            # Allow session working directories
            work_dir = context.get("working_directory") or context.get("workspace_dir")
            if work_dir and Path(work_dir).is_dir():
                roots.append(Path(work_dir).resolve())

            brain_directory = context.get("brain_directory")
            project_id = context.get("project_id")
            path = Path(brain_directory) if brain_directory else get_session_brain_dir(session.session_id, project_id)
            if path.is_dir():
                roots.append(path.resolve())
    except Exception:
        # The application workspace remains available if persistence is temporarily unavailable.
        pass

    result = list(dict.fromkeys(roots))
    _DYNAMIC_ROOTS_CACHE = (now, result)
    return result

