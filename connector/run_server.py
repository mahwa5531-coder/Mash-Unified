import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.resolve()
nexau_dir = (backend_dir.parent / 'NexAU').resolve()
sys.path.insert(0, str(nexau_dir))
sys.path.insert(0, str(backend_dir))

# Honor PYTHONPATH in PyInstaller frozen mode and mount Mash user python environment
pythonpath = os.environ.get("PYTHONPATH", "")
if pythonpath:
    for p in reversed(pythonpath.split(os.pathsep)):
        if p and p not in sys.path:
            sys.path.insert(0, p)

mash_user_env = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "Mash" / "python_env"
    if sys.platform == "win32"
    else Path.home() / ".local" / "share" / "mash" / "python_env"
)
if mash_user_env.is_dir() and str(mash_user_env) not in sys.path:
    sys.path.append(str(mash_user_env))

import uvicorn

if __name__ == '__main__':
    # Support dual-mode execution (FastAPI backend supervisor vs embedded Python CLI runner)
    args = sys.argv[1:]
    is_cli = (
        os.path.basename(sys.argv[0]).lower().startswith("python")
        or (args and args[0] in ("-c", "-m", "--python"))
        or (args and args[0].endswith(".py"))
    )
    if is_cli:
        if args and args[0] == "--python":
            args = args[1:]
        # Strip standard Python interpreter flags (e.g. -I, -s, -E, -u, -B, -v, -q, -O)
        while args and args[0].startswith("-") and args[0] not in ("-c", "-m", "-V", "--version"):
            flag = args.pop(0)
            if flag in ("-W", "-X") and args:
                args.pop(0)
        if not args:
            sys.exit(0)
        if args[0] in ("-V", "--version"):
            print(f"Python {sys.version.split()[0]}")
            sys.exit(0)
        if args[0] == "-c":
            code = args[1] if len(args) > 1 else ""
            sys.argv = ["python"] + args[2:]
            exec(code, {"__name__": "__main__"})
            sys.exit(0)
        elif args[0] == "-m":
            mod = args[1] if len(args) > 1 else ""
            sys.argv = ["python"] + args[2:]
            import runpy
            runpy.run_module(mod, run_name="__main__")
            sys.exit(0)
        else:
            script_path = args[0]
            sys.argv = ["python"] + args[1:]
            import runpy
            runpy.run_path(script_path, run_name="__main__")
            sys.exit(0)

    from app.main import app
    # Support dynamic ephemeral port from desktop process supervisor
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level='info')
