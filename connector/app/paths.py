# Copyright (c) Mash. All rights reserved.
"""Workspace, session, and brain storage path helpers for Mash Desktop.

ponytail: Re-exports from canonical nexau.archs.platform.path_helpers to eliminate
redundancy between Desktop Connector and Agent Runtime.
"""

from __future__ import annotations

from nexau.archs.platform.path_helpers import (
    get_brain_dir,
    get_database_path,
    get_installation_id,
    get_nexau_home,
    get_project_cache_dir,
    get_session_brain_dir,
    is_windows_host,
    resolve_deliverables_dir,
    resolve_sandbox_work_dir,
    scaffold_nexau_system_storage,
    scaffold_session_storage,
    scaffold_workspace_storage,
)

__all__ = [
    "get_brain_dir",
    "get_database_path",
    "get_installation_id",
    "get_nexau_home",
    "get_project_cache_dir",
    "get_session_brain_dir",
    "is_windows_host",
    "resolve_deliverables_dir",
    "resolve_sandbox_work_dir",
    "scaffold_nexau_system_storage",
    "scaffold_session_storage",
    "scaffold_workspace_storage",
]
