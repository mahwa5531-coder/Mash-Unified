# Copyright (c) Mash. All rights reserved.
"""Workspace, session, and brain storage path helpers for Mash Desktop."""

from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path, PureWindowsPath


def is_windows_host() -> bool:
    """Return True when the current Python runtime is on Windows."""
    return sys.platform == "win32"


def get_nexau_home() -> Path:
    """Return the global ~/.nexau directory."""
    p = Path.home() / ".nexau"
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_database_path() -> Path:
    """Return the unified SQLite database path (~/.nexau/database/nexau.db).
    Automatically scaffolds ~/.nexau/database/ and migrates legacy root DB files if present.
    """
    db_dir = get_nexau_home() / "database"
    db_dir.mkdir(parents=True, exist_ok=True)
    new_db = db_dir / "nexau.db"
    legacy_db = get_nexau_home() / "nexau.db"
    if legacy_db.exists() and not new_db.exists():
        import shutil
        for suffix in ["", "-wal", "-shm"]:
            src = get_nexau_home() / f"nexau.db{suffix}"
            dst = db_dir / f"nexau.db{suffix}"
            if src.exists():
                try:
                    shutil.move(str(src), str(dst))
                except Exception:
                    pass
    return new_db


def get_installation_id() -> str:
    """Return the unique permanent machine/installation UUID (~/.nexau/installation_id).
    Uses native Windows OS Machine GUID on Windows, with cryptographic UUIDv4 fallback.
    """
    p = get_nexau_home() / "installation_id"
    if p.exists():
        text = p.read_text(encoding="utf-8").strip()
        if text:
            return text

    if is_windows_host():
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography")
            machine_guid, _ = winreg.QueryValueEx(key, "MachineGuid")
            if machine_guid and str(machine_guid).strip():
                guid_str = str(machine_guid).strip()
                p.write_text(guid_str, encoding="utf-8")
                return guid_str
        except Exception:
            pass

    new_id = str(uuid.uuid4())
    p.write_text(new_id, encoding="utf-8")
    return new_id


def get_session_brain_dir(session_id: str | None = None, project_id: str | None = None) -> Path:
    """Return the brain directory for a session (~/.nexau/brain/<session_id>/)."""
    base = get_nexau_home() / "brain"
    if session_id:
        p = base / str(session_id)
        p.mkdir(parents=True, exist_ok=True)
        return p
    if project_id:
        p = get_nexau_home() / "projects" / str(project_id) / "brain"
        p.mkdir(parents=True, exist_ok=True)
        return p
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_brain_dir(session_id: str | None = None, project_id: str | None = None) -> Path:
    """Backwards-compatible alias for get_session_brain_dir."""
    return get_session_brain_dir(session_id, project_id)


def get_project_cache_dir(project_id: str) -> Path:
    """Return the project cache directory (~/.nexau/cache/<project_id>/)."""
    p = get_nexau_home() / "cache" / project_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def scaffold_nexau_system_storage() -> Path:
    """Scaffold global NexAU system directories on disk (~/.nexau/...).
    Ensures database, brain, agents, vault, templates, and cache exist on clean install.
    """
    home = get_nexau_home()
    (home / "database").mkdir(parents=True, exist_ok=True)
    (home / "brain").mkdir(parents=True, exist_ok=True)
    (home / "agents").mkdir(parents=True, exist_ok=True)
    (home / "vault").mkdir(parents=True, exist_ok=True)
    (home / "templates").mkdir(parents=True, exist_ok=True)
    (home / "cache").mkdir(parents=True, exist_ok=True)
    get_installation_id()
    return home


def scaffold_session_storage(session_id: str, project_id: str | None = None) -> Path:
    """Scaffold dedicated session brain directory hierarchy:
    ~/.nexau/brain/<session_id>/
      ├── .system_generated/
      │   ├── logs/
      │   └── tasks/
      ├── .user_uploaded/
      ├── working_papers/
      ├── scratch/
      └── cache/
    """
    brain_dir = get_session_brain_dir(session_id, project_id)
    (brain_dir / ".system_generated" / "logs").mkdir(parents=True, exist_ok=True)
    (brain_dir / ".system_generated" / "tasks").mkdir(parents=True, exist_ok=True)
    (brain_dir / ".user_uploaded").mkdir(parents=True, exist_ok=True)
    (brain_dir / "working_papers").mkdir(parents=True, exist_ok=True)
    (brain_dir / "scratch").mkdir(parents=True, exist_ok=True)
    (brain_dir / "cache").mkdir(parents=True, exist_ok=True)
    return brain_dir


def scaffold_workspace_storage(workspace_path: str | Path) -> Path:
    """Scaffold the designated audit folders inside the user's workspace:
    <workspace_root>/
      ├── Audit_Deliverables/   (Official statutory deliverables, memos, spreadsheets)
      └── .nexau/               (Hidden metadata, local workspace cache)
    """
    ws = Path(workspace_path).resolve()
    if not ws.exists() or not ws.is_dir():
        ws.mkdir(parents=True, exist_ok=True)

    (ws / "Audit_Deliverables").mkdir(parents=True, exist_ok=True)
    (ws / ".nexau" / "cache").mkdir(parents=True, exist_ok=True)
    
    ws_meta = ws / ".nexau" / "workspace.json"
    if not ws_meta.exists():
        import json
        from datetime import datetime, timezone
        try:
            ws_meta.write_text(json.dumps({
                "name": ws.name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "deliverables_dir": "Audit_Deliverables",
                "version": "1.0.0",
            }, indent=2), encoding="utf-8")
        except Exception:
            pass

    return ws


def resolve_deliverables_dir(
    working_directory: str | Path | None = None,
    brain_directory: str | Path | None = None,
) -> Path:
    """Resolve and scaffold the visible deliverables directory for reports, working papers, and proofs."""
    if working_directory and str(working_directory) != "No Repo" and Path(working_directory).exists():
        deliverables_dir = Path(working_directory) / "Audit_Deliverables"
        legacy_dir = Path(working_directory) / "NexAU_Outputs"
        out_dir = legacy_dir if (legacy_dir.exists() and not deliverables_dir.exists()) else deliverables_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir
    if brain_directory:
        wp_dir = Path(brain_directory) / "working_papers"
        wp_dir.mkdir(parents=True, exist_ok=True)
        return wp_dir
    fallback = get_nexau_home() / "outputs"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def resolve_sandbox_work_dir(
    working_directory: str | Path | None = None,
    scratch_directory: str | Path | None = None,
    brain_directory: str | Path | None = None,
) -> str:
    """Resolve the sandbox execution directory: workspace root if valid, else session scratch/brain."""
    if working_directory and str(working_directory) != "No Repo" and Path(working_directory).exists():
        return str(Path(working_directory).resolve())
    for fallback in [scratch_directory, brain_directory]:
        if fallback and Path(fallback).exists():
            return str(Path(fallback).resolve())
    return str(Path.cwd().resolve())
