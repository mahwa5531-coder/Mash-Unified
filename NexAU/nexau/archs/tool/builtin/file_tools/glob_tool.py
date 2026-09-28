# Copyright 2025 Google LLC
# SPDX-License-Identifier: Apache-2.0
"""
glob tool - Finds files matching glob patterns.

Based on gemini-cli's glob.ts implementation.
Returns absolute paths sorted by modification time (newest first).
"""

import fnmatch
import os
import re
import shlex
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.sandbox import BaseSandbox, SandboxStatus
from nexau.archs.tool.builtin._sandbox_utils import get_sandbox, resolve_path

# Default exclusions matching gemini-cli & high-performance dev filters
DEFAULT_EXCLUDES = [
    "node_modules",
    ".git",
    "__pycache__",
    "venv",
    ".venv",
    "dist",
    "build",
    ".tox",
    ".eggs",
    "*.egg-info",
    ".next",
    "bifrost_data",
    ".gemini",
    ".nexau",
    "reports",
]

MAX_GLOB_MATCHES = 100


def _find_rg_executable() -> str:
    """Locate ripgrep executable: bundled with app or on system PATH."""
    rg_in_path = shutil.which("rg")
    if rg_in_path:
        return rg_in_path

    here = Path(__file__).resolve()
    is_win = sys.platform == "win32"
    exe_name = "rg.exe" if is_win else "rg"
    candidates = [
        here.parents[4] / "bin" / exe_name,
        here.parents[5] / "backend" / "bin" / exe_name,
        here.parents[5] / "NexAU" / "bin" / exe_name,
        Path(sys.prefix) / "Scripts" / exe_name,
        Path(sys.prefix) / "bin" / exe_name,
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            return str(c)
    return "rg"


def _rg_glob(
    pattern: str,
    search_dir: str,
    case_sensitive: bool,
    max_matches: int,
    sandbox: BaseSandbox,
) -> list[str]:
    """Execute fast file listing via ripgrep."""
    exe = _find_rg_executable()
    cmd: list[str] = [
        "--files",
        "--color",
        "never",
    ]

    # Excludes: glob negatives
    for ex in DEFAULT_EXCLUDES:
        if ex.startswith("*"):
            cmd.extend(["--glob", f"!{ex}"])
        else:
            cmd.extend(["--glob", f"!{ex}/**"])

    # Include pattern
    clean_pat = pattern.strip()
    if clean_pat and clean_pat not in ("*", "**/*", "**"):
        cmd.extend(["--glob", clean_pat])

    cmd.append(sandbox.to_shell_path(search_dir))

    prefix = "& " if sys.platform == "win32" else ""
    cmd_str = f'{prefix}"{exe}" ' + " ".join(shlex.quote(x) for x in cmd)
    res = sandbox.execute_shell(cmd_str, timeout=10000)

    if res.exit_code not in (0, 1) and res.status != SandboxStatus.SUCCESS:
        raise RuntimeError(res.stderr or "rg --files failed")

    lines = [line.strip() for line in (res.stdout or "").splitlines() if line.strip()]
    return lines[:max_matches]


def _python_glob(
    pattern: str,
    search_dir: str,
    max_matches: int,
) -> list[str]:
    """Fallback fast os.walk with root-level directory pruning."""
    matches: list[str] = []
    t0 = time.time()
    MAX_TIME_SECS = 5.0

    clean_pat = pattern.strip()
    if clean_pat.startswith("**/"):
        clean_pat = clean_pat[3:]

    for root, dirnames, filenames in os.walk(search_dir):
        # Prune heavy folders at root so we never walk into them
        dirnames[:] = [
            d for d in dirnames
            if d.lower() not in DEFAULT_EXCLUDES
            and not any(fnmatch.fnmatch(d, ex) for ex in DEFAULT_EXCLUDES)
        ]

        if len(matches) >= max_matches or (time.time() - t0) > MAX_TIME_SECS:
            break

        for fname in filenames:
            if fnmatch.fnmatch(fname, clean_pat) or fnmatch.fnmatch(fname.lower(), clean_pat.lower()):
                full_path = os.path.join(root, fname)
                matches.append(full_path.replace("\\", "/"))
                if len(matches) >= max_matches:
                    break

    return matches


def glob(
    pattern: str | None = None,
    dir_path: str | None = None,
    case_sensitive: bool = False,
    respect_git_ignore: bool = True,
    agent_state: AgentState | None = None,
    *,
    Pattern: str | None = None,
    SearchPath: str | None = None,
    path: str | None = None,
    dir: str | None = None,
    CaseSensitive: bool | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Finds files matching a glob pattern using high-speed bundled ripgrep.

    Returns file paths matching the pattern. Results are capped at 100 matches for performance.

    Args:
        pattern: Glob pattern (e.g. "**/*.py", "*.xlsx", "docs/*.md")
        dir_path: Directory to search in (optional, defaults to cwd)
        case_sensitive: Whether matching should be case-sensitive
    """
    pattern = Pattern or pattern or "*"
    if SearchPath is not None:
        dir_path = SearchPath
    elif path is not None:
        dir_path = path
    elif dir is not None:
        dir_path = dir

    if CaseSensitive is not None:
        case_sensitive = CaseSensitive

    try:
        sandbox: BaseSandbox = get_sandbox(agent_state)

        # Determine search directory
        search_dir = resolve_path(dir_path, sandbox) if dir_path else str(sandbox.work_dir)

        if not sandbox.file_exists(search_dir):
            error_msg = f"Search path does not exist: {search_dir}"
            return {
                "content": error_msg,
                "returnDisplay": "Error: Path not found",
                "error": {
                    "message": error_msg,
                    "type": "DIRECTORY_NOT_FOUND",
                },
            }

        if not sandbox.get_file_info(search_dir).is_directory:
            error_msg = f"Search path is not a directory: {search_dir}"
            return {
                "content": error_msg,
                "returnDisplay": "Error: Not a directory",
                "error": {
                    "message": error_msg,
                    "type": "NOT_A_DIRECTORY",
                },
            }

        matches: list[str] = []
        strategy = "rg"
        try:
            matches = _rg_glob(
                pattern=pattern,
                search_dir=search_dir,
                case_sensitive=case_sensitive,
                max_matches=MAX_GLOB_MATCHES,
                sandbox=sandbox,
            )
        except Exception:
            strategy = "os.walk fallback"
            matches = _python_glob(
                pattern=pattern,
                search_dir=search_dir,
                max_matches=MAX_GLOB_MATCHES,
            )

        if not matches:
            return {
                "content": f'No files found matching pattern "{pattern}" within {search_dir}.',
                "returnDisplay": "No files found",
            }

        was_capped = len(matches) >= MAX_GLOB_MATCHES
        capped_note = f" (results capped at {MAX_GLOB_MATCHES} matches for performance)" if was_capped else ""
        file_list = "\n".join(matches)

        result_message = (
            f'Found {len(matches)} matching file(s) for pattern "{pattern}" within {search_dir}{capped_note} '
            f'(engine: {strategy}):\n---\n{file_list}'
        )

        return {
            "content": result_message,
            "returnDisplay": f"Found {len(matches)} matching file(s){' (capped)' if was_capped else ''}",
        }

    except Exception as e:
        error_msg = f"Error during glob search: {str(e)}"
        return {
            "content": error_msg,
            "returnDisplay": "Error: Glob failed",
            "error": {
                "message": error_msg,
                "type": "GLOB_EXECUTION_ERROR",
            },
        }