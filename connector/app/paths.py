# Copyright (c) Mash. All rights reserved.
"""Workspace, session, and brain storage path helpers for Mash Desktop.

Re-exports from canonical nexau.archs.platform.path_helpers to eliminate
redundancy between Desktop Connector and Agent Runtime.
"""

from __future__ import annotations

from nexau.archs.platform.path_helpers import (
    SAFE_ID_REGEX,
    get_brain_dir,
    get_database_path,
    get_installation_id,
    get_mash_home,
    get_nexau_home,
    get_project_cache_dir,
    get_session_brain_dir,
    is_windows_host,
    resolve_deliverables_dir,
    resolve_sandbox_work_dir,
    safe_rmtree_session_brain,
    scaffold_nexau_system_storage,
    scaffold_session_storage,
    scaffold_workspace_storage,
    validate_safe_id,
)
from urllib.parse import unquote


def normalize_local_path(raw_path: str) -> str:
    """Single Source of Truth Path Normalizer for Mash Backend.

    Handles:
    - Safe URL decoding (unquote)
    - Strips file:///, file://, file: prefixes
    - Normalizes Windows drive letter leading slashes (/C: -> C:)
    - Converts all backslashes to standard forward slashes (\\ -> /)
    - Strips URL query params and #anchors
    """
    if not raw_path:
        return ""
    p = unquote(raw_path).strip()
    if p.startswith("file:///"):
        p = p[8:]
    elif p.startswith("file://"):
        p = p[7:]
    elif p.startswith("file:"):
        p = p[5:]
    if len(p) >= 3 and p[0] == "/" and p[1].isalpha() and p[2] == ":":
        p = p[1:]
    p = p.split("#")[0].split("?")[0]
    return p.replace("\\", "/").strip()


__all__ = [
    "SAFE_ID_REGEX",
    "normalize_local_path",
    "get_brain_dir",
    "get_database_path",
    "get_installation_id",
    "get_mash_home",
    "get_nexau_home",
    "get_project_cache_dir",
    "get_session_brain_dir",
    "is_windows_host",
    "resolve_deliverables_dir",
    "resolve_sandbox_work_dir",
    "safe_rmtree_session_brain",
    "scaffold_nexau_system_storage",
    "scaffold_session_storage",
    "scaffold_workspace_storage",
    "validate_safe_id",
]
