import os
import sys
from pathlib import Path

backend_dir = Path(__file__).parent.resolve()
nexau_dir = (backend_dir.parent / 'NexAU').resolve()
sys.path.insert(0, str(nexau_dir))
sys.path.insert(0, str(backend_dir))

import uvicorn

if __name__ == '__main__':
    # ponytail: Support dual-mode execution (FastAPI backend supervisor vs embedded Python CLI runner)
    args = sys.argv[1:]
    is_cli = (
        os.path.basename(sys.argv[0]).lower().startswith("python")
        or (args and args[0] in ("-c", "-m", "--python"))
        or (args and args[0].endswith(".py"))
    )
    if is_cli:
        if args and args[0] == "--python":
            args = args[1:]
        if not args:
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
    # ponytail: Support dynamic ephemeral port from desktop process supervisor
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=port, log_level='info')
