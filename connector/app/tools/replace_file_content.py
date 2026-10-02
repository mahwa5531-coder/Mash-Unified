# Copyright 2026 NexAU Engine
# SPDX-License-Identifier: Apache-2.0
"""
replace_file_content tool - Industrial-grade deterministic code editor.

Combines Antigravity strict line-scoping with Aider & OpenHands global uniqueness resolution:
1. Tier 1 (Exact Range Match): If TargetContent is in [StartLine, EndLine], replaces it with mathematical precision.
2. Tier 2 (Global Unique Match): If not in [StartLine, EndLine], checks if TargetContent is 100% UNIQUE in the entire file.
   If unique, replaces it safely at its actual line position (eliminates LLM line-drift errors).
3. Tier 3 (Whitespace-Tolerant Unique Match): Checks line-by-line stripped matching for trailing whitespace variations.
4. Tier 4 (Ambiguity Guard & Safe Diagnostic Abort): If TargetContent occurs multiple times outside the range,
   or doesn't exist, safely aborts with diagnostic line context.
"""

import difflib
import logging
from pathlib import Path
from typing import Any

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.sandbox import BaseSandbox, SandboxStatus
from nexau.archs.tool.builtin._sandbox_utils import get_sandbox, resolve_path

logger = logging.getLogger(__name__)


def replace_file_content(
    TargetFile: str | None = None,
    file_path: str | None = None,
    StartLine: int | None = None,
    start_line: int | None = None,
    EndLine: int | None = None,
    end_line: int | None = None,
    TargetContent: str | None = None,
    old_string: str | None = None,
    ReplacementContent: str | None = None,
    new_string: str | None = None,
    AllowMultiple: bool | None = None,
    allow_multiple: bool | None = None,
    Instruction: str | None = None,
    instruction: str | None = None,
    Description: str | None = None,
    description: str | None = None,
    TargetLintErrorIds: list[str] | None = None,
    toolAction: str | None = None,
    toolSummary: str | None = None,
    agent_state: AgentState | None = None,
    sandbox: BaseSandbox | None = None,
) -> dict[str, Any]:
    """Surgically edits a file with strict line-bounding and global uniqueness safety."""

    # 1. Parameter normalization
    target_file = TargetFile or file_path
    if not target_file:
        return {
            "content": "Error: 'TargetFile' parameter is required for replace_file_content.",
            "returnDisplay": "Error: Missing TargetFile",
            "isError": True,
        }

    s_line = StartLine if StartLine is not None else start_line
    e_line = EndLine if EndLine is not None else end_line
    target_text = TargetContent if TargetContent is not None else old_string
    replace_text = ReplacementContent if ReplacementContent is not None else new_string

    allow_mult = AllowMultiple if AllowMultiple is not None else (allow_multiple if allow_multiple is not None else False)

    if s_line is None or e_line is None:
        return {
            "content": "Error: Both 'StartLine' and 'EndLine' are required to bound the edit range.",
            "returnDisplay": "Error: Missing StartLine/EndLine",
            "isError": True,
        }

    if target_text is None or replace_text is None:
        return {
            "content": "Error: Both 'TargetContent' and 'ReplacementContent' are required.",
            "returnDisplay": "Error: Missing TargetContent/ReplacementContent",
            "isError": True,
        }

    if s_line > e_line:
        return {
            "content": f"Error: StartLine ({s_line}) cannot be greater than EndLine ({e_line}).",
            "returnDisplay": "Error: Invalid line range",
            "isError": True,
        }

    if Path(target_file).suffix.lower() == ".ipynb":
        return {
            "content": "Error: Direct editing of .ipynb notebook files is not supported.",
            "returnDisplay": "Error: Unsupported file format (.ipynb)",
            "isError": True,
        }

    # 2. Sandbox and path resolution
    if sandbox is None:
        sandbox = get_sandbox(agent_state)

    try:
        resolved_path = resolve_path(target_file, sandbox)
    except Exception as e:
        return {
            "content": f"Error resolving path: {e}",
            "returnDisplay": "Error resolving path",
            "isError": True,
        }

    if not sandbox.file_exists(resolved_path):
        return {
            "content": f"Error: File not found: {target_file}",
            "returnDisplay": f"Error: File not found ({target_file})",
            "isError": True,
        }

    # 3. Read file content
    read_res = sandbox.read_file(resolved_path, binary=True)
    if read_res.status != SandboxStatus.SUCCESS:
        return {
            "content": f"Error reading file: {read_res.error or 'Unknown error'}",
            "returnDisplay": "Error reading file",
            "isError": True,
        }

    content_val = read_res.content
    if isinstance(content_val, (bytes, bytearray)):
        raw_bytes = bytes(content_val)
    elif isinstance(content_val, str):
        raw_bytes = content_val.encode("utf-8")
    else:
        raw_bytes = b""

    # Detect line endings
    has_crlf = b"\r\n" in raw_bytes
    file_text = raw_bytes.decode("utf-8", errors="replace")
    lines = file_text.splitlines(keepends=True)
    total_lines = len(lines)

    # Normalize line endings for internal computation
    normalized_file = file_text.replace("\r\n", "\n")
    search_str = target_text.replace("\r\n", "\n")
    replace_str = replace_text.replace("\r\n", "\n")

    # Bound line ranges
    s_idx = max(0, min(s_line - 1, total_lines))
    e_idx = max(0, min(e_line, total_lines))

    applied_tier = None
    new_full_content = None
    diff_original = None
    diff_modified = None
    actual_s = s_line
    actual_e = e_line

    # -------------------------------------------------------------
    # TIER 1: Exact Range Match [StartLine, EndLine]
    # -------------------------------------------------------------
    target_chunk = "".join(lines[s_idx:e_idx]).replace("\r\n", "\n")
    if search_str in target_chunk:
        occurrences = target_chunk.count(search_str)
        if not allow_mult and occurrences > 1:
            return {
                "content": (
                    f"Error: Found {occurrences} occurrences of TargetContent within lines {s_line}-{e_line}. "
                    f"Set AllowMultiple=True to replace all, or narrow your line range."
                ),
                "returnDisplay": f"Multiple occurrences ({occurrences}) in range",
                "isError": True,
            }
        
        count_to_replace = -1 if allow_mult else 1
        new_chunk = target_chunk.replace(search_str, replace_str, count_to_replace)
        
        prefix = "".join(lines[:s_idx])
        suffix = "".join(lines[e_idx:])
        new_full_content = prefix + new_chunk + suffix
        diff_original = target_chunk
        diff_modified = new_chunk
        applied_tier = "exact_range"

    # -------------------------------------------------------------
    # TIER 2: Global Unique Match (Aider / OpenHands Pattern)
    # Only triggered if TargetContent appears EXACTLY ONCE in the whole file.
    # Eliminates errors caused by LLM line-counting drift without ambiguity risk.
    # -------------------------------------------------------------
    if applied_tier is None:
        global_count = normalized_file.count(search_str)
        if global_count == 1:
            match_pos = normalized_file.find(search_str)
            match_start_line = normalized_file[:match_pos].count("\n") + 1
            match_end_line = match_start_line + search_str.count("\n")
            
            new_normalized_file = normalized_file[:match_pos] + replace_str + normalized_file[match_pos + len(search_str):]
            new_full_content = new_normalized_file
            diff_original = search_str
            diff_modified = replace_str
            applied_tier = "global_unique"
            actual_s = match_start_line
            actual_e = match_end_line

    # -------------------------------------------------------------
    # TIER 3: Whitespace-Tolerant Unique Match (Aider Pattern)
    # -------------------------------------------------------------
    if applied_tier is None:
        search_lines_stripped = [l.rstrip() for l in search_str.split("\n")]
        file_lines_stripped = [l.rstrip() for l in normalized_file.split("\n")]
        
        match_line_indices = []
        L = len(search_lines_stripped)
        for i in range(len(file_lines_stripped) - L + 1):
            if file_lines_stripped[i : i + L] == search_lines_stripped:
                match_line_indices.append(i)
                
        if len(match_line_indices) == 1:
            matched_i = match_line_indices[0]
            orig_slice = lines[matched_i : matched_i + L]
            prefix = "".join(lines[:matched_i])
            suffix = "".join(lines[matched_i + L:])
            
            new_lines_block = replace_str if replace_str.endswith("\n") else replace_str + "\n"
            new_full_content = prefix + new_lines_block + suffix
            diff_original = "".join(orig_slice)
            diff_modified = new_lines_block
            applied_tier = "whitespace_tolerant"
            actual_s = matched_i + 1
            actual_e = matched_i + L

    # -------------------------------------------------------------
    # TIER 4: Ambiguity Guard & Safe Diagnostic Abort
    # -------------------------------------------------------------
    if applied_tier is None:
        global_count = normalized_file.count(search_str)
        sample_chunk = "\n".join([f"  L{s_line + idx}: {l.rstrip()}" for idx, l in enumerate(lines[s_idx:min(e_idx, s_idx + 10)])])
        
        if global_count > 1:
            hint = f"Note: TargetContent was found {global_count} times in other parts of the file. Please specify accurate StartLine and EndLine to disambiguate."
        else:
            hint = "TargetContent was not found anywhere in the file. Verify indentation or check if the file was already modified."

        return {
            "content": (
                f"Error: TargetContent was not found within lines {s_line} to {e_line} of {target_file}.\n"
                f"{hint}\n\n"
                f"Actual content currently in lines {s_line}-{min(e_line, s_line + 9)}:\n{sample_chunk}"
            ),
            "returnDisplay": f"TargetContent not found in L{s_line}-L{e_line}",
            "isError": True,
        }

    # Restore CRLF if original file used CRLF
    if has_crlf:
        new_full_content = new_full_content.replace("\r\n", "\n").replace("\n", "\r\n")

    # 4. Write updated content back to disk
    write_res = sandbox.write_file(
        resolved_path,
        new_full_content,
        encoding="utf-8",
        binary=False,
    )
    if write_res.status != SandboxStatus.SUCCESS:
        return {
            "content": f"Error writing file: {write_res.error or 'Failed to write'}",
            "returnDisplay": "Error writing file",
            "isError": True,
        }

    # 5. Generate clean unified diff for return display
    diff_lines = list(difflib.unified_diff(
        diff_original.splitlines(keepends=True),
        diff_modified.splitlines(keepends=True),
        fromfile=f"original:{target_file}:L{actual_s}-L{actual_e}",
        tofile=f"modified:{target_file}:L{actual_s}-L{actual_e}",
        n=2,
    ))
    diff_text = "".join(diff_lines)

    tier_notes = {
        "exact_range": f"Replaced in {target_file} (lines {actual_s}-{actual_e})",
        "global_unique": f"Replaced unique target in {target_file} (located at lines {actual_s}-{actual_e})",
        "whitespace_tolerant": f"Replaced in {target_file} (whitespace-matched at lines {actual_s}-{actual_e})",
    }
    action_desc = tier_notes.get(applied_tier, f"Replaced in {target_file}")

    return {
        "content": f"Successfully updated {target_file} ({action_desc}).\n\n```diff\n{diff_text}```",
        "returnDisplay": action_desc,
        "isError": False,
    }
