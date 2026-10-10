from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/capabilities")
async def list_capabilities():
    return {
        "capabilities": [
            {"id": "python_execution", "name": "Python Sandbox"},
            {"id": "file_system", "name": "Local File System Access"},
            {"id": "chrome_devtools", "name": "Chrome DevTools"},
        ]
    }


@router.get("/skills")
async def list_skills():
    """List available builtin and workspace skills."""
    return {
        "skills": [
            {"name": "ponytail", "description": "Senior dev efficiency ladder and minimal diff rules"},
            {"name": "audit_engine", "description": "Financial and ledger reconciliation audit tools"},
            {"name": "code_refactor", "description": "Surgical codebase refactoring without rewrite"},
        ]
    }


@router.get("/models")
async def list_models():
    """List supported LLM models and active configurations."""
    return {
        "models": [
            {"id": "gemini-2.5-flash", "provider": "google", "name": "Gemini 2.5 Flash"},
            {"id": "gemini-3.5-flash-lite", "provider": "google", "name": "Gemini 3.5 Flash Lite"},
            {"id": "gpt-4o", "provider": "openai", "name": "GPT-4o"},
            {"id": "claude-3-5-sonnet", "provider": "anthropic", "name": "Claude 3.5 Sonnet"},
        ]
    }


@router.get("/system/health")
@router.get("/health")
async def get_system_health():
    """Lightweight backend liveness and health probe."""
    return {"status": "ok", "service": "mash-backend"}


@router.get("/system/info")
@router.get("/info")
async def get_system_info():
    """Returns the machine installation ID, version, OS, and local database size."""
    import sys
    import platform
    from app.paths import get_installation_id, get_nexau_home, get_database_path

    db_path = get_database_path()
    db_size = db_path.stat().st_size if db_path.exists() else 0

    return {
        "installation_id": get_installation_id(),
        "version": "1.0.0",
        "platform": platform.platform(),
        "os": sys.platform,
        "python_version": sys.version.split()[0],
        "home_directory": str(get_nexau_home()),
        "database_size_bytes": db_size,
    }


import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel

logger = logging.getLogger(__name__)


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
    import sys
    import subprocess

    if sys.platform == "win32":
        # 1. Native IFileOpenDialog with FOS_PICKFOLDERS via native_picker.ps1 (Real modern File Explorer)
        picker_script = Path(__file__).resolve().parent.parent / "native_picker.ps1"
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
            "}"
        )
        try:
            res = subprocess.run(
                ["powershell", "-STA", "-NoProfile", "-Command", ps_fallback],
                capture_output=True,
                text=True,
                timeout=60,
            )
            out = res.stdout.strip()
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

    # If the folder name itself is an existing absolute or relative path
    direct_p = Path(name).expanduser().resolve()
    if direct_p.is_dir():
        return {"status": "success", "folder_path": str(direct_p), "folder_name": direct_p.name}

    candidates = [
        home / "Downloads" / name,
        home / "Desktop" / name,
        home / "Documents" / name,
        home / "projects" / name,
        home / ".nexau" / "projects" / name,
        home / name,
        Path.cwd() / name,
        Path.cwd() if Path.cwd().name.lower() == name.lower() else None,
    ]

    # Check additional drives on Windows
    for drive in ["D", "E", "F"]:
        try:
            d_path = Path(f"{drive}:/")
            if d_path.exists():
                candidates.extend([d_path / name, d_path / "projects" / name])
        except Exception:
            pass

    # If sample children are provided, score matching candidates
    if request.sample_children:
        best_candidate = None
        for c in candidates:
            if c and c.is_dir():
                matches = sum(1 for ch in request.sample_children if (c / ch).exists())
                if matches > 0:
                    return {"status": "success", "folder_path": str(c.resolve()), "folder_name": c.name}
                if best_candidate is None:
                    best_candidate = c
        if best_candidate:
            return {"status": "success", "folder_path": str(best_candidate.resolve()), "folder_name": best_candidate.name}

    for c in candidates:
        if c and c.is_dir():
            return {"status": "success", "folder_path": str(c.resolve()), "folder_name": c.name}

    # Search 1-2 levels down in current working directory and common directories
    for base in [Path.cwd(), home / "Downloads", home / "Desktop", home / "Documents", home]:
        if base and base.is_dir():
            try:
                # Direct child check
                direct = base / name
                if direct.is_dir():
                    return {"status": "success", "folder_path": str(direct.resolve()), "folder_name": direct.name}
                # 1-level down check
                for sub in base.iterdir():
                    if sub.is_dir():
                        if sub.name.lower() == name.lower():
                            return {"status": "success", "folder_path": str(sub.resolve()), "folder_name": sub.name}
                        nested = sub / name
                        if nested.is_dir():
                            return {"status": "success", "folder_path": str(nested.resolve()), "folder_name": nested.name}
            except Exception:
                pass

    # ponytail: do not fabricate phantom folder paths in Downloads (C-03)
    return {"status": "error", "message": f"Folder '{name}' could not be resolved to an existing directory on disk."}


@router.post("/system/quickstart-folder")
async def get_quickstart_folder():
    """Get or generate the default quickstart folder path under ~/.nexau/projects/."""
    from app.paths import get_nexau_home
    projects_dir = get_nexau_home() / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)

    base_target = projects_dir / "Quickstart"
    target = base_target
    counter = 1
    while target.exists() and any(target.iterdir()):
        target = projects_dir / f"Quickstart-{counter}"
        counter += 1

    return {
        "status": "success",
        "folder_path": str(target),
        "folder_name": target.name,
    }


@router.get("/system/browse-directories")
async def browse_directories(path: str | None = None):
    """List subdirectories on the host machine for in-app workspace selection without browser security prompts."""
    import sys
    import os
    import string
    from pathlib import Path

    home = Path.home()
    if not path or not path.strip():
        target = home / "Downloads" if (home / "Downloads").is_dir() else home
    else:
        target = Path(path.strip()).expanduser().resolve()

    if not target.exists() or not target.is_dir():
        target = home

    # Drives on Windows
    drives = []
    if sys.platform == "win32":
        for letter in string.ascii_uppercase:
            try:
                dp = Path(f"{letter}:\\")
                if dp.exists():
                    drives.append(f"{letter}:\\")
            except Exception:
                pass

    # Standard quick shortcuts
    shortcuts = []
    for sc_name, sc_sub in [("Downloads", "Downloads"), ("Desktop", "Desktop"), ("Documents", "Documents"), ("Projects", "projects")]:
        p = home / sc_sub
        if p.is_dir():
            shortcuts.append({"name": sc_name, "path": str(p.resolve())})

    if Path.cwd().is_dir():
        shortcuts.append({"name": f"{Path.cwd().name} (Current)", "path": str(Path.cwd().resolve())})

    # Subdirectories
    directories = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        name = entry.name
                        if name.startswith("$") or name in ("System Volume Information", "Recovery", "PerfLogs"):
                            continue
                        directories.append({
                            "name": name,
                            "path": str(Path(entry.path).resolve()),
                            "is_hidden": name.startswith("."),
                        })
                except Exception:
                    continue
    except PermissionError:
        pass
    except Exception as e:
        logger.warning(f"Error scanning directory {target}: {e}")

    directories.sort(key=lambda d: (d["is_hidden"], d["name"].lower()))
    parent = str(target.parent) if target.parent != target else None

    return {
        "current_path": str(target),
        "parent_path": parent,
        "drives": drives,
        "shortcuts": shortcuts,
        "directories": directories,
    }


class OpenFileRequest(BaseModel):
    file_path: str
    session_id: str | None = None


@router.post("/system/open-file")
@router.post("/api/system/open-file")
async def open_system_file(request: OpenFileRequest):
    """Open a local file or directory with the host operating system's registered application."""
    import sys
    import subprocess
    import os
    from urllib.parse import unquote
    import re

    clean_path = unquote(request.file_path).strip()
    clean_path = re.sub(r"^file:///?", "", clean_path, flags=re.IGNORECASE)
    clean_path = re.sub(r"^/([a-zA-Z]:)", r"\1", clean_path)
    clean_path = clean_path.split("#")[0].strip()

    p = Path(clean_path).expanduser()
    if not p.exists() and request.session_id:
        for b_base in [Path.home() / ".gemini" / "antigravity" / "brain", Path.home() / ".nexau" / "brain"]:
            cand = b_base / request.session_id / clean_path
            if cand.exists():
                p = cand
                break

    p = p.resolve()
    if not p.exists():
        return {"status": "error", "message": f"Path '{clean_path}' does not exist on local disk."}

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

