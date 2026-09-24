import os
import sys
import json
import contextlib
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path

# ponytail: Explicitly load .env file so new LLM settings apply
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import SQLModel
from dotenv import load_dotenv

from nexau import AgentConfig, LLMConfig
from nexau.archs.main_sub.execution.middleware.context_compaction import ContextCompactionMiddleware
from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.transports.http import HTTPConfig, SSETransportServer
from nexau.archs.session.session_manager import SessionManager
from app.dependencies import init_engine
from app.models.project import ProjectModel
from app.routers import projects, sessions, chat, artifacts, uploads, tasks, system, auth, settings

load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
load_dotenv()

# ──────────────────────────────────────────────
# DB path (~/.nexau/nexau.db)
# ──────────────────────────────────────────────
from nexau.archs.platform.path_helpers import get_nexau_home, get_database_path, get_session_brain_dir, get_project_cache_dir

_DB_DIR = get_nexau_home()
_DB_PATH = get_database_path()
_DB_ASYNC_URL = f"sqlite+aiosqlite:///{_DB_PATH}"
_DB_SYNC_URL  = f"sqlite:///{_DB_PATH}"

# ──────────────────────────────────────────────
# Agent config with core tools
# ──────────────────────────────────────────────


def _build_agent_config() -> AgentConfig:
    try:
        from nexau.archs.tool import Tool
        from nexau.archs.tool.builtin import (
            view_file,
            write_file,
            run_shell_command,
            search_file_content,
            replace_file_content,
            glob,
            audit_skill_tool,
            google_web_search,
            web_fetch,
            background_task_manage_tool,
        )
        from nexau.archs.platform.crypto_vault import load_secure_vault
        from nexau.archs.platform.app_config import AppConfig

        app_cfg = AppConfig.load()
        vault = load_secure_vault() or {}

        custom_base_url = os.getenv("OPENAI_BASE_URL") or os.getenv("LLM_BASE_URL")
        custom_key = os.getenv("OPENAI_API_KEY") or os.getenv("LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY")
        custom_model = os.getenv("OPENAI_MODEL") or os.getenv("LLM_MODEL")

        active_key = (
            custom_key
            or vault.get("api_key")
            or ("sk-local-test" if custom_base_url else "")
        )
        active_model = custom_model or app_cfg.model.default_model or "google/gemini-2.5-flash"

        # ponytail: Direct OpenAI-compatible endpoint support (local Ollama/vLLM or any OpenAI proxy)
        active_api_type = os.getenv("LLM_API_TYPE", "openai_chat_completion")
        is_mock = os.getenv("MOCK_LLM", "").lower() in ("true", "1", "yes") or active_key.lower() in ("mock", "none", "test")

        if is_mock:
            active_key = active_key or "mock"
            default_base_url = "http://mock"
        elif custom_base_url:
            default_base_url = custom_base_url
        elif active_key.startswith("sk-or-"):
            default_base_url = "https://openrouter.ai/api/v1"
            if not ("/" in active_model):
                active_model = "google/gemini-2.5-flash"
        else:
            default_base_url = app_cfg.model.gateway_url or os.getenv("BIFROST_GATEWAY_URL", "https://openrouter.ai/api/v1")

        thinking_budget = int(os.getenv("LLM_THINKING_BUDGET", "16384"))
        extra_llm_params: dict[str, Any] = {}
        if thinking_budget > 0:
            extra_llm_params["reasoning"] = {
                "max_tokens": thinking_budget
            }

        common_llm_config = LLMConfig(
            api_type=active_api_type,
            model=active_model,
            api_key=active_key,
            max_tokens=(
                int(os.getenv("LLM_MAX_TOKENS"))
                if os.getenv("LLM_MAX_TOKENS")
                else (65536 if (":free" in active_model or "openrouter/free" in active_model) else (app_cfg.model.max_tokens or 4096))
            ),
            base_url=custom_base_url or default_base_url,
            timeout=float(os.getenv("LLM_TIMEOUT")) if os.getenv("LLM_TIMEOUT") else None,
            stream_idle_timeout=float(os.getenv("LLM_STREAM_IDLE_TIMEOUT")) if os.getenv("LLM_STREAM_IDLE_TIMEOUT") else None,
            **extra_llm_params,
        )

        import nexau
        schemas_dir = Path(nexau.__file__).parent / "archs" / "tool" / "builtin" / "schemas"
        
        # Core builtin tools (native NexAU execution)
        view_file_tool = Tool.from_yaml(str(schemas_dir / "view_file.tool.yaml"), binding=view_file)
        write_file_tool = Tool.from_yaml(str(schemas_dir / "write_file.tool.yaml"), binding=write_file)
        audit_skill_tool_inst = Tool.from_yaml(str(schemas_dir / "audit_skill_tool.tool.yaml"), binding=audit_skill_tool)
        replace_tool = Tool.from_yaml(str(schemas_dir / "replace_file_content.tool.yaml"), binding=replace_file_content)
        search_file_tool = Tool.from_yaml(str(schemas_dir / "search_file_content.tool.yaml"), binding=search_file_content)
        glob_tool = Tool.from_yaml(str(schemas_dir / "glob.tool.yaml"), binding=glob)
        run_shell_tool = Tool.from_yaml(str(schemas_dir / "run_shell_command.tool.yaml"), binding=run_shell_command)
        web_search_tool = Tool.from_yaml(str(schemas_dir / "web_search.tool.yaml"), binding=google_web_search)
        web_fetch_tool = Tool.from_yaml(str(schemas_dir / "web_fetch.tool.yaml"), binding=web_fetch)
        background_task_manage_tool_inst = Tool.from_yaml(str(schemas_dir / "background_task_manage_tool.tool.yaml"), binding=background_task_manage_tool)

        max_ctx_tokens = int(os.getenv("LLM_MAX_CONTEXT_TOKENS", "1000000"))

        # ponytail: NexAU native dynamic compaction (defaults to 75% of model context window)
        target_tokens = os.getenv("COMPACTION_TARGET_TOKENS")
        threshold = (
            min(1.0, max(0.001, float(target_tokens) / max_ctx_tokens))
            if target_tokens
            else float(os.getenv("COMPACTION_THRESHOLD", "0.75"))
        )

        compaction_middleware = ContextCompactionMiddleware(
            auto_compact=True,
            compaction_strategy="llm_summary",
            keep_user_rounds=int(os.getenv("COMPACTION_KEEP_USER_ROUNDS", "5")),
            max_context_tokens=max_ctx_tokens,
            threshold=threshold,
            summary_model=os.getenv("SUMMARY_LLM_MODEL"),
            save_history=True,
            emergency_compact_enabled=True,
        )

        # Core tools - Direct execution without subagent indirection
        unique_tools = []
        seen_names = set()
        for t in [
            view_file_tool,
            write_file_tool,
            replace_tool,
            search_file_tool,
            glob_tool,
            run_shell_tool,
            audit_skill_tool_inst,
            web_search_tool,
            web_fetch_tool,
            background_task_manage_tool_inst,
        ]:
            if t.name not in seen_names:
                seen_names.add(t.name)
                unique_tools.append(t)

        from nexau.archs.main_sub.execution.middleware.long_tool_output import LongToolOutputMiddleware
        from nexau.archs.main_sub.execution.middleware.round_and_token_reminder import RoundAndTokenReminderMiddleware

        # ponytail: Use NexAU native defaults (10,000 chars / ~2,500 tokens cap, 50 head lines, 30 tail lines, disk temp-file offloading)
        long_output_middleware = LongToolOutputMiddleware()

        steering_middleware = RoundAndTokenReminderMiddleware(
            max_context_tokens=max_ctx_tokens,
            desired_max_tokens=16384,
            enable_routine_reminders=False,
        )

        return AgentConfig(
            name="main_auditor",
            system_prompt=None,  # ponytail: None delegates to default_system_prompt.j2 with full runtime context and tools
            tools=unique_tools,
            sub_agents={},
            llm_config=common_llm_config,
            middlewares=[compaction_middleware, long_output_middleware, steering_middleware],
            max_context_tokens=max_ctx_tokens,
            max_iterations=int(os.getenv("AGENT_MAX_ITERATIONS", "10")),
            stop_tools=set(),
        )
    except Exception as e:
        print(f"[WARN] Error initializing tools: {e}")
        from nexau.archs.main_sub.execution.middleware.round_and_token_reminder import RoundAndTokenReminderMiddleware
        fallback_steering = RoundAndTokenReminderMiddleware(
            max_context_tokens=1000000,
            desired_max_tokens=16384,
            enable_routine_reminders=False,
        )
        return AgentConfig(
            name="main_auditor",
            system_prompt=None,
            llm_config=common_llm_config,
            tools=[],
            sub_agents={},
            middlewares=[fallback_steering],
            max_context_tokens=1000000,
            max_iterations=int(os.getenv("AGENT_MAX_ITERATIONS", "10")),
            stop_tools=set(),
        )

# ──────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.dependencies as _deps
    from nexau.archs.platform.path_helpers import scaffold_nexau_system_storage

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
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