import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.dependencies import DatabaseEngineDep, resolve_engine as _get_engine
from app.paths import get_mash_home, get_session_brain_dir, validate_safe_id
from app.workspace import APP_WORKSPACE_ROOT, resolve_session_workspace

logger = logging.getLogger(__name__)

router = APIRouter(tags=["artifacts"])


def _recover_from_sqlite_direct(session_id: str, p: Path, clean_path: str) -> str | None:
    """Recover file content from session tool call history if file was deleted or ephemeral."""
    try:
        import sqlite3, json
        from app.paths import get_database_path
        db_path = get_database_path()
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()
        rows = cur.execute(
            "SELECT append_messages, replace_messages FROM agent_run_actions WHERE session_id = ? ORDER BY created_at_ns DESC",
            (session_id,)
        ).fetchall()
        norm_name = p.name.lower()
        norm_clean = clean_path.replace("\\", "/").lower()
        for r in rows:
            raw = r[0] or r[1]
            if not raw:
                continue
            msgs = json.loads(raw)
            for m in msgs:
                for b in m.get("content", []):
                    b_type = b.get("type")
                    if b_type in ("tool_use", "tool_call"):
                        inp = b.get("input", {}) or {}
                        if isinstance(inp, dict):
                            t_path = str(inp.get("TargetFile") or inp.get("AbsolutePath") or inp.get("path") or inp.get("file_path") or "").replace("\\", "/").lower()
                            if t_path and (norm_name in t_path or norm_clean in t_path):
                                if inp.get("content") and isinstance(inp.get("content"), str):
                                    conn.close()
                                    return inp["content"]
        conn.close()
    except Exception as e:
        logger.debug(f"Virtual file recovery failed: {e}")
    return None


def _scan_directory_fast(
    dir_path: Path,
    rel_prefix: str = "",
    group: str = "working_papers",
    extensions: tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    """F-32 single-stat os.scandir scan preventing quad-stat overhead."""
    items = []
    if not dir_path.is_dir():
        return items
    try:
        with os.scandir(dir_path) as it:
            for entry in it:
                if entry.name.startswith("."):
                    continue
                if entry.is_file():
                    if extensions and not entry.name.lower().endswith(extensions):
                        continue
                    st = entry.stat()
                    items.append({
                        "name": entry.name,
                        "rel_path": f"{rel_prefix}/{entry.name}" if rel_prefix else entry.name,
                        "path": str(Path(entry.path).resolve()).replace("\\", "/"),
                        "mtime": st.st_mtime,
                        "size": st.st_size,
                        "group": group,
                    })
        items.sort(key=lambda x: x["mtime"], reverse=True)
    except Exception as e:
        logger.debug(f"Error scanning directory {dir_path}: {e}")
    return items


@router.get("/artifacts/session/{session_id}")
async def list_artifacts(
    session_id: str,
    engine: DatabaseEngineDep,
):
    """List deliverables and working papers for a session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None

    ws = await resolve_session_workspace(eng, session_id) if session else None
    is_project_session = bool(ws and ws.is_dir() and ws != APP_WORKSPACE_ROOT)
    project_dir = str(ws.resolve()) if is_project_session and ws else None

    project_id = (session.context or {}).get("project_id") if session else None
    primary_brain_dir = Path(get_session_brain_dir(session_id, project_id)).resolve()
    wp_dir = primary_brain_dir / "working_papers"

    deliverables_items: list[dict[str, Any]] = []
    working_papers_items: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    # 1. Scan working papers in session brain directory (F-32: single stat pass)
    working_papers_items.extend(_scan_directory_fast(wp_dir, rel_prefix="working_papers", group="working_papers"))

    # 2. Check root-level deliverable files directly in brain directory (.md, .xlsx, .csv, .pdf)
    root_brain_deliverables = _scan_directory_fast(
        primary_brain_dir,
        rel_prefix="",
        group="deliverables",
        extensions=(".md", ".xlsx", ".csv", ".pdf"),
    )
    for item in root_brain_deliverables:
        if item["name"] not in seen_names:
            seen_names.add(item["name"])
            deliverables_items.append(item)

    # 3. If PROJECT session: parse <workspace>/Audit_Deliverables/
    deliv_dir_str = None
    if is_project_session and project_dir:
        deliv_dir = Path(project_dir) / "Audit_Deliverables"
        if deliv_dir.is_dir():
            deliv_dir_str = str(deliv_dir.resolve()).replace("\\", "/")
            proj_deliverables = _scan_directory_fast(deliv_dir, rel_prefix="Audit_Deliverables", group="deliverables")
            for item in proj_deliverables:
                if item["name"] not in seen_names:
                    seen_names.add(item["name"])
                    deliverables_items.append(item)

    all_items = deliverables_items + working_papers_items

    return {
        "is_project_session": is_project_session,
        "deliverables": deliverables_items,
        "working_papers": working_papers_items,
        "items": all_items,
        "files": [it["rel_path"] for it in all_items],
        "project_directory": project_dir,
        "deliverables_directory": deliv_dir_str,
        "brain_directory": str(primary_brain_dir),
        "working_papers_directory": str(wp_dir.resolve()).replace("\\", "/"),
        "mode": "workspace" if is_project_session else "standalone",
    }


@router.api_route("/files/content", methods=["GET", "HEAD"])
async def get_file_content(
    path: str,
    raw: bool = False,
    session_id: str | None = None,
    engine: DatabaseEngineDep = None,
):
    """Read and return file content or stream on local disk."""
    clean_path = unquote(path).strip()
    if not clean_path:
        raise HTTPException(status_code=400, detail="File path cannot be empty.")

    # Traversal defense
    if any(p in clean_path.split("/") or p in clean_path.split("\\") for p in ("..", ".%2e", "%2e.")):
        raise HTTPException(status_code=403, detail="Invalid path traversal detected.")

    eng = _get_engine(engine)
    p = Path(clean_path).expanduser()
    if not (p.is_absolute() and p.is_file()):
        rel_path = clean_path.lstrip("/\\")
        candidates: list[Path] = []
        if session_id:
            try:
                validate_safe_id(session_id, "session_id")
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            s_dir = get_session_brain_dir(session_id).resolve()
            if s_dir.is_dir():
                candidates.extend([
                    s_dir / rel_path,
                    s_dir / "working_papers" / rel_path,
                    s_dir / "scratch" / rel_path,
                ])
            try:
                ws = await resolve_session_workspace(eng, session_id)
                if ws and ws.is_dir():
                    candidates.extend([
                        ws / rel_path,
                        ws / "Audit_Deliverables" / rel_path,
                        ws / "working_papers" / rel_path,
                    ])
            except Exception:
                pass
        candidates.extend([
            APP_WORKSPACE_ROOT / rel_path,
        ])
        for cand in candidates:
            if cand.is_file():
                p = cand.resolve()
                break
        else:
            p = p.resolve()
    else:
        p = p.resolve()

    # Enforce session authorization for brain storage access
    brain_root = (get_mash_home() / "brain").resolve()
    if p.is_relative_to(brain_root):
        if not session_id:
            raise HTTPException(
                status_code=403,
                detail="Access denied: Direct access to session brain files without session authorization is forbidden."
            )
        validate_safe_id(session_id, "session_id")

    # desktop read model — any local file the host OS user can read is viewable

    try:
        exists = p.exists()
        is_dir = p.is_dir() if exists else False
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied: Permission denied accessing path.")
    except Exception:
        exists = False
        is_dir = False

    if not exists:
        if session_id:
            v_content = _recover_from_sqlite_direct(session_id, p, clean_path)
            if v_content is not None:
                return {
                    "type": "text",
                    "filename": p.name,
                    "path": str(p),
                    "content": v_content,
                }
        raise HTTPException(status_code=404, detail=f"File '{clean_path}' not found on local disk.")

    if is_dir:
        raise HTTPException(status_code=403, detail="Access denied: Path is a directory.")

    ext = p.suffix.lower()
    if ext == ".pdf":
        return FileResponse(p, media_type="application/pdf", content_disposition_type="inline")

    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"):
        return FileResponse(p, content_disposition_type="inline")

    if raw or ext in (".docx", ".doc", ".pptx", ".ppt", ".zip", ".tar", ".gz", ".7z", ".rar", ".exe", ".bin", ".db", ".sqlite", ".sqlite3"):
        return FileResponse(p, filename=p.name)

    # Spreadsheets: lightweight descriptor; raw bytes parsed client-side in ExcelViewerCard
    if ext in (".xlsx", ".xls", ".xlsm", ".xltx", ".xltm", ".xlsb", ".ods"):
        return {"type": "excel", "filename": p.name, "path": str(p)}

    # Text, code, markdown, and CSV file reading with safe 10MB preview truncation
    try:
        file_size = p.stat().st_size
        MAX_SAFE_PREVIEW_BYTES = 10_000_000
        if file_size > MAX_SAFE_PREVIEW_BYTES:
            with open(p, "rb") as f:
                raw_chunk = f.read(MAX_SAFE_PREVIEW_BYTES)
            text_chunk = raw_chunk.decode("utf-8", errors="replace")
            last_nl = text_chunk.rfind("\n")
            if last_nl > 0 and (len(text_chunk) - last_nl) < 100_000:
                text_chunk = text_chunk[:last_nl]
            return {
                "type": "text",
                "filename": p.name,
                "path": str(p),
                "content": text_chunk,
                "is_truncated": True,
                "total_bytes": file_size,
                "preview_bytes": len(text_chunk.encode("utf-8")),
            }
        raw_text = p.read_text(encoding="utf-8", errors="replace")
        clean_text = raw_text.replace("\r\r\n", "\n").replace("\r\n", "\n").replace("\r", "\n")
        return {"content": clean_text}
    except Exception as e:
        return {"content": f"Error reading file: {e}"}
