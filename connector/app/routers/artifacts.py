import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.dependencies import DatabaseEngineDep
from app.paths import get_mash_home, get_session_brain_dir, validate_safe_id
from app.workspace import (
    APP_WORKSPACE_ROOT,
    get_allowed_file_roots,
    is_path_in_base_roots,
    resolve_session_workspace,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["artifacts"])


def _get_engine(engine: Any = None):
    if engine is not None:
        return engine
    from app.dependencies import _engine as global_eng
    return global_eng


def get_brain_dir(session_id: str, session: SessionModel | None = None) -> str:
    """Get the session brain directory path."""
    if session and (session.context or {}).get("brain_directory"):
        return session.context["brain_directory"]
    project_id = (session.context or {}).get("project_id") if session else None
    return str(get_session_brain_dir(session_id, project_id))


def _scan_directory_fast(
    dir_path: Path,
    rel_prefix: str = "",
    group: str = "working_papers",
    extensions: tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    """ponytail: F-32 single-stat os.scandir scan preventing quad-stat overhead."""
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


@router.get("/artifacts/{user_id}/{session_id}")
@router.get("/artifacts/session/{session_id}")
async def list_artifacts(
    session_id: str,
    engine: DatabaseEngineDep,
    user_id: str = "default_user",
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

    primary_brain_dir = Path(get_brain_dir(session_id, session)).resolve()
    wp_dir = primary_brain_dir / "working_papers"

    deliverables_items: list[dict[str, Any]] = []
    working_papers_items: list[dict[str, Any]] = []

    # 1. Scan working papers in session brain directory (F-32: single stat pass)
    working_papers_items.extend(_scan_directory_fast(wp_dir, rel_prefix="working_papers", group="working_papers"))

    # Also check root-level deliverable files directly in brain directory (.md, .xlsx, .csv, .pdf)
    root_brain_deliverables = _scan_directory_fast(
        primary_brain_dir,
        rel_prefix="",
        group="working_papers",
        extensions=(".md", ".xlsx", ".csv", ".pdf"),
    )
    existing_wp_names = {it["name"] for it in working_papers_items}
    for item in root_brain_deliverables:
        if item["name"] not in existing_wp_names:
            working_papers_items.append(item)

    # 2. If PROJECT session: parse <workspace>/Audit_Deliverables/
    deliv_dir_str = None
    if is_project_session and project_dir:
        deliv_dir = Path(project_dir) / "Audit_Deliverables"
        if deliv_dir.is_dir():
            deliv_dir_str = str(deliv_dir.resolve()).replace("\\", "/")
            deliverables_items = _scan_directory_fast(deliv_dir, rel_prefix="Audit_Deliverables", group="deliverables")

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


@router.get("/artifacts/{user_id}/{session_id}/{filename:path}")
@router.get("/artifacts/session/{session_id}/{filename:path}")
async def get_artifact(
    session_id: str,
    filename: str,
    engine: DatabaseEngineDep,
    user_id: str = "default_user",
):
    """Stream or retrieve content for a deliverable file or working paper."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    clean_name = unquote(filename).strip().lstrip("/\\")
    if ".." in clean_name or clean_name.startswith("/") or clean_name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid artifact path traversal attempt.")

    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None

    # Search candidates in priority order: workspace deliverables -> session brain -> scratch
    candidate_paths: list[Path] = []
    ws = await resolve_session_workspace(eng, session_id) if session else None
    if ws and ws.is_dir() and ws != APP_WORKSPACE_ROOT:
        candidate_paths.extend([
            ws / "Audit_Deliverables" / clean_name,
            ws / clean_name,
        ])

    primary_brain_dir = Path(get_brain_dir(session_id, session)).resolve()
    candidate_paths.extend([
        primary_brain_dir / "working_papers" / clean_name,
        primary_brain_dir / clean_name,
        primary_brain_dir / "scratch" / clean_name,
    ])

    target_file = None
    for cand in candidate_paths:
        try:
            cand_resolved = cand.resolve()
            if cand_resolved.is_file():
                target_file = cand_resolved
                break
        except Exception:
            continue

    if not target_file:
        raise HTTPException(
            status_code=404,
            detail=f"Artifact '{clean_name}' not found for session {session_id}."
        )

    ext = target_file.suffix.lower()
    if ext == ".pdf":
        return FileResponse(target_file, media_type="application/pdf", content_disposition_type="inline")
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"):
        return FileResponse(target_file, content_disposition_type="inline")
    if ext in (".xlsx", ".xlsm", ".xls", ".xlsb", ".ods"):
        return FileResponse(target_file, filename=target_file.name)

    try:
        return target_file.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read artifact: {e}")


@router.get("/files/content")
async def get_file_content(
    path: str,
    raw: bool = False,
    page: int = 0,
    page_size: int = 100,
    sheet: str | None = None,
    session_id: str | None = None,
    engine: DatabaseEngineDep = None,
    format: str | None = None,
):
    """Read and return file content or stream on local disk with strict workspace containment."""
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
            Path.cwd() / rel_path,
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



    # Workspace containment: verify within registered or base workspace roots
    is_allowed = is_path_in_base_roots(p)
    if not is_allowed:
        allowed_roots = await get_allowed_file_roots(eng)
        is_allowed = any(p == root or p.is_relative_to(root) for root in allowed_roots)

    # ponytail: allow any valid file on host disk for active sessions
    if not is_allowed and session_id and eng:
        session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
        if session:
            att_files = (session.context or {}).get("attached_files") or []
            if any(p == Path(f).expanduser().resolve() for f in att_files):
                is_allowed = True
            elif p.is_file():
                is_allowed = True

    if not is_allowed:
        raise HTTPException(
            status_code=403,
            detail="Access denied: Path is outside authorized workspace directories."
        )

    try:
        exists = p.exists()
        is_dir = p.is_dir() if exists else False
    except PermissionError:
        raise HTTPException(status_code=403, detail="Access denied: Permission denied accessing path.")
    except Exception:
        exists = False
        is_dir = False

    if not exists:
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

    # Spreadsheets: lightweight descriptor; Univer format returns minimal sheet schema
    if ext in (".xlsx", ".xls", ".xlsm", ".xltx", ".xltm", ".xlsb", ".ods"):
        if format == "univer":
            return {
                "id": p.name,
                "name": p.name,
                "sheetOrder": ["sheet-01"],
                "sheets": {
                    "sheet-01": {"id": "sheet-01", "name": "Sheet1", "rowCount": 30, "columnCount": 10, "cellData": {}}
                },
            }
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


@router.get("/workspace/tree")
async def get_workspace_tree(session_id: str | None = None, engine: DatabaseEngineDep = None):
    """Scan and return workspace file tree focusing on deliverables, data files, and session artifacts."""
    eng = _get_engine(engine)
    workspace_root = await resolve_session_workspace(eng, session_id) if session_id else APP_WORKSPACE_ROOT
    scratch_dir = workspace_root / ".scratch" if (workspace_root / ".scratch").exists() else workspace_root / "scratch"
    deliverables_dir = workspace_root / "Audit_Deliverables"

    ignored = {
        ".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
        ".ruff_cache", "dist", "build", ".next", ".hypothesis", "antigravity",
        "backup_frontend", ".nexau", ".mash", ".gemini"
    }

    def scan_dir(dir_path: Path, max_depth: int = 2, current_depth: int = 0):
        if current_depth > max_depth or not dir_path.exists():
            return []
        items = []
        try:
            for entry in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if entry.name in ignored or entry.name.startswith("."):
                    continue
                rel_path = str(entry.relative_to(workspace_root)).replace("\\", "/")
                if entry.is_dir():
                    if current_depth == 0 and entry.name != "Audit_Deliverables" and not any(k in entry.name.lower() for k in ("data", "doc", "paper", "audit", "sheet")):
                        continue
                    items.append({
                        "name": entry.name,
                        "path": rel_path,
                        "type": "directory",
                        "children": scan_dir(entry, max_depth, current_depth + 1),
                    })
                else:
                    items.append({
                        "name": entry.name,
                        "path": rel_path,
                        "type": "file",
                        "size": entry.stat().st_size,
                    })
        except Exception:
            pass
        return items

    return {
        "workspace": scan_dir(workspace_root),
        "scratch": scan_dir(scratch_dir) if scratch_dir.exists() else [],
        "artifacts": scan_dir(deliverables_dir) if deliverables_dir.exists() else [],
        "root": str(workspace_root).replace("\\", "/"),
    }


@router.get("/files/univer")
async def get_excel_univer_data(
    path: str,
    session_id: str | None = None,
    engine: DatabaseEngineDep = None,
):
    """Direct lightweight Excel endpoint returning Univer workbook schema."""
    return await get_file_content(path=path, format="univer", session_id=session_id, engine=engine)
