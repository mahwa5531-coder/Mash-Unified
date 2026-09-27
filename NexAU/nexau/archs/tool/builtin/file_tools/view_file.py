# Copyright 2026 NexAU Engine
# SPDX-License-Identifier: Apache-2.0
"""
view_file tool - Universal, high-performance polymorphic file and directory viewer.

Directly composes:
- Calamine & Polars fast-bundle engine for spreadsheets (.xlsx, .csv, .parquet)
- Read visual file engine for images, video, and PDFs
- Directory tree engine for folder inspection
- Batch glob engine for wildcard patterns
- Precise 1-indexed line slicing and byte pagination for source code & text
"""

import base64
import hashlib
import logging
import os
import re
import mimetypes
from pathlib import Path
from typing import Any

from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.platform.path_helpers import get_session_brain_dir, get_project_cache_dir
from nexau.archs.sandbox import BaseSandbox, SandboxStatus
from nexau.archs.tool.builtin._sandbox_utils import get_sandbox, resolve_path
from nexau.archs.tool.builtin.file_tools.list_directory import list_directory
from nexau.archs.tool.builtin.file_tools.read_visual_file import read_visual_file
from nexau.archs.tool.builtin.file_tools.read_many_files import read_many_files

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_SIZE = 100  # SWE-agent windowing discipline
MAX_LINES_PER_VIEW = 800
MAX_BYTES_PER_VIEW = 46_080

TABULAR_EXTENSIONS = {".xlsx", ".xls", ".csv", ".tsv", ".parquet"}
VISUAL_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif", ".svg",
    ".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv", ".m4v",
    ".pdf"
}


def _is_visual_file(file_path: str) -> bool:
    return Path(file_path).suffix.lower() in VISUAL_EXTENSIONS


def _format_tabular_output(
    parsed_md: str,
    target_path: str,
    ext: str,
    start: int | None = None,
    end: int | None = None,
    agent_state: AgentState | None = None,
) -> dict[str, Any]:
    """
    Format tabular markdown output.
    - If output fits within MAX_BYTES_PER_VIEW and no slicing requested: return directly (no truncation, 0 disk files).
    - If output exceeds MAX_BYTES_PER_VIEW: keep beginning intact from line 1, truncate only the tail,
      save the complete parsed markdown to cache, and append the clickable file link at the end.
    """
    lines = parsed_md.splitlines(keepends=True)
    total_lines = len(lines)
    total_chars = len(parsed_md)

    # Normal case: content fits comfortably within limits and no specific window requested
    if total_chars <= MAX_BYTES_PER_VIEW and start is None and end is None:
        return {
            "content": parsed_md,
            "returnDisplay": f"Read {ext.upper().lstrip('.')} dataset: {Path(target_path).name} ({total_lines} lines)",
        }

    # Line window resolution
    req_start = max(1, start) if start is not None else 1
    req_end = min(total_lines, end) if end is not None else total_lines

    # Build output from req_start without truncating the beginning
    accumulated_lines = []
    accumulated_chars = 0
    SAFE_CHAR_CEILING = MAX_BYTES_PER_VIEW - 350  # reserve space for notice and link

    last_idx = req_start - 1
    for idx in range(req_start - 1, req_end):
        line = lines[idx]
        if (accumulated_chars + len(line)) > SAFE_CHAR_CEILING and accumulated_lines:
            break
        accumulated_lines.append(line)
        accumulated_chars += len(line)
        last_idx = idx

    output_body = "".join(accumulated_lines)
    is_truncated = (last_idx < total_lines - 1)

    # When output is huge and truncated, save full un-truncated file to cache and provide clickable link
    if is_truncated:
        path_obj = Path(target_path)
        stem = path_obj.stem
        path_hash = hashlib.sha256(str(path_obj.resolve()).lower().encode()).hexdigest()[:8]
        bundle_name = f"{stem}_{path_hash}_fast_bundle"

        session_id = None
        project_id = None
        if agent_state and getattr(agent_state, "context", None):
            ctx = getattr(agent_state, "context", None)
            ctx_dict = getattr(ctx, "context", None) or (ctx if isinstance(ctx, dict) else {})
            session_id = ctx_dict.get("session_id")
            project_id = ctx_dict.get("project_id")

        if session_id:
            cache_dir = get_session_brain_dir(session_id, None) / "cache" / bundle_name
        elif project_id:
            cache_dir = get_project_cache_dir(project_id) / bundle_name
        else:
            cache_dir = Path.home() / ".nexau" / "cache" / bundle_name

        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            clean_stem = re.sub(r"[^\w\-]", "_", stem)
            full_md_path = cache_dir / f"{clean_stem}_full_parsed.md"
            full_md_path.write_text(parsed_md, encoding="utf-8")
            full_md_uri = f"file:///{str(full_md_path).replace(chr(92), '/')}"
            next_start = last_idx + 2
            output_body += (
                f"\n\n[Content truncated at {accumulated_chars:,} characters ({last_idx + 1}/{total_lines} lines). "
                f"Full parsed file available at: {full_md_uri}\n"
                f"To view next window, specify StartLine={next_start}, or open the cached file directly.]"
            )
        except Exception as e:
            logger.debug("Failed to cache full parsed markdown: %s", e)

    return {
        "content": output_body,
        "returnDisplay": f"Read {ext.upper().lstrip('.')} dataset: {Path(target_path).name} (lines {req_start}-{last_idx + 1} of {total_lines})",
    }


def view_file(
    AbsolutePath: str | None = None,
    file_path: str | None = None,
    StartLine: int | None = None,
    start_line: int | None = None,
    EndLine: int | None = None,
    end_line: int | None = None,
    ContentOffset: int | None = None,
    content_offset: int | None = None,
    sheet_name: str | None = None,
    toolAction: str | None = None,
    toolSummary: str | None = None,
    agent_state: AgentState | None = None,
    sandbox: BaseSandbox | None = None,
) -> dict[str, Any]:
    """Polymorphic file viewer supporting text, code, spreadsheets, directories, and visual media."""

    target_path = AbsolutePath if AbsolutePath is not None else file_path
    if not target_path:
        return {
            "content": "Error: 'AbsolutePath' parameter is required for view_file.",
            "returnDisplay": "Error: Missing AbsolutePath",
            "isError": True,
        }

    # Normalize aliases
    start = StartLine if StartLine is not None else start_line
    end = EndLine if EndLine is not None else end_line
    offset = ContentOffset if ContentOffset is not None else content_offset

    # 1. Check for Batch / Glob Wildcard patterns (*, ?, [)
    if any(char in target_path for char in ["*", "?", "["]):
        return read_many_files(include=[target_path], agent_state=agent_state)

    # Resolve sandbox environment
    if sandbox is None:
        sandbox = get_sandbox(agent_state)

    try:
        resolved_path = resolve_path(target_path, sandbox)
    except Exception as e:
        return {
            "content": f"Error resolving path: {e}",
            "returnDisplay": "Error resolving path",
            "isError": True,
        }

    # 2. Check if target is a Directory
    try:
        if sandbox.file_exists(resolved_path):
            info = sandbox.get_file_info(resolved_path)
            if info.is_directory:
                return list_directory(dir_path=target_path, agent_state=agent_state)
    except Exception:
        pass

    # Extract extension
    ext = Path(resolved_path).suffix.lower()

    # 3. Tabular Datasets (.xlsx, .xls, .csv, .parquet) -> Calamine Engine
    if ext in [".xlsx", ".xls"]:
        from nexau.ingestion_pipeline.excel_to_md import parse_excel_to_markdown

        proj_id = None
        sess_id = None
        if agent_state:
            ctx = getattr(agent_state, "context", None)
            if ctx is not None:
                ctx_dict = getattr(ctx, "context", None) or (ctx if isinstance(ctx, dict) else {})
                proj_id = ctx_dict.get("project_id")
                sess_id = ctx_dict.get("session_id")

        parsed_md = parse_excel_to_markdown(
            resolved_path,
            project_id=proj_id,
            session_id=sess_id,
            sheet_name=sheet_name,
        )
        return _format_tabular_output(parsed_md, target_path, ext, start, end, agent_state=agent_state)

    if ext in [".csv", ".tsv"]:
        from nexau.ingestion_pipeline.csv_to_md_parquet import parse_csv_to_markdown

        proj_id = None
        sess_id = None
        if agent_state:
            ctx = getattr(agent_state, "context", None)
            if ctx is not None:
                ctx_dict = getattr(ctx, "context", None) or (ctx if isinstance(ctx, dict) else {})
                proj_id = ctx_dict.get("project_id")
                sess_id = ctx_dict.get("session_id")

        parsed_md = parse_csv_to_markdown(
            resolved_path,
            project_id=proj_id,
            session_id=sess_id,
        )
        return _format_tabular_output(parsed_md, target_path, ext, start, end, agent_state=agent_state)

    # 4. Antigravity & Gemini CLI-Grade Native PDF Ingestion Engine
    if ext == ".pdf":
        max_pdf_bytes = 50 * 1024 * 1024  # 50MB limit matching Gemini Files API
        read_res = sandbox.read_file(resolved_path, binary=True)
        if read_res.status != SandboxStatus.SUCCESS:
            error_msg = read_res.error or f"Failed to read PDF file: {target_path}"
            return {"content": f"Error: {error_msg}", "returnDisplay": f"Error: {error_msg}", "isError": True}

        raw_bytes = bytes(read_res.content) if isinstance(read_res.content, (bytes, bytearray)) else b""
        if not raw_bytes:
            return {"content": "Error: PDF file is empty.", "returnDisplay": "PDF file is empty", "isError": True}

        if len(raw_bytes) > max_pdf_bytes:
            error_msg = f"PDF file too large ({len(raw_bytes)} bytes). Maximum size is {max_pdf_bytes} bytes (50MB)."
            return {
                "content": error_msg,
                "returnDisplay": "PDF file too large (exceeds 50MB limit).",
                "isError": True,
            }

        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=raw_bytes, filetype="pdf")
            num_pages = len(doc)
        except Exception as e:
            return {
                "content": f"Error opening PDF document: {e}",
                "returnDisplay": f"Corrupted or invalid PDF: {Path(target_path).name}",
                "isError": True,
            }

        if num_pages == 0:
            return {
                "content": f"[PDF file '{Path(target_path).name}' contains 0 pages.]",
                "returnDisplay": f"Empty PDF ({Path(target_path).name})",
            }

        # Pure Vision-First Multimodal PDF Engine (Antigravity & Gemini CLI pattern):
        # Renders document pages directly into high-res visual images and converts to base64.
        # Zero brittle text extraction: preserves tables, columns, charts, and geometry natively.
        MAX_SAFE_PAGES = 50  # Protect against exceeding HTTP request payload limits (>30MB)
        if start is not None or end is not None:
            p_start = max(1, start if start is not None else 1)
            p_end = min(num_pages, end if end is not None else num_pages)
        else:
            # Default: Send all pages of the document directly to the vision LLM
            p_start = 1
            p_end = min(num_pages, MAX_SAFE_PAGES)

        if p_end < p_start:
            p_end = p_start

        meta_title = doc.metadata.get("title") if doc.metadata else None
        title_str = f" - '{meta_title}'" if meta_title else ""
        header_text = (
            f"[PDF Document: {Path(target_path).name}{title_str} ({num_pages} total pages)]\n"
            f"All {p_end - p_start + 1} pages rendered into high-resolution visual images for direct multimodal perception."
        )
        if p_end < num_pages:
            header_text += (
                f"\n(Displaying pages {p_start} to {p_end}. {num_pages - p_end} more pages remaining. "
                f"Specify StartLine={p_end + 1}, EndLine={min(num_pages, p_end + MAX_SAFE_PAGES)} to view next window)."
            )

        content_parts: list[dict[str, Any]] = [{"type": "text", "text": header_text}]

        for p_idx in range(p_start - 1, p_end):
            page_num = p_idx + 1
            page = doc[p_idx]
            # 150 DPI provides crystal-clear rendering for financial balance sheets and fine print
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("jpeg", jpg_quality=85)
            img_b64 = base64.b64encode(img_bytes).decode("utf-8")
            content_parts.append({
                "type": "image",
                "image_url": f"data:image/jpeg;base64,{img_b64}",
                "detail": "high",
            })

        display_desc = f"Read PDF {Path(target_path).name} (rendered {p_end - p_start + 1} visual pages for multimodal model)"
        return {
            "content": content_parts,
            "returnDisplay": display_desc,
        }

    # 5. Multimodal Visual / Media -> Visual Engine
    if ext in VISUAL_EXTENSIONS or _is_visual_file(resolved_path):
        return read_visual_file(
            file_path=target_path,
            agent_state=agent_state,
        )

    # 5. Guard against complex office documents, compiled binaries, databases, and archives
    # ponytail: explicit rejection prevents context flooding with corrupt binary strings
    unsupported_binary_exts = {
        ".docx", ".doc", ".pptx", ".ppt", ".zip", ".tar", ".gz", ".7z", ".rar",
        ".exe", ".bin", ".iso", ".dmg", ".dll", ".so", ".dylib", ".msi", ".sys",
        ".pyc", ".pyo", ".pyd", ".class", ".o", ".obj", ".lib", ".a",
        ".db", ".sqlite", ".sqlite3", ".db-wal", ".db-shm", ".sst",
        ".mp3", ".wav", ".aac", ".flac", ".ogg",
    }
    if ext in unsupported_binary_exts:
        return {
            "content": (
                f"Viewing binary document or archive '{Path(target_path).name}' ({ext}) is not supported. "
                "MASH natively renders PDF, images, JSON, tabular files (.xlsx, .csv), and text/code files."
            ),
            "returnDisplay": f"Unsupported format: {ext}",
            "isError": True,
        }

    # 6. Source Code & Text Files -> 1-Indexed Line Slicing with SWE-agent windowing
    read_res = sandbox.read_file(resolved_path, binary=True)
    if read_res.status != SandboxStatus.SUCCESS:
        error_msg = read_res.error or f"Failed to read file: {target_path}"
        return {
            "content": f"Error: {error_msg}",
            "returnDisplay": f"Error: {error_msg}",
            "isError": True,
        }

    content_val = read_res.content
    if isinstance(content_val, (bytes, bytearray)):
        raw_bytes = bytes(content_val)
    elif isinstance(content_val, str):
        raw_bytes = content_val.encode("utf-8")
    else:
        raw_bytes = b""

    total_bytes = len(raw_bytes)

    # Apply byte ContentOffset if provided
    byte_start = max(0, offset or 0)
    if byte_start >= total_bytes and total_bytes > 0:
        return {
            "content": f"[ContentOffset {byte_start} exceeds total file size ({total_bytes} bytes).]",
            "returnDisplay": f"End of file reached ({total_bytes} bytes)",
        }

    # Slice raw bytes within 46KB window
    byte_chunk = raw_bytes[byte_start : byte_start + MAX_BYTES_PER_VIEW]
    is_byte_truncated = (byte_start + len(byte_chunk)) < total_bytes

    # Lossless/lossy UTF-8 decode
    text_content = byte_chunk.decode("utf-8", errors="replace")
    all_lines = text_content.splitlines(keepends=True)
    total_lines = len(all_lines)

    # Handle line slicing (1-indexed)
    # SWE-agent windowing discipline: if unbounded, default to DEFAULT_WINDOW_SIZE (100 lines)
    is_unbounded = (start is None and end is None)
    req_start = max(1, start) if start is not None else 1
    if end is not None:
        req_end = min(total_lines, end)
    elif is_unbounded and total_lines > DEFAULT_WINDOW_SIZE:
        req_end = min(total_lines, DEFAULT_WINDOW_SIZE)
    else:
        req_end = min(total_lines, req_start + MAX_LINES_PER_VIEW - 1)

    if req_end < req_start:
        req_end = req_start

    # Enforce hard ceiling of 800 lines per single call
    if (req_end - req_start + 1) > MAX_LINES_PER_VIEW:
        req_end = req_start + MAX_LINES_PER_VIEW - 1

    selected_lines = all_lines[req_start - 1 : req_end]

    # Format lines with 1-indexed numbers and SWE-agent spatial markers
    formatted_chunks = []
    
    # Spatial marker above
    if req_start > 1:
        formatted_chunks.append(f"[({req_start - 1} lines above)]")

    for idx, line in enumerate(selected_lines):
        line_no = req_start + idx
        clean_line = line.rstrip("\r\n")
        formatted_chunks.append(f"{line_no:5d} | {clean_line}")

    # Spatial marker below
    if req_end < total_lines:
        remaining = total_lines - req_end
        next_start = req_end + 1
        next_end = min(total_lines, next_start + DEFAULT_WINDOW_SIZE - 1)
        formatted_chunks.append(
            f"\n[({remaining} more lines below. Use StartLine={next_start}, EndLine={next_end} to view next window)]"
        )
    elif is_byte_truncated:
        next_offset = byte_start + len(byte_chunk)
        formatted_chunks.append(f"\n[Byte content truncated at {next_offset}/{total_bytes} bytes.]")

    output_text = "\n".join(formatted_chunks)

    display_info = f"Viewed {target_path}"
    if total_lines > 0:
        display_info += f" (lines {req_start}-{req_end} of {total_lines})"

    return {
        "content": output_text,
        "returnDisplay": display_info,
    }
