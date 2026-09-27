import asyncio
import csv
import logging
import os
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from app.dependencies import DatabaseEngineDep, get_engine, _engine
from app.models.project import ProjectModel
from app.workspace import get_allowed_file_roots, is_path_in_base_roots, resolve_session_workspace
from nexau.archs.session.orm import ComparisonFilter
from nexau.archs.session.models import SessionModel
from nexau.archs.platform.path_helpers import get_session_brain_dir

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
    """List all artifacts for a session from both the brain directory and project workspace."""
    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None
    primary_brain_dir = get_brain_dir(session_id, session)

    candidate_dirs = [
        Path(primary_brain_dir),
        Path.home() / ".nexau" / "brain" / session_id,
        Path.home() / ".gemini" / "antigravity" / "brain" / session_id,
    ]

    files_with_mtime: list[tuple[str, float]] = []
    seen_files = set()
    found_brain_dir = primary_brain_dir

    for b_dir in candidate_dirs:
        if b_dir.is_dir():
            found_brain_dir = str(b_dir)
            try:
                SYSTEM_IGNORE = {
                    "scratch", "working_papers", ".user_uploaded", ".system_generated", "media", "cache"
                }
                for f in os.listdir(b_dir):
                    if f.startswith(".") or f.endswith(".metadata.json") or f in SYSTEM_IGNORE:
                        continue
                    full_p = b_dir / f
                    if full_p.is_file() and f not in seen_files:
                        seen_files.add(f)
                        files_with_mtime.append((f, full_p.stat().st_mtime))
            except Exception:
                pass

            wp_p = b_dir / "working_papers"
            if wp_p.is_dir():
                try:
                    for f in os.listdir(wp_p):
                        if f.startswith(".") or f.endswith(".metadata.json"):
                            continue
                        rel_f = f"working_papers/{f}"
                        full_p = wp_p / f
                        if full_p.is_file() and rel_f not in seen_files:
                            seen_files.add(rel_f)
                            files_with_mtime.append((rel_f, full_p.stat().st_mtime))
                except Exception:
                    pass

            scratch_p = b_dir / "scratch"
            if scratch_p.is_dir():
                try:
                    for f in os.listdir(scratch_p):
                        if f.startswith(".") or f.endswith(".metadata.json"):
                            continue
                        rel_f = f"scratch/{f}"
                        full_p = scratch_p / f
                        if full_p.is_file() and rel_f not in seen_files:
                            seen_files.add(rel_f)
                            files_with_mtime.append((rel_f, full_p.stat().st_mtime))
                except Exception:
                    pass

    # Include deliverables from project Audit_Deliverables and NexAU_Outputs folders
    project_dir = None
    try:
        ws = await resolve_session_workspace(eng, session_id)
        if ws and ws.is_dir():
            project_dir = str(ws)
            for folder_name in ("Audit_Deliverables", "NexAU_Outputs"):
                outputs_dir = ws / folder_name
                if outputs_dir.is_dir():
                    for f in os.listdir(outputs_dir):
                        if f.startswith("."):
                            continue
                        full_p = outputs_dir / f
                        rel_f = f"{folder_name}/{f}"
                        if full_p.is_file() and rel_f not in seen_files:
                            seen_files.add(rel_f)
                            files_with_mtime.append((rel_f, full_p.stat().st_mtime))
    except Exception:
        pass

    files_with_mtime.sort(key=lambda x: x[1], reverse=True)
    files = [x[0] for x in files_with_mtime]

    return {
        "files": files,
        "brain_directory": found_brain_dir,
        "project_directory": project_dir,
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
    eng = _get_engine(engine)
    session = await eng.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id)) if eng else None
    primary_brain_dir = get_brain_dir(session_id, session)

    candidate_dirs = [
        Path(primary_brain_dir),
        Path.home() / ".nexau" / "brain" / session_id,
        Path.home() / ".gemini" / "antigravity" / "brain" / session_id,
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


@router.get("/files/content")
@router.get("/api/files/content")
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
        candidates: list[Path] = []
        if session_id:
            for b_base in [Path.home() / ".gemini" / "antigravity" / "brain", Path.home() / ".nexau" / "brain"]:
                s_dir = b_base / session_id
                if s_dir.is_dir():
                    candidates.extend([
                        s_dir / clean_path,
                        s_dir / f"{clean_path}.md",
                        s_dir / "working_papers" / clean_path,
                        s_dir / "working_papers" / f"{clean_path}.md",
                        s_dir / "scratch" / clean_path,
                        s_dir / ".system_generated" / "tasks" / clean_path,
                        s_dir / ".system_generated" / "logs" / clean_path,
                    ])
            try:
                ws = await resolve_session_workspace(eng, session_id)
                if ws and ws.is_dir():
                    clean_sub = clean_path.replace("NexAU_Outputs/", "").replace("NexAU_Outputs\\", "").replace("Audit_Deliverables/", "").replace("Audit_Deliverables\\", "")
                    candidates.extend([
                        ws / clean_path,
                        ws / "Audit_Deliverables" / clean_path,
                        ws / "Audit_Deliverables" / clean_sub,
                        ws / "NexAU_Outputs" / clean_path,
                        ws / "NexAU_Outputs" / clean_sub,
                    ])
            except Exception:
                pass
        candidates.extend([
            Path.cwd() / clean_path,
            mash_root / clean_path,
        ])
        for cand in candidates:
            if cand.is_file():
                p = cand.resolve()
                found = True
                break
        if not found:
            p = p.resolve()

    if not p.exists():
        return {"content": f"File '{clean_path or path}' not found on local disk.", "error": "not_found"}

    if p.is_dir():
        raise HTTPException(status_code=403, detail="Access denied: Path is outside authorized workspace directories.")

    eng = _get_engine(engine)
    if not is_path_in_base_roots(p):
        allowed_roots = await get_allowed_file_roots(eng)
        if not any(p == root or p.is_relative_to(root) for root in allowed_roots):
            raise HTTPException(
                status_code=403,
                detail="Access denied: Path is outside authorized workspace directories."
            )

    if raw:
        return FileResponse(p, filename=p.name)

    ext = p.suffix.lower()
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg", ".pdf"):
        return FileResponse(p, media_type="application/pdf" if ext == ".pdf" else None)

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
            with open(p, mode="r", encoding="utf-8", errors="replace") as f:
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
        MAX_SAFE_PREVIEW_BYTES = 1_500_000  # 1.5 MB safe preview chunk
        if file_size > MAX_SAFE_PREVIEW_BYTES:
            with open(p, "rb") as f:
                raw_chunk = f.read(MAX_SAFE_PREVIEW_BYTES)
            text_chunk = raw_chunk.decode("utf-8", errors="replace")
            last_nl = text_chunk.rfind("\n")
            if last_nl > 0:
                text_chunk = text_chunk[:last_nl]
            size_mb = round(file_size / (1024 * 1024), 1)
            comment_prefix = "-- " if p.suffix.lower() == ".sql" else "# " if p.suffix.lower() in (".py", ".sh", ".yaml", ".yml") else "// "
            preview_banner = f"{comment_prefix}[MASH SAFE PREVIEW: Large file ({size_mb} MB). Displaying initial schema and records to protect system memory. Use 3-dots menu to download full file.]\n\n"
            return {
                "type": "text",
                "filename": p.name,
                "path": str(p),
                "content": preview_banner + text_chunk,
                "is_truncated": True,
                "total_bytes": file_size,
                "preview_bytes": len(text_chunk.encode("utf-8")),
            }
        return {"content": p.read_text(encoding="utf-8", errors="replace")}
    except Exception as e:
        return {"content": f"Error reading file: {e}"}


@router.get("/workspace/tree")
@router.get("/api/workspace/tree")
async def get_workspace_tree(session_id: str | None = None):
    """Scan and return workspace file tree, scratch folder, and session artifacts."""
    workspace_root = Path.cwd()
    scratch_dir = workspace_root / ".scratch"

    def scan_dir(dir_path: Path, max_depth=3, current_depth=0):
        if current_depth > max_depth or not dir_path.exists():
            return []
        items = []
        ignored = {".git", ".venv", "node_modules", "__pycache__", ".pytest_cache", ".ruff_cache", "dist", "build"}
        try:
            for entry in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if entry.name in ignored:
                    continue
                rel_path = str(entry.relative_to(workspace_root)).replace("\\", "/")
                if entry.is_dir():
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
    artifacts_dir = Path("artifacts")
    if artifacts_dir.exists():
        artifacts = scan_dir(artifacts_dir)

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
