import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/system/health")
@router.get("/health")
async def get_system_health(request: Request):
    """Lightweight backend liveness and health probe."""
    warmup_error = getattr(request.app.state, "warmup_error", None)
    if warmup_error:
        raise HTTPException(status_code=503, detail=f"Agent runtime warmup failed: {warmup_error}")
    return {"status": "ok", "service": "mash-backend"}


@router.get("/system/info")
@router.get("/info")
async def get_system_info():
    """Returns the machine installation ID, version, OS, and local database size."""
    import platform
    import sys

    from app.paths import get_database_path, get_installation_id, get_mash_home

    db_path = get_database_path()
    db_size = db_path.stat().st_size if db_path.exists() else 0

    return {
        "installation_id": get_installation_id(),
        "version": "0.1.0",
        "platform": platform.platform(),
        "os": sys.platform,
        "python_version": sys.version.split()[0],
        "home_directory": str(get_mash_home()),
        "database_size_bytes": db_size,
    }


class UpdateStateRequest(BaseModel):
    status: str
    version: str | None = "1.2.0"
    progress: int | None = 0


_desktop_update_state = {
    "status": "idle",
    "version": "1.2.0",
    "progress": 0,
}


@router.get("/system/updates")
async def get_system_updates():
    """Returns background auto-update status."""
    return _desktop_update_state


@router.post("/system/updates/set-state")
async def set_system_update_state(req: UpdateStateRequest):
    """Sync or mock updater status."""
    _desktop_update_state["status"] = req.status
    if req.version:
        _desktop_update_state["version"] = req.version
    if req.progress is not None:
        _desktop_update_state["progress"] = req.progress
    return {"status": "ok", "state": _desktop_update_state}


@router.post("/system/updates/restart")
async def restart_system_app():
    """Trigger application shutdown and relaunch for applying pending updates."""
    _desktop_update_state["status"] = "idle"
    return {
        "status": "restarting",
        "action": "quit_and_install",
        "message": "Application shutting down for binary swap and scheduled relaunch."
    }


class SelectFolderRequest(BaseModel):
    folder_path: str | None = None


def _open_folder_dialog() -> str | None:
    """Open real native Windows File Explorer folder selection dialog with rapid failover."""
    import subprocess
    import sys

    if sys.platform == "win32":
        # 1. Native folder picker via native_picker.ps1 (IFileOpenDialog with FOS_PICKFOLDERS)
        picker_script = Path(__file__).resolve().parent.parent / "native_picker.ps1"
        if not picker_script.exists() and getattr(sys, "frozen", False):
            picker_script = Path(sys.executable).parent / "native_picker.ps1"
            if not picker_script.exists() and hasattr(sys, "_MEIPASS"):
                picker_script = Path(sys._MEIPASS) / "native_picker.ps1"
        if picker_script.exists():
            try:
                res = subprocess.run(
                    [
                        "powershell",
                        "-STA",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(picker_script),
                        "-Title",
                        "Select Workspace Folder",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                out = res.stdout.strip()
                if out == "__CANCELLED__":
                    return None
                if out and Path(out).is_dir():
                    return out
            except Exception as e:
                logger.warning(f"Native folder picker failed: {e}")

        # 2. PowerShell OpenFileDialog fallback with folder selection (File Explorer window)
        ps_fallback = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.OpenFileDialog; "
            "$f.ValidateNames = $false; "
            "$f.CheckFileExists = $false; "
            "$f.CheckPathExists = $true; "
            "$f.FileName = 'Select Folder'; "
            "$f.Title = 'Select Workspace Folder'; "
            "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { "
            "  [System.IO.Path]::GetDirectoryName($f.FileName) "
            "} else { '__CANCELLED__' }"
        )
        try:
            res = subprocess.run(
                ["powershell", "-STA", "-NoProfile", "-Command", ps_fallback],
                capture_output=True,
                text=True,
                timeout=60,
            )
            out = res.stdout.strip()
            if out == "__CANCELLED__":
                return None
            if out and Path(out).is_dir():
                return out
        except Exception:
            pass

    # 3. Tkinter fallback
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk()\n"
        "root.withdraw()\n"
        "root.wm_attributes('-topmost', 1)\n"
        "root.focus_force()\n"
        "folder = filedialog.askdirectory(title='Select Workspace Folder', mustexist=True)\n"
        "root.destroy()\n"
        "if folder:\n"
        "    print(folder)\n"
    )
    try:
        res = subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            timeout=60,
        )
        out = res.stdout.strip()
        if out and Path(out).is_dir():
            return out
    except Exception:
        pass

    return None


@router.post("/system/select-folder")
async def select_folder(request: SelectFolderRequest | None = None):
    """Open native Windows Explorer folder selection dialog or validate provided folder."""
    if request and request.folder_path:
        p = Path(request.folder_path).expanduser().resolve()
        if p.is_dir():
            return {
                "status": "success",
                "folder_path": str(p),
                "folder_name": p.name or str(p),
            }
        return {"status": "error", "detail": f"Path '{request.folder_path}' is not an existing directory"}

    folder = await asyncio.to_thread(_open_folder_dialog)
    if folder:
        p = Path(folder).resolve()
        return {
            "status": "success",
            "folder_path": str(p),
            "folder_name": p.name or str(p),
        }
    return {"status": "cancelled", "folder_path": None, "folder_name": None}


class ResolveFolderRequest(BaseModel):
    folder_name: str
    hint_path: str | None = None
    sample_children: list[str] | None = None


@router.post("/system/resolve-folder")
async def resolve_folder_endpoint(request: ResolveFolderRequest):
    """Resolve a selected folder name to its absolute filesystem path."""
    name = request.folder_name.strip()
    home = Path.home()

    if request.hint_path:
        hp = Path(request.hint_path).expanduser().resolve()
        if hp.is_dir():
            return {"status": "success", "folder_path": str(hp), "folder_name": hp.name}

    # Direct existing directory check
    direct_p = Path(name).expanduser().resolve()
    if direct_p.is_dir():
        return {"status": "success", "folder_path": str(direct_p), "folder_name": direct_p.name}

    # Standard user workspace locations
    candidates = [
        home / "Documents" / name,
        home / "Desktop" / name,
        home / "Downloads" / name,
        home / "projects" / name,
        home / ".mash" / "projects" / name,
        Path.cwd() / name,
    ]

    for c in candidates:
        if c.is_dir():
            return {"status": "success", "folder_path": str(c.resolve()), "folder_name": c.name}

    return {"status": "error", "message": f"Folder '{name}' could not be resolved to an existing directory on disk. Please select folder using the system file browser."}


class OpenFileRequest(BaseModel):
    file_path: str
    session_id: str | None = None


@router.post("/system/open-file")
async def open_system_file(request: OpenFileRequest):
    """Open a local file or directory with the host operating system's registered application."""
    import os
    import re
    import subprocess
    import sys
    from app.paths import normalize_local_path, validate_safe_id
    from app.workspace import is_path_in_base_roots

    clean_path = normalize_local_path(request.file_path)

    if request.session_id:
        try:
            validate_safe_id(request.session_id, "session_id")
        except ValueError as e:
            return {"status": "error", "message": str(e)}

    p = Path(clean_path).expanduser()
    if not (p.is_absolute() and p.exists()) and request.session_id:
        from app.dependencies import _engine as global_eng
        from app.paths import get_session_brain_dir
        from app.workspace import resolve_session_workspace, APP_WORKSPACE_ROOT

        rel_path = clean_path.lstrip("/\\")
        candidates = []
        s_dir = get_session_brain_dir(request.session_id).resolve()
        if s_dir.is_dir():
            candidates.extend([
                s_dir / rel_path,
                s_dir / "working_papers" / rel_path,
                s_dir / "scratch" / rel_path,
            ])
        try:
            ws = await resolve_session_workspace(global_eng, request.session_id)
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

    p = p.resolve()
    if not p.exists():
        return {"status": "error", "message": f"Path '{clean_path}' does not exist on local disk."}

    # allow valid user files on host disk
    is_allowed = is_path_in_base_roots(p)
    if not is_allowed:
        from app.dependencies import _engine as global_eng
        from app.workspace import get_allowed_file_roots
        allowed_roots = await get_allowed_file_roots(global_eng)
        is_allowed = any(p == root or p.is_relative_to(root) for root in allowed_roots)

    if not is_allowed:
        return {"status": "error", "message": f"Access denied: Path '{clean_path}' is outside allowed application workspace roots."}

    try:
        if sys.platform == "win32":
            os.startfile(str(p))
        elif sys.platform == "darwin":
            subprocess.run(["open", str(p)], check=False)
        else:
            subprocess.run(["xdg-open", str(p)], check=False)
        return {"status": "success", "path": str(p)}
    except Exception as e:
        err_str = str(e)
        if "1155" in err_str or "No application is associated" in err_str or "no application" in err_str.lower():
            err_str = "No spreadsheet application found on this computer. Please download the file or install Excel."
        return {"status": "error", "message": err_str}
