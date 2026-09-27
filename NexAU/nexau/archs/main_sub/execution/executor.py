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

"""Main execution orchestrator for agents.

RFC-0006:  Structured Tool Definitions executor

executor structured  neutral structured definitions, 
OpenAI / Anthropic / Gemini provider schema  LLMCaller . 
"""

import asyncio
import inspect
import json
import logging
import threading
import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from contextvars import copy_context
from copy import deepcopy
from dataclasses import dataclass
from enum import Enum, auto
from typing import TYPE_CHECKING, Any, cast

from nexau.archs.llm.llm_aggregators.events import RetryEvent
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.agent_state import AgentState
from nexau.archs.main_sub.config import AgentConfig
from nexau.archs.main_sub.execution.hooks import (
    AfterAgentHookInput,
    AfterModelHook,
    AfterModelHookInput,
    AfterToolHook,
    AfterToolHookInput,
    BeforeAgentHookInput,
    BeforeModelHook,
    BeforeModelHookInput,
    BeforeToolHook,
    FunctionMiddleware,
    Middleware,
    MiddlewareManager,
)
from nexau.archs.main_sub.execution.llm_caller import LLMCaller
from nexau.archs.main_sub.execution.model_response import ModelResponse
from nexau.archs.main_sub.execution.parse_structures import (
    ParsedResponse,
    ToolCall,
)
from nexau.archs.main_sub.execution.response_parser import ResponseParser
from nexau.archs.main_sub.execution.stop_reason import AgentStopReason
from nexau.archs.main_sub.execution.subagent_manager import SubAgentManager
from nexau.archs.main_sub.execution.tool_executor import ToolExecutionResult, ToolExecutor
from nexau.archs.main_sub.framework_context import FrameworkContext
from nexau.archs.main_sub.history_list import HistoryList
from nexau.archs.main_sub.token_trace_session import TokenTraceContextOverflowError, TokenTraceSession
from nexau.archs.main_sub.tool_call_modes import (
    STRUCTURED_TOOL_CALL_MODES,
    normalize_tool_call_mode,
)
from nexau.archs.main_sub.utils.token_counter import TokenCounter
from nexau.archs.permissions.types import (
    AskOutcome,
    AskPermission,
    DenyOutcome,
    PermissionDenied,
)
from nexau.archs.tool.tool import (
    StructuredToolDefinition,
    Tool,
)
from nexau.archs.tool.tool_registry import ToolRegistry
from nexau.archs.tracer.context import TraceContext
from nexau.archs.tracer.core import BaseTracer, SpanType
from nexau.core.adapters.legacy import messages_from_legacy_openai_chat
from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, coerce_tool_result_content

if TYPE_CHECKING:
    from nexau.archs.sandbox.base_sandbox import BaseSandbox
    from nexau.archs.session import SessionManager

    from .history_events import HistoryEvent

logger = logging.getLogger(__name__)


def _coerce_raw_output(output: object) -> dict[str, Any] | list[Any] | None:
    """Narrow generic feedback ``output`` to the dict/list shape that
    ``ToolResultBlock.raw_output`` accepts. ``None`` / scalars → ``None``
    (Pydantic schema only allows ``dict | list | None``).

    Boundary helper: ``output`` arrives as ``object`` from feedback dicts;
    ``cast`` localises the unsafe narrowing here so the two call sites stay
    pyright-clean. Pydantic validates downstream on construction.

    Stores verbatim what ``ToolExecutor.finalize_tool_execution`` produced
    (which already wraps non-dict tool returns into ``{"result": <X>}``,
    [tool_executor.py:361]). UI consumers needing to skip the trivial
    ``{"result": <scalar>}`` wrapping should do that filtering themselves -
    the framework keeps ``raw_output`` faithful to the field name (truly
    raw post-normalization) rather than layering a second policy on top.
    """
    if isinstance(output, (dict, list)):
        return cast("dict[str, Any] | list[Any]", output)
    return None


def _sync_history(
    history: object,
    messages: list[Message],
) -> None:
    """RFC-0026: end-of-iteration / boundary sync - feed current messages
    into HistoryList. Untyped (no ``history_event``); HistoryList's
    fingerprint-diff fallback decides between APPEND and untyped REPLACE
    based on what changed since the last baseline.

    Typed history events emitted by middleware land eagerly via
    :func:`_emit_pending_history_event` at the middleware boundary
    (before_model / after_model), not via this helper.

    No-op when ``history`` isn't a HistoryList (legacy list/dict paths).
    """
    if not isinstance(history, HistoryList):
        return
    history.replace_all(messages)


def _realign_after_direct_history_replace(
    framework_context: "FrameworkContext",
    messages: list[Message],
    token_trace_session: TokenTraceSession | None,
) -> list[Message]:
    """Realign local working messages after a direct ``ctx.history.replace``.

    Hook-dispatched history events are handled at middleware boundaries and do
    not flow through this helper. Its only current producer is emergency
    compaction inside ``wrap_model_call``, which writes durable history directly
    because it cannot return a HookResult to the executor.
    """
    replaced_messages = framework_context.history.consume_pending_replace_messages()
    if replaced_messages is None:
        return messages
    if token_trace_session is not None:
        token_trace_session.sync_external_messages(replaced_messages)
    return replaced_messages


def _emit_pending_history_event(
    framework_context: "FrameworkContext",
    event: "HistoryEvent | None",
) -> None:
    """RFC-0026: eager typed-event write at the middleware boundary.

    When a middleware (compaction / future ``/clear`` / ``/undo``) sets
    ``HookResult.history_event``, the executor calls this immediately
    after the middleware chain returns. Dispatches by event type to the
    matching public ``ctx.history.*`` API method.

    Subsequent ``_sync_history`` calls in the same iteration see baseline
    aligned and don't double-write.

    Forward-compat: ``HistoryEvent`` is a discriminated union; unknown
    event types decode as ``UnknownEvent`` and this dispatcher silently
    skips them - old SDK reading a future event type degrades to "drop
    the typed signal, fall back to fingerprint diff" rather than crash.

    Code paths that can't return a HookResult (emergency compaction inside
    ``wrap_model_call``) call ``params.framework_context.history.replace``
    directly with their own ``extra``; both routes converge on the same
    canonical API method.
    """
    if event is None:
        return
    # Local import to avoid Pydantic union construction during executor
    # module import (HistoryEvent uses runtime Discriminator).
    from .history_events import ReplaceEvent

    if isinstance(event, ReplaceEvent):
        framework_context.history.replace(event.messages, extra=event.extra)
        framework_context.history.clear_pending_replace_messages()
        return
    # AppendEvent / UndoEvent / UnknownEvent: no public ctx.history.*
    # method exposed yet (per RFC-0026's "narrow first" rule). Silently
    # skip - when a real producer arrives, both add the API method on
    # ``HistoryAPI`` and the dispatch branch here.
    logger.debug("RFC-0026: skipping history_event of type %r — no producer wired yet", type(event).__name__)


class _IterationOutcome(Enum):
    """Signal returned by _execute_iteration_async to control the main loop.

    CONTINUE - advance to the next iteration.
    BREAK    - exit the while loop (final_response / force_stop_reason already set on state).
    """

    CONTINUE = auto()
    BREAK = auto()


@dataclass
class _AsyncIterationState:
    """Mutable context shared across helpers during one execute_async() invocation."""

    messages: list[Message]
    final_response: str
    force_stop_reason: AgentStopReason
    iteration: int
    agent_state: "AgentState"
    token_trace_session: TokenTraceSession | None
    framework_context: FrameworkContext
    runtime_client: object | None
    custom_llm_client_provider: Callable[[str], object] | None
    origin_history: list[Message] | list[dict[str, object]]
    # RFC-0019:
    permission_cache: dict[str, tuple[list[str], list[str]]] | None = None


class Executor:
    """Orchestrates execution of agent tasks with parallel processing support."""

    def __init__(
        self,
        agent_name: str,
        agent_id: str,
        tool_registry: ToolRegistry,
        sub_agents: dict[str, AgentConfig],
        stop_tools: set[str],
        openai_client: Any,
        llm_config: LLMConfig,
        async_openai_client: Any | None = None,
        max_iterations: int = 0,
        max_context_tokens: int = 1048576,
        max_running_subagents: int = 5,
        retry_attempts: int = 5,
        retry_backoff_max_seconds: int = 30,
        token_counter: TokenCounter | None = None,
        after_model_hooks: list[AfterModelHook] | None = None,
        before_model_hooks: list[BeforeModelHook] | None = None,
        after_tool_hooks: list[AfterToolHook] | None = None,
        before_tool_hooks: list[BeforeToolHook] | None = None,
        middlewares: list[Middleware] | None = None,
        global_storage: Any = None,
        tool_call_mode: str = "structured",
        team_mode: bool = False,
        structured_tools: Sequence[StructuredToolDefinition] | None = None,
        session_manager: "SessionManager | None" = None,
        user_id: str | None = None,
        session_id: str | None = None,
    ):
        """Initialize executor.

        Args:
            agent_name: Name of the agent
            agent_id: ID of the agent
            tool_registry: ToolRegistry containing available tools
            sub_agents: Dictionary of sub-agent configs
            stop_tools: Set of tool names that trigger execution stop
            openai_client: OpenAI client instance
            llm_config: LLM configuration
            max_iterations: Maximum iterations per execution
            max_context_tokens: Maximum context token limit
            max_running_subagents: Maximum concurrent sub-agents
            retry_attempts: int of API retry attempts
            token_counter: Optional token counter instance
            before_model_hooks: Optional list of hooks called before parsing LLM response
            after_model_hooks: Optional list of hooks called after parsing LLM response
            before_tool_hooks: Optional list of hooks called before tool execution
            after_tool_hooks: Optional list of hooks called after tool execution
            middlewares: Optional list of middleware objects applied to all phases
            tool_call_mode: Preferred tool call format ('xml' or 'structured')
            team_mode: If True, executor runs in "forever run" mode for team agents
            structured_tools: Vendor-neutral structured tool definitions
            session_manager: Optional SessionManager for unified data access
            user_id: Optional user ID for persistence
            session_id: Optional session ID for persistence
        """
        self.agent_name = agent_name
        self.agent_id = agent_id
        self.max_running_subagents = max_running_subagents

        # RFC-0019: session & pending
        self._session_manager = session_manager
        self._user_id = user_id
        self._session_id = session_id

        # Initialize components
        self.middleware_manager = self._build_middleware_manager(
            middlewares or [],
            before_model_hooks or [],
            after_model_hooks or [],
            after_tool_hooks or [],
            before_tool_hooks or [],
        )
        self._event_emitter: Callable[[Any], None] | None = None
        self._wire_middleware_llm_runtime(
            llm_config,
            openai_client,
            session_id=session_id,
            global_storage=global_storage,
            max_context_tokens=max_context_tokens,
        )
        self._wire_middleware_event_emitters()
        self._tool_registry = tool_registry
        self._tool_registry_lock = threading.RLock()
        self.tool_executor = ToolExecutor(
            tool_registry=tool_registry,
            stop_tools=stop_tools,
            middleware_manager=self.middleware_manager,
        )

        self.subagent_manager = SubAgentManager(
            agent_name,
            sub_agents,
            global_storage,
            session_manager=session_manager,
            user_id=user_id,
            session_id=session_id,
        )
        self.response_parser = ResponseParser()
        self.llm_caller = LLMCaller(
            openai_client,
            llm_config,
            retry_attempts,
            retry_backoff_max_seconds=retry_backoff_max_seconds,
            on_retry=self._build_retry_callback(llm_config),
            middleware_manager=self.middleware_manager,
            global_storage=global_storage,
            session_id=session_id,
            async_openai_client=async_openai_client,
        )

        # Execution parameters
        self.llm_config = llm_config
        self.max_iterations = max_iterations
        self.max_context_tokens = max_context_tokens
        self.global_storage = global_storage

        # Token counting
        self.token_counter = token_counter or TokenCounter(model=llm_config.model)

        # Tool call behavior
        self.tool_call_mode = normalize_tool_call_mode(tool_call_mode)
        self.use_structured_tool_calls = self.tool_call_mode in STRUCTURED_TOOL_CALL_MODES

        # 1. RFC-0006: executor neutral structured definitions, vendor .
        if structured_tools is not None:
            self.structured_tool_definitions = deepcopy(list(structured_tools))
        elif self.use_structured_tool_calls:
            self.structured_tool_definitions = [
                tool.to_structured_definition(
                    description=self._structured_tool_description(tool),
                )
                for tool in self._tool_registry.compute_eager_tools()
            ]
        else:
            self.structured_tool_definitions = []

        if self.use_structured_tool_calls and not self.structured_tool_definitions:
            logger.warning(
                f"⚠️ {self.tool_call_mode.capitalize()} tool call mode enabled but no structured tool definitions were provided.",
            )

        # Process tracking for parallel execution
        self._running_executors: dict[str, ThreadPoolExecutor] = {}  # Maps executor_id to ThreadPoolExecutor
        self._executor_lock = threading.Lock()
        self._shutdown_event = threading.Event()
        self.stop_signal = False

        # RFC-0001: execute
        # _execution_done: set execute, clear
        self._execution_done = threading.Event()
        self._execution_done.set()  # :

        # Message queue for dynamic message enqueueing during execution
        self.queued_messages: list[Message] = []

        # RFC-0002: Team mode - "forever run" loop that waits for messages when idle
        self.team_mode = team_mode
        self._message_available = threading.Event()
        self._is_idle = False  # True when waiting for messages in team_mode
        self._is_waiting_for_user = False  # True when idle due to ask_user stop tool
        self._last_stop_tool_name: str | None = None  #  stop 
        self._consecutive_text_only_count: int = 0  # team_mode 
        self._has_active_teammates: Callable[[], bool] | None = None  # AgentTeam, teammate

    def _wire_middleware_event_emitters(self) -> None:
        """Wire internal middleware emitters to the unified event callback when available."""
        if not self.middleware_manager:
            return

        event_emitter: Callable[[Any], None] | None = None
        for middleware in self.middleware_manager.middlewares:
            handler = middleware.get_event_handler()
            if handler is not None:
                event_emitter = handler
                break

        if event_emitter is None:
            return

        self._event_emitter = event_emitter

        for middleware in self.middleware_manager.middlewares:
            if not middleware.supports_set_event_emitter:
                continue
            try:
                middleware.set_event_emitter(event_emitter)
            except Exception as exc:
                logger.warning(
                    "⚠️ Failed to wire event emitter for middleware %s: %s",
                    middleware.__class__.__name__,
                    exc,
                )

    def _build_retry_callback(self, llm_config: LLMConfig) -> Callable[[int, int, float, str], None] | None:
        """Build retry event callback when middleware exposes an event emitter."""
        event_emitter = self._event_emitter
        if event_emitter is None:
            return None

        def emit_retry_event(attempt: int, max_attempts: int, backoff_seconds: float, error_message: str) -> None:
            retry_event = RetryEvent(
                api_type=llm_config.api_type,
                attempt=attempt,
                max_attempts=max_attempts,
                backoff_seconds=backoff_seconds,
                error_message=error_message,
            )
            event_emitter(retry_event)

        return emit_retry_event

    def _wire_middleware_llm_runtime(
        self,
        llm_config: LLMConfig,
        openai_client: Any,
        *,
        session_id: str | None = None,
        global_storage: Any | None = None,
        max_context_tokens: int | None = None,
    ) -> None:
        """Inject base LLM runtime into middleware that needs inherited model settings."""
        if not self.middleware_manager:
            return

        for middleware in self.middleware_manager.middlewares:
            if not middleware.supports_set_llm_runtime:
                continue
            try:
                middleware.set_llm_runtime(
                    llm_config,
                    openai_client,
                    session_id=session_id,
                    global_storage=global_storage,
                    max_context_tokens=max_context_tokens,
                )
            except TypeError:
                # Backward compatibility: middleware without max_context_tokens/global_storage/session_id parameter
                try:
                    middleware.set_llm_runtime(llm_config, openai_client, session_id=session_id, global_storage=global_storage)
                except TypeError:
                    try:
                        middleware.set_llm_runtime(llm_config, openai_client, session_id=session_id)
                    except TypeError:
                        middleware.set_llm_runtime(llm_config, openai_client)
            except Exception as exc:
                logger.warning(
                    "⚠️ Failed to wire LLM runtime for middleware %s: %s",
                    middleware.__class__.__name__,
                    exc,
                )

    @property
    def shutdown_event(self) -> threading.Event:
        """Public accessor for the shutdown event."""
        return self._shutdown_event

    @property
    def has_active_teammates(self) -> Callable[[], bool] | None:
        return self._has_active_teammates

    @has_active_teammates.setter
    def has_active_teammates(self, value: Callable[[], bool] | None) -> None:
        self._has_active_teammates = value

    @property
    def tool_registry(self) -> ToolRegistry:
        return self._tool_registry

    @property
    def has_running_executors(self) -> bool:
        """Check if there are any running thread pool executors."""
        return bool(self._running_executors)

    @property
    def is_executing(self) -> bool:
        """Check if execute() main loop is currently running.

        RFC-0001:  interrupt() . 
        """
        return not self._execution_done.is_set()

    @property
    def is_idle(self) -> bool:
        """Check if executor is idle (waiting for messages in team_mode).

        RFC-0002: . 
        """
        return self._is_idle

    @property
    def is_waiting_for_user(self) -> bool:
        """Check if executor is idle because it's waiting for user response (ask_user).

        RFC-0002:  ask_user  idle  idle, 
         watchdog . 
        """
        return self._is_waiting_for_user

    def _mark_waiting_for_user(self) -> None:
        """Set waiting-for-user flag if the last stop tool was ask_user."""
        if self._last_stop_tool_name == "ask_user":
            self._is_waiting_for_user = True

    @property
    def execution_done_event(self) -> threading.Event:
        """Public accessor for the _execution_done event.

        RFC-0001: interrupt()  wait()  execute() . 
        Event is set when execute() is NOT running, cleared when running.
        """
        return self._execution_done

    def _snapshot_structured_tool_definitions(self) -> list[StructuredToolDefinition]:
        """Return a synchronized snapshot of neutral structured tool definitions.

        RFC-0006: neutral structured definitions  ToolRegistry 

        ToolSearch  deferred tools  ToolRegistry; 
         eager tools / sub-agent executor,  LLM
         neutral structured definitions. 
        """

        if not self.use_structured_tool_calls:
            return []

        with self._tool_registry_lock:
            definition_names = {definition["name"] for definition in self.structured_tool_definitions}

            # 1. ToolRegistry eager tools ( ToolSearch ) .
            for tool in self._tool_registry.compute_eager_tools():
                if tool.name in definition_names:
                    continue
                self.structured_tool_definitions.append(
                    tool.to_structured_definition(
                        description=self._structured_tool_description(tool),
                    ),
                )
                definition_names.add(tool.name)

            return deepcopy(self.structured_tool_definitions)

    @property
    def structured_tool_payload(self) -> list[StructuredToolDefinition]:
        """Return a snapshot of neutral structured tool definitions."""
        return self._snapshot_structured_tool_definitions()

    def update_structured_tools(self, definitions: list[StructuredToolDefinition]) -> None:
        """Replace the structured tool definitions.

        P1 async/sync :  async MCP 

         Agent.create()  MCP completed, 
         MCP  executor  structured tool payload . 
        """
        with self._tool_registry_lock:
            self.structured_tool_definitions = deepcopy(list(definitions))

    def _wait_for_messages(self) -> bool:
        """Enter idle wait until new messages arrive or stop signal is received.

        RFC-0002: team_mode  idle method

        Returns:
            True if new messages arrived, False if stop signal received.
        """
        self._is_idle = True
        while not self.stop_signal and len(self.queued_messages) == 0:
            self._message_available.clear()
            self._message_available.wait(timeout=30)
        self._is_idle = False
        self._is_waiting_for_user = False
        return not self.stop_signal

    def _build_permission_cache_from_tools(self) -> dict[str, tuple[list[str], list[str]]]:
        """Build permission cache from Tool.permissions (sync, no DB).

        RFC-0019: sync execute() 

         ToolRegistry  eager tools,  YAML permissions . 
         permissions  tool  cache,  fallback  (["**"], []). 
        """
        cache: dict[str, tuple[list[str], list[str]]] = {}
        for tool in self._tool_registry.compute_eager_tools():
            if tool.permissions:
                cache[tool.name] = (
                    tool.permissions.get("allow", []),
                    tool.permissions.get("deny", []),
                )
        return cache

    async def _build_permission_cache_async(self) -> dict[str, tuple[list[str], list[str]]]:
        """Build permission cache from DB or Tool.permissions.

        RFC-0019: async execute_async() 

         DB  (package config  user ), 
         session_manager  fallback  Tool.permissions. 
        permissions=None  tool,  DB . 
        """
        if self._session_manager and self._user_id and self._session_id:
            cache: dict[str, tuple[list[str], list[str]]] = {}
            for tool in self._tool_registry.compute_eager_tools():
                if tool.permissions is None:
                    continue
                allow, deny = await self._session_manager.load_permission_rules(
                    user_id=self._user_id,
                    session_id=self._session_id,
                    tool_name=tool.name,
                )
                cache[tool.name] = (allow, deny)
            return cache
        return self._build_permission_cache_from_tools()

    def enqueue_message(self, message: dict[str, str]) -> None:
        """Enqueue a message to be processed during execution.

        Args:
            message: Message dictionary with 'role' and 'content' keys
        """
        # Keep public API stable (dict input), but immediately normalize to UMP Message internally.
        role = Role(message.get("role", "user"))
        content = message.get("content", "")
        self.queued_messages.append(Message(role=role, content=[TextBlock(text=content)]))
        # RFC-0002: team_mode
        self._message_available.set()
        logger.info(
            f"📝 Message enqueued during execution: {message.get('role', 'unknown')} - {message.get('content', '')[:50]}...",
        )

    def execute(
        self,
        history: list[Message] | list[dict[str, Any]],
        agent_state: "AgentState",
        *,
        runtime_client: Any | None = None,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        trace_id: str | None = None,
    ) -> tuple[str, list[Message]]:
        """Execute agent task with full orchestration.

        Args:
            history: Complete conversation history including system prompt and user message
            agent_state: AgentState containing agent context and global storage
            trace_id: RFC-0024 caller-supplied W3C trace id, threaded into
                FrameworkContext so middleware (e.g. AgentEventsMiddleware
                emitting ``RunStartedEvent.trace_id``) can read it without
                touching the deprecated AgentState.

        Returns:
            Tuple of (agent_response, updated_messages_history)
        """
        # Reset the stop signal
        self.stop_signal = False
        self._shutdown_event.clear()

        # RFC-0006: FrameworkContext, function ctx
        # RFC-0026: pass HistoryList handle so middleware (compaction)
        # can emit typed REPLACE via ctx.history.replace(...).
        # RFC-0024: trace_id lives here, not on AgentState.
        framework_context = FrameworkContext(
            agent_name=self.agent_name,
            agent_id=self.agent_id,
            run_id=agent_state.run_id,
            root_run_id=agent_state.root_run_id,
            _tool_registry=self._tool_registry,
            _shutdown_event=self._shutdown_event,
            _history=history if isinstance(history, HistoryList) else None,
            session_id=self._session_id or "",
            trace_id=trace_id,
        )

        # RFC-0019:
        permission_cache = self._build_permission_cache_from_tools()

        # RFC-0001: execute
        self._execution_done.clear()

        messages: list[Message] = []

        # Keep a reference to the original history (HistoryList) so we can
        # sync the executor's local ``messages`` back before blocking waits.
        # This ensures that if the agent is cancelled (e.g. browser refresh)
        # while waiting, the HistoryList already contains all messages and
        # the ``finally`` block in ``_run_inner`` can flush them to storage.
        _origin_history = history

        force_stop_reason = AgentStopReason.SUCCESS

        # RFC-0009: AgentState token trace session
        token_trace_session = agent_state.token_trace_session

        try:
            # Use history directly as the single source of truth
            if history and isinstance(history[0], dict):
                messages = messages_from_legacy_openai_chat(cast(list[dict[str, Any]], history))
            else:
                messages = cast(list[Message], history).copy()

            # RFC-0009: session run token buffer
            tools_payload = None
            if self.use_structured_tool_calls:
                with self._tool_registry_lock:
                    # Snapshot current structured tool definitions under lock to avoid concurrent mutation
                    tools_payload = deepcopy(self.structured_tool_payload)

            if self.llm_config.api_type == "generate_with_token":
                if token_trace_session is None:
                    token_trace_session = TokenTraceSession(
                        self.llm_config,
                        max_context_tokens=self.max_context_tokens,
                    )
                token_trace_session.initialize_from_messages(
                    messages,
                    tools=cast(list[dict[str, Any]] | None, tools_payload),
                )
                token_trace_session.sync_external_messages(messages)

            if self.middleware_manager:
                before_agent_hook_input = BeforeAgentHookInput(
                    agent_state=agent_state,
                    messages=messages,
                    framework_context=framework_context,
                )
                try:
                    messages = self.middleware_manager.run_before_agent(
                        before_agent_hook_input,
                    )
                except Exception as e:
                    logger.warning(f"⚠️ Before-agent middleware execution failed: {e}")

            # Loop until no more tool calls or sub-agent calls are made
            iteration = 0
            final_response = ""
            recent_tool_signatures: list[str] = []

            logger.info(
                f"🔄 Starting iterative execution loop for agent '{self.agent_name}'",
            )

            while self.max_iterations is None or self.max_iterations <= 0 or iteration < self.max_iterations:
                iter_label = f"{iteration + 1}/{self.max_iterations}" if self.max_iterations and self.max_iterations > 0 else f"{iteration + 1}"
                logger.info(
                    f"🔄 Iteration {iter_label} for agent '{self.agent_name}'",
                )

                logger.info(
                    f"Agent name {self.agent_name} Current stop_signal: {self.stop_signal}",
                )
                if self.stop_signal:
                    logger.info(
                        "❗️ Stop signal received, stopping execution",
                    )
                    stop_response = "Stop signal received."
                    stop_response, messages = self._apply_after_agent_hooks(
                        agent_state=agent_state,
                        messages=messages,
                        final_response=stop_response,
                        stop_reason=AgentStopReason.USER_INTERRUPTED,
                    )
                    return stop_response, messages

                # Process any queued messages
                if self.queued_messages:
                    logger.info(
                        f"📝 Processing {len(self.queued_messages)} queued messages",
                    )
                    messages.extend(self.queued_messages)
                    self.queued_messages = []

                # RFC-0002: team_mode, ( system prompt)
                # LLM, idle, token.
                if self.team_mode and not any(m.role != Role.SYSTEM for m in messages):
                    # Sync messages back to HistoryList before blocking wait
                    if isinstance(_origin_history, HistoryList):
                        _sync_history(_origin_history, messages)
                    if not self._wait_for_messages():
                        break
                    iteration += 1
                    continue

                # RFC-0002: team_mode, system assistant
                # LLM, idle . session assistant
                # , LLM ( LLM assistant ) .
                if self.team_mode:
                    last_non_system: Message | None = None
                    for m in reversed(messages):
                        if m.role != Role.SYSTEM:
                            last_non_system = m
                            break
                    if last_non_system is not None and last_non_system.role == Role.ASSISTANT:
                        logger.info(
                            f"⏸️ team_mode: last message is assistant, skipping LLM call for '{self.agent_name}'",
                        )
                        # Sync messages back to HistoryList before blocking wait
                        if isinstance(_origin_history, HistoryList):
                            _sync_history(_origin_history, messages)
                        if not self._wait_for_messages():
                            break
                        iteration += 1
                        continue

                before_model_hook_input = BeforeModelHookInput(
                    agent_state=agent_state,
                    max_iterations=self.max_iterations,
                    current_iteration=iteration,
                    messages=messages,
                )

                if self.middleware_manager:
                    try:
                        messages = self.middleware_manager.run_before_model(
                            before_model_hook_input,
                        )
                    except Exception as e:
                        logger.warning(f"⚠️ Before-model middleware execution failed: {e}")
                    # RFC-0026: typed REPLACE emitted by the chain (e.g.
                    # compaction) lands eagerly on disk so the action stream
                    # carries the typed variant - matches Phase 3 semantics.
                    _emit_pending_history_event(
                        framework_context,
                        before_model_hook_input.history_event,
                    )

                tools_payload = None
                if self.use_structured_tool_calls:
                    # 1. RFC-0006: ToolRegistry, neutral definitions.
                    tools_payload = self._snapshot_structured_tool_definitions()

                # Count current prompt tokens (including tool definitions if present)

                current_prompt_tokens = self.token_counter.count_tokens(
                    messages,
                    tools=tools_payload,
                )

                force_stop_reason = AgentStopReason.SUCCESS
                if current_prompt_tokens > self.max_context_tokens:
                    logger.warning(
                        "⚠️ Prompt tokens (%d) exceed max_context_tokens (%d). Continuing model call.",
                        current_prompt_tokens,
                        self.max_context_tokens,
                    )

                # Calculate max_tokens dynamically based on available budget
                available_tokens = self.max_context_tokens - current_prompt_tokens

                # Get desired max_tokens from LLM config or use reasonable default
                desired_max_tokens = self.llm_config.max_tokens or 65536
                calculated_max_tokens = min(
                    desired_max_tokens,
                    available_tokens,
                )
                calculated_max_tokens = max(1, calculated_max_tokens)

                # Ensure we have at least some tokens for response
                if available_tokens < 50:
                    logger.warning(
                        "⚠️ Available response budget is %d (<50). Continuing model call.",
                        available_tokens,
                    )

                if self.max_iterations and self.max_iterations > 0 and iteration == self.max_iterations - 2:
                    messages.append(
                        Message.user(
                            "[SYSTEM NOTICE: You have 2 operational turns remaining in your turn budget. "
                            "Complete any final data checks now. Your next turn will be your final synthesis turn.]"
                        )
                    )

                if self.max_iterations and self.max_iterations > 0 and iteration == self.max_iterations - 1:
                    logger.info(
                        "🏁 Final synthesis iteration reached. Forcing text synthesis without tools.",
                    )
                    tools_payload = None
                    force_stop_reason = AgentStopReason.SUCCESS
                    messages.append(
                        Message.user(
                            "[SYSTEM NOTICE: This is your final operational turn. Synthesize all findings and calculations "
                            "collected so far and output your final conclusive audit report now.]"
                        )
                    )

                logger.info(
                    f"🔢 Token usage: prompt={current_prompt_tokens}, max_tokens={calculated_max_tokens}, available={available_tokens}",
                )

                # Call LLM to get response
                logger.info(
                    f"🧠 Calling LLM for agent '{self.agent_name}' with {calculated_max_tokens} max tokens...",
                )
                model_response = self.llm_caller.call_llm(
                    messages,
                    openai_client=runtime_client,
                    force_stop_reason=force_stop_reason,
                    agent_state=agent_state,
                    tool_call_mode=self.tool_call_mode,
                    tools=tools_payload,
                    shutdown_event=self._shutdown_event,
                    token_trace_session=token_trace_session,
                    # RFC-0026: emergency compaction in wrap_model_call
                    # writes typed REPLACE via ctx.history.replace(...).
                    framework_context=framework_context,
                )
                # Emergency compaction writes durable history inside wrap_model_call.
                # Realign the local working copy before any early exit can sync it back.
                messages = _realign_after_direct_history_replace(
                    framework_context,
                    messages,
                    token_trace_session,
                )
                if model_response is None:
                    break

                assistant_content = model_response.content or ""

                # Store this as the latest response (potential final response)
                final_response = assistant_content

                # Parse response to check for actions
                parsed_response = self.response_parser.parse_response(
                    model_response,
                )

                # Add the assistant's original response to conversation
                assistant_message = model_response.to_ump_message()
                messages.append(assistant_message)
                if token_trace_session is not None:
                    token_trace_session.append_model_response(
                        output_token_ids=model_response.output_token_ids,
                        fallback_messages=[assistant_message],
                    )

                # Process tool calls and sub-agent calls
                logger.info(
                    f"⚙️ Processing tool/sub-agent calls for agent '{self.agent_name}'...",
                )
                after_model_hook_input = AfterModelHookInput(
                    agent_state=agent_state,
                    max_iterations=self.max_iterations,
                    current_iteration=iteration,
                    original_response=assistant_content,
                    parsed_response=parsed_response,
                    messages=messages,
                    model_response=model_response,
                )

                (
                    processed_response,
                    should_stop,
                    stop_tool_result,
                    updated_messages,
                    execution_feedbacks,
                    ask_outcomes,
                ) = self._process_xml_calls(
                    after_model_hook_input,
                    custom_llm_client_provider=custom_llm_client_provider,
                    framework_context=framework_context,
                    permission_cache=permission_cache,
                )

                # Update messages with any modifications from hooks
                messages = updated_messages

                processed_parsed_response = after_model_hook_input.parsed_response

                # Extract just the tool results from processed_response
                openai_tool_mode = bool(
                    processed_parsed_response
                    and processed_parsed_response.model_response
                    and processed_parsed_response.model_response.tool_calls
                )

                if openai_tool_mode:
                    tool_result_messages: list[Message] = []
                    for feedback in execution_feedbacks:
                        call_obj = feedback.get("call")
                        content = feedback.get("content") or ""
                        output = feedback.get("output")

                        if isinstance(call_obj, ToolCall):
                            call_id = call_obj.tool_call_id
                        else:
                            call_id = None

                        if not call_id:
                            continue

                        # RFC-0024: pass raw_output through so the persisted
                        # ToolResultBlock retains structured fields (returnDisplay
                        # duration_ms, custom meta) for downstream UI consumers.
                        tool_result_block = ToolResultBlock(
                            tool_use_id=str(call_id),
                            content=coerce_tool_result_content(
                                feedback.get("llm_tool_output", output if output is not None else content),
                                fallback_text=None,
                            ),
                            is_error=bool(feedback.get("is_error")),
                            raw_output=_coerce_raw_output(output),
                        )

                        # micro-compact: created_at
                        from datetime import UTC, datetime

                        tool_result_message = Message(
                            role=Role.TOOL,
                            content=[tool_result_block],
                            created_at=datetime.now(UTC),
                        )
                        messages.append(tool_result_message)
                        tool_result_messages.append(tool_result_message)

                    tool_results = ""
                    if token_trace_session is not None and tool_result_messages:
                        token_trace_session.append_messages(tool_result_messages, mask_value=0)
                else:
                    tool_results = processed_response.replace(
                        assistant_content,
                        "",
                        1,
                    ).strip()

                if tool_results:
                    # Hallucination / infinite loop detector: stop repeating identical actions cleanly
                    if execution_feedbacks:
                        current_sig_parts = []
                        for fb in execution_feedbacks:
                            c = fb.get("call")
                            c_name = getattr(c, "tool_name", getattr(c, "name", str(type(c))))
                            c_args = str(getattr(c, "tool_arguments", getattr(c, "arguments", "")))
                            current_sig_parts.append(f"{c_name}:{c_args}")
                        if current_sig_parts:
                            call_sig = "||".join(current_sig_parts)
                            recent_tool_signatures.append(call_sig)
                            if len(recent_tool_signatures) >= 4 and all(s == call_sig for s in recent_tool_signatures[-4:]):
                                logger.warning(
                                    f"Loop detector: Agent executed identical tool call 4 times consecutively. Cleanly returning.",
                                )
                                force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                                final_response = processed_response or "Cleanly completed (no further state progression)."
                                break

                    # micro-compact: created_at
                    from datetime import UTC, datetime

                    from nexau.core.messages import TextBlock

                    tool_result_feedback_message = Message(
                        role=Role.USER,
                        content=[TextBlock(text=f"Tool execution results:\n{tool_results}")],
                        created_at=datetime.now(UTC),
                    )
                    messages.append(tool_result_feedback_message)
                    if token_trace_session is not None:
                        token_trace_session.append_messages([tool_result_feedback_message], mask_value=0)

                # RFC-0019: Ask outcomes → pending_tool_calls
                if ask_outcomes:
                    pending: dict[str, Any] = {
                        outcome.tool_call_id: {
                            "tool_name": outcome.tool_name,
                            "prompt": outcome.prompt,
                            "permission_key": outcome.permission_key,
                            "parameters": outcome.parameters,
                            "decision": None,
                        }
                        for outcome in ask_outcomes
                    }
                    if self._session_manager and self._user_id and self._session_id:
                        import asyncio

                        asyncio.run(
                            self._session_manager.update_pending_tool_calls(
                                user_id=self._user_id,
                                session_id=self._session_id,
                                pending_tool_calls=pending,
                            )
                        )
                    force_stop_reason = AgentStopReason.PERMISSION_PENDING
                    break

                # Check if a stop tool was executed
                if should_stop and len(self.queued_messages) == 0:
                    # RFC-0002: team_mode, 「 tool call」
                    # stop_tool ( finish_team) .
                    if self.team_mode:
                        # team_mode stop tool `finish_team` ;
                        # stop_tools ( ask_user / complete_task / stop tool)
                        # tool call, .
                        if stop_tool_result is not None and self._last_stop_tool_name == "finish_team":
                            logger.info(
                                "🛑 Stop tool detected in team_mode, exiting executor loop",
                            )
                            force_stop_reason = AgentStopReason.STOP_TOOL_TRIGGERED
                            final_response = stop_tool_result
                            break
                        # RFC-0002: teammate ;
                        # teammate _wait_for_messages .
                        if stop_tool_result is None:
                            has_teammates = self._has_active_teammates() if self._has_active_teammates else False
                            if not has_teammates:
                                self._consecutive_text_only_count += 1
                                if self._consecutive_text_only_count >= 3:
                                    logger.warning(
                                        "team_mode: agent produced 3 consecutive text-only responses with no active teammates, auto-exiting"
                                    )
                                    force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                                    final_response = processed_response
                                    break
                                nudge = Message.user(
                                    "[System] You responded with text but did not call any tool. "
                                    "If you are done, you MUST call `finish_team` with a summary. "
                                    "If you need to do more work, call the appropriate tool."
                                )
                                messages.append(nudge)
                                iteration += 1
                                continue
                        # RFC-0002: team_mode, timeout.
                        # Leader teammate completed ( 120s)
                        # watchdog leader.
                        # ask_user idle, watchdog
                        self._mark_waiting_for_user()
                        # Sync messages back to HistoryList before blocking wait
                        if isinstance(_origin_history, HistoryList):
                            _sync_history(_origin_history, messages)
                        if not self._wait_for_messages():
                            force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                            final_response = processed_response
                            break
                        iteration += 1
                        continue
                    # Return the stop tool result directly, formatted as JSON if it's not a string
                    if stop_tool_result is not None:
                        logger.info(
                            "🛑 Stop tool detected, returning stop tool result as final response",
                        )
                        force_stop_reason = AgentStopReason.STOP_TOOL_TRIGGERED
                        final_response = stop_tool_result
                        break
                    else:
                        logger.info("🛑 No more tool calls, stop.")
                        force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                        # Fallback to the processed response if no specific result
                        final_response = processed_response
                        break

                if self.team_mode:
                    self._consecutive_text_only_count = 0
                iteration += 1

            # Add note if finite max iterations reached
            if self.max_iterations and self.max_iterations > 0 and iteration >= self.max_iterations:
                force_stop_reason = AgentStopReason.MAX_ITERATIONS_REACHED
                final_response += "\n\n[Note: Maximum iteration limit reached]"

            final_response, messages = self._apply_after_agent_hooks(
                agent_state=agent_state,
                messages=messages,
                final_response=final_response,
                stop_reason=force_stop_reason,
            )

            logger.info(
                f"🔄 Force stop reason: {force_stop_reason.name}",
            )
            logger.info(
                f"🔄 Final response for agent '{self.agent_name}': {final_response[:100]}",
            )
            logger.debug(
                "🔍 [HISTORY-DEBUG] executor returning: %d messages, roles=%s",
                len(messages),
                [m.role.value for m in messages],
            )
            self._store_token_trace(token_trace_session)
            return final_response, messages

        except TokenTraceContextOverflowError as e:
            # token trace session
            force_stop_reason = AgentStopReason.CONTEXT_TOKEN_LIMIT
            final_response = f"Error: {e}"
            logger.error("❌ TokenTraceSession context overflow: %s", e)

            final_response, messages = self._apply_after_agent_hooks(
                agent_state=agent_state,
                messages=messages,
                final_response=final_response,
                stop_reason=force_stop_reason,
            )
            self._store_token_trace(token_trace_session)
            return final_response, messages

        except Exception as e:
            force_stop_reason = AgentStopReason.ERROR_OCCURRED
            final_response = f"Error: {str(e)}"

            final_response, messages = self._apply_after_agent_hooks(
                agent_state=agent_state,
                messages=messages,
                final_response=final_response,
                stop_reason=force_stop_reason,
            )

            logger.error(
                f"🔄 Force stop reason: {force_stop_reason.name}",
            )
            logger.error(
                f"🔄 Final response for agent '{self.agent_name}': {final_response}",
            )
            logger.error(
                f"❌ Error in agent execution: {e}",
            )
            self._store_token_trace(token_trace_session)
            # Re-raise with more context
            raise RuntimeError(f"Error in agent execution: {e}") from e

        finally:
            # Sync intermediate iteration messages back to HistoryList so that
            # _run_inner's error/finally flush can persist them (fixes #390)
            if isinstance(_origin_history, HistoryList):
                _sync_history(_origin_history, messages)
            self._store_token_trace(token_trace_session)
            # RFC-0009: messages, run
            if token_trace_session is not None:
                token_trace_session.synced_message_count = len(messages)
            # RFC-0001: execute, interrupt
            self._execution_done.set()

    async def execute_async(
        self,
        history: list[Message] | list[dict[str, Any]],
        agent_state: "AgentState",
        *,
        runtime_client: Any | None = None,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        trace_id: str | None = None,
    ) -> tuple[str, list[Message]]:
        """Fully async execution - runs on the main event loop.

        async/sync :  async executor

        - LLM: await call_llm_async() (Gemini  httpx.AsyncClient,  to_thread )
        - Tool: asyncio.gather + tool.execute_async() (async tool  await, sync tool to_thread)
        - Middleware hooks: asyncio.to_thread ( hooks  sync API)
        - Team mode : asyncio.to_thread(_wait_for_messages)
        - History flush:  create_task  await flush_async()

        sync execute() backward compatibility sync . 
        """

        # 1.
        self.stop_signal = False
        self._shutdown_event.clear()
        self._execution_done.clear()
        self._empty_thought_retries = 0

        state = _AsyncIterationState(
            messages=[],
            final_response="",
            force_stop_reason=AgentStopReason.SUCCESS,
            iteration=0,
            agent_state=agent_state,
            token_trace_session=agent_state.token_trace_session,
            framework_context=FrameworkContext(
                agent_name=self.agent_name,
                agent_id=self.agent_id,
                run_id=agent_state.run_id,
                root_run_id=agent_state.root_run_id,
                _tool_registry=self._tool_registry,
                _shutdown_event=self._shutdown_event,
                # RFC-0026: typed REPLACE writers (compaction) reach
                # HistoryList through ctx.history.replace(...).
                _history=history if isinstance(history, HistoryList) else None,
                session_id=self._session_id or "",
                # RFC-0024: caller-supplied trace_id, FrameworkContext-owned.
                trace_id=trace_id,
            ),
            runtime_client=runtime_client,
            custom_llm_client_provider=custom_llm_client_provider,
            origin_history=history,
        )

        try:
            # 2. messages, token trace session before-agent hooks
            await self._prepare_async_execution(state)

            # 3.
            while self.max_iterations is None or self.max_iterations <= 0 or state.iteration < self.max_iterations:
                if self.stop_signal:
                    stop_response = "Stop signal received."
                    stop_response, state.messages = await asyncio.to_thread(
                        self._apply_after_agent_hooks,
                        agent_state=agent_state,
                        messages=state.messages,
                        final_response=stop_response,
                        stop_reason=AgentStopReason.USER_INTERRUPTED,
                    )
                    return stop_response, state.messages

                outcome = await self._execute_iteration_async(state)
                if outcome == _IterationOutcome.BREAK:
                    break

            # 4.
            if self.max_iterations and self.max_iterations > 0 and state.iteration >= self.max_iterations:
                state.force_stop_reason = AgentStopReason.MAX_ITERATIONS_REACHED
                state.final_response += "\\n\\n[Note: Maximum iteration limit reached]"

            state.final_response, state.messages = await asyncio.to_thread(
                self._apply_after_agent_hooks,
                agent_state=agent_state,
                messages=state.messages,
                final_response=state.final_response,
                stop_reason=state.force_stop_reason,
            )

            self._store_token_trace(state.token_trace_session)
            return state.final_response, state.messages

        except TokenTraceContextOverflowError as e:
            state.force_stop_reason = AgentStopReason.CONTEXT_TOKEN_LIMIT
            state.final_response = f"Error: {e}"
            state.final_response, state.messages = await asyncio.to_thread(
                self._apply_after_agent_hooks,
                agent_state=agent_state,
                messages=state.messages,
                final_response=state.final_response,
                stop_reason=state.force_stop_reason,
            )
            self._store_token_trace(state.token_trace_session)
            return state.final_response, state.messages

        except Exception as e:
            state.force_stop_reason = AgentStopReason.ERROR_OCCURRED
            state.final_response = f"Error: {str(e)}"
            state.final_response, state.messages = await asyncio.to_thread(
                self._apply_after_agent_hooks,
                agent_state=agent_state,
                messages=state.messages,
                final_response=state.final_response,
                stop_reason=state.force_stop_reason,
            )
            self._store_token_trace(state.token_trace_session)
            raise RuntimeError(f"Error in agent execution: {e}") from e

        finally:
            if isinstance(state.origin_history, HistoryList):
                _sync_history(state.origin_history, state.messages)
            self._store_token_trace(state.token_trace_session)
            if state.token_trace_session is not None:
                state.token_trace_session.synced_message_count = len(state.messages)
            self._execution_done.set()

    # ------------------------------------------------------------------
    # execute_async method
    # ------------------------------------------------------------------

    async def _prepare_async_execution(self, state: _AsyncIterationState) -> None:
        """Prepare messages, token trace session and run before-agent hooks.

         → token trace  → before-agent middleware

        Mutates *state* in-place.
        """

        history = state.origin_history
        if history and isinstance(history[0], dict):
            state.messages = messages_from_legacy_openai_chat(cast(list[dict[str, Any]], history))
        else:
            state.messages = cast(list[Message], history).copy()

        # Token trace session
        tools_payload = None
        if self.use_structured_tool_calls:
            with self._tool_registry_lock:
                tools_payload = deepcopy(self.structured_tool_payload)

        if self.llm_config.api_type == "generate_with_token":
            if state.token_trace_session is None:
                state.token_trace_session = TokenTraceSession(
                    self.llm_config,
                    max_context_tokens=self.max_context_tokens,
                )
            state.token_trace_session.initialize_from_messages(
                state.messages,
                tools=cast(list[dict[str, Any]] | None, tools_payload),
            )
            state.token_trace_session.sync_external_messages(state.messages)

        # Before-agent middleware hooks
        if self.middleware_manager:
            before_agent_hook_input = BeforeAgentHookInput(
                agent_state=state.agent_state,
                messages=state.messages,
                framework_context=state.framework_context,
            )
            try:
                state.messages = await asyncio.to_thread(
                    self.middleware_manager.run_before_agent,
                    before_agent_hook_input,
                )
            except Exception as e:
                logger.warning(f"⚠️ Before-agent middleware execution failed: {e}")

        # RFC-0019:
        state.permission_cache = await self._build_permission_cache_async()

    async def _execute_iteration_async(self, state: _AsyncIterationState) -> _IterationOutcome:
        """Execute one iteration of the main async loop.

        async:  → team_mode  → LLM  →
         → tool result → . 

        Mutates *state* in-place and returns the loop control signal.
        """

        # 1.
        if self.queued_messages:
            state.messages.extend(self.queued_messages)
            self.queued_messages = []

        # 2. team_mode: LLM
        if self.team_mode and not any(m.role != Role.SYSTEM for m in state.messages):
            if isinstance(state.origin_history, HistoryList):
                _sync_history(state.origin_history, state.messages)
            if not await asyncio.to_thread(self._wait_for_messages):
                return _IterationOutcome.BREAK
            state.iteration += 1
            return _IterationOutcome.CONTINUE

        # 3. team_mode: assistant LLM
        if self.team_mode:
            last_non_system: Message | None = None
            for m in reversed(state.messages):
                if m.role != Role.SYSTEM:
                    last_non_system = m
                    break
            if last_non_system is not None and last_non_system.role == Role.ASSISTANT:
                if isinstance(state.origin_history, HistoryList):
                    _sync_history(state.origin_history, state.messages)
                if not await asyncio.to_thread(self._wait_for_messages):
                    return _IterationOutcome.BREAK
                state.iteration += 1
                return _IterationOutcome.CONTINUE

        # 4. Before-model middleware hooks
        before_model_hook_input = BeforeModelHookInput(
            agent_state=state.agent_state,
            max_iterations=self.max_iterations,
            current_iteration=state.iteration,
            messages=state.messages,
        )

        if self.middleware_manager:
            try:
                state.messages = await asyncio.to_thread(
                    self.middleware_manager.run_before_model,
                    before_model_hook_input,
                )
            except Exception as e:
                logger.warning(f"⚠️ Before-model middleware execution failed: {e}")
            # RFC-0026: see sync-path comment for rationale.
            _emit_pending_history_event(
                state.framework_context,
                before_model_hook_input.history_event,
            )
            # RFC-0027: before_model middleware --
            # LLM, .
            if before_model_hook_input.force_stop_reason is not None:
                return self._apply_middleware_force_stop(
                    state,
                    before_model_hook_input.force_stop_reason,
                )

        # 5. & token
        tools_payload = None
        if self.use_structured_tool_calls:
            tools_payload = self._snapshot_structured_tool_definitions()

        current_prompt_tokens = self.token_counter.count_tokens(
            state.messages,
            tools=tools_payload,
        )

        state.force_stop_reason = AgentStopReason.SUCCESS
        if current_prompt_tokens > self.max_context_tokens:
            logger.warning(
                "⚠️ Prompt tokens (%d) exceed max_context_tokens (%d). Continuing.",
                current_prompt_tokens,
                self.max_context_tokens,
            )

        available_tokens = self.max_context_tokens - current_prompt_tokens
        desired_max_tokens = self.llm_config.max_tokens or 65536
        _ = max(1, min(desired_max_tokens, available_tokens))  # calculated_max_tokens (reserved for future use)

        if self.max_iterations and self.max_iterations > 0 and state.iteration == self.max_iterations - 2:
            state.messages.append(
                Message.user(
                    "[SYSTEM NOTICE: You have 2 operational turns remaining in your turn budget. "
                    "Complete any final data checks now. Your next turn will be your final synthesis turn.]"
                )
            )

        if self.max_iterations and self.max_iterations > 0 and state.iteration == self.max_iterations - 1:
            logger.info("🏁 Final synthesis iteration reached. Forcing text synthesis without tools.")
            tools_payload = None
            state.force_stop_reason = AgentStopReason.SUCCESS
            state.messages.append(
                Message.user(
                    "[SYSTEM NOTICE: This is your final operational turn. Synthesize all findings and calculations "
                    "collected so far and output your final conclusive audit report now.]"
                )
            )

        # 6. LLM - await, to_thread
        model_response = await self.llm_caller.call_llm_async(
            state.messages,
            openai_client=state.runtime_client,
            force_stop_reason=state.force_stop_reason,
            agent_state=state.agent_state,
            tool_call_mode=self.tool_call_mode,
            tools=tools_payload,
            shutdown_event=self._shutdown_event,
            token_trace_session=state.token_trace_session,
            # RFC-0026: see sync-path comment.
            framework_context=state.framework_context,
        )
        # Emergency compaction writes durable history inside wrap_model_call.
        # Realign the local working copy before any early exit can sync it back.
        state.messages = _realign_after_direct_history_replace(
            state.framework_context,
            state.messages,
            state.token_trace_session,
        )
        if model_response is None:
            return _IterationOutcome.BREAK

        # 7. assistant
        assistant_content = model_response.content or ""
        state.final_response = assistant_content

        parsed_response = self.response_parser.parse_response(model_response)
        assistant_message = model_response.to_ump_message()
        state.messages.append(assistant_message)
        if state.token_trace_session is not None:
            state.token_trace_session.append_model_response(
                output_token_ids=model_response.output_token_ids,
                fallback_messages=[assistant_message],
            )

        # 8. / ( after-model middleware)
        after_model_hook_input = AfterModelHookInput(
            agent_state=state.agent_state,
            max_iterations=self.max_iterations,
            current_iteration=state.iteration,
            original_response=assistant_content,
            parsed_response=parsed_response,
            messages=state.messages,
            model_response=model_response,
        )

        (
            processed_response,
            should_stop,
            stop_tool_result,
            updated_messages,
            execution_feedbacks,
            ask_outcomes,
        ) = await self._process_xml_calls_async(
            after_model_hook_input,
            custom_llm_client_provider=state.custom_llm_client_provider,
            framework_context=state.framework_context,
            permission_cache=state.permission_cache,
        )

        state.messages = updated_messages

        # RFC-0027: after_model middleware --
        # tool result / should_stop BREAK
        # NO_MORE_TOOL_CALLS . tool call _process_xml_calls_async
        # (function force_stop_reason ) .
        if after_model_hook_input.force_stop_reason is not None:
            return self._apply_middleware_force_stop(
                state,
                after_model_hook_input.force_stop_reason,
            )

        # 9. tool result
        self._append_tool_result_messages(
            state=state,
            execution_feedbacks=execution_feedbacks,
            processed_parsed_response=after_model_hook_input.parsed_response,
            assistant_content=assistant_content,
            processed_response=processed_response,
        )

        # RFC-0019: Ask outcomes → pending_tool_calls
        if ask_outcomes:
            pending: dict[str, Any] = {
                outcome.tool_call_id: {
                    "tool_name": outcome.tool_name,
                    "prompt": outcome.prompt,
                    "permission_key": outcome.permission_key,
                    "parameters": outcome.parameters,
                    "decision": None,
                }
                for outcome in ask_outcomes
            }
            if self._session_manager and self._user_id and self._session_id:
                await self._session_manager.update_pending_tool_calls(
                    user_id=self._user_id,
                    session_id=self._session_id,
                    pending_tool_calls=pending,
                )
            state.force_stop_reason = AgentStopReason.PERMISSION_PENDING
            return _IterationOutcome.BREAK

        # Auto-continuation guard for empty-thought cutoff:
        # If the model generated reasoning but stopped with empty content and zero tool calls,
        # don't leave the user with an abandoned thought; nudge the model once to finalize its response.
        if (
            should_stop
            and not (parsed_response and parsed_response.has_calls())
            and assistant_content.strip() in ("", "[empty]")
            and getattr(self, "_empty_thought_retries", 0) < 1
        ):
            self._empty_thought_retries = getattr(self, "_empty_thought_retries", 0) + 1
            logger.warning("⚠️ Model stopped with reasoning but no tool calls or content. Triggering automatic continuation.")
            state.messages.append(
                Message(
                    role=Role.FRAMEWORK,
                    content=[
                        TextBlock(
                            text="[Notice: You concluded your internal reasoning without generating the response or calling any tool. "
                            "Please provide your response or invoke a tool to proceed.]"
                        )
                    ],
                )
            )
            state.iteration += 1
            return _IterationOutcome.CONTINUE

        # 10.
        if should_stop and len(self.queued_messages) == 0:
            return await self._handle_stop_condition_async(
                state,
                stop_tool_result=stop_tool_result,
                processed_response=processed_response,
            )

        if self.team_mode:
            self._consecutive_text_only_count = 0

        # RFC-0022 Phase 2: persist per-iter progress before continuing.
        # Without this, all assistant + tool_result messages produced across
        # N iterations only land in the DB after the final iter (via the
        # end-of-run flush in agent.py). A crash mid-loop would lose all
        # already-completed iterations. Per-iter flush makes each completed
        # iter durable, so the next reader sees real progress.
        await self._persist_iter_progress(state)

        state.iteration += 1
        return _IterationOutcome.CONTINUE

    async def _persist_iter_progress(self, state: _AsyncIterationState) -> None:
        """RFC-0022 Phase 2: per-iter persistence of newly accumulated messages.

        Sync ``state.messages`` (executor's local list, where assistant +
        tool_result rows for THIS iter were just appended) back to the bound
        ``HistoryList`` and flush. The fingerprint diff in ``HistoryList.flush``
        will detect the new tail and emit ``APPEND([this iter's messages])``.

        Called at the end of every CONTINUE iter. Crash before the next iter
        leaves the DB with all completed iters durable; only the in-flight
        iter's partial output (already represented in Redis live events) is
        lost from DB until the next manual recovery.

        No-op when ``state.origin_history`` is not a HistoryList (e.g. tests
        passing a plain list, or sync execute() path which has its own
        end-of-run flush).
        """
        history = state.origin_history
        if not isinstance(history, HistoryList):
            return
        history.replace_all(state.messages)
        try:
            # state.iteration is the just-completed iter index (incremented
            # AFTER this method returns at executor.py: state.iteration += 1).
            # Pass it as iter_index so the APPEND row carries
            # AppendExtra.iter_index=N and idempotency_key="{run_id}:{N}"
            # making the per-iter UNIQUE dedup actually fire on retries.
            await history.flush_async(iter_index=state.iteration)
        except Exception as exc:
            # Per-iter flush is best-effort. Failure here means the iter's
            # messages stay in _pending and the next flush (or end-of-run
            # flush) catches them. Don't fail the run.
            logger.warning("[STREAM] per-iter flush failed (will retry next flush): %s", exc)

    def _append_tool_result_messages(
        self,
        *,
        state: _AsyncIterationState,
        execution_feedbacks: list[dict[str, Any]],
        processed_parsed_response: ParsedResponse | None,
        assistant_content: str,
        processed_response: str,
    ) -> None:
        """Build tool result messages from execution feedbacks and append to state.

        tool result: structured tool  TOOL, 
        XML  USER . 

        Mutates *state.messages* in-place. Also appends to token trace session
        when present.
        """

        openai_tool_mode = bool(
            processed_parsed_response and processed_parsed_response.model_response and processed_parsed_response.model_response.tool_calls
        )

        if openai_tool_mode:
            tool_result_messages: list[Message] = []
            for feedback in execution_feedbacks:
                call_obj = feedback.get("call")
                content = feedback.get("content") or ""
                output = feedback.get("output")

                if isinstance(call_obj, ToolCall):
                    call_id = call_obj.tool_call_id
                else:
                    call_id = None

                if not call_id:
                    continue

                # RFC-0024: pass raw_output through (dict/list only).
                tool_result_block = ToolResultBlock(
                    tool_use_id=str(call_id),
                    content=coerce_tool_result_content(
                        feedback.get("llm_tool_output", output if output is not None else content),
                        fallback_text=None,
                    ),
                    is_error=bool(feedback.get("is_error")),
                    raw_output=_coerce_raw_output(output),
                )
                # micro-compact: created_at
                from datetime import UTC, datetime

                tool_result_message = Message(role=Role.TOOL, content=[tool_result_block], created_at=datetime.now(UTC))
                state.messages.append(tool_result_message)
                tool_result_messages.append(tool_result_message)

            tool_results = ""
            if state.token_trace_session is not None and tool_result_messages:
                state.token_trace_session.append_messages(tool_result_messages, mask_value=0)
        else:
            tool_results = processed_response.replace(assistant_content, "", 1).strip()

        if tool_results:
            tool_result_feedback_message = Message(role=Role.USER, content=[TextBlock(text=f"Tool execution results:\n{tool_results}")])
            state.messages.append(tool_result_feedback_message)
            if state.token_trace_session is not None:
                state.token_trace_session.append_messages([tool_result_feedback_message], mask_value=0)

    def _apply_middleware_force_stop(
        self,
        state: _AsyncIterationState,
        reason: AgentStopReason,
    ) -> _IterationOutcome:
        """Finalize a run that a before/after_model middleware asked to force-stop.

        RFC-0027: middleware

         state,  --, 
        middleware/ (
        sensitive wordsmiddleware) .  BREAK . 
        """
        state.force_stop_reason = reason
        if state.messages:
            state.final_response = state.messages[-1].get_text_content()
        logger.warning("🛑 Middleware force-stop: %s", reason.name)
        return _IterationOutcome.BREAK

    async def _handle_stop_condition_async(
        self,
        state: _AsyncIterationState,
        *,
        stop_tool_result: str | None,
        processed_response: str,
    ) -> _IterationOutcome:
        """Determine whether to break or continue when should_stop is True.

: team_mode  finish_team ()  stop tool (), 
        . 

        Mutates *state.final_response* and *state.force_stop_reason* when breaking.
        """

        if self.team_mode:
            if stop_tool_result is not None and self._last_stop_tool_name == "finish_team":
                state.force_stop_reason = AgentStopReason.STOP_TOOL_TRIGGERED
                state.final_response = stop_tool_result
                return _IterationOutcome.BREAK

            # RFC-0002: teammate ;
            # teammate _wait_for_messages .
            if stop_tool_result is None:
                has_teammates = self._has_active_teammates() if self._has_active_teammates else False
                if not has_teammates:
                    self._consecutive_text_only_count += 1
                    if self._consecutive_text_only_count >= 3:
                        logger.warning("team_mode: agent produced 3 consecutive text-only responses with no active teammates, auto-exiting")
                        state.force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                        state.final_response = processed_response
                        return _IterationOutcome.BREAK
                    nudge = Message.user(
                        "[System] You responded with text but did not call any tool. "
                        "If you are done, you MUST call `finish_team` with a summary. "
                        "If you need to do more work, call the appropriate tool."
                    )
                    state.messages.append(nudge)
                    state.iteration += 1
                    return _IterationOutcome.CONTINUE

            self._mark_waiting_for_user()
            if isinstance(state.origin_history, HistoryList):
                _sync_history(state.origin_history, state.messages)
            if not await asyncio.to_thread(self._wait_for_messages):
                state.force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
                state.final_response = processed_response
                return _IterationOutcome.BREAK
            state.iteration += 1
            return _IterationOutcome.CONTINUE

        if stop_tool_result is not None:
            state.force_stop_reason = AgentStopReason.STOP_TOOL_TRIGGERED
            state.final_response = stop_tool_result
            return _IterationOutcome.BREAK

        state.force_stop_reason = AgentStopReason.NO_MORE_TOOL_CALLS
        state.final_response = processed_response
        return _IterationOutcome.BREAK

    @staticmethod
    def _extract_stop_tool_result(
        *,
        tool_name: str,
        raw_output: dict[str, Any],
        tool_call: ToolCall,
    ) -> str:
        """Return the user-facing final response for a stop tool call."""

        if tool_name == "complete_task":
            result = tool_call.parameters.get("result")
            if result is not None:
                return str(result)

        actual_result: dict[str, Any] = {key: value for key, value in raw_output.items() if key != "_is_stop_tool"}
        if "result" in actual_result and len(actual_result) == 1:
            return json.dumps(
                actual_result["result"],
                ensure_ascii=False,
                indent=4,
            )
        return (
            json.dumps(
                actual_result,
                ensure_ascii=False,
                indent=4,
            )
            if actual_result
            else json.dumps(
                raw_output,
                ensure_ascii=False,
                indent=4,
            )
        )

    async def _process_xml_calls_async(
        self,
        hook_input: AfterModelHookInput,
        *,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        framework_context: FrameworkContext,
        permission_cache: dict[str, tuple[list[str], list[str]]] | None = None,
    ) -> tuple[str, bool, str | None, list[Message], list[dict[str, Any]], list[AskOutcome]]:
        """Async version of _process_xml_calls.

        Middleware hooks  to_thread  (sync API), 
        tool/sub-agent  _execute_parsed_calls_async asynchronous execution. 
        """

        response_payload: str | ModelResponse = hook_input.model_response or hook_input.original_response
        parsed_response: ParsedResponse | None = hook_input.parsed_response or self.response_parser.parse_response(
            response_payload,
        )
        hook_input.parsed_response = parsed_response
        current_messages = hook_input.messages.copy()
        force_continue = False

        if self.middleware_manager:
            try:
                parsed_response, current_messages, force_continue = await asyncio.to_thread(
                    self.middleware_manager.run_after_model, hook_input
                )
            except Exception as e:
                logger.warning(f"⚠️ After-model middleware execution failed: {e}")
            # RFC-0026: see sync-path comment for rationale.
            _emit_pending_history_event(
                framework_context,
                hook_input.history_event,
            )
            # RFC-0027: after_model middleware -- /
            # . should_stop=True ;
            # hook_input.force_stop_reason (outparam) _execute_iteration_async.
            if hook_input.force_stop_reason is not None:
                return hook_input.original_response, True, None, current_messages, [], []

        if not parsed_response or not parsed_response.has_calls():
            if force_continue:
                return hook_input.original_response, False, None, current_messages, [], []
            else:
                return hook_input.original_response, True, None, current_messages, [], []

        assert parsed_response is not None
        processed_response, should_stop, stop_tool_result, execution_feedbacks, ask_outcomes = await self._execute_parsed_calls_async(
            parsed_response,
            hook_input.agent_state,
            custom_llm_client_provider=custom_llm_client_provider,
            framework_context=framework_context,
            permission_cache=permission_cache,
        )
        return processed_response, should_stop, stop_tool_result, current_messages, execution_feedbacks, ask_outcomes

    async def _await_with_shutdown_race(
        self,
        awaitable: Any,
        *,
        poll_interval: float = 0.05,
    ) -> tuple[Any, bool]:
        """Await ``awaitable`` while watching ``_shutdown_event``; cancel on stop.

         (NAC ): ,  agent  await  tool / sub-agent
         future,  tool  stop_signal. 
         helper  agent : shutdown_event  cancel awaitable,
         stop_signal, . 

        :  ``asyncio.to_thread``  future  cancel  detach ,
        worker  (Python ).  sub-agent 
        ``Executor.force_stop``  stop_signal,  iteration . 

        Returns:
            (result, False): awaitable completed ( awaitable  handle shutdown
                 error tuple ,  _run_tool  shutdown emit )
            (None, True): shutdown_event  awaitable ,  race cancel
        """
        # NOTE: awaitable ( _run_tool) shutdown +
        # _emit_tool_error_result, cancel emit .
        # awaitable poll, .
        task = asyncio.ensure_future(awaitable)

        # : shield task wait_for timeout cancel
        # timeout, shutdown cancel.
        # awaitable (asyncio.to_thread tool / sub-agent)
        # shutdown_event race cancel, .
        while not task.done():
            try:
                result = await asyncio.wait_for(asyncio.shield(task), timeout=poll_interval)
                return result, False
            except TimeoutError:
                if self._shutdown_event.is_set():
                    task.cancel()
                    # await task CancelledError
                    # asyncio "Task was destroyed but it is pending" warning
                    # task ensure_future children ( gather) cancel .
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass
                    return None, True
                continue
        # task completed; race task cancel
        # task.result CancelledError; interrupted.
        try:
            return task.result(), False
        except asyncio.CancelledError:
            return None, True

    async def _execute_parsed_calls_async(
        self,
        parsed_response: ParsedResponse,
        agent_state: "AgentState",
        *,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        framework_context: FrameworkContext,
        permission_cache: dict[str, tuple[list[str], list[str]]] | None = None,
    ) -> tuple[str, bool, str | None, list[dict[str, Any]], list[AskOutcome]]:
        """Async parallel tool/sub-agent execution via asyncio.gather.

        async tool →  await tool.execute_async()
        sync tool / sub-agent → asyncio.to_thread 
        """

        processed_response = parsed_response.original_response

        if self._shutdown_event.is_set():
            return processed_response, False, None, [], []

        if not parsed_response.tool_calls:
            return processed_response, False, None, [], []

        parallel_execution_id = str(uuid.uuid4())

        # Deduplicate tool_call_ids
        seen_tool_call_ids: defaultdict[str, int] = defaultdict(int)
        for idx, tool_call in enumerate(parsed_response.tool_calls):
            base_id = tool_call.tool_call_id or f"tool_call_{idx}"
            count = seen_tool_call_ids[base_id]
            tool_call.tool_call_id = f"{base_id}_{count}" if count else base_id
            seen_tool_call_ids[base_id] += 1
            tool_call.parallel_execution_id = parallel_execution_id

        serial_tool_names = set(self._tool_registry.compute_serial_tool_names())

        # async tasks
        async def _run_tool(tc: ToolCall) -> tuple[str, ToolCall, tuple[str, Any, bool]]:
            """Dispatch tool execution based on sync/async implementation type.

            - Sync tool:  _execute_tool_call_safe  worker . 
               (get_sandbox → before_tool → tool.execute → after_tool) 
               worker,  running event loop, 
               ThreadPoolExecutor . 
               sync tool  agent_state.get_sandbox(), 
              run_async_function_sync()  sync framework API. 

            - Async tool:  event loop  await tool.execute_async(). 
              Async tool  async-native API,  sync-only 
              run_async_function_sync(). 
            """
            if self._shutdown_event.is_set():
                error_msg = "Shutdown in progress"
                await asyncio.to_thread(self._emit_tool_error_result, tc, error_msg, agent_state)
                return ("tool", tc, (tc.tool_name, error_msg, True))

            tool_obj = self._tool_registry.get_tool(tc.tool_name)
            if tool_obj is None:
                error_msg = self._tool_not_found_msg(tc.tool_name)
                await asyncio.to_thread(self._emit_tool_error_result, tc, error_msg, agent_state)
                return ("tool", tc, (tc.tool_name, error_msg, True))

            # async tool: implementation async def
            # class ( MCPTool) async execute_async .
            is_async_impl = (
                tool_obj.implementation is not None and inspect.iscoroutinefunction(tool_obj.implementation)
            ) or tool_obj.has_native_async_execute

            if not is_async_impl:
                # ── Sync tool: worker ──
                # ThreadPoolExecutor.submit(_execute_tool_call_safe)
                return (
                    "tool",
                    tc,
                    await asyncio.to_thread(
                        self._execute_tool_call_safe,
                        tc,
                        agent_state,
                        framework_context,
                        permission_cache,
                    ),
                )

            # ── Async tool: event loop ──
            tool_call_id = tc.tool_call_id or f"tool_call_{uuid.uuid4()}"
            converted_params: dict[str, Any] = {}
            try:
                for pn, pv in tc.parameters.items():
                    converted_params[pn] = self.tool_executor.convert_parameter_type(tc.tool_name, pn, pv)

                # RFC-0019: per-tool-call FrameworkContext
                if permission_cache is not None:
                    allow_rules, deny_rules = permission_cache.get(tc.tool_name, (["**"], []))
                    tool_ctx: FrameworkContext = framework_context.for_tool_call(
                        tool_name=tc.tool_name,
                        allow_rules=allow_rules,
                        deny_rules=deny_rules,
                    )
                else:
                    tool_ctx = framework_context

                # get_sandbox sync session API, to_thread
                sandbox: BaseSandbox | None = None
                if tc.tool_name not in {"LoadSkill"}:
                    sandbox = await asyncio.to_thread(agent_state.get_sandbox)

                # before_tool middleware hook (sync hook → to_thread)
                tool_parameters = converted_params.copy()
                if self.middleware_manager:
                    from nexau.archs.main_sub.execution.hooks import BeforeToolHookInput

                    before_input = BeforeToolHookInput(
                        agent_state=agent_state,
                        sandbox=sandbox,
                        tool_name=tc.tool_name,
                        tool_call_id=tc.tool_call_id or "",
                        tool_input=tool_parameters,
                        parallel_execution_id=tc.parallel_execution_id,
                    )
                    tool_parameters = await asyncio.to_thread(self.middleware_manager.run_before_tool, before_input)

                exec_params: dict[str, Any] = dict(tool_parameters)
                exec_params["agent_state"] = agent_state
                exec_params["sandbox"] = sandbox
                exec_params["ctx"] = tool_ctx

                # tracer Langfuse span ( sync )
                tracer: BaseTracer | None = agent_state.get_global_value("tracer")
                tool_call_id = tc.tool_call_id or ""

                # Async tool: await ( to_thread)
                # TraceContext package tool span
                if tracer:
                    span_name = f"Tool: {tc.tool_name}"
                    trace_inputs: dict[str, Any] = {
                        "parameters": tool_parameters,
                        "tool_call_id": tool_call_id,
                    }
                    trace_attrs: dict[str, Any] = {
                        "agent_name": agent_state.agent_name,
                        "agent_id": agent_state.agent_id,
                        "source_id": tool_obj.source_id,
                    }
                    trace_ctx = TraceContext(tracer, span_name, SpanType.TOOL, trace_inputs, trace_attrs)
                    trace_ctx.__enter__()
                    try:
                        result = await tool_obj.execute_async(**exec_params)
                        execution_result = await asyncio.to_thread(
                            self.tool_executor.finalize_tool_execution,
                            agent_state=agent_state,
                            sandbox=sandbox,
                            tool=tool_obj,
                            tool_name=tc.tool_name,
                            tool_parameters=tool_parameters,
                            tool_call_id=tool_call_id,
                            result=result,
                            execution_error=None,
                        )
                        trace_ctx.set_outputs({"result": execution_result.raw_output})
                        trace_ctx.__exit__(None, None, None)
                        return ("tool", tc, (tc.tool_name, execution_result, False))
                    except (AskPermission, PermissionDenied):
                        trace_ctx.__exit__(None, None, None)
                        raise
                    except Exception as e:
                        trace_ctx.set_outputs({"result": {"status": "error", "error": str(e), "error_type": type(e).__name__}})
                        trace_ctx.__exit__(type(e), e, e.__traceback__)
                        return ("tool", tc, (tc.tool_name, str(e), True))
                else:
                    result = await tool_obj.execute_async(**exec_params)
                    execution_result = await asyncio.to_thread(
                        self.tool_executor.finalize_tool_execution,
                        agent_state=agent_state,
                        sandbox=sandbox,
                        tool=tool_obj,
                        tool_name=tc.tool_name,
                        tool_parameters=tool_parameters,
                        tool_call_id=tool_call_id,
                        result=result,
                        execution_error=None,
                    )
                    return ("tool", tc, (tc.tool_name, execution_result, False))
            except AskPermission as e:
                return (
                    "tool",
                    tc,
                    (
                        tc.tool_name,
                        AskOutcome(
                            tool_call_id=tool_call_id,
                            tool_name=tc.tool_name,
                            prompt=e.prompt,
                            permission_key=e.permission_key,
                            parameters=converted_params,
                        ),
                        False,
                    ),
                )
            except PermissionDenied as e:
                return (
                    "tool",
                    tc,
                    (
                        tc.tool_name,
                        DenyOutcome(
                            tool_call_id=tool_call_id,
                            reason=e.reason,
                            permission_key=e.permission_key,
                        ),
                        True,
                    ),
                )
            except Exception as e:
                return ("tool", tc, (tc.tool_name, str(e), True))

        # serial tools
        serial_tasks: list[ToolCall] = []
        parallel_tool_tasks: list[ToolCall] = []
        for tc in parsed_response.tool_calls:
            if tc.tool_name in serial_tool_names:
                serial_tasks.append(tc)
            else:
                parallel_tool_tasks.append(tc)

        # type: (call_type, call_obj, (name, result, is_error))
        all_results: list[tuple[str, ToolCall, tuple[str, Any, bool]]] = []

        # serial tools
        for tc in serial_tasks:
            # shutdown_event cancel tool, serial / parallel
            # stop_signal (" tool ") .
            serial_result, interrupted = await self._await_with_shutdown_race(_run_tool(tc))
            if interrupted:
                return processed_response, False, None, [], []
            all_results.append(serial_result)

        # tools
        # call_origins parallel_coros, gather exception
        parallel_coros: list[Any] = []
        call_origins: list[tuple[str, ToolCall]] = []
        for tc in parallel_tool_tasks:
            parallel_coros.append(_run_tool(tc))
            call_origins.append(("tool", tc))

        if parallel_coros:
            # gather shutdown race.: return_exceptions=True children
            # exception; cancel gather wrapper, gather
            # CancelledError, cancel children (cpython behavior
            # asyncio.gather docs "If gather is cancelled, all submitted
            # awaitables that have not completed yet are also cancelled.").
            # : children asyncio.to_thread detach, worker
            # sync (Python ); sub-agent worker force_stop
            # stop_signal iteration, /token .
            gather_result, interrupted = await self._await_with_shutdown_race(asyncio.gather(*parallel_coros, return_exceptions=True))
            if interrupted:
                return processed_response, False, None, [], []
            parallel_results = cast(list[Any], gather_result)
            for idx, r in enumerate(parallel_results):
                if isinstance(r, BaseException):
                    _, origin_call = call_origins[idx]
                    all_results.append(("tool", origin_call, (origin_call.tool_name, str(r), True)))
                elif isinstance(r, tuple):
                    all_results.append(r)  # type: ignore[arg-type]

        tool_results: list[str] = []
        execution_feedbacks: list[dict[str, Any]] = []
        ask_outcomes: list[AskOutcome] = []
        stop_tool_detected = False
        stop_tool_result: str | None = None

        for entry in all_results:
            call_type: str = entry[0]
            call_obj: ToolCall = entry[1]
            result_data: tuple[str, Any, bool] = entry[2]
            tool_name, result, is_error = result_data

            # RFC-0019: outcome
            if isinstance(result, AskOutcome):
                ask_outcomes.append(result)
                continue
            if isinstance(result, DenyOutcome):
                deny_msg = f"Permission denied: {result.reason}"
                execution_feedbacks.append(
                    {
                        "call_type": call_type,
                        "call": call_obj,
                        "content": deny_msg,
                        "output": {"status": "error", "error": deny_msg},
                        "llm_tool_output": deny_msg,
                        "is_error": True,
                    }
                )
                should_append_xml = call_obj.source != "structured"
                if should_append_xml:
                    tool_results.append(f"\n<tool_result>\n<tool_name>{tool_name}</tool_name>\n<error>{deny_msg}</error>\n</tool_result>\n")
                continue

            raw_output, llm_tool_output = self._split_tool_outputs(result)
            feedback_is_error = is_error
            if isinstance(raw_output, dict):
                raw_output_dict = cast(dict[str, Any], raw_output)
                feedback_is_error = feedback_is_error or ToolExecutor.should_mark_llm_output_as_error(raw_output_dict)
            result_str = self._serialize_llm_tool_output(llm_tool_output)
            execution_feedbacks.append(
                {
                    "call_type": call_type,
                    "call": call_obj,
                    "content": result_str,
                    "output": raw_output,
                    "llm_tool_output": llm_tool_output,
                    "is_error": feedback_is_error,
                }
            )

            # ToolCall.source indicates call format; structured tool calls do not append XML tool results.
            should_append_xml = call_obj.source != "structured"
            if feedback_is_error:
                if should_append_xml:
                    tool_results.append(
                        f"\n<tool_result>\n<tool_name>{tool_name}</tool_name>\n<error>{result_str}</error>\n</tool_result>\n"
                    )
            else:
                if should_append_xml:
                    tool_results.append(
                        f"\n<tool_result>\n<tool_name>{tool_name}</tool_name>\n<result>{result_str}</result>\n</tool_result>\n"
                    )
                # stop tool
                try:
                    stop_raw_output: dict[str, Any] | None
                    if isinstance(raw_output, dict):
                        stop_raw_output = cast(dict[str, Any], raw_output)
                    else:
                        stop_raw_output = None

                    if stop_raw_output is not None and stop_raw_output.get("_is_stop_tool"):
                        stop_tool_detected = True
                        self._last_stop_tool_name = tool_name
                        stop_tool_result = self._extract_stop_tool_result(
                            tool_name=tool_name,
                            raw_output=stop_raw_output,
                            tool_call=call_obj,
                        )
                except TypeError:
                    pass

        if tool_results:
            processed_response += "\n\n" + "\n\n".join(tool_results)

        return processed_response, stop_tool_detected, stop_tool_result, execution_feedbacks, ask_outcomes

    def _store_token_trace(self, token_trace_session: TokenTraceSession | None) -> None:
        """Persist token trace data into shared trace memory."""
        if token_trace_session is None or self.global_storage is None:
            return

        existing_trace_memory = self.global_storage.get("trace_memory", {})
        trace_memory = cast(dict[str, Any], existing_trace_memory) if isinstance(existing_trace_memory, dict) else {}
        trace_memory.update(token_trace_session.export_trace())
        self.global_storage.set("trace_memory", trace_memory)

    def _apply_after_agent_hooks(
        self,
        *,
        agent_state: "AgentState",
        messages: list[Message],
        final_response: str,
        stop_reason: AgentStopReason | None,
    ) -> tuple[str, list[Message]]:
        """Run after-agent middleware hooks and return possibly updated values."""

        if not self.middleware_manager:
            return final_response, messages

        after_agent_hook_input = AfterAgentHookInput(
            agent_state=agent_state,
            messages=messages,
            agent_response=final_response,
            stop_reason=stop_reason,
        )
        try:
            return self.middleware_manager.run_after_agent(after_agent_hook_input)
        except Exception as exc:
            logger.warning(f"⚠️ After-agent middleware execution failed: {exc}")
            return final_response, messages

    @staticmethod
    def _build_middleware_manager(
        configured_middlewares: list[Middleware],
        before_model_hooks: list[BeforeModelHook],
        after_model_hooks: list[AfterModelHook],
        after_tool_hooks: list[AfterToolHook],
        before_tool_hooks: list[BeforeToolHook],
    ) -> MiddlewareManager | None:
        combined: list[Middleware] = list(configured_middlewares)

        def _hook_name(hook: Callable[..., Any]) -> str:
            return getattr(hook, "__name__", hook.__class__.__name__)

        for bm_hook in before_model_hooks:
            combined.append(
                FunctionMiddleware(
                    before_model_hook=bm_hook,
                    name=f"before_model::{_hook_name(bm_hook)}",
                ),
            )

        for am_hook in after_model_hooks:
            combined.append(
                FunctionMiddleware(
                    after_model_hook=am_hook,
                    name=f"after_model::{_hook_name(am_hook)}",
                ),
            )

        for at_hook in after_tool_hooks:
            combined.append(
                FunctionMiddleware(
                    after_tool_hook=at_hook,
                    name=f"after_tool::{_hook_name(at_hook)}",
                ),
            )

        for bt_hook in before_tool_hooks:
            combined.append(
                FunctionMiddleware(
                    before_tool_hook=bt_hook,
                    name=f"before_tool::{_hook_name(bt_hook)}",
                ),
            )

        return MiddlewareManager(combined)

    def _process_xml_calls(
        self,
        hook_input: AfterModelHookInput,
        *,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        framework_context: FrameworkContext,
        permission_cache: dict[str, tuple[list[str], list[str]]] | None = None,
    ) -> tuple[str, bool, str | None, list[Message], list[dict[str, Any]], list[AskOutcome]]:
        """Process XML tool calls and sub-agent calls using two-phase approach.

        Args:
            response: Agent response containing XML calls
            messages: Current conversation history

        Returns:
            Tuple of (processed_response, should_stop, stop_tool_result, updated_messages, execution_feedbacks, ask_outcomes)
        """
        # Phase 1: Parse the response to extract all calls
        logger.info("📋 Phase 1: Parsing LLM response for all executable calls")
        response_payload: str | ModelResponse = hook_input.model_response or hook_input.original_response
        parsed_response: ParsedResponse | None = hook_input.parsed_response or self.response_parser.parse_response(
            response_payload,
        )
        hook_input.parsed_response = parsed_response

        # Keep track of current messages (may be modified by hooks)
        current_messages = hook_input.messages.copy()
        force_continue = False  # Default: don't force continue

        # Execute middlewares if any are configured (always run even if no calls)
        if self.middleware_manager:
            try:
                parsed_response, current_messages, force_continue = self.middleware_manager.run_after_model(hook_input)
            except Exception as e:
                logger.warning(f"⚠️ After-model middleware execution failed: {e}")
            # RFC-0026: see before_model sync-path comment for rationale.
            _emit_pending_history_event(
                framework_context,
                hook_input.history_event,
            )

        # If no calls found after hooks, check if we should force continue
        if not parsed_response or not parsed_response.has_calls():
            if force_continue:
                # Hook removed all calls but added feedback, let agent continue
                logger.info(
                    "🎣 No tool calls remaining, but hook requested force_continue. Agent will continue with feedback.",
                )
                return hook_input.original_response, False, None, current_messages, [], []
            else:
                # Normal behavior: no calls means stop
                logger.info(
                    "🛑 No tool calls remaining, stopping.",
                )
                return hook_input.original_response, True, None, current_messages, [], []

        # Phase 2: Execute all parsed calls
        logger.info(
            f"⚡ Phase 2: Executing {parsed_response.get_call_summary()}",
        )
        assert parsed_response is not None
        processed_response, should_stop, stop_tool_result, execution_feedbacks, ask_outcomes = self._execute_parsed_calls(
            parsed_response,
            hook_input.agent_state,
            custom_llm_client_provider=custom_llm_client_provider,
            framework_context=framework_context,
            permission_cache=permission_cache,
        )
        return processed_response, should_stop, stop_tool_result, current_messages, execution_feedbacks, ask_outcomes

    def _execute_parsed_calls(
        self,
        parsed_response: ParsedResponse,
        agent_state: "AgentState",
        *,
        custom_llm_client_provider: Callable[[str], Any] | None = None,
        framework_context: FrameworkContext,
        permission_cache: dict[str, tuple[list[str], list[str]]] | None = None,
    ) -> tuple[str, bool, str | None, list[dict[str, Any]], list[AskOutcome]]:
        """Execute all parsed calls in parallel.

        Args:
            parsed_response: ParsedResponse containing all calls to execute
            agent_state: AgentState containing agent context and global storage

        Returns:
            Tuple of (processed_response, should_stop, stop_tool_result, execution_feedbacks, ask_outcomes)
        """
        processed_response = parsed_response.original_response

        # Check if agent is shutting down
        if self._shutdown_event.is_set():
            logger.warning(
                f"⚠️ Agent '{self.agent_name}' ({self.agent_id}) is shutting down, skipping new task execution",
            )
            return processed_response, False, None, [], []

        # Execute tool calls in parallel
        if not parsed_response.tool_calls:
            return processed_response, False, None, [], []

        executor_id = str(uuid.uuid4())
        parallel_execution_id = str(uuid.uuid4())

        tool_executor = ThreadPoolExecutor()

        # Track executors for cleanup
        with self._executor_lock:
            self._running_executors[f"{executor_id}_tools"] = tool_executor

        # Handle duplicate tool_call_ids by adding suffixes
        seen_tool_call_ids: defaultdict[str, int] = defaultdict(int)
        for idx, tool_call in enumerate(parsed_response.tool_calls):
            base_id = tool_call.tool_call_id or f"tool_call_{idx}"
            count = seen_tool_call_ids[base_id]
            if count:
                tool_call.tool_call_id = f"{base_id}_{count}"
            else:
                tool_call.tool_call_id = base_id
            seen_tool_call_ids[base_id] += 1
            # Set parallel execution ID for grouping
            tool_call.parallel_execution_id = parallel_execution_id

        serial_tool_names = set(self._tool_registry.compute_serial_tool_names())

        try:
            # Batch all context snapshots before any task submission to prevent
            # OTel context pollution between parallel tool threads (fix-span-overlap)
            tool_snapshots = [(copy_context(), tool_call) for tool_call in parsed_response.tool_calls]

            # Submit tool execution tasks using pre-created context snapshots
            tool_futures: dict[Future[tuple[str, Any, bool]], tuple[str, ToolCall]] = {}
            for task_ctx, tool_call in tool_snapshots:
                # RFC-0001: shutdown_event
                if self._shutdown_event.is_set():
                    logger.info("🛑 Shutdown event detected, skipping remaining tool calls")
                    break

                future = tool_executor.submit(
                    task_ctx.run,
                    self._execute_tool_call_safe,
                    tool_call,
                    agent_state,
                    framework_context,
                    permission_cache,
                )
                tool_futures[future] = ("tool", tool_call)

                if tool_call.tool_name in serial_tool_names:
                    future.result()

            # Combine all futures
            all_futures: dict[Future[tuple[str, Any, bool]], tuple[str, ToolCall]] = {**tool_futures}

            # Collect results as they complete
            tool_results: list[str] = []
            execution_feedbacks: list[dict[str, Any]] = []
            ask_outcomes: list[AskOutcome] = []
            stop_tool_detected = False
            stop_tool_result = None

            for future in as_completed(all_futures):
                call_type, call_obj = all_futures[future]
                try:
                    result_data = future.result()
                    tool_name, result, is_error = result_data

                    # RFC-0019: outcome
                    if isinstance(result, AskOutcome):
                        ask_outcomes.append(result)
                        continue
                    if isinstance(result, DenyOutcome):
                        deny_msg = f"Permission denied: {result.reason}"
                        execution_feedbacks.append(
                            {
                                "call_type": "tool",
                                "call": call_obj,
                                "content": deny_msg,
                                "output": {"status": "error", "error": deny_msg},
                                "llm_tool_output": deny_msg,
                                "is_error": True,
                            },
                        )
                        should_append_xml = call_obj.source != "structured"
                        if should_append_xml:
                            tool_results.append(
                                f"""
<tool_result>
<tool_name>{tool_name}</tool_name>
<error>{deny_msg}</error>
</tool_result>
""",
                            )
                        continue

                    raw_output, llm_tool_output = self._split_tool_outputs(result)
                    feedback_is_error = is_error
                    if isinstance(raw_output, dict):
                        raw_output_dict = cast(dict[str, Any], raw_output)
                        feedback_is_error = feedback_is_error or ToolExecutor.should_mark_llm_output_as_error(raw_output_dict)
                    result_str = self._serialize_llm_tool_output(llm_tool_output)
                    execution_feedbacks.append(
                        {
                            "call_type": "tool",
                            "call": call_obj,
                            "content": result_str,
                            "output": raw_output,
                            "llm_tool_output": llm_tool_output,
                            "is_error": feedback_is_error,
                        },
                    )
                    if feedback_is_error:
                        logger.error(
                            f"❌ Tool '{tool_name}' error: {result_str}",
                        )
                        should_append_xml = call_obj.source != "structured"
                        if should_append_xml:
                            tool_results.append(
                                f"""
<tool_result>
<tool_name>{tool_name}</tool_name>
<error>{result_str}</error>
</tool_result>
""",
                            )
                    else:
                        logger.info(
                            f"📤 Tool '{tool_name}' result: {result_str[:100]}",
                        )
                        should_append_xml = call_obj.source != "structured"
                        tool_result_xml = f"""
<tool_result>
<tool_name>{tool_name}</tool_name>
<result>{result_str}</result>
</tool_result>
"""
                        if should_append_xml:
                            tool_results.append(tool_result_xml)

                        # Check if this tool result indicates a stop tool was executed
                        try:
                            stop_raw_output: dict[str, Any] | None
                            if isinstance(raw_output, dict):
                                stop_raw_output = cast(dict[str, Any], raw_output)
                            else:
                                stop_raw_output = None

                            if stop_raw_output is not None and stop_raw_output.get("_is_stop_tool"):
                                stop_tool_detected = True
                                self._last_stop_tool_name = tool_name
                                stop_tool_result = self._extract_stop_tool_result(
                                    tool_name=tool_name,
                                    raw_output=stop_raw_output,
                                    tool_call=call_obj,
                                )
                                logger.info(
                                    f"🛑 Stop tool '{tool_name}' result detected, will terminate after processing",
                                )
                        except TypeError:
                            pass
                except Exception as e:
                    logger.error(
                        f"❌ Unexpected error processing {call_type}: {e}",
                    )
                    tool_results.append(
                        f"""
<tool_result>
<tool_name>unknown</tool_name>
<error>Unexpected error: {str(e)}</error>
</tool_result>
""",
                    )

            # Append tool results to the original response
            if tool_results:
                processed_response += "\n\n" + "\n\n".join(tool_results)

        finally:
            # Clean up executors
            with self._executor_lock:
                try:
                    tool_executor.shutdown(wait=True, cancel_futures=False)
                except Exception as e:
                    logger.error(f"❌ Error shutting down executors: {e}")
                finally:
                    self._running_executors.pop(f"{executor_id}_tools", None)

        return processed_response, stop_tool_detected, stop_tool_result, execution_feedbacks, ask_outcomes

    @staticmethod
    def _tool_not_found_msg(tool_name: str) -> str:
        return f"Tool '{tool_name}' not found"

    def _emit_tool_error_result(
        self,
        tc: ToolCall,
        error_msg: str,
        agent_state: "AgentState",
    ) -> None:
        """Invoke after_tool middleware hooks for tool calls that bypass normal execution.

        When a tool call is rejected early (tool not found, shutdown), the normal
        finalize_tool_execution path is skipped, so after_tool middleware hooks -
        most importantly AgentEventsMiddleware which emits ToolCallResultEvent -
        are never invoked. This leaves the event stream missing the tool_call_result
        event, causing downstream consumers (persistence layer, UI) to never
        receive the tool result.
        """
        if not self.middleware_manager:
            return
        error_output: dict[str, Any] = {"status": "error", "error": error_msg}
        hook_input = AfterToolHookInput(
            agent_state=agent_state,
            # ponytail: pass active sandbox from agent_state so after_tool middleware (e.g. LongToolOutputMiddleware) can persist/truncate
            sandbox=agent_state.get_sandbox(),
            tool_name=tc.tool_name,
            tool_call_id=tc.tool_call_id or "",
            tool_input=tc.parameters,
            tool_output=error_output,
            llm_tool_output=error_output,
        )
        try:
            self.middleware_manager.run_after_tool(hook_input, error_output, error_output)
        except Exception:
            logger.warning(
                "Failed to emit error tool result for '%s' (tool_call_id=%s)",
                tc.tool_name,
                tc.tool_call_id,
                exc_info=True,
            )

    def _execute_tool_call_safe(
        self,
        tool_call: ToolCall,
        agent_state: "AgentState",
        framework_context: FrameworkContext,
        permission_cache: dict[str, tuple[list[str], list[str]]] | None = None,
    ) -> tuple[str, Any, bool]:
        """Safely execute a tool call.

        RFC-0019:  tool call  FrameworkContext, 
         AskPermission / PermissionDenied  Outcome. 
        """
        # Early check: emit error result event if tool is not registered.
        if self._tool_registry.get_tool(tool_call.tool_name) is None:
            error_msg = self._tool_not_found_msg(tool_call.tool_name)
            self._emit_tool_error_result(tool_call, error_msg, agent_state)
            return (tool_call.tool_name, error_msg, True)

        tool_call_id = tool_call.tool_call_id or f"tool_call_{uuid.uuid4()}"
        converted_params: dict[str, Any] = {}

        try:
            # Convert parameters to correct types and execute
            for param_name, param_value in tool_call.parameters.items():
                converted_params[param_name] = self.tool_executor.convert_parameter_type(
                    tool_call.tool_name,
                    param_name,
                    param_value,
                )

            # RFC-0019: per-tool-call FrameworkContext
            if permission_cache is not None:
                allow_rules, deny_rules = permission_cache.get(tool_call.tool_name, (["**"], []))
                tool_ctx = framework_context.for_tool_call(
                    tool_name=tool_call.tool_name,
                    allow_rules=allow_rules,
                    deny_rules=deny_rules,
                )
            else:
                tool_ctx = framework_context

            result = self.tool_executor.execute_tool_with_llm_output(
                agent_state,
                tool_call.tool_name,
                converted_params,
                tool_call_id=tool_call_id,
                parallel_execution_id=tool_call.parallel_execution_id,
                framework_context=tool_ctx,
            )

            return (tool_call.tool_name, result, False)

        except AskPermission as e:
            return (
                tool_call.tool_name,
                AskOutcome(
                    tool_call_id=tool_call_id,
                    tool_name=tool_call.tool_name,
                    prompt=e.prompt,
                    permission_key=e.permission_key,
                    parameters=converted_params,
                ),
                False,
            )
        except PermissionDenied as e:
            return (
                tool_call.tool_name,
                DenyOutcome(
                    tool_call_id=tool_call_id,
                    reason=e.reason,
                    permission_key=e.permission_key,
                ),
                True,
            )
        except Exception as e:
            return tool_call.tool_name, str(e), True

    def force_stop(self) -> None:
        """Force-stop the executor, breaking the team_mode forever-run loop.

        RFC-0002:  team_mode 

        Sets stop_signal and wakes the message wait so the loop exits immediately.
         running sub-agents  executor,  stop
         (: sub-agent ) . 
        """
        self._force_stop(set())

    def _force_stop(self, visited_executor_ids: set[int]) -> None:
        """Force-stop this executor and propagate to running sub-agents.

        RFC-0002:  running sub-agents

        visited_executor_ids exception executor graph . 
        """
        executor_id = id(self)
        if executor_id in visited_executor_ids:
            return
        visited_executor_ids.add(executor_id)

        # 1. executor
        self.stop_signal = True
        self._shutdown_event.set()
        self._message_available.set()

        # 2. running sub-agents;, finally pop .
        for sub_agent in list(self.subagent_manager.running_sub_agents.values()):
            try:
                sub_agent.executor._force_stop(visited_executor_ids)
            except Exception as e:
                logger.warning(f"propagate force_stop to sub-agent {sub_agent.agent_id} failed: {e}")

    def cleanup(self) -> None:
        """Clean up executor resources."""
        logger.info(f"🧹 Cleaning up executor for agent '{self.agent_name}'...")
        self.stop_signal = True

        # Signal shutdown to prevent new tasks
        self._shutdown_event.set()

        # RFC-0001: LLM
        # 1. shutdown(wait=False) middleware
        # 2. close sync/async HTTP client
        try:
            self.llm_caller.shutdown_thread_pool()
        except Exception as e:
            logger.warning(f"⚠️ Error shutting down LLM thread pool: {e}")

        client = self.llm_caller.openai_client
        if client is not None:
            try:
                client.close()
            except Exception as e:
                logger.warning(f"⚠️ Error closing sync LLM client during cleanup: {e}")

        async_client = self.llm_caller.async_openai_client
        if async_client is not None:
            # AsyncOpenAI/AsyncAnthropic.close coroutine, sync cleanup await.
            # GC ; async client .
            self.llm_caller.async_openai_client = None

        # Shutdown subagent manager
        self.subagent_manager.shutdown()

        # Shutdown all running executors
        with self._executor_lock:
            for executor_id, executor in self._running_executors.items():
                try:
                    logger.info(f"🛑 Shutting down executor {executor_id}")
                    executor.shutdown(wait=False, cancel_futures=True)
                except Exception as e:
                    logger.error(
                        f"❌ Error shutting down executor {executor_id}: {e}",
                    )

            self._running_executors.clear()

        logger.info(
            f"✅ Executor cleanup completed for agent '{self.agent_name}'",
        )

    @staticmethod
    def _structured_tool_description(tool: Tool) -> str:
        """Return the description exposed to structured tool-calling models."""

        return tool.get_structured_description()

    @staticmethod
    def _split_tool_outputs(result: Any) -> tuple[Any, Any]:
        """Split raw and llm-facing outputs from the execution result."""

        if isinstance(result, ToolExecutionResult):
            return result.raw_output, result.llm_tool_output
        return result, result

    @staticmethod
    def _serialize_llm_tool_output(value: Any) -> str:
        """Serialize llm-facing tool output for text-only feedback paths."""

        if isinstance(value, str):
            return value
        try:
            return json.dumps(value, indent=2, ensure_ascii=False)
        except (TypeError, ValueError):
            return str(value)

    def add_tool(self, tool: Tool) -> None:
        """Add a tool to the executor.

        Args:
            tool: Tool instance to add
        """
        if tool.defer_loading:
            raise ValueError(
                "Runtime-added deferred tools are not supported. Register deferred tools during agent initialization instead.",
            )

        with self._tool_registry_lock:
            # Keep registry and structured definition updates atomic for concurrent readers/writers
            self._tool_registry.add_source("runtime", [tool])
            if self.use_structured_tool_calls:
                self.structured_tool_definitions.append(
                    tool.to_structured_definition(
                        description=self._structured_tool_description(tool),
                    ),
                )

    def add_sub_agent(self, name: str, agent_config: AgentConfig) -> None:
        """Add a sub-agent config.

        Args:
            name: Name of the sub-agent
            agent_config: Config creates the agent
        """
        self.subagent_manager.add_sub_agent(name, agent_config)