import asyncio
import csv
import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.dependencies import DatabaseEngineDep
from app.paths import get_session_brain_dir, validate_safe_id
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


@router.get("/artifacts/{user_id}/{session_id}")
@router.get("/api/artifacts/{user_id}/{session_id}")
@router.get("/artifacts/session/{session_id}")
@router.get("/api/artifacts/session/{session_id}")
async def list_artifacts(
    session_id: str,
    engine: DatabaseEngineDep,
    user_id: str = "default_user",
):
    """List deliverables for a session:
    - If in a project workspace: parse ONLY <workspace>/Audit_Deliverables/
    - If in a standalone session (No Repo): parse ONLY <brain_dir>/working_papers/
    """
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None

    ws = await resolve_session_workspace(eng, session_id) if session else None
    is_project_session = False
    project_dir = None
    if ws and ws.is_dir() and ws != APP_WORKSPACE_ROOT:
        is_project_session = True
        project_dir = str(ws)
    elif session and session.context:
        ws_uri = session.context.get("workspace_uri", "")
        if ws_uri and ws_uri != "No Repo" and Path(ws_uri).is_dir():
            is_project_session = True
            project_dir = str(Path(ws_uri).resolve())

    primary_brain_dir = get_brain_dir(session_id, session)
    wp_dir = Path(primary_brain_dir) / "working_papers"

    deliverables_items = []
    working_papers_items = []

    # 1. Scan working_papers in session brain directory (always present for all sessions)
    if wp_dir.is_dir():
        for f in sorted(wp_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file() and not f.name.startswith("."):
                working_papers_items.append({
                    "name": f.name,
                    "rel_path": f"working_papers/{f.name}",
                    "path": str(f.resolve()).replace("\\", "/"),
                    "mtime": f.stat().st_mtime,
                    "size": f.stat().st_size,
                    "group": "working_papers",
                })
    # Also check root-level deliverable files directly in brain directory (.md, .xlsx, .csv, .pdf)
    b_path = Path(primary_brain_dir)
    if b_path.is_dir():
        for f in sorted(b_path.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
            if f.is_file() and f.suffix.lower() in (".md", ".xlsx", ".csv", ".pdf") and not f.name.startswith("."):
                if f.name not in {it["name"] for it in working_papers_items}:
                    working_papers_items.append({
                        "name": f.name,
                        "rel_path": f.name,
                        "path": str(f.resolve()).replace("\\", "/"),
                        "mtime": f.stat().st_mtime,
                        "size": f.stat().st_size,
                        "group": "working_papers",
                    })

    # 2. If PROJECT session: parse <workspace>/Audit_Deliverables/
    deliv_dir_str = None
    if is_project_session and project_dir:
        deliv_dir = Path(project_dir) / "Audit_Deliverables"
        if deliv_dir.is_dir():
            deliv_dir_str = str(deliv_dir.resolve()).replace("\\", "/")
            for f in sorted(deliv_dir.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if f.is_file() and not f.name.startswith("."):
                    deliverables_items.append({
                        "name": f.name,
                        "rel_path": f"Audit_Deliverables/{f.name}",
                        "path": str(f.resolve()).replace("\\", "/"),
                        "mtime": f.stat().st_mtime,
                        "size": f.stat().st_size,
                        "group": "deliverables",
                    })

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
@router.get("/api/artifacts/{user_id}/{session_id}/{filename:path}")
@router.get("/artifacts/session/{session_id}/{filename:path}")
@router.get("/api/artifacts/session/{session_id}/{filename:path}")
async def get_artifact(
    filename: str,
    session_id: str,
    engine: DatabaseEngineDep,
    user_id: str = "default_user",
):
    """Serve an artifact file from the session brain directory or project workspace."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None
    primary_brain_dir = get_brain_dir(session_id, session)

    candidate_dirs = [
        Path(primary_brain_dir),
        Path.home() / ".mash" / "brain" / session_id,
        Path.home() / ".nexau" / "brain" / session_id,
    ]

    for b_dir in candidate_dirs:
        b_res = b_dir.resolve()
        candidate_paths = [
            (b_dir / filename).resolve(),
            (b_dir / "working_papers" / filename).resolve(),
            (b_dir / "scratch" / filename).resolve(),
        ]
        for cp in candidate_paths:
            try:
                if cp.is_file() and cp.is_relative_to(b_res):
                    return FileResponse(str(cp))
            except ValueError:
                continue

    # Check in project / workspace directory and deliverables (Audit_Deliverables & NexAU_Outputs)
    try:
        ws = await resolve_session_workspace(eng, session_id)
        if ws and ws.is_dir():
            ws_root = ws.resolve()
            clean_sub = filename.replace("NexAU_Outputs/", "").replace("NexAU_Outputs\\", "").replace("Audit_Deliverables/", "").replace("Audit_Deliverables\\", "")
            ws_candidates = [
                (ws_root / filename).resolve(),
                (ws_root / "Audit_Deliverables" / filename).resolve(),
                (ws_root / "Audit_Deliverables" / clean_sub).resolve(),
                (ws_root / "NexAU_Outputs" / filename).resolve(),
                (ws_root / "NexAU_Outputs" / clean_sub).resolve(),
            ]
            for cp in ws_candidates:
                try:
                    if cp.is_file() and cp.is_relative_to(ws_root):
                        return FileResponse(str(cp))
                except ValueError:
                    continue
    except Exception:
        pass

    raise HTTPException(status_code=404, detail=f"Artifact file '{filename}' not found")


# ponytail: Support both GET and HEAD per RFC 9110 for browser pre-flight checks (PdfViewer)
@router.api_route("/files/content", methods=["GET", "HEAD"])
@router.api_route("/api/files/content", methods=["GET", "HEAD"])
async def get_file_content(
    path: str,
    raw: bool = False,
    sheet: str | None = None,
    page: int = 0,
    page_size: int = 200,
    format: str | None = None,
    session_id: str | None = None,
    engine: DatabaseEngineDep = None
):
    """Read local file text for the frontend Monaco editor view, parse Excel workbooks with Rust engine, or serve images/binaries directly."""
    mash_root = Path(__file__).parent.parent.parent.parent.resolve()
    eng = _get_engine(engine)

    # Normalize path, strip file protocol, anchors, and Windows drive anomalies
    clean_path = unquote(path).strip()
    clean_path = re.sub(r"^file:///?", "", clean_path, flags=re.IGNORECASE)
    clean_path = re.sub(r"^/([a-zA-Z]:)", r"\1", clean_path)
    clean_path = clean_path.split("#")[0].strip()

    p = Path(clean_path).expanduser()
    if p.is_absolute() and p.is_file():
        p = p.resolve()
    else:
        found = False
        rel_path = clean_path.lstrip("/\\")
        candidates: list[Path] = []
        if session_id:
            try:
                validate_safe_id(session_id, "session_id")
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            for b_folder in [".mash", ".nexau"]:
                s_dir = (Path.home() / b_folder / "brain" / session_id).resolve()
                if s_dir.is_dir():
                    for cp in [
                        s_dir / rel_path,
                        s_dir / f"{rel_path}.md",
                        s_dir / "working_papers" / rel_path,
                        s_dir / "working_papers" / f"{rel_path}.md",
                        s_dir / "scratch" / rel_path,
                        s_dir / ".system_generated" / "tasks" / rel_path,
                        s_dir / ".system_generated" / "logs" / rel_path,
                    ]:
                        try:
                            if cp.resolve().is_relative_to(s_dir):
                                candidates.append(cp)
                        except Exception:
                            pass
            try:
                ws = await resolve_session_workspace(eng, session_id)
                if ws and ws.is_dir():
                    clean_sub = rel_path.replace("NexAU_Outputs/", "").replace("NexAU_Outputs\\", "").replace("Audit_Deliverables/", "").replace("Audit_Deliverables\\", "")
                    for cp in [
                        ws / rel_path,
                        ws / "Audit_Deliverables" / rel_path,
                        ws / "Audit_Deliverables" / clean_sub,
                        ws / "NexAU_Outputs" / rel_path,
                        ws / "NexAU_Outputs" / clean_sub,
                    ]:
                        try:
                            if cp.resolve().is_relative_to(ws):
                                candidates.append(cp)
                        except Exception:
                            pass
            except Exception:
                pass
        candidates.extend([
            Path.cwd() / rel_path,
            mash_root / rel_path,
        ])
        for cand in candidates:
            if cand.is_file():
                p = cand.resolve()
                found = True
                break
        if not found:
            try:
                p = p.resolve()
            except Exception:
                pass

    # ponytail: Strict cross-session isolation. Direct path access to session brain
    # directories must strictly match the authorized session_id to prevent cross-session leaks.
    for b_folder in [".mash", ".nexau"]:
        brain_root = (Path.home() / b_folder / "brain").resolve()
        try:
            if p == brain_root or p.is_relative_to(brain_root):
                if not session_id:
                    raise HTTPException(
                        status_code=403,
                        detail="Access denied: Direct access to session brain files without session authorization is forbidden."
                    )
                authorized_session_dir = (brain_root / session_id).resolve()
                if not (p == authorized_session_dir or p.is_relative_to(authorized_session_dir)):
                    raise HTTPException(
                        status_code=403,
                        detail="Access denied: Cross-session file access is strictly forbidden."
                    )
        except HTTPException:
            raise
        except Exception:
            pass

    if not is_path_in_base_roots(p):
        allowed_roots = await get_allowed_file_roots(eng)
        if not any(p == root or p.is_relative_to(root) for root in allowed_roots):
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
        raise HTTPException(status_code=404, detail=f"File '{clean_path or path}' not found on local disk.")

    if is_dir:
        raise HTTPException(status_code=403, detail="Access denied: Path is outside authorized workspace directories.")

    ext = p.suffix.lower()
    if ext == ".pdf":
        return FileResponse(p, media_type="application/pdf", content_disposition_type="inline")

    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg"):
        return FileResponse(p, content_disposition_type="inline")

    if raw:
        return FileResponse(p, filename=p.name)

    # Complex office documents and binary archives: return FileResponse directly for safe download
    unsupported_binary_exts = {
        ".docx", ".doc", ".pptx", ".ppt", ".zip", ".tar", ".gz", ".7z", ".rar",
        ".exe", ".bin", ".iso", ".dmg", ".dll", ".so", ".dylib"
    }
    if ext in unsupported_binary_exts:
        return FileResponse(p, filename=p.name)

    # High-Performance Unified Spreadsheet Parser (Excel .xlsx, .xlsm, .xls, .xlsb, .ods and CSV)
    if ext in (".xlsx", ".xls", ".xlsm", ".xltx", ".xltm", ".xlsb", ".ods", ".csv"):
        try:
            from app.services.excel_univer import parse_excel_to_univer
            univer_wb = await asyncio.to_thread(parse_excel_to_univer, p)
            return {
                "type": "univer",
                "filename": p.name,
                "path": str(p),
                "workbook": univer_wb,
            }
        except Exception as u_err:
            logger.warning(f"Univer parser fallback for {p}: {u_err}")

        try:
            import fastexcel
            reader = fastexcel.read_excel(p)
            sheet_names = reader.sheet_names
            if not sheet_names:
                return {
                    "type": "excel",
                    "filename": p.name,
                    "path": str(p),
                    "sheets": {},
                    "sheet_names": [],
                    "total_rows": 0,
                    "total_cols": 0,
                    "page": 0,
                    "page_size": page_size,
                    "total_pages": 0,
                    "columns": [],
                    "rows": [],
                }

            target_sheet = sheet if (sheet and sheet in sheet_names) else sheet_names[0]

            # Bound page and pageSize safely
            safe_page_size = max(10, min(page_size, 1000))
            safe_page = max(0, page)
            skip = safe_page * safe_page_size

            # Load slice lazily through Rust memory mapping
            sheet_obj = reader.load_sheet(target_sheet, header_row=None, skip_rows=skip, n_rows=safe_page_size)
            total_rows = sheet_obj.total_height
            total_cols = sheet_obj.width
            total_pages = max(1, (total_rows + safe_page_size - 1) // safe_page_size) if total_rows > 0 else 1

            arrow_batch = sheet_obj.to_arrow()
            col_names = arrow_batch.schema.names
            cols_data = [arrow_batch[c].to_pylist() for c in col_names]

            rows = []
            if cols_data and len(cols_data[0]) > 0:
                num_records = len(cols_data[0])
                for r_idx in range(num_records):
                    row_vals = []
                    for c_idx in range(len(cols_data)):
                        v = cols_data[c_idx][r_idx]
                        if v is None:
                            row_vals.append("")
                        elif isinstance(v, float):
                            if v.is_integer():
                                row_vals.append(str(int(v)))
                            else:
                                row_vals.append(f"{v:g}")
                        else:
                            row_vals.append(str(v))
                    rows.append(row_vals)

            # Retrieve canonical header row (Row 0) for column naming and charting
            header_row = []
            if safe_page == 0 and len(rows) > 0:
                header_row = rows[0]
            else:
                try:
                    head_sheet = reader.load_sheet(target_sheet, header_row=None, skip_rows=0, n_rows=1)
                    head_batch = head_sheet.to_arrow()
                    head_cols = [head_batch[c].to_pylist() for c in head_batch.schema.names]
                    if head_cols and len(head_cols[0]) > 0:
                        header_row = [str(head_cols[c_idx][0]) if head_cols[c_idx][0] is not None else "" for c_idx in range(len(head_cols))]
                except Exception:
                    header_row = []

            return {
                "type": "excel",
                "filename": p.name,
                "path": str(p),
                "sheet_names": sheet_names,
                "active_sheet": target_sheet,
                "total_rows": total_rows,
                "total_cols": total_cols,
                "page": safe_page,
                "page_size": safe_page_size,
                "total_pages": total_pages,
                "headers": header_row,
                "columns": col_names,
                "rows": rows,
                "sheets": {target_sheet: rows},
            }
        except Exception as e:
            return {"content": f"Failed to load Excel workbook '{p.name}' via Rust engine: {e}", "error": str(e)}

    # High-Performance CSV Reader returning unified Excel spreadsheet schema
    if ext == ".csv":
        try:
            safe_page_size = max(10, min(page_size, 1000))
            safe_page = max(0, page)
            skip = safe_page * safe_page_size
            paged_rows = []
            header_row = []
            total_rows = 0
            total_cols = 0

            # ponytail: Stream CSV line-by-line without allocating 100MB+ in memory
            with open(p, encoding="utf-8", errors="replace") as f:
                csv_reader = csv.reader(f)
                for idx, r in enumerate(csv_reader):
                    total_rows += 1
                    if idx == 0:
                        header_row = r
                    if len(r) > total_cols:
                        total_cols = len(r)
                    if skip <= idx < skip + safe_page_size:
                        paged_rows.append(r)

            total_pages = max(1, (total_rows + safe_page_size - 1) // safe_page_size) if total_rows > 0 else 1
            col_names = [f"Col_{i+1}" for i in range(total_cols)]
            if header_row and len(header_row) == total_cols:
                col_names = header_row
            return {
                "type": "excel",
                "filename": p.name,
                "path": str(p),
                "sheet_names": [p.name],
                "active_sheet": p.name,
                "total_rows": total_rows,
                "total_cols": total_cols,
                "page": safe_page,
                "page_size": safe_page_size,
                "total_pages": total_pages,
                "headers": header_row,
                "columns": col_names,
                "rows": paged_rows,
                "sheets": {p.name: paged_rows},
            }
        except Exception as csv_err:
            try:
                return {"content": p.read_text(encoding="utf-8", errors="replace")}
            except Exception:
                return {"content": f"Error loading CSV file '{p.name}': {csv_err}", "error": str(csv_err)}

    try:
        file_size = p.stat().st_size
        MAX_SAFE_PREVIEW_BYTES = 10_000_000  # 10 MB safe preview limit
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
        return {"content": p.read_text(encoding="utf-8", errors="replace")}
    except Exception as e:
        return {"content": f"Error reading file: {e}"}


@router.get("/workspace/tree")
@router.get("/api/workspace/tree")
async def get_workspace_tree(session_id: str | None = None, engine: DatabaseEngineDep = None):
    """Scan and return workspace file tree focusing strictly on audit deliverables, data files, and session artifacts."""
    eng = _get_engine(engine)
    workspace_root = await resolve_session_workspace(eng, session_id) if session_id else APP_WORKSPACE_ROOT
    scratch_dir = workspace_root / ".scratch" if (workspace_root / ".scratch").exists() else workspace_root / "scratch"

    deliverables_dir = workspace_root / "Audit_Deliverables"

    def scan_dir(dir_path: Path, max_depth=2, current_depth=0):
        if current_depth > max_depth or not dir_path.exists():
            return []
        items = []
        ignored = {
            ".git", ".venv", "venv", "node_modules", "__pycache__", ".pytest_cache",
            ".ruff_cache", "dist", "build", ".next", ".hypothesis", "antigravity",
            "backup_frontend", ".nexau", ".mash", ".gemini"
        }
        try:
            for entry in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if entry.name in ignored or entry.name.startswith("."):
                    continue
                rel_path = str(entry.relative_to(workspace_root)).replace("\\", "/")
                if entry.is_dir():
                    # Only recurse into Audit_Deliverables or top-level data/docs folders
                    if current_depth == 0 and entry.name != "Audit_Deliverables" and not any(k in entry.name.lower() for k in ("data", "doc", "paper", "audit", "sheet")):
                        continue
                    children = scan_dir(entry, max_depth, current_depth + 1)
                    items.append({
                        "name": entry.name,
                        "path": rel_path,
                        "type": "directory",
                        "children": children,
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

    workspace_files = scan_dir(workspace_root)
    scratch_files = scan_dir(scratch_dir) if scratch_dir.exists() else []

    artifacts = []
    if deliverables_dir.exists():
        artifacts = scan_dir(deliverables_dir)

    return {
        "workspace": workspace_files,
        "scratch": scratch_files,
        "artifacts": artifacts,
        "root": str(workspace_root).replace("\\", "/"),
    }


@router.get("/files/univer")
@router.get("/api/files/univer")
async def get_excel_univer_data(
    path: str,
    session_id: str | None = None,
    engine: DatabaseEngineDep = None
):
    """Direct high-fidelity Excel endpoint returning Univer IWorkbookData schema."""
    return await get_file_content(path=path, format="univer", session_id=session_id, engine=engine)
