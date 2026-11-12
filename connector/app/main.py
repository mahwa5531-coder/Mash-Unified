import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_connector_dir = Path(__file__).resolve().parent.parent
_root_dir = _connector_dir.parent
load_dotenv(_root_dir / ".env" if (_root_dir / ".env").exists() else _connector_dir / ".env")

# Ensure NexAU engine is importable when launched directly via uvicorn without run_server.py
_nexau_dir = _root_dir / "NexAU"
if _nexau_dir.exists() and str(_nexau_dir) not in sys.path:
    sys.path.insert(0, str(_nexau_dir))

# Add bundled ripgrep binary directory to PATH so shell tools inherit it in dev and frozen builds
_rg_bin_dir = (
    Path(getattr(sys, "_MEIPASS", "")) / "nexau" / "bin"
    if getattr(sys, "frozen", False)
    else _nexau_dir / "bin"
)
if _rg_bin_dir.exists() and str(_rg_bin_dir) not in os.environ.get("PATH", ""):
    os.environ["PATH"] = str(_rg_bin_dir) + os.pathsep + os.environ.get("PATH", "")

import nexau
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from nexau import AgentConfig, LLMConfig
from nexau.archs.platform.crypto_vault import _IN_MEMORY_AUTH_META, load_secure_vault
from nexau.archs.transports.http import HTTPConfig, SSETransportServer

from app import dependencies as _deps
from app.client import resolve_cloud_gateway_url
from app.dependencies import init_engine
from app.models.project import ProjectModel
from app.paths import get_database_path, scaffold_nexau_system_storage
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


def _build_agent_config() -> AgentConfig:
    """Build runtime AgentConfig from manifest, encrypted local vault, and cloud gateway config."""
    local_manifest = Path(__file__).resolve().parent / "resources" / "main_agent.yaml"
    fallback_manifest = Path(nexau.__file__).parent / "agents" / "main_agent.yaml"
    agent_config = AgentConfig.from_yaml(local_manifest if local_manifest.exists() else fallback_manifest)

    vault = load_secure_vault() or {}
    cloud_gateway = resolve_cloud_gateway_url()
    active_key = _IN_MEMORY_AUTH_META.get("access_token") or "bearer-pending-auth"
    active_model = os.getenv("MASH_MODEL") or os.getenv("LLM_MODEL") or os.getenv("OPENAI_MODEL") or "mash/auto"

    is_mock = os.getenv("MOCK_LLM", "").lower() in ("true", "1", "yes") or active_key.lower() in ("mock", "none", "test")
    if is_mock:
        default_base_url = "http://mock"
    else:
        llm_base = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
        if llm_base:
            default_base_url = llm_base.rstrip("/")
        else:
            clean_gw = cloud_gateway.removesuffix("/v1/agent")
            default_base_url = clean_gw if clean_gw.endswith("/v1") else f"{clean_gw}/v1"

    retries = int(os.getenv("LLM_MAX_RETRIES", "3"))
    agent_config.retry_attempts = retries

    agent_config.llm_config = LLMConfig(
        api_type="openai_chat_completion",
        model=active_model,
        base_url=default_base_url,
        api_key=active_key,
        max_tokens=int(os.getenv("LLM_MAX_TOKENS")) if os.getenv("LLM_MAX_TOKENS") else None,
        timeout=float(os.getenv("LLM_TIMEOUT", "120.0")),
        stream_idle_timeout=float(os.getenv("LLM_STREAM_IDLE_TIMEOUT", "45.0")),
        max_retries=retries,
    )

    agent_config.max_context_tokens = int(
        os.getenv("LLM_MAX_CONTEXT_TOKENS")
        or vault.get("max_context_tokens")
        or 1048576
    )

    if os.getenv("AGENT_MAX_ITERATIONS"):
        agent_config.max_iterations = int(os.getenv("AGENT_MAX_ITERATIONS"))

    return agent_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    scaffold_nexau_system_storage()
    engine = init_engine(f"sqlite+aiosqlite:///{get_database_path()}")
    await engine.setup_models([ProjectModel])

    try:
        await auth.ensure_valid_token()
    except Exception as e:
        logger.warning("Cold boot token refresh skipped or offline: %s", e)

    sse_server = SSETransportServer(engine=engine, config=HTTPConfig(), default_agent_config=_build_agent_config())

    app.state.engine = engine
    app.state.sse_server = sse_server
    app.state.session_manager = sse_server._session_manager
    _deps._session_manager = sse_server._session_manager
    chat._sse_server = sse_server

    try:
        yield
    finally:
        if getattr(app.state, "engine", None) is engine:
            app.state.engine = None
            app.state.sse_server = None
            app.state.session_manager = None
        if getattr(_deps, "_engine", None) is engine:
            _deps._engine = None
            _deps._session_manager = None
        if getattr(chat, "_sse_server", None) is sse_server:
            chat._sse_server = None
        try:
            await engine.dispose()
        except Exception as e:
            logger.debug("Engine dispose on shutdown failed: %s", e)


app = FastAPI(
    title="Mash Desktop Connector API",
    description="Local desktop sidecar API for Mash.",
    version="1.0.0",
    lifespan=lifespan,
)

# Local desktop only: Next dev server on any loopback port and packaged Electron app://mash origin.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?|app://mash)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(artifacts.router)
app.include_router(artifacts.router, prefix="/api")
app.include_router(uploads.router)
app.include_router(tasks.router)
app.include_router(tasks.router, prefix="/api")
app.include_router(system.router)
app.include_router(auth.router)
app.include_router(settings.router)


@app.get("/health", tags=["system"])
async def root_health():
    """Root /health probe used by Electron's backend supervisor."""
    return await system.get_system_health()
