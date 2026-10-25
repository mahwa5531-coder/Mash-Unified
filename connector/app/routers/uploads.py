import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter

from app.dependencies import DatabaseEngineDep
from app.paths import get_session_brain_dir, validate_safe_id

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


MAX_UPLOAD_SIZE_BYTES = 30 * 1024 * 1024  # 30 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB


@router.post("/{session_id}")
async def upload_file(session_id: str, file: UploadFile, engine: DatabaseEngineDep):
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    session = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    brain_dir = (session.context or {}).get("brain_directory") if session else None
    if not brain_dir:
        project_id = (session.context or {}).get("project_id") if session else None
        brain_dir = str(get_session_brain_dir(session_id, project_id))
    save_dir = os.path.join(brain_dir, ".user_uploaded")
    os.makedirs(save_dir, exist_ok=True)
    raw_filename = file.filename
    if raw_filename is not None and not raw_filename.strip():
        raise HTTPException(status_code=400, detail="Invalid filename")
    raw_filename = raw_filename or "uploaded_file"
    if "\x00" in raw_filename:
        raise HTTPException(status_code=400, detail="Invalid filename: null byte detected")
    norm_name = raw_filename.replace("\\", "/")
    if any((set(s) == {"."} and len(s) >= 2) or ".." in s for s in norm_name.split("/")):
        raise HTTPException(status_code=400, detail="Invalid filename: path traversal detected")
    safe_filename = Path(norm_name).name
    if not safe_filename or safe_filename in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    dest_path = (Path(save_dir) / safe_filename).resolve()
    if not dest_path.is_relative_to(Path(save_dir).resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename path")
    dest = str(dest_path)
    total_bytes = 0
    try:
        with open(dest, "wb") as f:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE_BYTES:
                    f.close()
                    if os.path.exists(dest):
                        os.remove(dest)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds maximum allowed size of 30 MB ({total_bytes / (1024 * 1024):.1f} MB)",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")
    return {"status": "success", "path": dest, "size": total_bytes}


@router.get("/{session_id}")
async def list_uploaded_files(session_id: str, engine: DatabaseEngineDep):
    """List all user-uploaded files for the given session."""
    try:
        validate_safe_id(session_id, "session_id")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    session = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    brain_dir = (session.context or {}).get("brain_directory") if session else None
    if not brain_dir:
        project_id = (session.context or {}).get("project_id") if session else None
        brain_dir = str(get_session_brain_dir(session_id, project_id))
    import datetime
    from pathlib import Path

    candidate_upload_dirs = [
        Path(brain_dir) / ".user_uploaded",
    ]
    seen_files = set()
    files_with_mtime = []
    for u_dir in candidate_upload_dirs:
        if u_dir.is_dir():
            try:
                for fname in os.listdir(u_dir):
                    fpath = u_dir / fname
                    if fpath.is_file() and fname not in seen_files:
                        seen_files.add(fname)
                        mtime = fpath.stat().st_mtime
                        files_with_mtime.append({
                            "name": fname,
                            "path": str(fpath),
                            "size_bytes": fpath.stat().st_size,
                            "created_at": datetime.datetime.fromtimestamp(mtime).isoformat(),
                            "mtime": mtime
                        })
            except Exception:
                pass

    files_with_mtime.sort(key=lambda x: x["mtime"], reverse=True)
    for item in files_with_mtime:
        item.pop("mtime", None)

    return {"session_id": session_id, "uploads": files_with_mtime}
