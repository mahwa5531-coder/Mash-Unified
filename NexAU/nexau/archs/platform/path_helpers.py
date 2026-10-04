# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Cross-platform path helpers.

RFC-0019: Windows support with PowerShell default and optional Git Bash

The helpers in this module keep Python-native paths and shell-consumable paths
explicitly separated. Python file APIs should keep native paths; Windows
PowerShell/cmd backends keep native paths, while optional Git Bash commands use
POSIX-style paths on Windows.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path, PureWindowsPath

_CLI_ROOT_DIR = "nexau"
_BASH_TOOL_RESULTS_DIR = "nexau_bash_tool_results"
_TOOL_OUTPUTS_DIR = "nexau_tool_outputs"
_CLI_SESSIONS_DIR = "cli-sessions"


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

    import uuid
    new_id = str(uuid.uuid4())
    p.write_text(new_id, encoding="utf-8")
    return new_id


def get_session_brain_dir(session_id: str | None = None, project_id: str | None = None) -> Path:
    """Return the brain directory for a session.

    Adopts Antigravity's unified flat brain architecture:
    - Dedicated session brain at ~/.nexau/brain/<session_id>/
    - Backwards-compatible: checks ~/.nexau/projects/<p_id>/sessions/<s_id>/ and
      ~/.nexau/standalone_sessions/<s_id>/ if legacy data exists.
    - If no session_id: ~/.nexau/brain
    """
    if session_id:
        if project_id:
            legacy_proj = get_nexau_home() / "projects" / project_id / "sessions" / session_id
            if legacy_proj.exists():
                return legacy_proj
        legacy_standalone = get_nexau_home() / "standalone_sessions" / session_id
        if legacy_standalone.exists():
            return legacy_standalone

        d = get_nexau_home() / "brain" / session_id
        d.mkdir(parents=True, exist_ok=True)
        return d
    d = get_nexau_home() / "brain"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_project_cache_dir(project_id: str) -> Path:
    """Return the session/project cache directory (~/.nexau/brain/<project_id>/cache/)."""
    d = get_nexau_home() / "brain" / project_id / "cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


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
    """Scaffold complete session brain and storage subdirectories on disk:
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


def get_brain_dir(session_id: str | None = None, project_id: str | None = None) -> Path:
    """Backwards-compatible alias for get_session_brain_dir."""
    return get_session_brain_dir(session_id, project_id)


def get_local_temp_root() -> Path:
    """Return the host temp directory used for local NexAU operations."""
    return Path(tempfile.gettempdir())


def get_local_bash_tool_results_dir(session_id: str | None = None) -> Path:
    """Return the base directory used for local shell stdout/stderr artifacts.
    Always uses system temp root to keep session brain clean and free of raw stdout/stderr dumps.
    """
    return get_local_temp_root() / _BASH_TOOL_RESULTS_DIR


def get_local_tool_output_dir(session_id: str | None = None) -> Path:
    """Return the base directory used by long-tool-output persistence."""
    if session_id:
        return get_brain_dir(session_id) / ".system_generated" / _TOOL_OUTPUTS_DIR
    return get_local_temp_root() / _TOOL_OUTPUTS_DIR


def get_local_cli_sessions_dir() -> Path:
    """Return the base directory used for CLI session snapshots."""
    return get_local_temp_root() / _CLI_ROOT_DIR / _CLI_SESSIONS_DIR


def native_path_to_shell_path(path: str | Path) -> str:
    """Convert a native local path to a shell-consumable path.

    On Unix hosts this returns a POSIX string representation.
    On Windows hosts this converts ``C:\\foo\\bar`` into ``/c/foo/bar`` for
    Git Bash consumption.
    """
    raw = str(path)
    if raw == "":
        return raw

    if not is_windows_host():
        return Path(raw).as_posix()

    if raw.startswith("/"):
        return raw.replace("\\", "/")

    windows_path = PureWindowsPath(raw)
    if windows_path.drive.startswith("\\\\"):
        return raw.replace("\\", "/")

    drive = windows_path.drive.rstrip(":")
    filtered_parts = [part for part in windows_path.parts if part not in {windows_path.drive, windows_path.root, windows_path.anchor}]
    normalized_tail = "/".join(filtered_parts)

    if drive:
        if normalized_tail:
            return f"/{drive.lower()}/{normalized_tail}"
        return f"/{drive.lower()}"

    return raw.replace("\\", "/")


def resolve_deliverables_dir(
    working_directory: str | Path | None = None,
    brain_directory: str | Path | None = None,
) -> Path:
    """Resolve and scaffold the visible deliverables directory for reports, working papers, and proofs.
    If working_directory exists: <working_directory>/Audit_Deliverables (or legacy NexAU_Outputs).
    Else: <brain_directory>/working_papers.
    """
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