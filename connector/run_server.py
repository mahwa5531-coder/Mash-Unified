import os
import sys
from pathlib import Path

# Configure paths: in development mode, ensure NexAU and connector are importable.
# In frozen mode, they are already packaged into the PYZ archive.
if not getattr(sys, "frozen", False):
    backend_dir = Path(__file__).parent.resolve()
    nexau_dir = (backend_dir.parent / "NexAU").resolve()
    if nexau_dir.is_dir() and str(nexau_dir) not in sys.path:
        sys.path.insert(0, str(nexau_dir))
    if str(backend_dir) not in sys.path:
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


def _run_cli(args: list[str]) -> None:
    """Execute code or scripts using CPython standard library runpy/exec without loading uvicorn."""
    if args and args[0] == "--python":
        args = args[1:]

    # Consume standard Python interpreter flags (e.g. -I, -s, -E, -u, -B, -v, -q, -O)
    while args and args[0].startswith("-") and args[0] not in ("-c", "-m", "-V", "--version", "-"):
        flag = args.pop(0)
        if flag in ("-W", "-X") and args:
            args.pop(0)

    if not args:
        if not sys.stdin.isatty():
            code = sys.stdin.read()
            sys.argv = ["-"]
            exec(code, {"__name__": "__main__", "__file__": None})
            sys.exit(0)
        sys.exit(0)

    if args[0] in ("-V", "--version"):
        print(f"Python {sys.version.split()[0]}")
        sys.exit(0)

    if args[0] == "-c":
        code = args[1] if len(args) > 1 else ""
        sys.argv = ["-c"] + args[2:]
        exec(code, {"__name__": "__main__", "__file__": None})
        sys.exit(0)

    if args[0] == "-m":
        mod = args[1] if len(args) > 1 else ""
        sys.argv = [mod] + args[2:]
        import runpy

        runpy.run_module(mod, run_name="__main__", alter_sys=True)
        sys.exit(0)

    if args[0] == "-":
        code = sys.stdin.read()
        sys.argv = ["-"] + args[1:]
        exec(code, {"__name__": "__main__", "__file__": None})
        sys.exit(0)

    script_path = args[0]
    sys.argv = [script_path] + args[1:]
    import runpy

    runpy.run_path(script_path, run_name="__main__")
    sys.exit(0)


def _run_server() -> None:
    """Lazily load FastAPI and Uvicorn to run the backend server."""
    import uvicorn
    from app.main import app

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    log_level = os.getenv("LOG_LEVEL", "info")
    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    args = sys.argv[1:]
    is_cli = (
        os.path.basename(sys.argv[0]).lower().startswith("python")
        or (args and args[0] in ("-c", "-m", "--python", "-V", "--version", "-"))
        or (args and args[0].endswith(".py"))
    )
    if is_cli:
        try:
            _run_cli(args)
        except SystemExit as e:
            sys.exit(e.code)
    else:
        _run_server()
