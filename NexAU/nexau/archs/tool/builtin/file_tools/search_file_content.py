# Copyright 2025 Google LLC
# SPDX-License-Identifier: Apache-2.0
"""
search_file_content tool (grep) - Searches for regex patterns in file contents.

Based on gemini-cli's grep.ts implementation.
Uses prioritized strategies: git grep -> system grep -> JavaScript fallback.
"""

import fnmatch
import re
import shlex
import shutil
import sys
from pathlib import Path, PureWindowsPath
from typing import Any

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.sandbox import BaseSandbox, SandboxStatus
from nexau.archs.tool.builtin._sandbox_utils import get_sandbox, resolve_path

# Configuration constants
DEFAULT_TOTAL_MAX_MATCHES = 50  # Hard-capped at 50 matches (matches Antigravity & OpenHands standard)
DEFAULT_SEARCH_TIMEOUT_MS = 30000
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
    ".next",
    "bifrost_data",
    ".gemini",
    ".nexau",
    "reports",
]

BINARY_EXTENSIONS = {
    ".parquet", ".xlsx", ".xls", ".db", ".db-wal", ".db-shm",
    ".jpeg", ".jpg", ".png", ".gif", ".ico", ".pdf", ".sst",
    ".meta", ".bin", ".pyc", ".zip", ".tar", ".gz"
}

_GREP_LINE_PATTERN: re.Pattern[str] = re.compile(r":(\d+):(.*)$")
_WINDOWS_DRIVE_PATH_PATTERN: re.Pattern[str] = re.compile(r"^[A-Za-z]:[\\/]")


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


def _rg_available(sandbox: BaseSandbox) -> bool:
    """Check if ripgrep (rg) is available inside the sandbox or bundled."""
    exe = _find_rg_executable()
    prefix = "& " if sys.platform == "win32" else ""
    try:
        res = sandbox.execute_shell(f'{prefix}"{exe}" --version', timeout=5000)
        return res.status == SandboxStatus.SUCCESS and (res.exit_code == 0)
    except Exception:
        return False


def _parse_grep_line(line: str, base_path: str) -> dict[str, Any] | None:
    """
    Parse a single line of grep-like output.
    Expects format: filePath:lineNumber:lineContent
    """
    if not line.strip():
        return None

    # RFC-0019: match the trailing `:lineNumber:` segment so Windows drive
    # prefixes like `C:\...` do not break parsing.
    match = _GREP_LINE_PATTERN.search(line)
    if match is None:
        return None

    file_path_raw = line[: match.start()]
    line_number_str = match.group(1)
    line_content = match.group(2)

    try:
        line_number = int(line_number_str)
    except ValueError:
        return None

    raw = file_path_raw.strip()
    windows_absolute_match = _WINDOWS_DRIVE_PATH_PATTERN.match(raw)
    if windows_absolute_match is not None:
        base_windows = PureWindowsPath(base_path)
        path_windows = PureWindowsPath(raw)
        try:
            rel = str(path_windows.relative_to(base_windows))
        except Exception:
            rel = raw
    else:
        base = Path(base_path)
        p = Path(raw)
        if p.is_absolute():
            try:
                rel = str(p.relative_to(base))
            except Exception:
                rel = raw
        else:
            rel = raw

    return {
        "filePath": rel,
        "lineNumber": line_number,
        "line": line_content,
    }


def _rg_grep(
    *,
    pattern: str,
    search_path: str,
    include: str | None,
    max_matches: int,
    excludes: list[str],
    sandbox: BaseSandbox,
) -> list[dict[str, Any]]:
    """Run ripgrep in the sandbox and parse results."""
    exe = _find_rg_executable()

    cmd: list[str] = [
        "-n",
        "-H",
        "-i",
        "--no-heading",
        "--color",
        "never",
        "--max-count",
        str(max_matches),
    ]

    # Excludes: best-effort glob negatives.
    for ex in excludes:
        if ex.startswith("*"):
            cmd.extend(["--glob", f"!{ex}"])
        else:
            cmd.extend(["--glob", f"!{ex}/**"])

    if include:
        cmd.extend(["--glob", include])

    cmd.append(pattern)
    cmd.append(sandbox.to_shell_path(search_path))

    prefix = "& " if sys.platform == "win32" else ""
    cmd_str = f'{prefix}"{exe}" ' + " ".join(shlex.quote(x) for x in cmd)
    res = sandbox.execute_shell(cmd_str, timeout=DEFAULT_SEARCH_TIMEOUT_MS)

    if res.status == SandboxStatus.TIMEOUT:
        raise TimeoutError("search_file_content timed out")

    # `rg` exit codes: 0 matches found, 1 no matches, 2 error
    if res.exit_code == 1:
        return []
    if res.status != SandboxStatus.SUCCESS or res.exit_code not in (0, 1):
        raise RuntimeError(res.stderr or res.error or "ripgrep failed")

    matches: list[dict[str, Any]] = []
    for line in (res.stdout or "").splitlines():
        parsed = _parse_grep_line(line, search_path)
        if parsed:
            matches.append(parsed)
            if len(matches) >= max_matches:
                break
    return matches


def search_file_content(
    pattern: str | None = None,
    dir_path: str | None = None,
    include: str | None = None,
    agent_state: AgentState | None = None,
    *,
    Query: str | None = None,
    query: str | None = None,
    SearchPath: str | None = None,
    path: str | None = None,
    Includes: Any | None = None,
    toolAction: str | None = None,
    toolSummary: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Searches for a regular expression pattern within file contents.

    Uses a prioritized strategy:
    1. git grep (if in git repository)
    2. System grep (if available)
    3. Pure Python fallback

    Returns lines containing matches with file paths and line numbers.

    Args:
        pattern: The regular expression pattern to search for (or Query)
        dir_path: Directory to search in (optional, defaults to cwd, or SearchPath)
        include: Glob pattern to filter files (or Includes)

    Returns:
        Dict with content and returnDisplay matching gemini-cli format
    """
    # ponytail: universal parameter alias normalization for cross-model resilience
    pattern = Query or query or pattern or ""
    if SearchPath is not None:
        dir_path = SearchPath
    elif path is not None:
        dir_path = path

    if Includes is not None and include is None:
        if isinstance(Includes, list):
            include = Includes[0] if Includes else None
        else:
            include = str(Includes)

    try:
        sandbox = get_sandbox(agent_state)

        # Validate pattern
        try:
            re.compile(pattern)
        except re.error as e:
            error_msg = f"Invalid regular expression pattern: {pattern}. Error: {str(e)}"
            return {
                "content": error_msg,
                "returnDisplay": "Error: Invalid regex pattern.",
                "error": {
                    "message": error_msg,
                    "type": "INVALID_PATTERN",
                },
            }

        # Determine search directory
        if dir_path:
            search_path = resolve_path(dir_path, sandbox)

            if not sandbox.file_exists(search_path):
                error_msg = f"Path does not exist: {search_path}"
                return {
                    "content": error_msg,
                    "returnDisplay": "Error: Path does not exist.",
                    "error": {
                        "message": error_msg,
                        "type": "FILE_NOT_FOUND",
                    },
                }

            if not sandbox.get_file_info(search_path).is_directory:
                if Path(search_path).suffix.lower() == ".pdf":
                    try:
                        import fitz
                        doc = fitz.open(search_path)
                        pdf_matches = []
                        rx = re.compile(pattern, re.IGNORECASE)
                        for page_idx in range(len(doc)):
                            page_text = doc[page_idx].get_text("text")
                            for line_idx, line in enumerate(page_text.splitlines(), 1):
                                if rx.search(line):
                                    pdf_matches.append({
                                        "filePath": str(Path(search_path).name),
                                        "lineNumber": page_idx + 1,
                                        "line": f"[Page {page_idx + 1}] {line.strip()}",
                                        "lineContent": f"[Page {page_idx + 1}] {line.strip()}",
                                    })
                                    if len(pdf_matches) >= DEFAULT_TOTAL_MAX_MATCHES:
                                        break
                            if len(pdf_matches) >= DEFAULT_TOTAL_MAX_MATCHES:
                                break
                        return _format_results(pdf_matches, pattern, dir_path or Path(search_path).name, "PyMuPDF PDF search")
                    except Exception:
                        pass
                error_msg = f"Path is not a directory: {search_path}"
                return {
                    "content": error_msg,
                    "returnDisplay": "Error: Path is not a directory.",
                    "error": {
                        "message": error_msg,
                        "type": "PATH_IS_NOT_A_DIRECTORY",
                    },
                }
        else:
            search_path = str(sandbox.work_dir)

        search_dir_display = dir_path or "."

        # Execute ripgrep (bundled or system)
        max_matches = DEFAULT_TOTAL_MAX_MATCHES
        if not _rg_available(sandbox):
            error_msg = "ripgrep (rg) binary is required for search_file_content and could not be executed."
            return {
                "content": f"Error: {error_msg}",
                "returnDisplay": "Error: ripgrep unavailable",
                "error": {
                    "message": error_msg,
                    "type": "RIPGREP_UNAVAILABLE",
                },
            }

        matches = _rg_grep(
            pattern=pattern,
            search_path=search_path,
            include=include,
            max_matches=max_matches,
            excludes=DEFAULT_EXCLUDES,
            sandbox=sandbox,
        )
        strategy_used = "ripgrep"

        # Build location description
        search_location = f'in path "{search_dir_display}"'
        filter_desc = f' (filter: "{include}")' if include else ""

        # No matches found
        if not matches:
            no_match_msg = f'No matches found for pattern "{pattern}" {search_location}{filter_desc}.'
            return {
                "content": no_match_msg,
                "returnDisplay": "No matches found",
            }

        # Check if results were truncated
        was_truncated = len(matches) >= max_matches

        # Group matches by file
        matches_by_file: dict[str, list[dict[str, Any]]] = {}
        for match in matches:
            file_key = match["filePath"]
            if file_key not in matches_by_file:
                matches_by_file[file_key] = []
            matches_by_file[file_key].append(match)

        # Sort matches within each file by line number
        for file_matches in matches_by_file.values():
            file_matches.sort(key=lambda m: m["lineNumber"])

        # Build result
        match_count = len(matches)
        match_term = "match" if match_count == 1 else "matches"

        truncation_note = f" (results limited to {max_matches} matches for performance)" if was_truncated else ""

        llm_content = (
            f'Found {match_count} {match_term} for pattern "{pattern}" '
            f"{search_location}{filter_desc}{truncation_note} (strategy: {strategy_used}):\n---\n"
        )

        for file_path, file_matches in matches_by_file.items():
            llm_content += f"File: {file_path}\n"
            for match in file_matches:
                trimmed_line = str(match.get("line") or match.get("lineContent") or "").strip()
                llm_content += f"L{match['lineNumber']}: {trimmed_line}\n"
            llm_content += "---\n"

        return {
            "content": llm_content.strip(),
            "returnDisplay": f"Found {match_count} {match_term}{' (limited)' if was_truncated else ''}",
        }

    except Exception as e:
        error_msg = f"Error during grep search operation: {str(e)}"
        return {
            "content": error_msg,
            "returnDisplay": f"Error: {str(e)}",
            "error": {
                "message": error_msg,
                "type": "GREP_EXECUTION_ERROR",
            },
        }