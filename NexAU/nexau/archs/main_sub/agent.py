# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Agent container and runtime wiring for NexAU.

RFC-0006: Agent  neutral structured tool definitions

Agent  structured  Tool / SubAgent  neutral
structured definitions;  provider-specific payload  LLMCaller 
 ``llm_config.api_type`` . 
"""

import asyncio
import inspect
import logging
import os
import threading
import traceback
import uuid
import warnings
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any, cast

if TYPE_CHECKING:
    from nexau.archs.main_sub.framework_context import FrameworkContext
    from nexau.archs.main_sub.team.state import AgentTeamState

import anthropic
import dotenv
import openai
import yaml

from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.agent_context import AgentContext, GlobalStorage
from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.main_sub.config import AgentConfig, ConfigError, ExecutionConfig
from nexau.archs.main_sub.context_value import ContextValue
from nexau.archs.main_sub.execution.executor import Executor
from nexau.archs.main_sub.execution.stop_reason import AgentStopReason
from nexau.archs.main_sub.execution.stop_result import StopResult
from nexau.archs.main_sub.history_list import HistoryList
from nexau.archs.main_sub.prompt_builder import PromptBuilder
from nexau.archs.main_sub.runtime_context import build_runtime_prompt_context
from nexau.archs.main_sub.skill import Skill, build_load_skill_tool, build_tool_skill
from nexau.archs.main_sub.token_trace_session import TokenTraceSession
from nexau.archs.main_sub.tool_call_modes import (
    STRUCTURED_TOOL_CALL_MODES,
    normalize_tool_call_mode,
    resolve_structured_provider_target,
)
from nexau.archs.main_sub.utils.cleanup_manager import cleanup_manager
from nexau.archs.main_sub.utils.image_probe import ensure_inbound_images_within_limits
from nexau.archs.main_sub.utils.token_counter import TokenCounter
from nexau.archs.permissions.types import PendingPermissionsError
from nexau.archs.sandbox import (
    BaseSandbox,
    BaseSandboxManager,
    LocalSandboxConfig,
    LocalSandboxManager,
    SandboxConfig,
)
from nexau.archs.session import AgentRunActionKey, SessionManager
from nexau.archs.session.models.agent_run_action_model import RunStatus
from nexau.archs.session.orm import InMemoryDatabaseEngine
from nexau.archs.tool import Tool
from nexau.archs.tool.builtin.tool_search import tool_search
from nexau.archs.tool.tool import StructuredToolDefinition
from nexau.archs.tool.tool_registry import ToolRegistry
from nexau.archs.tracer.context import TraceContext
from nexau.archs.tracer.core import BaseTracer, SpanType
from nexau.core.adapters.legacy import messages_from_legacy_openai_chat
from nexau.core.messages import Message, Role, TextBlock

# Setup logger for agent execution
logger = logging.getLogger(__name__)


def _normalize_run_history(history: list[dict[str, Any]] | list[Message] | None) -> list[Message]:
    """Normalize public Agent.run history input to UMP messages.

    Legacy OpenAI-chat dict history is still accepted at the outermost Agent API
    boundary for backward compatibility, but all internal execution should use
    UMP ``Message`` objects.
    """
    if not history:
        return []
    if all(isinstance(item, Message) for item in history):
        return list(cast(list[Message], history))
    if all(isinstance(item, dict) for item in history):
        return messages_from_legacy_openai_chat(cast(list[dict[str, Any]], history))
    raise TypeError("history must contain only Message objects or only legacy OpenAI-chat dicts")


class Agent:
    """Lightweight agent container focusing on configuration and delegation."""

    def __init__(
        self,
        *,
        config: AgentConfig,
        openai_client: Any | None = None,
        agent_id: str | None = None,
        global_storage: GlobalStorage | None = None,
        session_manager: SessionManager | None = None,
        user_id: str | None = None,
        session_id: str | None = None,
        is_root: bool = True,
        variables: ContextValue | None = None,
        team_state: "AgentTeamState | None" = None,
        sandbox_manager: "BaseSandboxManager[BaseSandbox] | None" = None,
    ):
        """Initialize agent with configuration.

        Args:
            config: Agent configuration
            openai_client: Optional prebuilt LLM client
            agent_id: Optional agent ID (auto-generated if not provided)
            global_storage: Optional global storage instance
            session_manager: Optional SessionManager for unified data access. If None,
                uses the shared in-memory SessionManager (via InMemoryDatabaseEngine.get_shared_instance()).
            user_id: Optional user ID for persistence
            session_id: Optional session ID for persistence
            is_root: Whether this is the root agent (default True). Set to False for sub-agents.
            variables: Optional ContextValue with structured runtime parameters
        """
        logger.info("Initializing Agent (%s)", config.name)

        # Store basic config
        self._is_root = is_root
        self.config: AgentConfig = config
        self._variables = variables
        self._team_state = team_state
        self._shared_sandbox_manager = sandbox_manager
        self._user_id = user_id or f"user_{uuid.uuid4().hex[:8]}"
        self._session_id = session_id or str(uuid.uuid4())

        # Initialize session_manager
        if session_manager is not None:
            self._session_manager = session_manager
            logger.debug("Using provided SessionManager")
        else:
            default_engine = InMemoryDatabaseEngine.get_shared_instance()
            self._session_manager = SessionManager(engine=default_engine)
            logger.debug("Using shared in-memory SessionManager")

        # Session initialization: load storage and register agent
        if self.__class__._is_skip_sync_session_init():
            # Agent.create path: async init will be done after __init__ returns
            self.global_storage = global_storage or GlobalStorage()
            self.agent_id = agent_id or f"pending_{uuid.uuid4().hex[:8]}"
        else:
            # Sync path (CLI, scripts, ThreadPoolExecutor workers)
            self.global_storage, self.agent_id = self._init_session_state(
                provided_storage=global_storage,
                proposed_agent_id=agent_id,
            )
        self.agent_name = self.config.name or self.agent_id

        # Set tracer in global storage (with conflict check)
        self._setup_tracer()

        # Prefer the tool_call_mode defined on AgentConfig when an ExecutionConfig
        # is not explicitly provided to keep Python-created agents consistent with
        # YAML-created ones.
        self.exec_config = ExecutionConfig.from_agent_config(self.config)

        # 1. RFC-0006: Python / YAML tool_call_mode, legacy alias.
        self.tool_call_mode = normalize_tool_call_mode(self.exec_config.tool_call_mode)
        self.use_structured_tool_calls = self.tool_call_mode in STRUCTURED_TOOL_CALL_MODES
        if self.use_structured_tool_calls:
            # 2. RFC-0006: structured provider api_type, tool_call_mode .
            resolve_structured_provider_target(self.config.llm_config.api_type if self.config.llm_config else None)

        # Initialize services
        logger.info("Initializing LLM client (api_type=%s)", self.config.llm_config.api_type if self.config.llm_config else "default")
        self.openai_client = openai_client if openai_client is not None else self._initialize_openai_client()
        self._async_openai_client = self._initialize_async_openai_client()

        # OpenAI Responses API prompt_cache_key, prompt .
        # agent key, agent key.
        if self.config.llm_config and self.config.llm_config.api_type == "openai_responses":
            if not self.config.llm_config.get_param("prompt_cache_key"):
                cache_key = str(uuid.uuid4())
                self.config.llm_config.set_param("prompt_cache_key", cache_key)
                logger.info("Injected prompt_cache_key=%s for agent '%s'", cache_key, self.config.name)

        # Load tool sources
        configured_tools = list(self.config.tools)
        mcp_tools = self._initialize_mcp_tools() if self.config.mcp_servers else []

        # Initialize sandbox
        self._initialize_sandbox()

        nexau_package_path = Path(__file__).parent.parent.parent
        searchable_tools = [*configured_tools, *mcp_tools]
        runtime_skills = self._build_runtime_skills()

        skill_tools: list[Tool] = []
        skill_tool = build_load_skill_tool(searchable_tools, runtime_skills)
        if skill_tool is not None:
            skill_tools.append(skill_tool)

        # RFC-0005: ToolRegistry, deferred loading
        self._tool_registry = ToolRegistry()
        self._tool_registry.add_source("config", configured_tools)
        if mcp_tools:
            self._tool_registry.add_source("mcp", mcp_tools)
        if skill_tools:
            self._tool_registry.add_source("builtin", skill_tools)

        # RFC-0005: deferred ToolSearch
        # deferred ToolSearch, payload
        if self._tool_registry.deferred_count > 0:
            tool_search_tool = Tool.from_yaml(
                str(nexau_package_path / "archs" / "tool" / "builtin" / "schemas" / "ToolSearch.tool.yaml"),
                binding=tool_search,
                as_skill=False,
            )
            self._tool_registry.add_source("builtin", [tool_search_tool])

        logger.info(
            "Registered %d tools (%d eager, %d deferred), %d sub_agents",
            len(self._tool_registry.get_all()),
            self._tool_registry.eager_count,
            self._tool_registry.deferred_count,
            len(self.config.sub_agents) if self.config.sub_agents else 0,
        )

        # Build skill registry for quick lookup (per-agent, not in global_storage)
        self.skill_registry = {skill.name: skill for skill in runtime_skills}

        # Initialize prompt builder
        self.prompt_builder = PromptBuilder()

        # Initialize execution components
        self._initialize_execution_components()

        # Conversation history (using HistoryList for automatic persistence)
        self._history: HistoryList = HistoryList(
            session_manager=self._session_manager,
            history_key=AgentRunActionKey(
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self.agent_id,
            ),
            agent_name=self.agent_name,
        )

        # RFC-0009: run token trace session
        self._token_trace_session: TokenTraceSession | None = None

        # RFC-0001: run context, interrupt
        self._last_context: dict[str, Any] = {}

        # RFC-0001: _run_async_inner completed ( history )
        # asyncio.Event, interrupt run_async
        self._run_complete: asyncio.Event = asyncio.Event()
        self._run_complete.set()  # :

        # Queue for messages to be processed in the next execution cycle
        self.queued_messages: list[Message] = []

        # Register for cleanup
        cleanup_manager.register_agent(self)
        logger.info("Agent '%s' initialized (agent_id=%s, session_id=%s)", self.agent_name, self.agent_id, self._session_id)

    @classmethod
    async def create(
        cls,
        *,
        config: AgentConfig,
        openai_client: Any | None = None,
        agent_id: str | None = None,
        global_storage: GlobalStorage | None = None,
        session_manager: SessionManager | None = None,
        user_id: str | None = None,
        session_id: str | None = None,
        is_root: bool = True,
        variables: ContextValue | None = None,
        team_state: "AgentTeamState | None" = None,
        sandbox_manager: "BaseSandboxManager[BaseSandbox] | None" = None,
    ) -> "Agent":
        """Async factory for Agent - the preferred way to create agents from async code.

        Performs session initialization (DB models, agent registration, storage
        restore) natively on the running event loop, avoiding nest_asyncio and
        cross-loop issues.

        Usage::

            agent = await Agent.create(config=my_config, session_manager=sm)
            response = await agent.run_async(message="Hello")

        All parameters are identical to ``Agent.__init__``.
        """
        # 1. session_manager, _DEFERRED_INIT sentinel sync init
        sm = session_manager
        if sm is None:
            default_engine = InMemoryDatabaseEngine.get_shared_instance()
            sm = SessionManager(engine=default_engine)

        # 2.: _skip_sync_init=True __init__ sync session
        # __init__, object.__new__ +
        # ... .: Agent ( transport )
        # create async session init.
        # , running loop Agent.
        # : __init__ async context session init
        # create async init.

        # __init__, thread-local flag
        # (: Agent.create )
        cls._create_flag.skip = True
        try:
            instance = cls(
                config=config,
                openai_client=openai_client,
                agent_id=agent_id,
                global_storage=global_storage,
                session_manager=sm,
                user_id=user_id,
                session_id=session_id,
                is_root=is_root,
                variables=variables,
                team_state=team_state,
                sandbox_manager=sandbox_manager,
            )
        finally:
            cls._create_flag.skip = False

        # 3. asynchronous execution session
        storage, resolved_agent_id = await instance._init_session_state_async(
            provided_storage=global_storage,
            proposed_agent_id=agent_id,
        )
        instance.global_storage = storage
        instance.agent_id = resolved_agent_id
        instance.agent_name = instance.config.name or resolved_agent_id

        # 3.5 P1 async/sync: async MCP
        # __init__ MCP (create_flag.skip=True)
        # completed MCP .
        if instance.config.mcp_servers:
            mcp_tools = await instance._initialize_mcp_tools_async()
            if mcp_tools:
                instance._tool_registry.add_source("mcp", mcp_tools)
                # structured tool payload package MCP
                instance.executor.update_structured_tools(instance._build_tool_call_payload())
                logger.info(
                    "Registered %d MCP tools via async init (total: %d eager, %d deferred)",
                    len(mcp_tools),
                    instance._tool_registry.eager_count,
                    instance._tool_registry.deferred_count,
                )

        # 4. agent_id/global_storage
        # Issue #431: (tracer + skill_registry )
        instance._reinject_transient_state()
        instance._rebuild_executor_with_resolved_id()

        return instance

    # Sentinel for create to skip sync session init in __init__
    # Use threading.local to isolate concurrent Agent.create calls across
    # different threads. Within a SINGLE thread (the common single-threaded
    # asyncio case), safety relies on the fact that there is NO await between
    # `skip = True` and `cls(...)`, so no other coroutine can observe the flag.
    # ⚠️ INVARIANT: Do NOT insert any `await` between setting skip and the
    # cls(...) call - that would allow another coroutine in the same thread
    # to see the stale flag and skip its own session init.
    _create_flag: threading.local = threading.local()

    @classmethod
    def _is_skip_sync_session_init(cls) -> bool:
        return getattr(cls._create_flag, "skip", False)

    def _rebuild_executor_with_resolved_id(self) -> None:
        """Update executor and HistoryList with resolved agent_id after async init.

        Called by Agent.create() after _init_session_state_async() resolves the
        real agent_id / global_storage. Updates:
        - executor.agent_name / agent_id / global_storage
        - executor.llm_caller.global_storage (for tracer access at LLM call time)
        - executor.subagent_manager.global_storage (for sub-agent tracer propagation)
        - HistoryList history_key (for persistence routing)
        """
        self.executor.agent_name = self.agent_name
        self.executor.agent_id = self.agent_id
        self.executor.global_storage = self.global_storage
        self.executor.llm_caller.global_storage = self.global_storage
        self.executor.subagent_manager.global_storage = self.global_storage

        # HistoryList: update the history_key to match resolved agent_id
        self._history.update_history_key(
            AgentRunActionKey(
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self.agent_id,
            )
        )

    @property
    def history(self) -> HistoryList:
        """Get the conversation history."""
        return self._history

    @history.setter
    def history(self, value: list[Message] | HistoryList) -> None:
        """Set the conversation history with smart detection.

        This setter intercepts direct assignment to agent.history and:
        1. If value is already a HistoryList, use it directly
        2. Otherwise, use replace_all() which intelligently detects append vs replace

        Args:
            value: New history (list of messages or HistoryList)
        """
        if isinstance(value, HistoryList):
            self._history = value
        else:
            self._history.replace_all(value)

    def _init_session_state(
        self,
        *,
        provided_storage: GlobalStorage | None,
        proposed_agent_id: str | None,
    ) -> tuple[GlobalStorage, str]:
        """Initialize session state synchronously.

        Uses asyncio.run() when no event loop is running (CLI, scripts, thread pool
        workers). Raises RuntimeError if called from an async context - callers in
        async code should use ``await Agent.create(...)`` instead.
        """
        from nexau.core.utils import get_running_loop_or_none

        if get_running_loop_or_none() is not None:
            raise RuntimeError(
                "Agent() cannot be called directly from an async context "
                "(this would require nest_asyncio). Use `await Agent.create(...)` "
                "or wrap in `asyncio.to_thread(lambda: Agent(...))` instead."
            )
        return asyncio.run(
            self._init_session_state_async(
                provided_storage=provided_storage,
                proposed_agent_id=proposed_agent_id,
            )
        )

    async def _init_session_state_async(
        self,
        *,
        provided_storage: GlobalStorage | None,
        proposed_agent_id: str | None,
    ) -> tuple[GlobalStorage, str]:
        """Initialize session state: global_storage and agent_id (async).

        This method consolidates all async session operations into a single call.

        Initialization logic:
        1. Initialize database models
        2. Register agent (which also creates/fetches session)
        3. Determine global_storage:
           - If user provides storage: use it directly (override mode)
           - Otherwise: use session.storage directly (restore mode)

        Args:
            provided_storage: User-provided GlobalStorage, or None
            proposed_agent_id: User-proposed agent ID, or None

        Returns:
            Tuple of (global_storage, agent_id)
        """
        # Step 1: Initialize database models
        await self._session_manager.setup_models()
        logger.debug("Session models initialized")

        # Step 2: Register agent - this also returns the session
        agent_id, session = await self._session_manager.register_agent(
            user_id=self._user_id,
            session_id=self._session_id,
            agent_id=proposed_agent_id,
            agent_name=self.config.name or "",
            is_root=self._is_root,
        )
        logger.debug("Agent registered with id='%s'", agent_id)

        # Step 3: Determine global_storage
        if provided_storage is not None:
            storage = provided_storage
            logger.info(
                "Using user-provided global_storage (override mode, %d keys)",
                len(storage.to_dict()),
            )
        else:
            storage = session.storage
            storage_size = len(storage.to_dict())
            if storage_size > 0:
                logger.info(
                    "Restored global_storage from session '%s' (%d keys)",
                    self._session_id,
                    storage_size,
                )
            else:
                logger.debug("Using empty GlobalStorage from session")

        return storage, agent_id

    def _setup_tracer(self) -> None:
        """Set up tracer in global_storage.

        If config.resolved_tracer is provided, it always takes precedence
        (overwrites any stale tracer restored from session storage).
        """
        if self.config.resolved_tracer is not None:
            self.global_storage.set("tracer", self.config.resolved_tracer)
            # Synchronize the Agent's canonical session_id to the tracer
            # so that trace backends (e.g. Langfuse) group traces under
            # the correct session instead of a random UUID.
            self.config.resolved_tracer.set_session_id(self._session_id)
            logger.debug("Tracer set from config.resolved_tracer (session_id=%s)", self._session_id)

    def _reinject_transient_state(self) -> None:
        """Re-inject non-serializable runtime state after storage swap.

        Issue #431: Agent.create()  session  storage  __init__ 
         storage, . 
        method,  key . 

        Note: skill_registry  AgentState (per-agent),  global_storage. 
        """
        # 1. tracer
        self._setup_tracer()

    @classmethod
    def from_yaml(
        cls,
        config_path: Path,
        agent_id: str | None = None,
        overrides: dict[str, Any] | None = None,
        global_storage: GlobalStorage | None = None,
    ) -> "Agent":
        """
        Create agent from YAML file.

        Args:
            config_path: Path to the agent configuration YAML file
            overrides: Dictionary of configuration overrides
            template_context: Context variables for Jinja template rendering
            global_storage: Optional global storage instance

        Returns:
            Configured Agent instance
        """
        if overrides:
            warnings.warn(
                "The overrides parameter is deprecated and will be removed in a future "
                "version. Please use AgentConfig.from_yaml() to load the configuration, "
                "modify attributes directly (e.g., agent_config.key = value), and then "
                "initialize the Agent using Agent(config=agent_config).",
                DeprecationWarning,
                stacklevel=2,
            )
        try:
            dotenv.load_dotenv()
            if not config_path.exists():
                raise ConfigError(f"Configuration file not found: {config_path}")

            # Load config schema from YAML configuration
            agent_config = AgentConfig.from_yaml(config_path, overrides)

            if global_storage is None:
                global_storage = GlobalStorage()
            if agent_config.global_storage:
                global_storage.update(agent_config.global_storage)

            # if config.get("system_prompt_type") == "jinja" and template_context:

            return cls(config=agent_config, agent_id=agent_id, global_storage=global_storage)

        except yaml.YAMLError as e:
            raise ConfigError(f"YAML parsing error in {config_path}: {e}")
        except Exception as e:
            traceback.print_exc()
            raise ConfigError(
                f"Error loading configuration from {config_path}: {e}",
            )

    def _initialize_openai_client(self) -> Any:
        """Initialize OpenAI client from LLM config."""
        # Guard clause
        llm_config = self.config.llm_config or LLMConfig()

        try:
            if llm_config.api_type in {"gemini_rest", "google_genai", "generate_with_token"}:
                return None
            if llm_config.api_type == "anthropic_chat_completion":
                client_kwargs = llm_config.to_client_kwargs()
                return anthropic.Anthropic(**client_kwargs)
            if llm_config.api_type in ["openai_responses", "openai_chat_completion"]:
                client_kwargs = llm_config.to_client_kwargs()
                return openai.OpenAI(**client_kwargs)
            raise ValueError(f"Invalid API type: {llm_config.api_type}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize OpenAI client: {e}")
            return None

    def _initialize_async_openai_client(self) -> Any:
        """Initialize async OpenAI/Anthropic client for native async LLM calls.

        async/sync:  AsyncOpenAI / AsyncAnthropic, 
         call_llm_async  await  to_thread . 
        """
        llm_config = self.config.llm_config or LLMConfig()

        try:
            if llm_config.api_type in {"gemini_rest", "google_genai", "generate_with_token"}:
                return None
            if llm_config.api_type == "anthropic_chat_completion":
                client_kwargs = llm_config.to_client_kwargs()
                return anthropic.AsyncAnthropic(**client_kwargs)
            if llm_config.api_type in ["openai_responses", "openai_chat_completion"]:
                client_kwargs = llm_config.to_client_kwargs()
                return openai.AsyncOpenAI(**client_kwargs)
            return None
        except Exception as e:
            logger.error(f"❌ Failed to initialize async client: {e}")
            return None

    def _initialize_mcp_tools(self) -> list[Tool]:
        """Initialize tools from MCP servers.

        P1 async/sync : async context  sync MCP 

         Agent.create()  (create_flag.skip=True), 
         sync MCP, list. Agent.create() 
         _initialize_mcp_tools_async() completed MCP . 
        """
        # async factory path: defer MCP init to Agent.create
        if self.__class__._is_skip_sync_session_init():
            logger.info(
                f"Deferring MCP tools initialization to async Agent.create() path ({len(self.config.mcp_servers)} servers configured)"
            )
            return []

        try:
            # Import here to avoid circular imports and optional dependency
            from ..tool.builtin import sync_initialize_mcp_tools

            logger.info(
                f"Initializing MCP tools from {len(self.config.mcp_servers)} servers",
            )

            mcp_tools = sync_initialize_mcp_tools(self.config.mcp_servers)
            logger.info(f"Successfully initialized {len(mcp_tools)} MCP tools")
            return list(mcp_tools)

        except ImportError:
            logger.error(
                "MCP client not available. Please install the mcp package.",
            )
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools: {e}")

        return []

    async def _initialize_mcp_tools_async(self) -> list[Tool]:
        """Initialize tools from MCP servers asynchronously.

        P1 async/sync : async MCP 

         Agent.create(),  async initialize_mcp_tools(), 
         MCP,  event loop. 
        """
        try:
            from ..tool.builtin import initialize_mcp_tools

            logger.info(
                f"Async initializing MCP tools from {len(self.config.mcp_servers)} servers",
            )

            mcp_tools = await initialize_mcp_tools(self.config.mcp_servers)
            logger.info(f"Successfully initialized {len(mcp_tools)} MCP tools (async)")
            return list(mcp_tools)

        except ImportError:
            logger.error(
                "MCP client not available. Please install the mcp package.",
            )
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools (async): {e}")

        return []

    def _structured_tool_description(self, tool: Tool) -> str:
        """Return the description exposed to structured tool-calling models."""
        return tool.get_structured_description()

    def _build_tool_call_payload(self) -> list[StructuredToolDefinition]:
        """Build neutral structured tool definitions for the active runtime.

        RFC-0006: Agent  neutral structured definitions

        structured, Agent  Tool  neutral definitions; 
        provider-specific OpenAI / Anthropic / Gemini schema . 

        RFC-0015: Agent  builtin tool  AgentConfig._finalize(), 
        . 
        """

        if not self.use_structured_tool_calls:
            return []

        tools_spec: list[StructuredToolDefinition] = []

        # 1. ToolRegistry eager tool ( builtin / MCP / LoadSkill / ToolSearch / Agent) .
        for tool in self._tool_registry.compute_eager_tools():
            tools_spec.append(
                tool.to_structured_definition(
                    description=self._structured_tool_description(tool),
                ),
            )

        return tools_spec

    @property
    def tool_call_payload(self) -> list[StructuredToolDefinition]:
        """Return the current neutral structured tool definitions."""
        if not self.use_structured_tool_calls:
            return []
        return self._build_tool_call_payload()

    @property
    def tool_registry(self) -> dict[str, Tool]:
        """Backward-compatible view of the registered tools."""
        return self._tool_registry.get_all()

    def _initialize_execution_components(self) -> None:
        """Initialize execution components."""
        self._validate_middleware_compatibility()
        token_counter = self._resolve_token_counter()

        self.executor = Executor(
            agent_name=self.agent_name,
            agent_id=self.agent_id,
            tool_registry=self._tool_registry,
            sub_agents=self.config.sub_agents or {},
            stop_tools=self.config.stop_tools or set(),
            openai_client=self.openai_client,
            async_openai_client=self._async_openai_client,
            llm_config=self.config.llm_config or LLMConfig(),
            max_iterations=self.exec_config.max_iterations,
            max_context_tokens=self.exec_config.max_context_tokens,
            max_running_subagents=self.exec_config.max_running_subagents,
            retry_attempts=self.exec_config.retry_attempts,
            retry_backoff_max_seconds=self.exec_config.retry_backoff_max_seconds,
            token_counter=token_counter,
            after_model_hooks=self.config.after_model_hooks,
            after_tool_hooks=self.config.after_tool_hooks,
            before_model_hooks=self.config.before_model_hooks,
            before_tool_hooks=self.config.before_tool_hooks,
            middlewares=self.config.middlewares,
            global_storage=self.global_storage,
            tool_call_mode=self.tool_call_mode,
            team_mode=self._team_state is not None,
            structured_tools=self.tool_call_payload,
            session_manager=self._session_manager,
            user_id=self._user_id,
            session_id=self._session_id,
        )

    def _validate_middleware_compatibility(self) -> None:
        """Validate middleware compatibility with the active LLM backend."""
        if self.config.llm_config is None or self.config.llm_config.api_type != "generate_with_token":
            return
        if not self.config.middlewares:
            return

        from nexau.archs.main_sub.execution.middleware.context_compaction import ContextCompactionMiddleware

        if any(isinstance(middleware, ContextCompactionMiddleware) for middleware in self.config.middlewares):
            raise ValueError(
                "api_type='generate_with_token' does not support ContextCompactionMiddleware. "
                "Please disable context compaction for this agent."
            )

    def _initialize_sandbox(self) -> None:
        """Initialize sandbox."""
        sandbox_config = self.config.sandbox_config
        if sandbox_config is None:
            sandbox_config = LocalSandboxConfig()

        # RFC-0032: Merge sandbox_env from variables into sandbox config
        if self._variables and self._variables.sandbox_env:
            merged_envs = {**sandbox_config.envs, **self._variables.sandbox_env}
            sandbox_config = sandbox_config.model_copy(update={"envs": merged_envs})

        # typed config, typed property
        self.config.sandbox_config = sandbox_config

        # Local sandbox, skill
        self._is_local_sandbox = isinstance(sandbox_config, LocalSandboxConfig)

        if self._shared_sandbox_manager is not None:
            # : sandbox_manager (Team caller-owned sub-agent )
            self.sandbox_manager: BaseSandboxManager[BaseSandbox] = self._shared_sandbox_manager
            self._is_local_sandbox = isinstance(self.sandbox_manager, LocalSandboxManager)
            # cleanup_manager, owner
        else:
            # : sandbox_manager
            self.sandbox_manager = LocalSandboxManager(work_dir=sandbox_config.work_dir)

            self.sandbox_manager.prepare_session_context(
                session_manager=self._session_manager,
                user_id=self._user_id,
                session_id=self._session_id,
                sandbox_config=sandbox_config,
                upload_assets=[],  # upload assets 
            )

            cleanup_manager.register_sandbox_manager(self.sandbox_manager)

        # sandbox skill ; local sandbox
        if not self._is_local_sandbox:
            upload_assets = self._build_skill_upload_assets()
            self.sandbox_manager.add_upload_assets(upload_assets)

    def _sandbox_skill_folder(self, local_folder: str) -> str:
        """Return the sandbox path used for a folder-based skill."""
        return str(Path(self.sandbox_manager.work_dir) / ".skills" / os.path.basename(local_folder))

    def _build_skill_upload_assets(self) -> list[tuple[str, str]]:
        """Collect local->sandbox directory uploads for folder-based skills.

        Keeps ``self.config.skills`` immutable so the original local folder can be
        reused across multiple Agent instances built from the same config.
        """
        upload_assets: list[tuple[str, str]] = []
        for skill in self.config.skills:
            if skill.folder:
                upload_assets.append((skill.folder, self._sandbox_skill_folder(skill.folder)))
        return upload_assets

    def _build_runtime_skills(self) -> list[Skill]:
        """Build runtime skill registry entries without mutating ``self.config.skills``."""
        runtime_skills: list[Skill] = []
        existing_skill_names: set[str] = set()

        for skill in self.config.skills:
            # Local sandbox, ; sandbox sandbox
            if skill.folder and not self._is_local_sandbox:
                sandbox_folder = self._sandbox_skill_folder(skill.folder)
            else:
                sandbox_folder = skill.folder
            runtime_skill = Skill(
                name=skill.name,
                description=skill.description,
                detail=skill.detail,
                folder=sandbox_folder,
            )
            runtime_skills.append(runtime_skill)
            existing_skill_names.add(runtime_skill.name)

        for tool in self.config.tools:
            if getattr(tool, "as_skill", False) is True and tool.name not in existing_skill_names:
                runtime_skills.append(build_tool_skill(tool, tool_call_mode=self.tool_call_mode))
                existing_skill_names.add(tool.name)

        return runtime_skills

    def _resolve_token_counter(self) -> TokenCounter:
        """Cast configured token counter to TokenCounter instance."""
        configured_counter = self.config.token_counter
        model_name = self.config.llm_config.model if self.config.llm_config else "gpt-4o"

        if isinstance(configured_counter, TokenCounter):
            return configured_counter

        token_counter = TokenCounter(model=model_name)
        if callable(configured_counter):
            try:
                signature = inspect.signature(configured_counter)
            except (TypeError, ValueError):
                signature = None

            has_var_args = False
            has_var_kwargs = False
            has_tools_param = False
            if signature is not None:
                has_tools_param = "tools" in signature.parameters
                has_var_args = any(parameter.kind == inspect.Parameter.VAR_POSITIONAL for parameter in signature.parameters.values())
                has_var_kwargs = any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in signature.parameters.values())

            def wrapped_counter(
                messages: Sequence[Message],
                tools: Sequence[Mapping[str, object]] | None = None,
            ) -> int:
                if tools is not None:
                    if has_tools_param or has_var_kwargs:
                        return int(configured_counter(messages, tools=tools))
                    if has_var_args:
                        return int(configured_counter(messages, tools))
                return int(configured_counter(messages))

            token_counter.set_counter(wrapped_counter)
            return token_counter

        return token_counter

    async def run_async(
        self,
        *,
        message: str | list[Message],
        history: list[dict[str, Any]] | list[Message] | None = None,
        context: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None,
        parent_agent_state: AgentState | None = None,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        variables: ContextValue | None = None,
        run_id: str | None = None,
        trace_id: str | None = None,
    ) -> str | tuple[str, dict[str, Any]]:
        """Run agent asynchronously with a message and return response.

        This is the async version of run(). Use this when you're already in an async context.

        The agent lock ensures only one execution per (session_id, agent_id) at a time.
        If the agent is already running, this method fails immediately with TimeoutError.

        Lock features:
        - Short TTL (default 30s) with automatic heartbeat renewal
        - Fast recovery: max 30s deadlock time even if release fails
        - No waiting: fails immediately if agent is busy

        Args:
            message: User message or list of messages
            history: Optional conversation history
            context: Optional context dict
            state: Optional state dict
            config: Optional config dict
            parent_agent_state: Optional parent agent state (for sub-agents)
            custom_llm_client_provider: Optional custom LLM client provider
            variables: Optional ContextValue with structured runtime parameters
            run_id: Optional pre-generated run ID; auto-generated if not provided

        Returns:
            Agent response string or tuple of (response, state)

        Raises:
            TimeoutError: If agent is already running
        """
        # Generate run_id before acquiring lock
        if run_id is None:
            from nexau.archs.session.id_generator import generate_run_id

            run_id = generate_run_id()

        async with self._session_manager.agent_lock.acquire(
            session_id=self._session_id,
            agent_id=self.agent_id,
            user_id=self._user_id,
            run_id=run_id,
        ):
            return await self._run_async_inner(
                message=message,
                history=history,
                context=context,
                state=state,
                config=config,
                parent_agent_state=parent_agent_state,
                custom_llm_client_provider=custom_llm_client_provider,
                run_id=run_id,
                variables=variables,
                trace_id=trace_id,
            )

    async def _run_async_inner(
        self,
        *,
        message: str | list[Message],
        history: list[dict[str, Any]] | list[Message] | None = None,
        context: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None,
        parent_agent_state: AgentState | None = None,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        run_id: str,
        variables: ContextValue | None = None,
        trace_id: str | None = None,
    ) -> str | tuple[str, dict[str, Any]]:
        """Inner implementation of run_async without lock handling.

        This method contains the actual agent execution logic.

        Args:
            run_id: Run ID for this execution (generated by run_async)
        """
        # #601:(>20MiB / >60MP)
        # , history -- errorretry
        # omit .
        if isinstance(message, list):
            ensure_inbound_images_within_limits(message)

        # RFC-0001: run, interrupt
        self._run_complete.clear()

        # async/sync: lazy re-init async client ( run close)
        if self.executor.llm_caller.async_openai_client is None:
            self.executor.llm_caller.async_openai_client = self._initialize_async_openai_client()

        # RFC-0019: - run
        pending = await self._session_manager.get_pending_tool_calls(
            user_id=self._user_id,
            session_id=self._session_id,
        )
        if pending and any(v.get("decision") is None for v in pending.values()):
            raise PendingPermissionsError(
                session_id=self._session_id,
                pending=pending,
            )

        logger.info(f"🤖 Agent '{self.config.name}' starting execution")
        message_text_for_logs = (
            message
            if isinstance(message, str)
            else next(
                (m.get_text_content() for m in reversed(message) if m.role == Role.USER and m.get_text_content()),
                f"<{len(message)} Message blocks>",
            )
        )
        logger.info(f"📝 User message: {message_text_for_logs}")

        # Merge initial state/config/context with provided ones
        merged_state = {**(self.config.initial_state or {})}
        if state:
            merged_state.update(state)

        merged_config = {**(self.config.initial_config or {})}
        if config:
            merged_config.update(config)

        effective_variables = variables or self._variables
        sandbox_instance = getattr(self.sandbox_manager, "_instance", None)
        runtime_context = build_runtime_prompt_context(
            sandbox_instance,
            working_directory=getattr(self.sandbox_manager, "work_dir", None),
        )
        initial_context = {
            "session_id": self._session_id,
            "user_id": self._user_id,
            **runtime_context,
            **(self.config.initial_context or {}),
        }
        merged_context = AgentContext.from_sources(
            initial_context=initial_context,
            legacy_context=context,
            template=effective_variables.template if effective_variables else None,
        ).context

        # Inject sandbox_env into sandbox at run time
        if effective_variables and effective_variables.sandbox_env:
            sandbox_instance = self.sandbox_manager.instance
            if sandbox_instance is not None:
                # Sandbox already created - update its envs directly
                sandbox_instance.envs = {**sandbox_instance.envs, **effective_variables.sandbox_env}
            else:
                # Sandbox not yet created - update the stored session context
                # so envs are included when the sandbox is lazily initialized
                ctx_data = self.sandbox_manager.session_context
                if ctx_data:
                    cfg = ctx_data.get("sandbox_config")
                    if isinstance(cfg, dict):
                        sandbox_cfg = cast(dict[str, dict[str, str]], cfg)
                        prev_envs = sandbox_cfg.get("envs", {})
                        sandbox_cfg["envs"] = {**prev_envs, **effective_variables.sandbox_env}

        # Get tracer from global storage
        tracer: BaseTracer | None = self.global_storage.get("tracer")

        # Determine span type based on whether this is a sub-agent
        span_type = SpanType.SUB_AGENT if parent_agent_state else SpanType.AGENT

        # Update agent metadata if needed
        agent_model = await self._session_manager.get_agent(
            user_id=self._user_id,
            session_id=self._session_id,
            agent_id=self.agent_id,
        )
        if agent_model and agent_model.agent_name != self.agent_name:
            await self._session_manager.update_agent_metadata(
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self.agent_id,
                agent_name=self.agent_name,
            )

        # Create agent context
        with AgentContext(context=merged_context) as ctx:
            # RFC-0001: context, interrupt
            self._last_context = ctx.context
            runtime_client = self.openai_client
            if custom_llm_client_provider:
                try:
                    override_client = custom_llm_client_provider(self.agent_name)
                    if override_client is not None:
                        runtime_client = override_client
                except Exception as exc:  # Defensive: user provided callable
                    logger.warning(f"⚠️ custom_llm_client_provider failed for '{self.agent_name}': {exc}")

            # Build system prompt (returns list[SystemPromptPart])
            system_prompt_parts = self.prompt_builder.build_system_prompt(
                agent_config=self.config,
                tools=self._tool_registry.compute_eager_tools(),
                sub_agents=self.config.sub_agents or {},
                runtime_context=merged_context,
                include_tool_instructions=not self.use_structured_tool_calls,
            )

            # Convert each part into a separate SYSTEM Message.
            # The ``cache`` flag is stored in metadata so that the Anthropic
            # adapter can selectively apply ``cache_control``.
            system_messages = [
                Message(
                    role=Role.SYSTEM,
                    content=[TextBlock(text=part.text)],
                    metadata={"cache": part.cache},
                )
                for part in system_prompt_parts
                if part.text.strip()
            ]

            parent_run_id: str | None

            # Determine root_run_id and parent_run_id
            if parent_agent_state:
                root_run_id = parent_agent_state.root_run_id
                parent_run_id = parent_agent_state.run_id
            else:
                root_run_id = run_id
                parent_run_id = None

            # Update HistoryList context with new run IDs
            self._history.update_context(
                run_id=run_id,
                root_run_id=root_run_id,
                parent_run_id=parent_run_id,
            )

            # RFC-0022 Phase 2: history_key needed both for the legacy first-run
            # restore and for RUN_START / RUN_END markers below; lift it out of
            # the conditional so both paths share one key.
            history_key = AgentRunActionKey(
                user_id=self._user_id,
                session_id=self._session_id,
                agent_id=self.agent_id,
            )

            # Load history from storage if this is the first run (history is empty)
            if not self.history:
                stored_messages = await self._session_manager.agent_run_action.load_messages(key=history_key)
                stored_non_system_messages = [msg for msg in stored_messages if msg.role != Role.SYSTEM]
                logger.debug(
                    "🔍 [HISTORY-DEBUG] agent '%s' restore: stored=%d, non_system=%d, roles=%s",
                    self.config.name,
                    len(stored_messages),
                    len(stored_non_system_messages),
                    [m.role.value for m in stored_non_system_messages],
                )

                if stored_non_system_messages:
                    logger.info(f"📚 Restored {len(stored_non_system_messages)} messages from storage for agent '{self.config.name}'")
                    # Initialize history with system prompt + stored messages
                    # Use update_baseline=True since we're loading from storage
                    self._history.replace_all(
                        system_messages + stored_non_system_messages,
                        update_baseline=True,
                    )
                else:
                    # Initialize with just system prompt
                    # Use update_baseline=True since this is initial state
                    self._history.replace_all(
                        system_messages,
                        update_baseline=True,
                    )
            else:
                # Update system prompt for existing history
                # Find and replace the system message
                # Use update_baseline=True since we're resetting to known state
                non_system_messages = [msg for msg in self.history if msg.role != Role.SYSTEM]
                self._history.replace_all(
                    system_messages + non_system_messages,
                    update_baseline=True,
                )

            # Add caller-provided history
            if history:
                self.history.extend(_normalize_run_history(history))

            # Add user message (HistoryList will auto-persist)
            if isinstance(message, str):
                user_message = Message.user(message)
                self.history.append(user_message)
            else:
                self.history.extend(message)

            # RFC-0022 Phase 2: eager-flush the user message BEFORE the agent
            # iter loop runs. Previously the user_message was only persisted as
            # part of the end-of-run batch APPEND, so any crash / OOM / network
            # failure during iter would lose the user's submission entirely
            # - the playground UI's optimistic write was the only surviving
            # record (see parity scan findings).
            # Now: APPEND([user_message]) lands immediately. Subsequent iters
            # add their messages to ``_pending`` and the per-iter flush below
            # (see executor.py async iter loop) catches them at iter
            # boundaries. End-of-run flush remains as the final safety net.
            # Net cost: 2+ INSERTs per turn instead of 1, but each is a small
            # single-message payload and the user-visibility win pays for it
            # many times over (was the #1 source of UI/SDK drift in our
            # parity scan against test cluster prod-like data).
            await self.history.flush_async()

            # RFC-0022 Phase 2: write RUN_START lifecycle marker right after
            # the triggering user message lands in history. Class A
            # (Reader-NOOP) - fold output unchanged. The marker carries
            # `run_id` + `created_at_ns` + `parent_run_id`, which is all
            # the call-tree boundary info current consumers need; trace_id
            # is wired separately (RFC-0024).
            # Both root and sub-agent runs write their own RUN_START.
            # RFC-0024: trace_id is an opaque caller-supplied W3C string;
            # nexau never auto-derives it (OTel global / ContextVar / env)
            # because callers' observability stacks differ - see RFC-0024 §3
            # for the NAC vs xiaobei (isolated SdkTracerProvider) case.
            # Sub-agents inherit it explicitly via the
            # ``call_sub_agent(trace_id=...)`` chain
            # (agent_tool → SubAgentManager → sub_agent.run_async); no implicit
            # backref through AgentState. Threaded into Executor below so
            # AgentEventsMiddleware emits the same value on RunStartedEvent.
            await self._session_manager.agent_run_action.persist_run_start(
                key=history_key,
                run_id=run_id,
                root_run_id=root_run_id,
                parent_run_id=parent_run_id,
                agent_name=self.agent_name,
                trace_id=trace_id,
            )

            # RFC-0009: token trace session, run
            if self.config.llm_config and self.config.llm_config.api_type == "generate_with_token" and self._token_trace_session is None:
                self._token_trace_session = TokenTraceSession(self.config.llm_config)

            # Create the AgentState instance
            # 1: sandbox_manager AgentState, sandbox
            # 2: AgentState.get_sandbox sandbox
            # 3: asyncio
            # 4: sandbox
            sandbox_mgr = self.sandbox_manager
            agent_state = AgentState(
                agent_name=self.agent_name,
                agent_id=self.agent_id,
                run_id=run_id,
                root_run_id=root_run_id,
                context=ctx,
                global_storage=self.global_storage,
                parent_agent_state=parent_agent_state,
                tool_registry=self._tool_registry,
                sandbox_manager=sandbox_mgr,
                variables=effective_variables,
                team_state=self._team_state,
                token_trace_session=self._token_trace_session,
                subagent_manager=self.executor.subagent_manager,
                skill_registry=self.skill_registry,
            )

            # RFC-0019: Resume -
            if pending and all(v.get("decision") is not None for v in pending.values()):
                from nexau.archs.main_sub.framework_context import FrameworkContext

                resume_ctx = FrameworkContext(
                    agent_name=self.agent_name,
                    agent_id=self.agent_id,
                    run_id=run_id,
                    root_run_id=root_run_id,
                    _tool_registry=self._tool_registry,
                    _shutdown_event=self.executor.shutdown_event,
                    session_id=self._session_id,
                )
                await self._resume_pending_tool_calls(pending, agent_state, resume_ctx)
                self.history.flush()

            # RFC-0022 Phase 2: track run terminal status for RUN_END marker.
            run_status: RunStatus = "ok"
            run_reason: str | None = None

            # Execute with or without tracing
            try:
                if tracer:
                    response = await self._run_with_tracing(
                        tracer=tracer,
                        span_type=span_type,
                        message_text_for_logs=message_text_for_logs,
                        agent_state=agent_state,
                        merged_context=merged_context,
                        runtime_client=runtime_client,
                        custom_llm_client_provider=custom_llm_client_provider,
                        trace_id=trace_id,
                    )
                else:
                    response = await self._run_inner(
                        agent_state,
                        merged_context,
                        runtime_client=runtime_client,
                        custom_llm_client_provider=custom_llm_client_provider,
                        trace_id=trace_id,
                    )

                # RFC-0022 Phase 2: stop_signal triggered → cancelled, not ok.
                if self.executor.stop_signal:
                    run_status = "cancelled"

                # stop_signal stop, run_async
                if not self.executor.stop_signal:
                    await self._persist_session_state(ctx.context)

                # Handle sandbox lifecycle after agent execution.
                # sandbox AgentTeam ; sub-agent sandbox
                # caller/root agent, sub-agent completed keepalive.
                if self._shared_sandbox_manager is None and self._is_root:
                    self.sandbox_manager.on_run_complete()

                    sandbox_config = self.config.sandbox_config
                    status_after_run = sandbox_config.status_after_run if sandbox_config else "stop"
                    if status_after_run == "pause":
                        self.sandbox_manager.pause_no_wait()
                    elif status_after_run == "stop":
                        self.sandbox_manager.stop()
                    else:
                        # Let the caller manage sandbox lifecycle (useful for RL training)
                        logger.info("Sandbox lifecycle managed by caller (status_after_run=none)")
                elif self._shared_sandbox_manager is None:
                    logger.info("Sandbox lifecycle managed by caller (sub-agent skips sandbox lifecycle)")

                logger.info(f"✅ Agent '{self.config.name}' completed execution")
                return response

            except Exception as e:
                # RFC-0022 Phase 2: surface error → status="error" + truncated reason
                run_status = "error"
                run_reason = f"{type(e).__name__}: {str(e)[:200]}"
                # RFC-0001: exception session state
                try:
                    # stop_signal stop, run_async
                    if not self.executor.stop_signal:
                        await self._persist_session_state(ctx.context)
                except Exception:
                    logger.warning("Failed to persist session state on error path")
                logger.error(f"❌ Agent '{self.config.name}' encountered error: {e}")
                raise

            finally:
                # RFC-0022 Phase 2: write RUN_END marker before everything else.
                # persist_run_end is idempotent (run_id:end key) and never raises
                # so safe to call from finally even if the run was already torn
                # down by the caller. Class A (Reader-NOOP) - fold output unchanged.
                # Cancellation hardening: when the run is cancelled (RFC-0001
                # client-disconnect-stop, agent.stop(force=True), parent task
                # cancellation), the current task is in a cancelled state and
                # any bare ``await`` in finally re-raises CancelledError
                # *before* the awaited coroutine starts executing - so the
                # RUN_END row never lands. Wrap in ``asyncio.shield`` so the
                # persist call gets a chance to complete even on the
                # cancellation path. We then re-await with a small timeout to
                # cap unbounded wait if shield itself is also cancelled.
                # If both layers are cancelled (extreme: pod kill mid-shield)
                # the read-side ``load_messages`` falls back to "no RUN_END
                # treat as in_progress" - graceful degradation, no broken
                # state. Real fix for that case is at the read-side bandaid
                # (mirror of the orphan tool_use synthesis) - separate issue.
                try:
                    persist_coro = self._session_manager.agent_run_action.persist_run_end(
                        key=history_key,
                        run_id=run_id,
                        root_run_id=root_run_id,
                        parent_run_id=parent_run_id,
                        agent_name=self.agent_name,
                        status=run_status,
                        reason=run_reason,
                    )
                    # Shield-wait with a 5s cap: enough for a single PG INSERT
                    # round-trip on a healthy cluster; bounded so we don't hang
                    # the cleanup path on a stuck DB.
                    await asyncio.wait_for(asyncio.shield(persist_coro), timeout=5.0)
                except asyncio.CancelledError:
                    # Outer cancellation came in DURING the shielded persist.
                    # The shielded coro keeps running on the loop; we just
                    # can't await its completion. Re-raise so the caller still
                    # sees cancellation. RUN_END will land slightly after
                    # the agent task ends - acceptable race.
                    raise
                except TimeoutError:
                    logger.warning(
                        "RUN_END persist timed out after 5s — task continues in background (run_id=%s status=%s)",
                        run_id,
                        run_status,
                    )
                except Exception as exc:
                    # persist_run_end already swallows internal errors; this catch
                    # is belt-and-suspenders against unforeseen issues so we never
                    # mask the original exception (if any) bubbling out of try.
                    logger.warning("RUN_END persist failed (ignored): %s", exc)

                # async/sync: async LLM client event loop
                # httpx.AsyncClient.__del__ . run lazy re-init .
                await self._close_async_llm_client()
                # RFC-0001: run completed, interrupt
                self._run_complete.set()

    def run(
        self,
        *,
        message: str | list[Message],
        history: list[dict[str, Any]] | list[Message] | None = None,
        context: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        config: dict[str, Any] | None = None,
        parent_agent_state: AgentState | None = None,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        variables: ContextValue | None = None,
        trace_id: str | None = None,
    ) -> str | tuple[str, dict[str, Any]]:
        """Run agent with a message and return response (sync entry point).

        P1 async/sync :  syncify 

         sync  (CLI, ) . async  run_async(). 
         asyncio.run()  run_async(),  syncify 
         BlockingPortal . 

        Args:
            message: User message or list of messages
            history: Optional conversation history
            context: Optional context dict
            state: Optional state dict
            config: Optional config dict
            parent_agent_state: Optional parent agent state (for sub-agents)
            custom_llm_client_provider: Optional custom LLM client provider
            variables: Optional ContextValue with structured runtime parameters

        Returns:
            Agent response string or tuple of (response, state)

        Raises:
            RuntimeError: If called from within a running event loop
            TimeoutError: If agent is already running
        """
        from nexau.core.utils import get_running_loop_or_none

        if get_running_loop_or_none() is not None:
            raise RuntimeError("Agent.run() cannot be called from within a running event loop. Use `await agent.run_async(...)` instead.")

        return asyncio.run(
            self.run_async(
                message=message,
                history=history,
                context=context,
                state=state,
                config=config,
                parent_agent_state=parent_agent_state,
                custom_llm_client_provider=custom_llm_client_provider,
                variables=variables,
                trace_id=trace_id,
            )
        )

    async def _run_with_tracing(
        self,
        tracer: BaseTracer,
        span_type: SpanType,
        message_text_for_logs: str,
        agent_state: AgentState,
        merged_context: dict[str, Any],
        runtime_client: Any,
        custom_llm_client_provider: Callable[[str], Any] | None,
        trace_id: str | None = None,
    ) -> str:
        """Execute agent with tracing enabled."""
        span_name = f"Agent: {self.agent_name}"
        inputs = {
            "message": message_text_for_logs,
            "agent_id": self.agent_id,
        }
        attributes: dict[str, Any] = {
            "agent_name": self.agent_name,
            "model": getattr(self.config.llm_config, "model", None),
        }
        agent_state.record_source_id(self.config.source_id)

        trace_ctx = TraceContext(tracer, span_name, span_type, inputs, attributes)
        with trace_ctx:
            try:
                response = await self._run_inner(
                    agent_state,
                    merged_context,
                    runtime_client=runtime_client,
                    custom_llm_client_provider=custom_llm_client_provider,
                    trace_id=trace_id,
                )
                trace_ctx.set_outputs({"response": response})
                plugin_attrs = {"plugin_sources": sorted(agent_state.plugin_sources)}
                trace_ctx.set_attributes(plugin_attrs)
                return response
            except Exception:
                raise

    async def _run_inner(
        self,
        agent_state: AgentState,
        merged_context: dict[str, Any],
        *,
        runtime_client: Any,
        custom_llm_client_provider: Callable[[str], Any] | None,
        trace_id: str | None = None,
    ) -> str:
        """Inner execution logic without tracing wrapper.

        RFC-0001: 

        finally, Exception  CancelledError, 
         flush . 
        """
        try:
            response, updated_messages = await self.executor.execute_async(
                self.history,
                agent_state,
                runtime_client=runtime_client,
                custom_llm_client_provider=custom_llm_client_provider,
                trace_id=trace_id,
            )
            # HistoryList will automatically persist any changes made by executor
            logger.debug(
                "🔍 [HISTORY-DEBUG] _run_inner: executor returned %d messages, roles=%s",
                len(updated_messages),
                [m.role.value for m in updated_messages],
            )
            self.history = updated_messages
            logger.debug(
                "🔍 [HISTORY-DEBUG] _run_inner: after assign, history has %d messages, roles=%s",
                len(self.history),
                [m.role.value for m in self.history],
            )

            # Flush pending messages to persistence
            self.history.flush()

            return response

        except Exception as e:
            logger.debug(
                "🔍 [HISTORY-DEBUG] _run_inner EXCEPTION: %s, history=%d msgs",
                str(e)[:100],
                len(self.history),
            )
            # Errors are NOT persisted into history. Previously this branch
            # appended ``Message.assistant(error_text)`` rows, but those rows:
            # (1) carry no ReasoningBlock, which DeepSeek-style providers reject
            # when the resumed history is sent back ("assistant must have
            # thinking") - bricks the session forever.
            # (2) corrupt model context generally - every subsequent turn sees
            # "I previously replied with a stack trace" and produces
            # nonsense follow-ups regardless of provider.
            # Errors are still observed:
            # - Logged at ERROR level above by ``logger.debug``-equivalent
            # exception logging upstream.
            # - Captured in Langfuse: every LLM call is wrapped in
            # ``TraceContext(...)``; ``__exit__`` forwards the exception
            # to ``langfuse_adapter.end_span(error=...)``, which sets
            # ``level=ERROR`` + ``status_message=str(error)`` on the span.
            # - The error_handler callback (if configured) still fires and
            # its return value is returned to the caller - that's the
            # appropriate channel for surfacing errors to user code.
            if self.config.error_handler:
                error_response = self.config.error_handler(e, self, merged_context)
                # Flush whatever was already in history before the failure
                # (e.g. user message) so we don't lose pre-error progress.
                self.history.flush()
                return error_response
            else:
                # Same flush as above before re-raising.
                self.history.flush()
                raise
        finally:
            # RFC-0001: exceptioncancel, flush
            # CancelledError (BaseException) except Exception
            # finally flush
            # : flush, has_pending_messages
            # team_mode executor replace_all _pending_messages
            # flush fingerprint .
            try:
                self.history.flush()
            except Exception:
                logger.warning("Failed to flush history in finally block")

    async def resolve_permission(
        self,
        tool_call_id: str,
        decision: str,
    ) -> None:
        """Resolve a pending permission request.

        RFC-0019: interface

         pending_tool_calls  tool_call  decision . 
         decision  "allow",  permission_key  allow . 

        Args:
            tool_call_id: The tool_call_id to resolve
            decision: One of "allow", "allow_once", "deny"
        """
        pending = await self._session_manager.get_pending_tool_calls(
            user_id=self._user_id,
            session_id=self._session_id,
        )
        if pending is None or tool_call_id not in pending:
            raise ValueError(f"No pending permission request for tool_call_id={tool_call_id}")

        entry = pending[tool_call_id]
        entry["decision"] = decision

        # "allow" → DB, key
        if decision == "allow":
            await self._session_manager.save_permission_rule(
                user_id=self._user_id,
                session_id=self._session_id,
                tool_name=entry["tool_name"],
                rule_content=entry["permission_key"],
                behavior="allow",
                source="user",
            )

        await self._session_manager.update_pending_tool_calls(
            user_id=self._user_id,
            session_id=self._session_id,
            pending_tool_calls=pending,
        )

    async def _resume_pending_tool_calls(
        self,
        pending: dict[str, Any],
        agent_state: AgentState,
        framework_context: "FrameworkContext",
    ) -> None:
        """Resume execution after all pending permissions are resolved.

        RFC-0019: Resume 

         pending entries: 
        - allow / allow_once →  tool
        - deny →  denial ToolResult
         pending_tool_calls. 
        """
        from nexau.archs.main_sub.framework_context import FrameworkContext
        from nexau.core.messages import ToolResultBlock, coerce_tool_result_content

        for tool_call_id, entry in pending.items():
            if entry.get("consumed"):
                continue

            decision = entry.get("decision")
            tool_name = entry["tool_name"]
            parameters = entry.get("parameters", {})

            if decision == "deny":
                # denial ToolResult
                denial_content = f"Permission denied by user for {tool_name}"
                tool_result_block = ToolResultBlock(
                    tool_use_id=tool_call_id,
                    content=coerce_tool_result_content(denial_content, fallback_text=None),
                    is_error=True,
                )
                self.history.append(Message(role=Role.TOOL, content=[tool_result_block]))
            elif decision in ("allow", "allow_once"):
                # tool
                tool_obj = self.executor.tool_registry.get_tool(tool_name)
                if tool_obj is None:
                    error_content = f"Tool '{tool_name}' not found during resume"
                    tool_result_block = ToolResultBlock(
                        tool_use_id=tool_call_id,
                        content=coerce_tool_result_content(error_content, fallback_text=None),
                        is_error=True,
                    )
                    self.history.append(Message(role=Role.TOOL, content=[tool_result_block]))
                else:
                    # per-tool-call context: allow_once permission_key
                    permission_key = entry.get("permission_key", "")
                    if decision == "allow_once":
                        tool_ctx: FrameworkContext = framework_context.for_tool_call(
                            tool_name=tool_name,
                            allow_rules=[permission_key],
                            deny_rules=[],
                        )
                    else:
                        # allow → DB, ["**"]
                        tool_ctx = framework_context.for_tool_call(
                            tool_name=tool_name,
                            allow_rules=["**"],
                            deny_rules=[],
                        )

                    try:
                        exec_params: dict[str, Any] = dict(parameters)
                        exec_params["agent_state"] = agent_state
                        exec_params["sandbox"] = agent_state.get_sandbox()
                        exec_params["ctx"] = tool_ctx

                        # MCPTool async async
                        if getattr(tool_obj, "_has_native_async_execute", False):
                            result = await tool_obj.execute_async(**exec_params)
                        else:
                            result = tool_obj.execute(**exec_params)

                        content_str = str(result)
                        tool_result_block = ToolResultBlock(
                            tool_use_id=tool_call_id,
                            content=coerce_tool_result_content(content_str, fallback_text=None),
                            is_error=False,
                        )
                        self.history.append(Message(role=Role.TOOL, content=[tool_result_block]))
                    except Exception as e:
                        error_content = f"Tool '{tool_name}' failed during resume: {e}"
                        tool_result_block = ToolResultBlock(
                            tool_use_id=tool_call_id,
                            content=coerce_tool_result_content(error_content, fallback_text=None),
                            is_error=True,
                        )
                        self.history.append(Message(role=Role.TOOL, content=[tool_result_block]))

            entry["consumed"] = True
            # RFC-0019: tool consumed
            await self._session_manager.update_pending_tool_calls(
                user_id=self._user_id,
                session_id=self._session_id,
                pending_tool_calls=pending,
            )

        # pending_tool_calls
        await self._session_manager.update_pending_tool_calls(
            user_id=self._user_id,
            session_id=self._session_id,
            pending_tool_calls=None,
        )

    def add_tool(self, tool: Tool) -> None:
        """Add a tool to the agent."""
        self.config.tools.append(tool)
        self.executor.add_tool(tool)

    async def _persist_session_state(self, context: dict[str, Any]) -> None:
        """Persist context and storage to session.

        This method saves the current agent context and global_storage to the SessionModel
        for persistence across requests. Non-serializable objects (like tracer, skill_registry)
        are automatically filtered out by sanitize_for_serialization in the storage layer.

        Args:
            context: The current agent context to persist
        """
        try:
            # Persist both context and storage in a single operation
            await self._session_manager.update_session_state(
                user_id=self._user_id,
                session_id=self._session_id,
                context=context,
                storage=self.global_storage,
            )
            logger.debug(
                "Persisted session state for session '%s', agent '%s'",
                self._session_id,
                self.agent_id,
            )
        except Exception as e:
            logger.warning(f"Failed to persist session state: {e}")

    def add_sub_agent(self, name: str, agent_config: AgentConfig) -> None:
        """Add a sub-agent config."""
        if self.config.sub_agents is None:
            self.config.sub_agents = {}
        self.config.sub_agents[name] = agent_config
        self.executor.add_sub_agent(name, agent_config)

    def enqueue_message(self, message: dict[str, str]) -> None:
        """Enqueue a message to be added to the history."""
        self.executor.enqueue_message(message)

    def sync_cleanup(self, *, _from_del: bool = False) -> None:
        """Synchronous cleanup for __del__ and other sync contexts.

        # 495: Flush and shutdown tracer on exit to prevent losing buffered trace data.

        Args:
            _from_del: Internal flag. True when called from __del__ to skip
                logging (logging may fail during interpreter shutdown).
        """
        if not _from_del:
            logger.info(
                f"🧹 Cleaning up agent '{self.config.name}' and its sub-agents...",
            )
        self.executor.cleanup()

        # #495: Flush and shutdown tracer to avoid losing buffered trace data.
        # CleanupManager calls sync_cleanup on SIGTERM/SIGINT/atexit, ensuring
        # the Langfuse SDK background worker drains its queue before exit.
        tracer: BaseTracer | None = self.global_storage.get("tracer")
        if tracer is not None:
            try:
                tracer.shutdown()
            except Exception:
                if not _from_del:
                    logger.warning("Tracer shutdown failed during cleanup", exc_info=True)

        if not _from_del:
            logger.info(f"✅ Agent '{self.config.name}' cleanup completed")

    async def stop(self, *, force: bool = False, timeout: float = 30.0) -> StopResult:
        """Stop the agent and persist current state.

        RFC-0001: Agent 

        interface,  force . 
         force value,  session state. 

        Args:
            force: True  (completed), 
                   False  () 
            timeout: completed ( force=False ) 

        Returns:
            StopResult package
        """
        return await self._interrupt(force=force, timeout=timeout)

    async def _close_async_llm_client(self) -> None:
        """Close the async LLM client to prevent httpx.__del__ crashes.

        async/sync :  event loop  AsyncOpenAI /
        AsyncAnthropic  httpx.AsyncClient,  GC  event loop
         __del__ → RuntimeError('Event loop is closed'). 
        """
        client = self.executor.llm_caller.async_openai_client
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass
            self.executor.llm_caller.async_openai_client = None

    async def _interrupt(self, *, force: bool = False, timeout: float = 30.0) -> StopResult:
        """Internal implementation of stop with state persistence.

        RFC-0001: Agent 

        Args:
            force: True, False 
            timeout: completed ( force=False ) 

        Returns:
            StopResult package
        """
        logger.info(f"🛑 Stopping agent '{self.config.name}' (force={force})...")

        # 1. executor; force_stop running sub-agents
        # graceful executor, timeout cleanup.
        self.executor.force_stop()

        if force:
            # 2a.: executor
            self.executor.cleanup()
        else:
            # 2b.: (timeout)
            await self._wait_for_execution_complete(timeout=timeout)

            # 3. _run_async_inner completed history
            # execute, _run_inner messages self.history
            try:
                await asyncio.wait_for(self._run_complete.wait(), timeout=5.0)
            except TimeoutError:
                logger.warning("Timed out waiting for run to complete after execute() finished")

        # 4. flush
        try:
            if self.history.has_pending_messages:
                self.history.flush()
        except Exception as e:
            logger.warning(f"Failed to flush history during stop: {e}")

        # 5. session state
        try:
            await self._persist_session_state(
                self._last_context if hasattr(self, "_last_context") else {},
            )
        except Exception as e:
            logger.warning(f"Failed to persist session state during stop: {e}")
            raise RuntimeError(f"stop persistence failed: {e}") from e

        logger.info(f"✅ Agent '{self.config.name}' stopped successfully")

        # async/sync: stop async client
        await self._close_async_llm_client()

        return StopResult(
            messages=list(self.history),
            stop_reason=AgentStopReason.USER_INTERRUPTED,
        )

    async def _wait_for_execution_complete(self, *, timeout: float = 30.0) -> None:
        """Wait for current execution to complete or timeout.

        RFC-0001: 

         executor._execution_done . 
        stop_signal, execute(), 
         _execution_done  set, wait() . 

        Args:
            timeout: 
        """
        # execute
        if not self.executor.is_executing:
            return

        # _execution_done set
        event = self.executor.execution_done_event
        completed = await asyncio.to_thread(event.wait, timeout)

        if not completed:
            # timeout:
            logger.warning(
                f"Interrupt timeout ({timeout}s) reached for agent '{self.agent_name} id {self.agent_id}', performing hard cleanup",
            )
            self.executor.cleanup()

    def __del__(self):
        """Destructor to ensure cleanup when agent is garbage collected."""
        try:
            self.sync_cleanup(_from_del=True)
        except Exception:
            pass  # Avoid exceptions during garbage collection