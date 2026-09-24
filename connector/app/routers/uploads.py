import os
import shutil
from fastapi import APIRouter, File, UploadFile, HTTPException
from app.dependencies import DatabaseEngineDep
from nexau.archs.session.models import SessionModel
from nexau.archs.session.orm import ComparisonFilter
from pathlib import Path

from nexau.archs.platform.path_helpers import get_session_brain_dir

router = APIRouter(prefix="/api/uploads", tags=["uploads"])


@router.post("/{session_id}")
async def upload_file(session_id: str, file: UploadFile, engine: DatabaseEngineDep):
    session = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    brain_dir = (session.context or {}).get("brain_directory") if session else None
    if not brain_dir:
        project_id = (session.context or {}).get("project_id") if session else None
        brain_dir = str(get_session_brain_dir(session_id, project_id))
    save_dir = os.path.join(brain_dir, ".user_uploaded")
    os.makedirs(save_dir, exist_ok=True)
    safe_filename = os.path.basename(file.filename or "uploaded_file")
    if not safe_filename or safe_filename in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid filename")
    dest_path = (Path(save_dir) / safe_filename).resolve()
    if not dest_path.is_relative_to(Path(save_dir).resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename path")
    dest = str(dest_path)
    try:
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")
    return {"status": "success", "path": dest}


@router.get("/{session_id}")
async def list_uploaded_files(session_id: str, engine: DatabaseEngineDep):
    """List all user-uploaded files for the given session."""
    session = await engine.find_first(SessionModel, filters=ComparisonFilter.eq("session_id", session_id))
    brain_dir = (session.context or {}).get("brain_directory") if session else None
    if not brain_dir:
        project_id = (session.context or {}).get("project_id") if session else None
        brain_dir = str(get_session_brain_dir(session_id, project_id))
    from pathlib import Path
    import datetime

    candidate_upload_dirs = [
        Path(brain_dir) / ".user_uploaded",
        Path.home() / ".nexau" / "brain" / session_id / ".user_uploaded",
        Path.home() / ".gemini" / "antigravity" / "brain" / session_id / ".user_uploaded",
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