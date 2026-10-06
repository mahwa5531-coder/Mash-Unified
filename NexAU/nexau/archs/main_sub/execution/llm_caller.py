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

"""LLM request assembly and provider-boundary adapters for MASh.

MASh exclusively routes all models (OpenAI, Anthropic, DeepSeek, Google)
through the OpenAI-compatible Cloud API gateway (POST /v1/chat/completions).
All native Anthropic, Google GenAI, and Responses API implementations
have been pruned.
"""
from __future__ import annotations

import asyncio
import contextvars
import functools
import hashlib
import inspect
import json
import logging
import threading
import time
import uuid
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Literal, cast

if TYPE_CHECKING:
    from nexau.archs.main_sub.framework_context import FrameworkContext

import httpx
import openai
import requests
from openai import AsyncStream, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from nexau.archs.llm.llm_aggregators import OpenAIChatCompletionAggregator
from nexau.archs.llm.llm_aggregators.events import Event
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.token_trace_session import TokenTraceSession
from nexau.archs.tool.tool import (
    StructuredToolDefinitionLike,
    normalize_structured_tool_definition,
    structured_tool_definition_to_openai,
)
from nexau.archs.tracer.context import TraceContext, get_current_span
from nexau.archs.tracer.core import BaseTracer, SpanType
from nexau.core.messages import Message, Role, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload

from ..agent_state import AgentState
from ..tool_call_modes import (
    STRUCTURED_TOOL_CALL_MODES,
    StructuredProviderTarget,
    normalize_tool_call_mode,
    resolve_structured_provider_target,
)
from .hooks import MiddlewareManager, ModelCallParams
from .model_response import ModelResponse

logger = logging.getLogger(__name__)

_MISSING_TOOL_RESULT_CONTENT = "no tool result (canceled, compacted or failed)"
_OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64

OnRetryCallback = Callable[[int, int, float, str], None]
"""(attempt, max_attempts, backoff_seconds, error_message) → None"""


def _noop_event_handler(_: Event) -> None:
    pass


def _chat_completion_to_model_response(completion: ChatCompletion) -> ModelResponse:
    message = completion.choices[0].message if completion.choices else None
    usage = _to_serializable_dict(completion.usage) if completion.usage is not None else None
    return ModelResponse.from_openai_message(message, usage=usage)


def _resolve_run_id(model_call_params: ModelCallParams | None) -> str:
    """Best-effort run_id for stream aggregator instances."""
    if model_call_params is None or model_call_params.agent_state is None:
        return "stream"
    return model_call_params.agent_state.run_id


def _get_event_emitter(manager: MiddlewareManager | None) -> Callable[[Event], None]:
    if manager is None:
        return _noop_event_handler
    for mw in manager.middlewares:
        handler = mw.get_event_handler()
        if handler is not None:
            return cast(Callable[[Event], None], handler)
    return _noop_event_handler


def _log_llm_debug_request(messages: Sequence[Message]) -> None:
    logger.info("🐛 [DEBUG] LLM Request Messages:")
    for msg in messages:
        logger.info(f"Role: {msg.role.value}")
        for block in msg.content:
            logger.info(f"Block: {type(block).__name__}: {str(block)[:200]}...")


def _log_llm_debug_response(model_response: ModelResponse) -> None:
    logger.info("🐛 [DEBUG] LLM Response Content:")
    logger.info(f"Role: {model_response.role}")
    if model_response.content:
        logger.info(f"Content: {model_response.content[:500]}...")
    if model_response.tool_calls:
        logger.info(f"Tool Calls Count: {len(model_response.tool_calls)}")
        for i, tc in enumerate(model_response.tool_calls):
            logger.info(f"  Tool Call #{i+1}: {tc.name} (id: {tc.id})")
            logger.info(f"    Arguments: {str(tc.arguments)[:200]}...")


class StreamIdleTimeoutError(TimeoutError):
    """Raised when an active SSE/chunk stream yields no chunks for a prolonged duration."""
    pass


def _get_stream_idle_timeout_seconds(llm_config: LLMConfig | None) -> float:
    if llm_config is None:
        return 300.0
    if getattr(llm_config, "stream_idle_timeout", None) is not None:
        return float(llm_config.stream_idle_timeout)
    if getattr(llm_config, "stream_idle_timeout_ms", None) is not None:
        return float(llm_config.stream_idle_timeout_ms) / 1000.0
    return 300.0


def _is_stream_timeout_exception(exc: Exception) -> bool:
    """Best-effort detection for provider/transport stream read timeouts."""
    if isinstance(exc, (httpx.ReadTimeout, requests.exceptions.ReadTimeout, TimeoutError)):
        return True
    return exc.__class__.__name__ in {"ReadTimeout", "APITimeoutError"}


def _maybe_wrap_stream_idle_timeout(
    exc: Exception,
    *,
    transport_name: str,
    llm_config: LLMConfig | None,
) -> StreamIdleTimeoutError | None:
    """Normalize SDK/provider timeout exceptions into StreamIdleTimeoutError."""
    if not _is_stream_timeout_exception(exc):
        return None
    idle_timeout_seconds = _get_stream_idle_timeout_seconds(llm_config)
    return StreamIdleTimeoutError(
        f"idle timeout waiting for {transport_name} ({idle_timeout_seconds}s): {exc}",
    )


def _compact_scalar(value: Any, *, max_chars: int = 256) -> str:
    if value is None:
        return "None"
    text = str(value)
    if len(text) > max_chars:
        return text[:max_chars] + "..."
    return text


def _extract_error_detail(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    err = payload.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        if msg:
            return f": {msg}"
    return ""


def _raw_message_metadata(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        try:
            dumped = payload.model_dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    if hasattr(payload, "__dict__"):
        return payload.__dict__
    return {}


def _ensure_tool_results(messages: list[Message]) -> list[Message]:
    """Ensure tool_use blocks have matching tool_result blocks."""
    if not messages:
        return messages

    tool_use_ids: set[str] = set()
    tool_result_ids: set[str] = set()

    for msg in messages:
        for block in msg.content:
            if isinstance(block, ToolUseBlock):
                tool_use_ids.add(block.id)
            elif isinstance(block, ToolResultBlock):
                tool_result_ids.add(block.tool_use_id)

    missing = tool_use_ids - tool_result_ids
    if not missing:
        return messages

    new_messages = list(messages)
    synthetic_results = [
        ToolResultBlock(tool_use_id=tid, content=_MISSING_TOOL_RESULT_CONTENT, is_error=True)
        for tid in missing
    ]
    new_messages.append(Message(role=Role.USER, content=synthetic_results))
    return new_messages


def _safe_int(val: Any) -> int | None:
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _safe_get(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _to_serializable_dict(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        try:
            return payload.model_dump()
        except Exception:
            pass
    if hasattr(payload, "__dict__"):
        return payload.__dict__
    return {}


def _adapt_structured_tools_for_provider(
    tools: Sequence[StructuredToolDefinitionLike] | None,
    provider_target: StructuredProviderTarget = "openai",
    *,
    tool_streaming: bool = True,
    strict: bool = False,
) -> list[Mapping[str, object]] | None:
    """Adapt neutral structured tools for OpenAI format."""
    if not tools:
        return None

    adapted_tools: list[Mapping[str, object]] = []
    for tool in tools:
        normalized = normalize_structured_tool_definition(tool)
        adapted_tools.append(structured_tool_definition_to_openai(normalized, strict=strict))

    return adapted_tools


def _process_stream_chunk(
    chunk: Any,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
) -> Any:
    """Run a raw stream chunk through middleware pipeline."""
    if middleware_manager is None or model_call_params is None:
        return chunk
    return middleware_manager.stream_chunk(chunk, model_call_params)


def _build_bifrost_headers(
    llm_config: LLMConfig,
    model_call_params: ModelCallParams | None = None,
) -> dict[str, str]:
    """Build telemetry and session headers for MASh Desktop Cloud Gateway."""
    headers: dict[str, str] = {}
    try:
        from nexau.archs.platform.crypto_vault import get_auth_metadata
        from nexau.archs.platform.path_helpers import get_installation_id

        meta = get_auth_metadata()
        headers["X-Machine-ID"] = get_installation_id()
        headers["X-Client-Version"] = "Mash-Desktop/1.0.0"
        if meta.get("email"):
            headers["X-User-ID"] = str(meta["email"])
    except Exception:
        pass

    # Extract session ID from model_call_params or llm_config
    session_id: str | None = None
    if model_call_params:
        if getattr(model_call_params, "session_id", None):
            session_id = str(model_call_params.session_id)
        elif getattr(model_call_params, "agent_state", None) and getattr(model_call_params.agent_state, "session_id", None):
            session_id = str(model_call_params.agent_state.session_id)
        elif getattr(model_call_params, "token_trace_session", None) and getattr(model_call_params.token_trace_session, "session_id", None):
            session_id = str(model_call_params.token_trace_session.session_id)

    if not session_id and hasattr(llm_config, "session_id") and llm_config.session_id:
        session_id = str(llm_config.session_id)
    if not session_id and hasattr(llm_config, "extra_params") and isinstance(llm_config.extra_params, dict):
        extra = llm_config.extra_params
        session_id = str(extra.get("session_id") or (extra.get("extra_params") or {}).get("session_id") or "") or None

    if session_id:
        headers["X-Session-ID"] = session_id

    # In MASh Desktop Cloud API spec, request_id is generated per request:
    headers.setdefault("X-Request-ID", f"req_{uuid.uuid4().hex[:16]}")

    if hasattr(llm_config, "default_headers") and llm_config.default_headers:
        headers.update(llm_config.default_headers)
    return headers


class LLMCaller:
    """Handles LLM API calls with retry logic (OpenAI chat completions)."""

    def __init__(
        self,
        openai_client: Any,
        llm_config: LLMConfig,
        retry_attempts: int = 5,
        *,
        retry_backoff_max_seconds: int = 30,
        on_retry: OnRetryCallback | None = None,
        middleware_manager: MiddlewareManager | None = None,
        global_storage: Any = None,
        session_id: str | None = None,
        async_openai_client: Any | None = None,
    ):
        self.openai_client = openai_client
        self.async_openai_client = async_openai_client
        self.llm_config = llm_config
        self.retry_attempts = retry_attempts
        self.retry_backoff_max_seconds = retry_backoff_max_seconds
        self.on_retry = on_retry
        self.middleware_manager = middleware_manager
        self.global_storage = global_storage
        self.session_id = session_id

        self._llm_thread_pool: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix="llm-call",
        )

    def _get_tracer(self) -> BaseTracer | None:
        if self.global_storage is not None:
            return self.global_storage.get("tracer")
        return None

    def call_llm(
        self,
        messages: list[Message],
        max_tokens: int | None = None,
        force_stop_reason: Any = None,
        agent_state: AgentState | None = None,
        tool_call_mode: str = "xml",
        tools: Sequence[StructuredToolDefinitionLike] | None = None,
        openai_client: Any | None = None,
        shutdown_event: threading.Event | None = None,
        token_trace_session: TokenTraceSession | None = None,
        framework_context: "FrameworkContext | None" = None,
    ) -> ModelResponse | None:
        """Call LLM with the given messages and return normalized response."""
        runtime_client = openai_client if openai_client is not None else self.openai_client

        if not runtime_client and not self.middleware_manager:
            raise RuntimeError(
                "OpenAI client is not available. Please check your API configuration.",
            )

        normalized_mode = normalize_tool_call_mode(tool_call_mode)
        use_structured_tools = normalized_mode in STRUCTURED_TOOL_CALL_MODES
        adapted_tools: list[Mapping[str, object]] | None = None
        if use_structured_tools:
            strict_tools = bool((self.llm_config.extra_params or {}).get("strict_tools", False))
            adapted_tools = _adapt_structured_tools_for_provider(
                tools,
                "openai",
                tool_streaming=self.llm_config.tool_streaming,
                strict=strict_tools,
            )

        api_params = self.llm_config.to_openai_params()

        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens

        if adapted_tools:
            api_params["tools"] = adapted_tools
            api_params.setdefault("tool_choice", "auto")
            api_params.setdefault("parallel_tool_calls", True)

        if not use_structured_tools:
            xml_stop_sequences = ["</tool_use>", "</use_parallel_tool_calls>"]
            existing_stop = api_params.get("stop", [])
            if isinstance(existing_stop, str):
                existing_stop = [existing_stop]
            elif existing_stop is None:
                existing_stop = []
            api_params["stop"] = existing_stop + xml_stop_sequences

        dropper = getattr(self.llm_config, "apply_param_drops", None)
        if callable(dropper):
            api_params = cast(dict[str, Any], dropper(api_params))

        if self.llm_config.debug:
            _log_llm_debug_request(messages)

        logger.info(f"🧠 Calling LLM with {max_tokens} max tokens...")

        messages = _ensure_tool_results(messages)

        model_call_params = ModelCallParams(
            messages=messages,
            max_tokens=max_tokens,
            force_stop_reason=force_stop_reason,
            agent_state=agent_state,
            tool_call_mode=tool_call_mode,
            tools=tools,
            api_params=api_params,
            openai_client=runtime_client,
            llm_config=self.llm_config,
            retry_attempts=self.retry_attempts,
            shutdown_event=shutdown_event,
            token_trace_session=token_trace_session,
            framework_context=framework_context,
        )

        def base_call(params: ModelCallParams) -> ModelResponse | None:
            return self._call_with_retry(params)

        if self.middleware_manager:
            response_payload = self.middleware_manager.wrap_model_call(model_call_params, base_call)
        else:
            response_payload = base_call(model_call_params)

        if response_payload is None:
            return None

        if self.llm_config.debug:
            _log_llm_debug_response(response_payload)

        return response_payload

    def _call_once_sync(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Execute a single LLM call attempt (no retry loop)."""
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        kwargs = dict(params.api_params)

        if self.session_id is not None:
            kwargs.setdefault("user", self.session_id)

        use_dev_role = bool(
            (self.llm_config.extra_params or {}).get("developer_role", False)
            or (self.llm_config.extra_params or {}).get("use_developer_role")
            or (self.llm_config.model and self.llm_config.model.startswith(("o1", "o3", "o4")))
        )
        kwargs["messages"] = serialize_ump_to_openai_chat_payload(
            params.messages,
            tool_image_policy="inject_user_message",
            use_developer_role=use_dev_role,
        )

        client = params.openai_client if params.openai_client is not None else self.openai_client
        response_content = call_llm_with_different_client(
            client,
            self.llm_config,
            kwargs,
            middleware_manager=self.middleware_manager,
            model_call_params=params,
            tracer=self._get_tracer(),
        )

        stop = kwargs.get("stop", [])
        if isinstance(stop, str):
            stop = [stop]
        if stop and response_content.content:
            for s in stop:
                response_content.content = response_content.content.split(s)[0]

        if response_content.has_content() or response_content.has_tool_calls():
            return response_content
        else:
            raw_message_meta = _raw_message_metadata(response_content.raw_message)
            finish_reason = raw_message_meta.get("finish_reason") or raw_message_meta.get("choice_finish_reason")
            logger.error(
                "❌ Empty model response received: finish_reason=%s, role=%s, content_len=%d, tool_calls=%d, usage=%s",
                finish_reason if finish_reason is not None else "unknown",
                response_content.role,
                len(response_content.content or ""),
                len(response_content.tool_calls),
                response_content.usage.to_dict(),
            )
            error_detail = _extract_error_detail(response_content.raw_message)
            raise RuntimeError(f"No response content or tool calls{error_detail}")

    async def _call_once_async(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Execute a single async LLM call attempt (no retry loop)."""
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        kwargs = dict(params.api_params)

        if self.session_id is not None:
            kwargs.setdefault("user", self.session_id)

        use_dev_role = bool(
            (self.llm_config.extra_params or {}).get("developer_role", False)
            or (self.llm_config.extra_params or {}).get("use_developer_role")
            or (self.llm_config.model and self.llm_config.model.startswith(("o1", "o3", "o4")))
        )
        kwargs["messages"] = serialize_ump_to_openai_chat_payload(
            params.messages,
            tool_image_policy="inject_user_message",
            use_developer_role=use_dev_role,
        )

        async_client = self.async_openai_client
        response_content = await call_llm_with_different_client_async(
            async_client,
            self.llm_config,
            kwargs,
            middleware_manager=self.middleware_manager,
            model_call_params=params,
            tracer=self._get_tracer(),
        )

        stop = kwargs.get("stop", [])
        if isinstance(stop, str):
            stop = [stop]
        if stop and response_content.content:
            for s in stop:
                response_content.content = response_content.content.split(s)[0]

        if response_content.has_content() or response_content.has_tool_calls():
            return response_content
        else:
            raw_message_meta = _raw_message_metadata(response_content.raw_message)
            finish_reason = raw_message_meta.get("finish_reason") or raw_message_meta.get("choice_finish_reason")
            logger.error(
                "❌ Empty model response received: finish_reason=%s, role=%s, content_len=%d, tool_calls=%d, usage=%s",
                finish_reason if finish_reason is not None else "unknown",
                response_content.role,
                len(response_content.content or ""),
                len(response_content.tool_calls),
                response_content.usage.to_dict(),
            )
            error_detail = _extract_error_detail(response_content.raw_message)
            raise RuntimeError(f"No response content or tool calls{error_detail}")

    def _call_with_retry(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Call OpenAI client with exponential backoff retry."""
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        backoff = 1
        for i in range(self.retry_attempts):
            try:
                if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
                    return None
                return self._call_once_sync(params)

            except Exception as e:
                if params.shutdown_event and params.shutdown_event.is_set():
                    logger.info("🛑 LLM call interrupted by shutdown_event, skipping retry")
                    return None

                logger.error(
                    f"❌ LLM call failed (attempt {i + 1}/{self.retry_attempts}): {e}",
                    exc_info=True,
                )
                if i == self.retry_attempts - 1:
                    raise e
                capped_backoff = min(backoff, self.retry_backoff_max_seconds)
                if self.on_retry is not None:
                    self.on_retry(i + 1, self.retry_attempts, capped_backoff, str(e))
                time.sleep(capped_backoff)
                backoff = min(backoff * 2, self.retry_backoff_max_seconds)
        return None

    async def call_llm_async(
        self,
        messages: list[Message],
        max_tokens: int | None = None,
        force_stop_reason: Any = None,
        agent_state: AgentState | None = None,
        tool_call_mode: str = "xml",
        tools: Sequence[StructuredToolDefinitionLike] | None = None,
        openai_client: Any | None = None,
        shutdown_event: threading.Event | None = None,
        token_trace_session: TokenTraceSession | None = None,
        framework_context: "FrameworkContext | None" = None,
    ) -> ModelResponse | None:
        """Async version of call_llm."""
        runtime_client = openai_client if openai_client is not None else self.openai_client

        if not runtime_client and not self.middleware_manager:
            raise RuntimeError(
                "OpenAI client is not available. Please check your API configuration.",
            )

        normalized_mode = normalize_tool_call_mode(tool_call_mode)
        use_structured_tools = normalized_mode in STRUCTURED_TOOL_CALL_MODES
        adapted_tools: list[Mapping[str, object]] | None = None
        if use_structured_tools:
            strict_tools = bool((self.llm_config.extra_params or {}).get("strict_tools", False))
            adapted_tools = _adapt_structured_tools_for_provider(
                tools,
                "openai",
                tool_streaming=self.llm_config.tool_streaming,
                strict=strict_tools,
            )

        api_params = self.llm_config.to_openai_params()
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens

        if adapted_tools:
            api_params["tools"] = adapted_tools
            api_params.setdefault("tool_choice", "auto")
            api_params.setdefault("parallel_tool_calls", True)

        if not use_structured_tools:
            xml_stop_sequences = ["</tool_use>", "</use_parallel_tool_calls>"]
            existing_stop = api_params.get("stop", [])
            if isinstance(existing_stop, str):
                existing_stop = [existing_stop]
            elif existing_stop is None:
                existing_stop = []
            api_params["stop"] = existing_stop + xml_stop_sequences

        dropper = getattr(self.llm_config, "apply_param_drops", None)
        if callable(dropper):
            api_params = cast(dict[str, Any], dropper(api_params))

        if self.llm_config.debug:
            _log_llm_debug_request(messages)

        messages = _ensure_tool_results(messages)

        model_call_params = ModelCallParams(
            messages=messages,
            max_tokens=max_tokens,
            force_stop_reason=force_stop_reason,
            agent_state=agent_state,
            tool_call_mode=tool_call_mode,
            tools=tools,
            api_params=api_params,
            openai_client=runtime_client,
            llm_config=self.llm_config,
            retry_attempts=self.retry_attempts,
            shutdown_event=shutdown_event,
            token_trace_session=token_trace_session,
            framework_context=framework_context,
        )

        response_payload: ModelResponse | None
        if self.middleware_manager:
            def _wrapped(params: ModelCallParams) -> ModelResponse | None:
                return self.middleware_manager.wrap_model_call(params, lambda p: self._call_once_sync(p))  # type: ignore[union-attr]

            response_payload = await self._call_with_retry_async(model_call_params, _wrapped)
        else:
            response_payload = await self._call_with_retry_async(model_call_params)

        if response_payload is None:
            return None

        if self.llm_config.debug:
            _log_llm_debug_response(response_payload)

        return response_payload

    async def _call_with_retry_async(
        self,
        params: ModelCallParams,
        sync_call_fn: Any | None = None,
    ) -> ModelResponse | None:
        """Async retry wrapper with asyncio.sleep for backoff."""
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        backoff = 1
        for i in range(self.retry_attempts):
            try:
                if params.shutdown_event and params.shutdown_event.is_set():
                    logger.info("🛑 LLM call interrupted by shutdown_event (async), skipping retry")
                    return None

                if sync_call_fn is not None:
                    return await self._run_sync_in_llm_pool(sync_call_fn, params)

                if self.llm_config.api_type != "openai_chat_completion":
                    raise NotImplementedError(
                        f"Direct {self.llm_config.api_type} calls are disabled. "
                        "MASh routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
                    )

                if self.async_openai_client is not None:
                    return await self._call_once_async_cancellable(params)

                return await self._run_sync_in_llm_pool(self._call_once_sync, params)

            except Exception as e:
                if params.shutdown_event and params.shutdown_event.is_set():
                    logger.info("🛑 LLM call interrupted by shutdown_event (async), skipping retry")
                    return None

                err_str = str(e).lower()
                if "requires more credits" in err_str or "fewer max_tokens" in err_str or "402" in err_str:
                    import re
                    afford_match = re.search(r"can only afford (\d+)", err_str)
                    if afford_match:
                        affordable = max(256, int(afford_match.group(1)) - 50)
                        params.api_params["max_tokens"] = affordable
                        logger.warning(f"⚠️ Token budget clamped to {affordable}")
                    else:
                        current_max = params.api_params.get("max_tokens", 4096)
                        params.api_params["max_tokens"] = max(512, current_max // 2)
                        logger.warning(f"⚠️ Token budget reduced to {params.api_params['max_tokens']}")

                logger.error(
                    f"❌ LLM call failed (attempt {i + 1}/{self.retry_attempts}, async): {e}",
                    exc_info=True,
                )
                if i == self.retry_attempts - 1:
                    raise e
                capped_backoff = min(backoff, self.retry_backoff_max_seconds)
                if self.on_retry is not None:
                    self.on_retry(i + 1, self.retry_attempts, capped_backoff, str(e))
                await asyncio.sleep(capped_backoff)
                backoff = min(backoff * 2, self.retry_backoff_max_seconds)
        return None

    async def _run_sync_in_llm_pool(self, fn: Callable[[ModelCallParams], Any], params: ModelCallParams) -> Any:
        loop = asyncio.get_running_loop()
        ctx = contextvars.copy_context()
        bound_fn = functools.partial(ctx.run, fn, params)
        return await loop.run_in_executor(self._llm_thread_pool, bound_fn)

    def shutdown_thread_pool(self) -> None:
        self._llm_thread_pool.shutdown(wait=False)

    async def _call_once_async_cancellable(self, params: ModelCallParams) -> ModelResponse | None:
        call_task = asyncio.create_task(self._call_once_async(params))
        shutdown_event = params.shutdown_event
        if shutdown_event is None:
            return await call_task

        async def _poll_shutdown() -> None:
            while not shutdown_event.is_set():
                await asyncio.sleep(0.05)

        poll_task = asyncio.create_task(_poll_shutdown())
        done, pending = await asyncio.wait(
            [call_task, poll_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for p in pending:
            p.cancel()
            try:
                await p
            except (asyncio.CancelledError, Exception):
                pass

        if call_task in done:
            return await call_task

        logger.info("🛑 Async LLM call cancelled by shutdown_event")
        return None


def call_llm_with_different_client(
    client: Any,
    llm_config: LLMConfig,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Call LLM with OpenAI format (MASh exclusively routes through OpenAI format)."""
    if llm_config.api_type == "openai_chat_completion":
        return call_llm_with_openai_chat_completion(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    raise NotImplementedError(
        f"Provider api_type='{llm_config.api_type}' is disabled. "
        "MASh routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
    )


async def call_llm_with_different_client_async(
    client: Any,
    llm_config: LLMConfig,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Async dispatcher — routes to OpenAI chat completion async."""
    if llm_config.api_type == "openai_chat_completion":
        return await call_llm_with_openai_chat_completion_async(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    raise NotImplementedError(
        f"Provider api_type='{llm_config.api_type}' is disabled. "
        "MASh routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
    )


def call_llm_with_openai_chat_completion(
    client: openai.OpenAI,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Call OpenAI chat completion with the given messages and return response content."""
    messages = kwargs.get("messages", [])
    for msg in messages:
        if isinstance(msg, dict):
            typed_msg = cast(dict[str, object], msg)
            if typed_msg.get("role") == "assistant" and typed_msg.get("content") == "" and typed_msg.get("tool_calls"):
                del typed_msg["content"]
    kwargs["messages"] = messages
    extra_params = kwargs.pop("extra_params", None)
    if extra_params and isinstance(extra_params, dict):
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body.update(extra_params)
        kwargs["extra_body"] = existing_extra_body
    if "reasoning" in kwargs:
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body["reasoning"] = kwargs.pop("reasoning")
        kwargs["extra_body"] = existing_extra_body
    if "provider" in kwargs:
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body["provider"] = kwargs.pop("provider")
        kwargs["extra_body"] = existing_extra_body
    kwargs.pop("thinkingConfig", None)
    if "extra_body" in kwargs and isinstance(kwargs["extra_body"], dict):
        r = kwargs["extra_body"].get("reasoning")
        if isinstance(r, dict) and "effort" in r and "max_tokens" in r:
            r.pop("max_tokens", None)

    if llm_config:
        req_headers = _build_bifrost_headers(llm_config, model_call_params)
        if req_headers:
            existing_extra_headers = dict(kwargs.get("extra_headers") or {})
            existing_extra_headers.update(req_headers)
            kwargs["extra_headers"] = existing_extra_headers

    stream_requested = bool(kwargs.pop("stream", False) or getattr(llm_config, "stream", False))

    should_trace = tracer is not None and get_current_span() is not None

    if stream_requested:
        def call_llm_stream(payload: dict[str, Any]) -> ModelResponse:
            payload = payload.copy()
            payload.pop("stream", None)
            stream_options = {"include_usage": True}
            payload["stream_options"] = stream_options
            run_id = _resolve_run_id(model_call_params)
            emitter = _get_event_emitter(middleware_manager)
            aggregator = OpenAIChatCompletionAggregator(on_event=emitter, run_id=run_id)

            try:
                if should_trace and tracer is not None:
                    trace_ctx: TraceContext = TraceContext(tracer, "OpenAI chat.completions.create (stream)", SpanType.LLM, inputs=payload)
                    with trace_ctx:
                        start_time = time.time()
                        first_token_time = None
                        stream_ctx: Stream[ChatCompletionChunk] = client.chat.completions.create(
                            stream=True,
                            **payload,
                        )
                        _shutdown_ev = model_call_params.shutdown_event if model_call_params else None
                        with stream_ctx:
                            for chunk in stream_ctx:
                                if _shutdown_ev is not None and _shutdown_ev.is_set():
                                    logger.info("🛑 Shutdown event detected during OpenAI streaming, finalizing partial response")
                                    break
                                if first_token_time is None:
                                    first_token_time = time.time()
                                processed_chunk = _process_stream_chunk(chunk, middleware_manager, model_call_params)
                                if processed_chunk is None:
                                    continue
                                aggregator.aggregate(processed_chunk)
                        completion = aggregator.build()
                        trace_ctx.set_outputs(_to_serializable_dict(completion))
                        if first_token_time is not None:
                            trace_ctx.set_attributes(
                                {
                                    "time_to_first_token_ms": (first_token_time - start_time) * 1000,
                                }
                            )
                        return _chat_completion_to_model_response(completion)

                stream_ctx = client.chat.completions.create(
                    stream=True,
                    **payload,
                )
                _shutdown_ev = model_call_params.shutdown_event if model_call_params else None
                with stream_ctx:
                    for chunk in stream_ctx:
                        if _shutdown_ev is not None and _shutdown_ev.is_set():
                            logger.info("🛑 Shutdown event detected during OpenAI streaming, finalizing partial response")
                            break
                        processed_chunk = _process_stream_chunk(chunk, middleware_manager, model_call_params)
                        if processed_chunk is None:
                            continue
                        aggregator.aggregate(processed_chunk)
                completion = aggregator.build()
                return _chat_completion_to_model_response(completion)

            except Exception as exc:
                wrapped_error = _maybe_wrap_stream_idle_timeout(
                    exc,
                    transport_name="openai chat stream",
                    llm_config=llm_config,
                )
                if wrapped_error is not None:
                    raise wrapped_error from exc
                raise exc

        return call_llm_stream(kwargs)

    try:
        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "OpenAI chat.completions.create", SpanType.LLM, inputs=kwargs)
            with trace_ctx:
                start_time = time.time()
                completion = client.chat.completions.create(**kwargs)
                trace_ctx.set_outputs(_to_serializable_dict(completion))
                trace_ctx.set_attributes({"latency_ms": (time.time() - start_time) * 1000})
                return _chat_completion_to_model_response(completion)

        completion = client.chat.completions.create(**kwargs)
        return _chat_completion_to_model_response(completion)
    except Exception as exc:
        raise exc


async def call_llm_with_openai_chat_completion_async(
    client: openai.AsyncOpenAI,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Async OpenAI chat completion."""
    messages = kwargs.get("messages", [])
    for msg in messages:
        if isinstance(msg, dict):
            typed_msg = cast(dict[str, object], msg)
            if typed_msg.get("role") == "assistant" and typed_msg.get("content") == "" and typed_msg.get("tool_calls"):
                del typed_msg["content"]
    kwargs["messages"] = messages
    extra_params = kwargs.pop("extra_params", None)
    if extra_params and isinstance(extra_params, dict):
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body.update(extra_params)
        kwargs["extra_body"] = existing_extra_body
    if "reasoning" in kwargs:
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body["reasoning"] = kwargs.pop("reasoning")
        kwargs["extra_body"] = existing_extra_body
    if "provider" in kwargs:
        existing_extra_body = dict(kwargs.get("extra_body") or {})
        existing_extra_body["provider"] = kwargs.pop("provider")
        kwargs["extra_body"] = existing_extra_body
    kwargs.pop("thinkingConfig", None)
    if "extra_body" in kwargs and isinstance(kwargs["extra_body"], dict):
        r = kwargs["extra_body"].get("reasoning")
        if isinstance(r, dict) and "effort" in r and "max_tokens" in r:
            r.pop("max_tokens", None)

    if llm_config:
        req_headers = _build_bifrost_headers(llm_config, model_call_params)
        if req_headers:
            existing_extra_headers = dict(kwargs.get("extra_headers") or {})
            existing_extra_headers.update(req_headers)
            kwargs["extra_headers"] = existing_extra_headers

    stream_requested = bool(kwargs.pop("stream", False) or getattr(llm_config, "stream", False))

    should_trace = tracer is not None and get_current_span() is not None

    if stream_requested:
        payload = kwargs.copy()
        payload.pop("stream", None)
        stream_options = {"include_usage": True}
        payload["stream_options"] = stream_options
        run_id = _resolve_run_id(model_call_params)
        emitter = _get_event_emitter(middleware_manager)
        aggregator = OpenAIChatCompletionAggregator(on_event=emitter, run_id=run_id)

        _shutdown_ev = model_call_params.shutdown_event if model_call_params else None

        try:
            if should_trace and tracer is not None:
                trace_ctx = TraceContext(tracer, "OpenAI chat.completions.create (async stream)", SpanType.LLM, inputs=payload)
                with trace_ctx:
                    start_time = time.time()
                    first_token_time = None
                    stream_ctx: AsyncStream[ChatCompletionChunk] = await client.chat.completions.create(
                        stream=True,
                        **payload,
                    )
                    async with stream_ctx:
                        async for chunk in stream_ctx:
                            if _shutdown_ev is not None and _shutdown_ev.is_set():
                                logger.info("🛑 Shutdown event detected during async OpenAI streaming, finalizing partial response")
                                break
                            if first_token_time is None:
                                first_token_time = time.time()
                            processed_chunk = _process_stream_chunk(chunk, middleware_manager, model_call_params)
                            if processed_chunk is None:
                                continue
                            aggregator.aggregate(processed_chunk)
                    completion = aggregator.build()
                    trace_ctx.set_outputs(_to_serializable_dict(completion))
                    if first_token_time is not None:
                        trace_ctx.set_attributes({"time_to_first_token_ms": (first_token_time - start_time) * 1000})
                    return _chat_completion_to_model_response(completion)

            stream_ctx = await client.chat.completions.create(
                stream=True,
                **payload,
            )
            async with stream_ctx:
                async for chunk in stream_ctx:
                    if _shutdown_ev is not None and _shutdown_ev.is_set():
                        logger.info("🛑 Shutdown event detected during async OpenAI streaming, finalizing partial response")
                        break
                    processed_chunk = _process_stream_chunk(chunk, middleware_manager, model_call_params)
                    if processed_chunk is None:
                        continue
                    aggregator.aggregate(processed_chunk)
            completion = aggregator.build()
            return _chat_completion_to_model_response(completion)

        except Exception as exc:
            wrapped_error = _maybe_wrap_stream_idle_timeout(
                exc,
                transport_name="openai chat stream",
                llm_config=llm_config,
            )
            if wrapped_error is not None:
                raise wrapped_error from exc
            raise exc

    try:
        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "OpenAI chat.completions.create (async)", SpanType.LLM, inputs=kwargs)
            with trace_ctx:
                start_time = time.time()
                completion = await client.chat.completions.create(**kwargs)
                trace_ctx.set_outputs(_to_serializable_dict(completion))
                trace_ctx.set_attributes({"latency_ms": (time.time() - start_time) * 1000})
                return _chat_completion_to_model_response(completion)

        completion = await client.chat.completions.create(**kwargs)
        return _chat_completion_to_model_response(completion)
    except Exception as exc:
        raise exc


# ==============================================================================
# ponytail: Legacy provider stubs maintained solely for backwards compatibility with tests.
# All active traffic in MASh exclusively routes through openai_chat_completion.
# ==============================================================================

def call_llm_with_anthropic_chat_completion(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("Direct Anthropic calls removed; MASh only supports openai_chat_completion.")

async def call_llm_with_anthropic_chat_completion_async(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("Direct Anthropic calls removed; MASh only supports openai_chat_completion.")

def call_llm_with_openai_responses(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("OpenAI responses API removed; MASh only supports openai_chat_completion.")

async def call_llm_with_openai_responses_async(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("OpenAI responses API removed; MASh only supports openai_chat_completion.")

def call_llm_with_generate_with_token(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("Generate with token removed; MASh only supports openai_chat_completion.")

def call_llm_with_google_genai(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("Direct Google GenAI SDK calls removed; MASh only supports openai_chat_completion.")

async def call_llm_with_google_genai_async(*args: Any, **kwargs: Any) -> Any:
    raise NotImplementedError("Direct Google GenAI SDK calls removed; MASh only supports openai_chat_completion.")

call_llm_with_gemini_rest = call_llm_with_google_genai
call_llm_with_gemini_rest_async = call_llm_with_google_genai_async

def _apply_anthropic_cache_control(kwargs: dict[str, Any], *args: Any, **extra: Any) -> dict[str, Any]:
    return kwargs

def _strip_thinking_signatures(messages: list[Any]) -> list[Any]:
    return messages

def _is_thinking_signature_error(exc: BaseException) -> bool:
    return False

def _strip_or_raise_on_signature_error(exc: BaseException, messages: list[Any]) -> list[Any]:
    raise exc

def record_thinking_signature_event(layer: str, **fields: Any) -> None:
    pass

def _bound_openai_prompt_cache_key(key: str) -> str:
    return key

def _strip_responses_api_artifacts(messages: list[Any]) -> list[Any]:
    return messages

def _default_openai_responses_parallel_tool_calls(llm_config: Any = None) -> bool:
    return True

def _normalize_token_ids(value: object, *, context: str = "") -> list[int]:
    return []

def _normalize_generate_with_token_finish_reason(value: Any) -> str:
    return "stop"

def _normalize_generate_with_token_usage(payload: dict[str, Any]) -> dict[str, Any]:
    return {}

def convert_tools_to_gemini(tools: Any) -> list[Any]:
    return []

def _enrich_gemini_trace_outputs(*args: Any, **kwargs: Any) -> None:
    pass

def _gemini_sanitize_parameters(params: dict[str, object]) -> dict[str, object]:
    return params
