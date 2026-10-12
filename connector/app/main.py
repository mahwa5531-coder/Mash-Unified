import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# ponytail: Explicitly load .env file so new LLM settings apply
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

# Ensure NexAU engine is importable from sibling directory
_nexau_dir = Path(__file__).resolve().parent.parent.parent / "NexAU"
if _nexau_dir.exists() and str(_nexau_dir) not in sys.path:
    sys.path.insert(0, str(_nexau_dir))

# Add bundled binaries (ripgrep, etc.) to PATH so all subprocesses and tools inherit them
_bin_dirs = [
    Path(__file__).resolve().parent.parent / "bin",
    Path(__file__).resolve().parent.parent.parent / "NexAU" / "bin",
]
for _bd in _bin_dirs:
    if _bd.exists():
        _p = str(_bd.resolve())
        if _p not in os.environ.get("PATH", ""):
            os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from nexau.archs.transports.http import HTTPConfig, SSETransportServer

from app.dependencies import init_engine
from app.models.project import ProjectModel

# ──────────────────────────────────────────────
# DB path (~/.nexau/nexau.db)
# ──────────────────────────────────────────────
from app.paths import (
    get_database_path,
    get_nexau_home,
)
from app.routers import (
    artifacts,
    auth,
    chat,
    projects,
    sessions,
    settings,
    system,
    tasks,
    uploads,
)
from nexau import AgentConfig, LLMConfig

_DB_DIR = get_nexau_home()
_DB_PATH = get_database_path()
_DB_ASYNC_URL = f"sqlite+aiosqlite:///{_DB_PATH}"
_DB_SYNC_URL  = f"sqlite:///{_DB_PATH}"

# ──────────────────────────────────────────────
# Agent config with core tools
# ──────────────────────────────────────────────


def _build_agent_config() -> AgentConfig:
    from nexau.archs.main_sub.config import AgentConfig
    from nexau.archs.platform.app_config import AppConfig
    from nexau.archs.platform.crypto_vault import load_secure_vault

    import nexau

    # Load canonical agent configuration (local Mash manifest preferred)
    local_manifest = Path(__file__).resolve().parent / "resources" / "main_agent.yaml"
    fallback_manifest = Path(nexau.__file__).parent / "agents" / "main_agent.yaml"
    manifest_path = local_manifest if local_manifest.exists() else fallback_manifest
    agent_config = AgentConfig.from_yaml(manifest_path)

    # Runtime LLM credential resolution from settings/vault/env
    app_cfg = AppConfig.load()
    vault = load_secure_vault() or {}

    # The desktop connector communicates exclusively with the MASH Cloud API layer
    cloud_gateway = (
        os.getenv("CLOUD_GATEWAY_URL")
        or os.getenv("GATEWAY_URL")
        or os.getenv("MASH_GATEWAY_URL")
        or os.getenv("MASH_API_URL")
        or app_cfg.model.gateway_url
        or "http://127.0.0.1:8080"
    )

    active_key = (
        vault.get("access_token")
        or vault.get("api_key")
        or "bearer-pending-auth"
    )
    # The desktop uses the abstract model alias "mash/auto".
    # The Cloud API gateway resolves this dynamically based on the user's plan.
    active_model = os.getenv("MASH_MODEL") or "mash/auto"

    is_mock = os.getenv("MOCK_LLM", "").lower() in ("true", "1", "yes") or active_key.lower() in ("mock", "none", "test")
    if is_mock:
        default_base_url = "http://mock"
    else:
        clean_gw = cloud_gateway.rstrip("/")
        if clean_gw.endswith("/v1/agent"):
            clean_gw = clean_gw[:-6]
        default_base_url = clean_gw if clean_gw.endswith("/v1") else f"{clean_gw}/v1"

    agent_config.llm_config = LLMConfig(
        api_type="openai_chat_completion",
        model=active_model,
        base_url=default_base_url,
        api_key=active_key,
        max_tokens=int(os.getenv("LLM_MAX_TOKENS")) if os.getenv("LLM_MAX_TOKENS") else None,
        timeout=float(os.getenv("LLM_TIMEOUT", "120.0")),
        stream_idle_timeout=float(os.getenv("LLM_STREAM_IDLE_TIMEOUT", "45.0")),
        max_retries=int(os.getenv("LLM_MAX_RETRIES", "3")),
    )

    agent_config.max_context_tokens = int(
        os.getenv("LLM_MAX_CONTEXT_TOKENS")
        or vault.get("max_context_tokens")
        or 1048576
    )

    if os.getenv("AGENT_MAX_ITERATIONS"):
        agent_config.max_iterations = int(os.getenv("AGENT_MAX_ITERATIONS"))

    return agent_config

# ──────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.dependencies as _deps
    from app.paths import scaffold_nexau_system_storage

    scaffold_nexau_system_storage()
    engine = init_engine(_DB_ASYNC_URL)
    await engine.setup_models([ProjectModel])

    agent_config = _build_agent_config()
    http_config = HTTPConfig()
    sse_server = SSETransportServer(engine=engine, config=http_config, default_agent_config=agent_config)

    # Set clean FastAPI app.state references
    app.state.engine = engine
    app.state.sse_server = sse_server
    app.state.session_manager = sse_server._session_manager

    # Backward compatibility references
    _deps._engine = engine
    _deps._session_manager = sse_server._session_manager

    from app.routers import chat as chat_router
    chat_router._sse_server = sse_server

    if sse_server.team_registry:
        sse_server.team_registry.register_config(
            "default",
            leader_config=agent_config,
            candidates={"main_auditor": agent_config},
        )
        from nexau.archs.transports.http.team_routes import create_team_router
        team_router = create_team_router(
            sse_server.team_registry,
            on_stream_event=sse_server._on_stream_event,
            get_history=sse_server._get_history,
            count_events=sse_server._count_events,
        )
        app.include_router(team_router)

    yield



# ──────────────────────────────────────────────
# App
# ──────────────────────────────────────────────
app = FastAPI(
    title="NexAU Audit Desktop App API",
    description="Backend for the custom React/Next.js frontend.",
    version="1.0.0",
    lifespan=lifespan,
)

_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "tauri://localhost",
    "http://tauri.localhost",
] + [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(artifacts.router)
app.include_router(uploads.router)
app.include_router(tasks.router)
app.include_router(system.router)
app.include_router(auth.router)
app.include_router(settings.router)

# Backwards compatibility re-exports
from app.routers.sessions import get_transcript as get_session_transcript_bridge  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    # ponytail: Default to loopback for desktop security; override via HOST env for container deployment
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port)
