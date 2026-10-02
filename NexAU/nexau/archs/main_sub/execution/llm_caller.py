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

"""LLM request assembly and provider-boundary adapters.

RFC-0006: structured tool calling  provider 

module,  ``llm_config.api_type``  neutral structured
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
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Literal, cast

if TYPE_CHECKING:
    from nexau.archs.main_sub.framework_context import FrameworkContext

import anthropic
import httpx
import openai
import requests
from openai import AsyncStream, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk

from nexau.archs.llm.llm_aggregators import (
    AnthropicEventAggregator,
    GeminiRestEventAggregator,
    OpenAIChatCompletionAggregator,
    OpenAIResponsesAggregator,
)
from nexau.archs.llm.llm_aggregators.events import Event
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.token_trace_session import TokenTraceSession
from nexau.archs.tool.tool import (
    StructuredToolDefinitionLike,
    normalize_structured_tool_definition,
    structured_tool_definition_to_anthropic,
    structured_tool_definition_to_openai,
)
from nexau.archs.tracer.context import TraceContext, get_current_span
from nexau.archs.tracer.core import BaseTracer, SpanType
from nexau.core.messages import Message, Role, ToolResultBlock, ToolUseBlock
from nexau.core.serializers.openai_chat import serialize_ump_to_openai_chat_payload
from nexau.core.serializers.openai_responses import (
    normalize_openai_responses_api_tools,
    prepare_openai_responses_api_input,
)

from ..agent_state import AgentState
from ..tool_call_modes import (
    STRUCTURED_TOOL_CALL_MODES,
    StructuredProviderTarget,
    normalize_tool_call_mode,
    resolve_structured_provider_target,
)
from .hooks import MiddlewareManager, ModelCallParams
from .model_response import ModelResponse
from .stop_reason import AgentStopReason


def _noop_event_handler(_: Event) -> None:
    return None


def _chat_completion_to_model_response(completion: ChatCompletion) -> ModelResponse:
    """Bridge Set A's ``ChatCompletion`` ``build()`` output to ``ModelResponse``.

    ``ModelResponse.from_openai_message`` expects a single message
    (``ChatCompletionMessage``) plus an optional usage dict - that was the
    natural shape Set B's ``finalize()`` produced. Set A's ``build()``
    returns the full ``ChatCompletion`` (with ``.choices`` and
    ``.usage``); extract the first choice's message and pass usage
    separately so the adapter sees what it expects.
    """
    message = completion.choices[0].message if completion.choices else None
    usage = _to_serializable_dict(completion.usage) if completion.usage is not None else None
    return ModelResponse.from_openai_message(message, usage=usage)


def _resolve_run_id(model_call_params: ModelCallParams | None) -> str:
    """Best-effort run_id for stream aggregator instances.

    RFC-0023 § ③ - Set A aggregators tag emitted events with ``run_id``.
    Production calls always have an ``agent_state`` carrying the live id;
    test scaffolding sometimes calls ``llm_caller`` without one, so fall
    back to a literal placeholder rather than crashing.
    """
    if model_call_params is None or model_call_params.agent_state is None:
        return "stream"
    return model_call_params.agent_state.run_id


def _get_event_emitter(manager: MiddlewareManager | None) -> Callable[[Event], None]:
    """Resolve the unified event emitter from the middleware chain.

    RFC-0023 § ③ - Set A aggregators now live inside ``llm_caller`` (one
    instance per stream call). They need an ``on_event`` sink so the AG-UI
    events they emit reach the user's streaming callback. The sink is owned
    by ``AgentEventsMiddleware`` (via its ``on_event`` instance attribute);
    we walk the middleware chain to fetch it. When no middleware provides
    one (eg. unit tests, scripts), fall back to a no-op so the aggregator
    can still drive ``build()``.
    """
    if manager is None:
        return _noop_event_handler
    for mw in manager.middlewares:
        handler = mw.get_event_handler()
        if handler is not None:
            return cast(Callable[[Event], None], handler)
    return _noop_event_handler


logger = logging.getLogger(__name__)

_MISSING_TOOL_RESULT_CONTENT = "no tool result (canceled, compacted or failed)"
_OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64

# idle timeoutexception, /API error, retry
OnRetryCallback = Callable[[int, int, float, str], None]
"""(attempt, max_attempts, backoff_seconds, error_message) → None"""


def _bound_openai_prompt_cache_key(key: str) -> str:
    """Bound a Responses prompt cache key without changing canonical session identity."""
    if len(key) <= _OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH:
        return key
    return hashlib.sha256(key.encode()).hexdigest()


def _log_llm_debug_request(messages: Sequence[Message]) -> None:
    logger.info("🐛 [DEBUG] LLM Request Messages:")
    for i, msg in enumerate(messages):
        logger.info(
            f"🐛 [DEBUG] Message {i}: {msg.role.value} -> {msg.get_text_content()}",
        )


def _log_llm_debug_response(model_response: ModelResponse) -> None:
    logger.info(f"🐛 [DEBUG] LLM Response: {model_response.render_text()}")


# Layer 4: catch `400 Invalid signature in thinking block` (legacy rows
# whose signature is non-empty but invalid - corrupted / model-version
# stale / cross-gateway), strip all ReasoningBlock signatures, retry once.
# Layer 3's default unsigned-thinking-drop branch then handles the
# stripped messages naturally. See commit f8e6faa5 / PR #554 for the
# full bug story.


_THINKING_SIGNATURE_ERROR_MARKERS = (
    "invalid `signature` in `thinking`",
    "invalid signature in thinking",
    'invalid "signature" in "thinking"',
)


def record_thinking_signature_event(layer: str, **fields: Any) -> None:
    """Tier-1+2 observability for the orphan-thinking-signature defense.

    Emits a structured log line AND attaches counters + context fields to
    the currently-active trace span (if any). Each defense layer (L1
    write-boundary coerce / L3 outbound drop / L4 400-retry) calls this
    when its branch fires, so production has a queryable trail:

      - Log aggregation (Loki / ELK): grep for ``thinking_signature.layer1``
        to count occurrences by model / agent / time.
      - Langfuse traces: filter by attribute
        ``thinking_signature.layerN`` to see the full conversation that
        triggered it.

    Safe to call when no tracer is active (span attrs become a no-op).
    """
    logger.warning("thinking_signature.%s", layer, extra={"orphan_thinking_event": True, **fields})
    span = get_current_span()
    if span is None:
        return
    key = f"thinking_signature.{layer}"
    span.attributes[key] = int(span.attributes.get(key, 0)) + 1
    for k, v in fields.items():
        span.attributes[f"{key}.{k}"] = v


def _is_thinking_signature_error(exc: BaseException) -> bool:
    """True iff `exc` is Anthropic's `400 Invalid signature in thinking block`.

    The status-extraction logic duplicates `llm_failover._extract_status_code`
    by a few lines, but that helper is module-private (pyright forbids the
    cross-module use). Promoting it to a shared module is a refactor for
    another PR.
    """
    if not isinstance(exc, anthropic.APIStatusError) or exc.status_code != 400:
        return False
    blob_lower = (str(getattr(exc, "message", "") or "") + " " + str(exc)).lower()
    return any(marker in blob_lower for marker in _THINKING_SIGNATURE_ERROR_MARKERS)


def _strip_or_raise_on_signature_error(
    exc: BaseException,
    params: "ModelCallParams | None",
    label: str,
) -> "ModelCallParams":
    """If `exc` is the Anthropic invalid-signature 400, log + return
    `params` with all ReasoningBlock signatures stripped (ready for
    one-shot retry). Otherwise re-raise so unrelated errors propagate.

    Called from inside an `except anthropic.APIStatusError` block of each
    of the 4 Anthropic call paths (sync × async × stream × non-stream).
    """
    if not _is_thinking_signature_error(exc):
        raise exc
    assert params is not None, "Layer 4 retry requires a ModelCallParams"
    record_thinking_signature_event(
        "layer4_retry",
        path=label,
        error_message=str(getattr(exc, "message", "") or "")[:200],
        run_id=getattr(params.agent_state, "run_id", None) if params.agent_state else None,
    )
    return replace(params, messages=_strip_thinking_signatures(params.messages))


def _strip_thinking_signatures(messages: list[Message]) -> list[Message]:
    """Return a shallow-cloned UMP history with every ReasoningBlock's
    signature cleared to None.

    Used by Layer 4's retry path: after Anthropic rejects a request with
    "Invalid signature in thinking block", we don't know which block has
    the bad signature, so we clear them all. The existing serializer
    (Layer 3) then drops the now-unsigned reasoning blocks via its default
    branch - no new parameter through the adapter/serializer chain.
    """
    from nexau.core.messages import ReasoningBlock

    out: list[Message] = []
    for msg in messages:
        new_content: list[Any] = []
        for block in msg.content:
            if isinstance(block, ReasoningBlock) and block.signature is not None:
                new_content.append(block.model_copy(update={"signature": None}))
            else:
                new_content.append(block)
        out.append(msg.model_copy(update={"content": new_content}))
    return out


class StreamIdleTimeoutError(Exception):
    """Raised when no stream chunk is received within the configured idle timeout.

     Codex  "idle timeout waiting for SSE/websocket" . 
     (per-chunk) timeout, timeout,  LLM 
    timeout, "". 
    """


def _get_stream_idle_timeout_seconds(llm_config: LLMConfig | None) -> float:
    """Return resolved stream idle timeout in seconds."""
    if llm_config is None:
        return LLMConfig.DEFAULT_STREAM_IDLE_TIMEOUT_MS / 1000.0
    return llm_config.get_stream_idle_timeout()


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


def _normalize_token_ids(value: object, *, context: str) -> list[int]:
    """Normalize token ids to a list of ints."""
    if not isinstance(value, list):
        raise ValueError(f"{context} must be a list of integers")

    token_ids: list[int] = []
    for item in cast(list[object], value):
        try:
            token_ids.append(int(cast(int | str, item)))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{context} contains a non-integer token: {item!r}") from exc
    return token_ids


def _compact_scalar(value: Any, *, max_chars: int = 256) -> str:
    text = str(value)
    if len(text) <= max_chars:
        return text
    return f"{text[:max_chars]}...(truncated {len(text) - max_chars} chars)"


def _extract_error_detail(payload: object) -> str:
    """Extract error detail string from a raw LLM response payload.

    Returns a string like `` (error_type: message)`` or empty string.
    """
    if isinstance(payload, Mapping):
        payload_mapping = cast(Mapping[str, object], payload)
        err = payload_mapping.get("error")
        if isinstance(err, Mapping):
            err_mapping = cast(Mapping[str, object], err)
            err_type = str(err_mapping.get("type", "unknown"))
            err_msg = str(err_mapping.get("message") or "")
            return f" ({err_type}: {err_msg})"
        if payload_mapping.get("type") == "error":
            return f" (raw: {payload})"
    return ""


def _raw_message_metadata(payload: Any) -> dict[str, Any]:
    metadata: dict[str, Any] = {"raw_type": type(payload).__name__}
    if payload is None:
        return metadata

    safe_fields = ("id", "model", "object", "role", "finish_reason", "stop_reason", "status")

    if isinstance(payload, Mapping):
        payload_mapping = cast(Mapping[str, Any], payload)
        for field in safe_fields:
            value = payload_mapping.get(field)
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                metadata[field] = _compact_scalar(value)
        choices_raw = payload_mapping.get("choices")
        if isinstance(choices_raw, list):
            choices_list = cast(list[Any], choices_raw)
            metadata["choices_count"] = len(choices_list)
            if choices_list and isinstance(choices_list[0], Mapping):
                first_choice_mapping = cast(Mapping[str, Any], choices_list[0])
                choice_finish_reason = first_choice_mapping.get("finish_reason")
                if choice_finish_reason is not None:
                    metadata["choice_finish_reason"] = _compact_scalar(choice_finish_reason)
        return metadata

    for field in safe_fields:
        value = getattr(payload, field, None)
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            metadata[field] = _compact_scalar(value)

    choices_raw = getattr(payload, "choices", None)
    if isinstance(choices_raw, list):
        choices_list = cast(list[Any], choices_raw)
        metadata["choices_count"] = len(choices_list)
        if choices_list:
            first_choice = choices_list[0]
            if isinstance(first_choice, Mapping):
                choice_finish_reason = cast(Mapping[str, Any], first_choice).get("finish_reason")
            else:
                choice_finish_reason = getattr(first_choice, "finish_reason", None)
            if choice_finish_reason is not None:
                metadata["choice_finish_reason"] = _compact_scalar(choice_finish_reason)

    return metadata


def _ensure_tool_results(messages: list[Message]) -> list[Message]:
    """Ensure every ToolUseBlock has a matching ToolResultBlock.

    When a tool execution is interrupted (canceled, compacted, or failed),
    the next LLM call will error with "No tool output found for function call".
    This function detects orphaned tool calls and injects synthetic tool result
    messages so the conversation remains valid.
    """
    # 1. tool_use id,
    tool_use_ids: dict[str, int] = {}
    tool_use_names: dict[str, str] = {}
    for idx, msg in enumerate(messages):
        if msg.role == Role.ASSISTANT:
            for block in msg.content:
                if isinstance(block, ToolUseBlock):
                    tool_use_ids[block.id] = idx
                    tool_use_names[block.id] = block.name

    if not tool_use_ids:
        return messages

    # 2. tool_result tool_use_id
    # ( tool_call_id UUID, "tool_call" -> "tool_call_a45a...")
    matched_tool_use_ids: set[str] = set()
    for msg in messages:
        if msg.role == Role.TOOL:
            for block in msg.content:
                if isinstance(block, ToolResultBlock):
                    result_id = block.tool_use_id
                    if result_id in tool_use_ids:
                        matched_tool_use_ids.add(result_id)
                    else:
                        # : tool_use_id ToolUseBlock.id
                        for use_id in tool_use_ids:
                            if result_id.startswith(use_id):
                                matched_tool_use_ids.add(use_id)
                                break

    # 3. tool_use_id
    missing_ids = set(tool_use_ids.keys()) - matched_tool_use_ids
    if not missing_ids:
        return messages

    logger.warning(
        "🔧 Found %d tool call(s) without results, injecting synthetic tool results: %s",
        len(missing_ids),
        missing_ids,
    )

    # 4. assistant
    missing_by_index: dict[int, list[str]] = {}
    for tid in missing_ids:
        assistant_idx = tool_use_ids[tid]
        missing_by_index.setdefault(assistant_idx, []).append(tid)

    # 5. list, assistant
    result: list[Message] = []
    for idx, msg in enumerate(messages):
        result.append(msg)
        if idx in missing_by_index:
            for tid in missing_by_index[idx]:
                result.append(
                    Message(
                        role=Role.TOOL,
                        content=[
                            ToolResultBlock(
                                tool_use_id=tid,
                                content=_MISSING_TOOL_RESULT_CONTENT,
                                is_error=True,
                            )
                        ],
                        # , Gemini REST (functionResponse name)
                        metadata={"tool_name": tool_use_names.get(tid, "")},
                    )
                )

    return result


class LLMCaller:
    """Handles LLM API calls with retry logic."""

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
        """Initialize LLM caller.

        Args:
            openai_client: OpenAI/Anthropic sync client instance
            llm_config: LLM configuration
            retry_attempts: Number of retry attempts for API calls
            retry_backoff_max_seconds:  (), default 30s. 
                 slot . 
            on_retry: retry,  ``OnRetryCallback``. 
                 UI 「retry N ...」. 
            middleware_manager: Optional middleware manager for wrapping calls
            global_storage: Optional global storage to retrieve tracer at call time
            session_id: Optional session ID injected into provider payloads
                (OpenAI ``user``, Anthropic ``metadata.user_id``; Gemini skipped)
            async_openai_client: AsyncOpenAI/AsyncAnthropic client for native async calls.
                When provided, ``_call_with_retry_async`` uses direct ``await``
                instead of ``to_thread`` bridging.
        """
        self.openai_client = openai_client
        self.async_openai_client = async_openai_client
        self.llm_config = llm_config
        self.retry_attempts = retry_attempts
        self.retry_backoff_max_seconds = retry_backoff_max_seconds
        self.on_retry = on_retry
        self.middleware_manager = middleware_manager
        self.global_storage = global_storage
        self.session_id = session_id

        # RFC-0001: sync LLM SDK, event loop default executor
        # force stop shutdown(wait=False), event loop
        self._llm_thread_pool: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix="llm-call",
        )

    def _get_tracer(self) -> BaseTracer | None:
        """Get tracer from global storage at call time."""
        if self.global_storage is not None:
            return self.global_storage.get("tracer")
        return None

    def call_llm(
        self,
        messages: list[Message],
        max_tokens: int | None = None,
        force_stop_reason: AgentStopReason | None = None,
        agent_state: AgentState | None = None,
        tool_call_mode: str = "xml",
        tools: Sequence[StructuredToolDefinitionLike] | None = None,
        openai_client: Any | None = None,
        shutdown_event: threading.Event | None = None,
        token_trace_session: TokenTraceSession | None = None,
        framework_context: "FrameworkContext | None" = None,
    ) -> ModelResponse | None:
        """Call LLM with the given messages and return normalized response.

        RFC-0006: structured tool calling  provider 

        Args:
            messages: List of conversation messages
            max_tokens: Maximum tokens for the response
            tool_call_mode: Tool calling strategy ('xml' or 'structured')
            tools: Optional neutral structured tool definitions

        Returns:
            A normalized ModelResponse object containing content and tool calls

        Raises:
            RuntimeError: If OpenAI client is not available or API call fails
        """
        runtime_client = openai_client if openai_client is not None else self.openai_client

        if not runtime_client and not self.middleware_manager and self.llm_config.api_type != "gemini_rest":
            raise RuntimeError(
                "OpenAI client is not available. Please check your API configuration.",
            )

        normalized_mode = normalize_tool_call_mode(tool_call_mode)
        use_structured_tools = normalized_mode in STRUCTURED_TOOL_CALL_MODES
        structured_provider_target: StructuredProviderTarget | None = None
        adapted_tools: list[Mapping[str, object]] | None = None
        if use_structured_tools:
            # 1. RFC-0006: structured provider api_type .
            structured_provider_target = resolve_structured_provider_target(self.llm_config.api_type)

            strict_tools = bool((self.llm_config.extra_params or {}).get("strict_tools", False))
            adapted_tools = _adapt_structured_tools_for_provider(
                tools,
                structured_provider_target,
                tool_streaming=self.llm_config.tool_streaming,
                strict=strict_tools,
            )

        # Prepare API parameters
        api_params = self.llm_config.to_openai_params()

        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens

        if adapted_tools and structured_provider_target == "anthropic":
            api_params["tools"] = adapted_tools
            api_params.setdefault("tool_choice", {"type": "auto"})

        if adapted_tools and structured_provider_target == "openai":
            api_params["tools"] = adapted_tools
            api_params.setdefault("tool_choice", "auto")
            api_params.setdefault("parallel_tool_calls", True)

        if adapted_tools and structured_provider_target == "gemini":
            api_params["tools"] = adapted_tools

        # Add XML stop sequences to prevent malformed XML
        if not use_structured_tools:
            xml_stop_sequences = [
                "</tool_use>",
                "</use_parallel_tool_calls>",
            ]

            # Merge with existing stop sequences if any
            existing_stop = api_params.get("stop", [])
            if isinstance(existing_stop, str):
                existing_stop = [existing_stop]
            elif existing_stop is None:
                existing_stop = []

            api_params["stop"] = existing_stop + xml_stop_sequences

        # Drop any params the config marks as incompatible
        dropper = getattr(self.llm_config, "apply_param_drops", None)
        if callable(dropper):
            api_params = cast(dict[str, Any], dropper(api_params))

        # Debug logging for LLM messages
        if self.llm_config.debug:
            _log_llm_debug_request(messages)

        logger.info(f"🧠 Calling LLM with {max_tokens} max tokens...")

        # Ensure all tool calls have corresponding tool results to avoid
        # "No tool output found for function call" errors after interruptions.
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

        model_response = response_payload

        if model_response.content:
            from ..utils.xml_utils import XMLUtils

            model_response.content = XMLUtils.restore_closing_tags(model_response.content)

        # Debug logging for LLM response
        if self.llm_config.debug:
            _log_llm_debug_response(model_response)

        return model_response

    def _call_once_sync(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Execute a single LLM call attempt (no retry loop).

        P2 async/sync : _call_with_retry_async 

         _call_with_retry, retry. 
         _call_with_retry_async  asyncio.to_thread, 
         async retry retry. 

        package: session_id, message, tracer . 
        """
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        kwargs = dict(params.api_params)

        # session_id → provider-specific user tracking field
        if self.session_id is not None:
            if self.llm_config.api_type == "openai_chat_completion":
                kwargs.setdefault("user", self.session_id)
            elif self.llm_config.api_type == "openai_responses":
                kwargs.setdefault("safety_identifier", self.session_id)
                kwargs.setdefault("prompt_cache_key", self.session_id)
            elif self.llm_config.api_type == "anthropic_chat_completion":
                existing_metadata: dict[str, str] = kwargs.get("metadata") or {}
                existing_metadata.setdefault("user_id", self.session_id)
                kwargs["metadata"] = existing_metadata

        tool_image_policy: Literal["inject_user_message", "embed_in_tool_message"] = "inject_user_message"
        if self.llm_config.api_type in {"openai_chat_completion", "openai_responses"}:
            tool_image_policy = "embed_in_tool_message" if self.llm_config.api_type == "openai_responses" else "inject_user_message"
        if self.llm_config.api_type != "generate_with_token":
            use_dev_role = bool(
                getattr(self.llm_config, "use_developer_role", False)
                or (self.llm_config.extra_params or {}).get("use_developer_role")
                or (self.llm_config.model and self.llm_config.model.startswith(("o1", "o3", "o4")))
            )
            kwargs["messages"] = serialize_ump_to_openai_chat_payload(
                params.messages,
                tool_image_policy=tool_image_policy,
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
            raise RuntimeError("No response content or tool calls from LLM")

    async def _call_once_async(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Execute a single async LLM call attempt (no retry loop).

        async/sync:  AsyncOpenAI / AsyncAnthropic  await, 
         to_thread . force stop  asyncio cancellation . 

        package: session_id, message, tracer . 
        """
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason
        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            return None

        kwargs = dict(params.api_params)

        # session_id → provider-specific user tracking field
        if self.session_id is not None:
            if self.llm_config.api_type == "openai_chat_completion":
                kwargs.setdefault("user", self.session_id)
            elif self.llm_config.api_type == "openai_responses":
                kwargs.setdefault("safety_identifier", self.session_id)
                kwargs.setdefault("prompt_cache_key", self.session_id)
            elif self.llm_config.api_type == "anthropic_chat_completion":
                existing_metadata: dict[str, str] = kwargs.get("metadata") or {}
                existing_metadata.setdefault("user_id", self.session_id)
                kwargs["metadata"] = existing_metadata

        tool_image_policy: Literal["inject_user_message", "embed_in_tool_message"] = "inject_user_message"
        if self.llm_config.api_type in {"openai_chat_completion", "openai_responses"}:
            tool_image_policy = "embed_in_tool_message" if self.llm_config.api_type == "openai_responses" else "inject_user_message"
        if self.llm_config.api_type != "generate_with_token":
            use_dev_role = bool(
                getattr(self.llm_config, "use_developer_role", False)
                or (self.llm_config.extra_params or {}).get("use_developer_role")
                or (self.llm_config.model and self.llm_config.model.startswith(("o1", "o3", "o4")))
            )
            kwargs["messages"] = serialize_ump_to_openai_chat_payload(
                params.messages,
                tool_image_policy=tool_image_policy,
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
            raise RuntimeError("No response content or tool calls from LLM")

    def _call_with_retry(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Call OpenAI client with exponential backoff retry."""
        from .executor import AgentStopReason

        force_stop_reason = params.force_stop_reason

        if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
            reason_name = getattr(force_stop_reason, "name", str(force_stop_reason))
            logger.info(
                f"🛑 LLM call forced to stop due to {reason_name}",
            )
            return None

        backoff = 1
        for i in range(self.retry_attempts):
            try:
                if force_stop_reason and force_stop_reason != AgentStopReason.SUCCESS:
                    return None
                kwargs = dict(params.api_params)

                # session_id → provider-specific user tracking field
                if self.session_id is not None:
                    if self.llm_config.api_type == "openai_chat_completion":
                        kwargs.setdefault("user", self.session_id)
                    elif self.llm_config.api_type == "openai_responses":
                        # 'user' is deprecated and some backends actively reject it.
                        # Only use its official replacements: safety_identifier + prompt_cache_key.
                        kwargs.setdefault("safety_identifier", self.session_id)
                        kwargs.setdefault("prompt_cache_key", self.session_id)
                    elif self.llm_config.api_type == "anthropic_chat_completion":
                        existing_metadata: dict[str, str] = kwargs.get("metadata") or {}
                        existing_metadata.setdefault("user_id", self.session_id)
                        kwargs["metadata"] = existing_metadata

                logger.debug(
                    "🔍 [HISTORY-DEBUG] LLM call: %d Message objects, roles=%s",
                    len(params.messages),
                    [m.role.value for m in params.messages],
                )
                tool_image_policy: Literal["inject_user_message", "embed_in_tool_message"] = "inject_user_message"
                if self.llm_config.api_type in {"openai_chat_completion", "openai_responses"}:
                    tool_image_policy = "embed_in_tool_message" if self.llm_config.api_type == "openai_responses" else "inject_user_message"
                if self.llm_config.api_type != "generate_with_token":
                    kwargs["messages"] = serialize_ump_to_openai_chat_payload(params.messages, tool_image_policy=tool_image_policy)
                    logger.debug(
                        "🔍 [HISTORY-DEBUG] After legacy conversion: %d dicts, roles=%s",
                        len(kwargs["messages"]),
                        [m.get("role") for m in kwargs["messages"]],
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
                    logger.error("❌ Empty model raw_message_meta=%s", raw_message_meta)
                    # Extract error details from raw response if available
                    error_detail = _extract_error_detail(response_content.raw_message)
                    raise RuntimeError(f"No response content or tool calls{error_detail}")

            except Exception as e:
                # RFC-0001: shutdown_event retry, None
                # execute stop_signal
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
        force_stop_reason: AgentStopReason | None = None,
        agent_state: AgentState | None = None,
        tool_call_mode: str = "xml",
        tools: Sequence[StructuredToolDefinitionLike] | None = None,
        openai_client: Any | None = None,
        shutdown_event: threading.Event | None = None,
        token_trace_session: TokenTraceSession | None = None,
        framework_context: "FrameworkContext | None" = None,
    ) -> ModelResponse | None:
        """Async version of call_llm.

        P2 async/sync :  LLM 

         asyncio.sleep  time.sleep retry, 
        Gemini REST  httpx.AsyncClient  HTTP, 
         provider (OpenAI/Anthropic)  asyncio.to_thread  sync SDK. 
        """
        # call_llm
        runtime_client = openai_client if openai_client is not None else self.openai_client

        if not runtime_client and not self.middleware_manager and self.llm_config.api_type != "gemini_rest":
            raise RuntimeError(
                "OpenAI client is not available. Please check your API configuration.",
            )

        normalized_mode = normalize_tool_call_mode(tool_call_mode)
        use_structured_tools = normalized_mode in STRUCTURED_TOOL_CALL_MODES
        adapted_tools: list[Mapping[str, object]] | None = None
        if use_structured_tools:
            structured_provider_target = resolve_structured_provider_target(self.llm_config.api_type)
            adapted_tools = _adapt_structured_tools_for_provider(
                tools,
                structured_provider_target,
                tool_streaming=self.llm_config.tool_streaming,
            )

        api_params = self.llm_config.to_openai_params()
        if max_tokens is not None:
            api_params["max_tokens"] = max_tokens

        if use_structured_tools:
            sp_target = resolve_structured_provider_target(self.llm_config.api_type)
            if adapted_tools and sp_target == "anthropic":
                api_params["tools"] = adapted_tools
                api_params.setdefault("tool_choice", {"type": "auto"})
            elif adapted_tools and sp_target == "openai":
                api_params["tools"] = adapted_tools
                api_params.setdefault("tool_choice", "auto")
            elif adapted_tools and sp_target == "gemini":
                api_params["tools"] = adapted_tools

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

        # async retry wrapper
        response_payload: ModelResponse | None
        if self.middleware_manager:
            # Middleware wrapping sync ( to_thread )
            # _call_once_sync _call_with_retry, retry
            def _wrapped(params: ModelCallParams) -> ModelResponse | None:
                return self.middleware_manager.wrap_model_call(params, lambda p: self._call_once_sync(p))  # type: ignore[union-attr]

            response_payload = await self._call_with_retry_async(model_call_params, _wrapped)
        else:
            response_payload = await self._call_with_retry_async(model_call_params)

        if response_payload is None:
            return None

        if response_payload.content:
            from ..utils.xml_utils import XMLUtils

            response_payload.content = XMLUtils.restore_closing_tags(response_payload.content)

        if self.llm_config.debug:
            _log_llm_debug_response(response_payload)

        return response_payload

    async def _call_with_retry_async(
        self,
        params: ModelCallParams,
        sync_call_fn: Any | None = None,
    ) -> ModelResponse | None:
        """Async retry wrapper with asyncio.sleep for backoff.

        async/sync :  async SDK  + asyncio.sleep 

        - Gemini REST: httpx.AsyncClient 
        - OpenAI / Anthropic ( middleware): AsyncOpenAI / AsyncAnthropic
           await, asyncio cancellation 
        - Middleware-wrapped: sync hook  _llm_thread_pool, 
          cleanup()  shutdown(wait=False) 

:  Gemini provider,  _call_once_sync() (), 
         _call_with_retry() (retry),  retry_attempts² 
        retry tracing span. 
        """
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
                    # Middleware-wrapped path: sync hook
                    # _llm_thread_pool default executor
                    # force stop event loop shutdown
                    return await self._run_sync_in_llm_pool(sync_call_fn, params)

                # Gemini / Google GenAI: disabled in favor of OpenAI-compatible Cloud API gateway
                if self.llm_config.api_type in ("gemini_rest", "google_genai"):
                    raise NotImplementedError(
                        "Direct Google GenAI SDK and Gemini REST calls are disabled. "
                        "Mash routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
                    )

                # OpenAI / Anthropic: async SDK, await
                # shutdown_event cancel: stop event
                # cancel await LLM
                if self.async_openai_client is not None:
                    return await self._call_once_async_cancellable(params)

                # Fallback: async client
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
                        logger.warning(f"⚠️ OpenRouter token budget clamped to {affordable} to fit balance on {params.api_params.get('model')}")
                    else:
                        current_max = params.api_params.get("max_tokens", 4096)
                        params.api_params["max_tokens"] = max(512, current_max // 2)
                        logger.warning(f"⚠️ OpenRouter token budget reduced to {params.api_params['max_tokens']}")
                elif "training violation" in err_str or "settings/privacy" in err_str:
                    logger.warning("⚠️ OpenRouter privacy restriction on model; falling back to google/gemini-2.0-flash-exp:free...")
                    params.api_params["model"] = "google/gemini-2.0-flash-exp:free"
                    if "extra_body" in params.api_params and isinstance(params.api_params["extra_body"], dict):
                        params.api_params["extra_body"].pop("provider", None)

                logger.error(
                    f"❌ LLM call failed (attempt {i + 1}/{self.retry_attempts}, async): {e}",
                    exc_info=True,
                )
                if i == self.retry_attempts - 1:
                    raise e
                capped_backoff = min(backoff, self.retry_backoff_max_seconds)
                err_str = str(e)
                if "in_flight_budget_exhausted" in err_str or "Retry after in-flight requests settle" in err_str or "Retry-After" in err_str:
                    capped_backoff = max(capped_backoff, 15.0)
                if self.on_retry is not None:
                    self.on_retry(i + 1, self.retry_attempts, capped_backoff, str(e))
                await asyncio.sleep(capped_backoff)
                backoff = min(backoff * 2, self.retry_backoff_max_seconds)
        return None

    async def _run_sync_in_llm_pool(
        self,
        func: Any,
        *args: Any,
    ) -> ModelResponse | None:
        """Run a sync function in the dedicated LLM thread pool.

        RFC-0001:  asyncio.to_thread 

         asyncio.to_thread  ( contextvars ), 
         _llm_thread_pool  event loop  default executor, 
         force stop  cleanup()  shutdown(wait=False) . 
        """
        loop = asyncio.get_running_loop()
        ctx = contextvars.copy_context()
        func_call = functools.partial(ctx.run, func, *args)
        return await loop.run_in_executor(self._llm_thread_pool, func_call)

    def shutdown_thread_pool(self) -> None:
        """Shut down the dedicated LLM thread pool without waiting.

        Called by Executor.cleanup() during force stop to release
        middleware-path worker threads immediately.
        """
        self._llm_thread_pool.shutdown(wait=False, cancel_futures=True)

    async def _call_once_async_cancellable(
        self,
        params: ModelCallParams,
    ) -> ModelResponse | None:
        """Run _call_once_async but cancel if shutdown_event is set.

        async/sync:  async LLM  graceful stop cancel. 
        stop()  shutdown_event, method cancel  await  HTTP, 
         execute_async, asyncio.gather . 
        """
        shutdown_ev = params.shutdown_event
        if shutdown_ev is not None and shutdown_ev.is_set():
            return None

        llm_task = asyncio.ensure_future(self._call_once_async(params))

        if shutdown_ev is None:
            return await llm_task

        # shutdown_event ( to_thread default executor )
        async def _poll_shutdown() -> None:
            while not shutdown_ev.is_set():
                await asyncio.sleep(0.1)

        shutdown_task = asyncio.ensure_future(_poll_shutdown())

        done, pending = await asyncio.wait(
            {llm_task, shutdown_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for p in pending:
            p.cancel()
            try:
                await p
            except asyncio.CancelledError:
                pass

        if llm_task in done:
            return llm_task.result()

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
    """Call LLM with the given messages and return response content."""
    if llm_config.api_type == "anthropic_chat_completion":
        return call_llm_with_anthropic_chat_completion(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
            cache_control_ttl=llm_config.cache_control_ttl,
        )
    elif llm_config.api_type == "openai_responses":
        return call_llm_with_openai_responses(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    elif llm_config.api_type == "openai_chat_completion":
        return call_llm_with_openai_chat_completion(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    elif llm_config.api_type in ("gemini_rest", "google_genai"):
        raise NotImplementedError(
            "Direct Google GenAI SDK and Gemini REST calls are disabled. "
            "Mash routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
        )
    elif llm_config.api_type == "generate_with_token":
        return call_llm_with_generate_with_token(
            client,
            kwargs,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    else:
        raise ValueError(f"Invalid API type: {llm_config.api_type}")


def _safe_int(value: Any) -> int:
    """Best-effort integer coercion for provider usage metadata."""
    try:
        return int(cast(int | str, value))
    except (TypeError, ValueError):
        return 0


def _normalize_generate_with_token_finish_reason(finish_reason: Any) -> str | None:
    """Normalize finish reasons from generate-with-token responses."""
    if finish_reason is None:
        return None

    if isinstance(finish_reason, Mapping):
        finish_reason_mapping = cast(Mapping[str, Any], finish_reason)
        finish_type = finish_reason_mapping.get("type")
        if finish_type is not None:
            return str(finish_type)
        return json.dumps(dict(finish_reason_mapping), ensure_ascii=False)

    return str(finish_reason)


def _get_generate_with_token_meta_info(response_payload: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return `meta_info` mapping from generate-with-token responses when available."""
    meta_info_raw = response_payload.get("meta_info")
    if isinstance(meta_info_raw, Mapping):
        return cast(Mapping[str, Any], meta_info_raw)
    return {}


def _extract_generate_with_token_message(response_payload: dict[str, Any]) -> tuple[dict[str, Any], Any]:
    """Extract an assistant message from either OpenAI-like or raw token payloads."""
    choices_payload = response_payload.get("choices")
    if isinstance(choices_payload, list) and choices_payload:
        choices_list = cast(list[object], choices_payload)
        first_choice_raw = choices_list[0]
        if not isinstance(first_choice_raw, Mapping):
            raise ValueError("generate_with_token response choice must be a mapping")
        choice_mapping = cast(Mapping[str, Any], first_choice_raw)
        choice_message_payload = choice_mapping.get("message")
        if not isinstance(choice_message_payload, Mapping):
            raise ValueError("generate_with_token response missing assistant message")
        return dict(cast(Mapping[str, Any], choice_message_payload)), choice_mapping.get("finish_reason")

    fallback_message_payload: dict[str, Any] = {
        "role": "assistant",
        "content": response_payload.get("text"),
    }
    tool_calls_raw = response_payload.get("tool_calls")
    if isinstance(tool_calls_raw, list):
        fallback_message_payload["tool_calls"] = list(cast(list[object], tool_calls_raw))

    finish_reason_raw = response_payload.get("finish_reason")
    if finish_reason_raw is None:
        finish_reason_raw = _get_generate_with_token_meta_info(response_payload).get("finish_reason")
    return fallback_message_payload, finish_reason_raw


def _extract_generate_with_token_nexrl_train(
    response_payload: dict[str, Any],
    *,
    request_tokens: list[int],
) -> dict[str, Any]:
    """Extract or synthesize NexRL train metadata from generate-with-token responses."""
    nexrl_train_payload = response_payload.get("nexrl_train")
    if isinstance(nexrl_train_payload, Mapping):
        return dict(cast(Mapping[str, Any], nexrl_train_payload))

    output_token_ids = _normalize_token_ids(
        response_payload.get("output_token_ids", response_payload.get("output_ids", [])),
        context="generate_with_token output token ids",
    )
    meta_info = _get_generate_with_token_meta_info(response_payload)
    response_logprobs: list[float] = []
    output_token_logprobs = meta_info.get("output_token_logprobs")
    if isinstance(output_token_logprobs, list):
        for entry in cast(list[object], output_token_logprobs):
            if isinstance(entry, (list, tuple)) and entry:
                entry_items = cast(Sequence[object], entry)
                first_logprob = entry_items[0]
                if isinstance(first_logprob, (int, float)):
                    response_logprobs.append(float(first_logprob))
            elif isinstance(entry, (int, float)):
                response_logprobs.append(float(entry))

    return {
        "prompt_tokens": list(request_tokens),
        "response_tokens": output_token_ids,
        "response_logprobs": response_logprobs,
    }


def _normalize_generate_with_token_usage(response_payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize token usage from generate-with-token responses."""
    usage_payload = response_payload.get("usage")
    if isinstance(usage_payload, Mapping):
        usage_dict: dict[str, Any] = dict(cast(Mapping[str, Any], usage_payload))
    else:
        usage_dict = {}

    meta_info = dict(_get_generate_with_token_meta_info(response_payload))
    nexrl_train_payload = response_payload.get("nexrl_train")
    nexrl_train = dict(cast(Mapping[str, Any], nexrl_train_payload)) if isinstance(nexrl_train_payload, Mapping) else {}

    prompt_tokens = _safe_int(
        usage_dict.get(
            "prompt_tokens",
            usage_dict.get(
                "input_tokens",
                meta_info.get("prompt_tokens", len(cast(list[Any], nexrl_train.get("prompt_tokens", [])))),
            ),
        )
    )
    completion_tokens = _safe_int(
        usage_dict.get(
            "completion_tokens",
            usage_dict.get(
                "output_tokens",
                meta_info.get("completion_tokens", len(cast(list[Any], nexrl_train.get("response_tokens", [])))),
            ),
        )
    )

    if prompt_tokens > 0 or "prompt_tokens" in usage_dict or "input_tokens" in usage_dict or "prompt_tokens" in nexrl_train:
        usage_dict.setdefault("prompt_tokens", prompt_tokens)
        usage_dict.setdefault("input_tokens", prompt_tokens)

    if completion_tokens > 0 or "completion_tokens" in usage_dict or "output_tokens" in usage_dict or "response_tokens" in nexrl_train:
        usage_dict.setdefault("completion_tokens", completion_tokens)

    if "total_tokens" not in usage_dict and (prompt_tokens or completion_tokens):
        usage_dict["total_tokens"] = prompt_tokens + completion_tokens

    cached_tokens = _safe_int(usage_dict.get("cached_tokens", meta_info.get("cached_tokens")))
    if cached_tokens > 0 or "cached_tokens" in usage_dict or "cached_tokens" in meta_info:
        usage_dict.setdefault("cached_tokens", cached_tokens)

    finish_reason_raw = response_payload.get("finish_reason", meta_info.get("finish_reason"))
    if finish_reason_raw is None:
        choices_payload = response_payload.get("choices")
        if isinstance(choices_payload, list) and choices_payload:
            choices_list = cast(list[object], choices_payload)
            first_choice_raw = choices_list[0]
            if isinstance(first_choice_raw, Mapping):
                finish_reason_raw = cast(Mapping[str, Any], first_choice_raw).get("finish_reason")
    finish_reason = _normalize_generate_with_token_finish_reason(finish_reason_raw)
    if finish_reason is not None:
        usage_dict["finish_reason"] = finish_reason
        if isinstance(finish_reason_raw, Mapping):
            usage_dict["finish_reason_details"] = dict(cast(Mapping[str, Any], finish_reason_raw))

    return usage_dict


def call_llm_with_generate_with_token(
    client: Any,
    kwargs: dict[str, Any],
    *,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Call a client-backed token generate API and normalize the response."""
    if llm_config is None:
        raise ValueError("llm_config is required for generate_with_token call")
    if model_call_params is None or model_call_params.token_trace_session is None:
        raise ValueError("token_trace_session is required for generate_with_token call")
    if client is None:
        raise ValueError("client is required for generate_with_token call")

    token_trace_session = model_call_params.token_trace_session
    token_trace_session.sync_external_messages(model_call_params.messages)

    request_tokens = list(token_trace_session.token_ids)
    request_payload = kwargs.copy()
    request_payload.pop("messages", None)
    stream_requested = bool(request_payload.pop("stream", False) or getattr(llm_config, "stream", False))
    if stream_requested:
        logger.warning("Streaming is not supported for generate_with_token; falling back to non-stream mode")

    def _invoke_generate() -> dict[str, Any]:
        request_kwargs = token_trace_session.build_generate_with_token_kwargs(
            max_output_tokens=cast(int | None, request_payload.pop("max_tokens", None)),
            request_params=request_payload,
        )
        if model_call_params.tools is not None:
            request_kwargs["tools"] = [
                structured_tool_definition_to_openai(tool) for tool in cast(list[dict[str, Any]], model_call_params.tools)
            ]
        response_payload = client.generate_with_token(**request_kwargs)
        if not isinstance(response_payload, Mapping):
            raise ValueError("generate_with_token response must be a mapping")
        return dict(cast(Mapping[str, Any], response_payload))

    if tracer is not None and get_current_span() is not None:
        trace_ctx = TraceContext(
            tracer,
            "generate_with_token",
            SpanType.LLM,
            inputs={
                "model": llm_config.model,
                "input_token_count": len(request_tokens),
            },
        )
        with trace_ctx:
            response_payload = _invoke_generate()
            trace_ctx.set_outputs(response_payload)
    else:
        response_payload = _invoke_generate()

    message_payload, finish_reason_raw = _extract_generate_with_token_message(response_payload)
    nexrl_train = _extract_generate_with_token_nexrl_train(
        response_payload,
        request_tokens=request_tokens,
    )

    normalized_output_token_ids = _normalize_token_ids(
        nexrl_train.get("response_tokens", []),
        context="generate_with_token nexrl_train.response_tokens",
    )

    usage_dict = _normalize_generate_with_token_usage(response_payload)
    if "finish_reason" not in usage_dict:
        finish_reason = _normalize_generate_with_token_finish_reason(finish_reason_raw)
        if finish_reason is not None:
            usage_dict["finish_reason"] = finish_reason
            if isinstance(finish_reason_raw, Mapping):
                usage_dict["finish_reason_details"] = dict(cast(Mapping[str, Any], finish_reason_raw))
    model_response = ModelResponse.from_openai_message(
        message_payload,
        usage=usage_dict,
    )
    model_response.raw_message = response_payload
    model_response.output_token_ids = normalized_output_token_ids

    output_text = model_response.content
    if output_text is None and normalized_output_token_ids:
        model_response.content = token_trace_session.detokenize(normalized_output_token_ids)
        output_text = model_response.content

    token_trace_session.record_round(
        request_tokens=request_tokens,
        response_tokens=normalized_output_token_ids,
        response_text=output_text,
        tool_calls=[call.to_openai_dict() for call in model_response.tool_calls],
        usage=usage_dict,
    )

    return model_response


def _adapt_structured_tools_for_provider(
    tools: Sequence[StructuredToolDefinitionLike] | None,
    provider_target: StructuredProviderTarget,
    *,
    tool_streaming: bool = True,
    strict: bool = False,
) -> list[Mapping[str, object]] | None:
    """Adapt neutral structured tools for the selected provider.

    RFC-0006: Provider 

     neutral / compatibility definition, 
    provider  schema; Gemini  neutral definition  adapter. 

    Parameters
    ----------
    tool_streaming:
        Forwarded to :func:`structured_tool_definition_to_anthropic`.  When
        *False*, ``eager_input_streaming`` is omitted from the Anthropic tool
        schema so that providers rejecting unknown fields are not affected.
    strict:
        When *True*, enforce OpenAI Structured Outputs schema constraints (strict: true).
    """

    if not tools:
        return None

    adapted_tools: list[Mapping[str, object]] = []
    for tool in tools:
        normalized = normalize_structured_tool_definition(tool)
        if provider_target == "openai":
            adapted_tools.append(structured_tool_definition_to_openai(normalized, strict=strict))
        elif provider_target == "anthropic":
            adapted_tools.append(structured_tool_definition_to_anthropic(normalized, tool_streaming=tool_streaming))
        elif provider_target == "gemini":
            adapted_tools.append(normalized)
        else:  # pragma: no cover - guarded by provider target resolution
            raise ValueError(f"Unsupported structured provider target: {provider_target}")

    return adapted_tools


def _strip_responses_api_artifacts(messages: list[Any]) -> list[Any]:
    """Remove Responses API-only artifacts from generic chat messages."""

    sanitized: list[Any] = []

    for message in messages or []:
        if not isinstance(message, Mapping):
            sanitized.append(message)
            continue

        message_mapping = cast(Mapping[str, Any], message)
        cleaned: dict[str, Any] = dict(message_mapping)
        cleaned.pop("response_items", None)
        cleaned.pop("reasoning", None)
        sanitized.append(cleaned)

    return sanitized


# Anthropic rejects requests carrying more than four ``cache_control``
# breakpoints with a 400 error. We allocate them prefix-first (system blocks
# before the trailing user block) so the largest stable prefix stays cached.
_MAX_CACHE_CONTROL_BREAKPOINTS = 4


def _apply_anthropic_cache_control(
    system_messages: list[dict[str, Any]],
    user_messages: list[dict[str, Any]],
    build_cache_control: Callable[[], dict[str, str]],
) -> None:
    """Apply Anthropic ``cache_control`` to system and user message blocks.

    System blocks carry a ``_cache`` flag from ``SystemPromptBlock``
    configuration; when absent the default is to cache. The total number of
    breakpoints is clamped to :data:`_MAX_CACHE_CONTROL_BREAKPOINTS` because
    Anthropic returns a 400 error when a request exceeds four. Breakpoints are
    assigned prefix-first so the longest stable prefix remains cacheable.
    """
    remaining = _MAX_CACHE_CONTROL_BREAKPOINTS

    for sys_block in system_messages:
        should_cache = sys_block.pop("_cache", True)
        if should_cache and remaining > 0:
            sys_block["cache_control"] = build_cache_control()
            remaining -= 1

    if remaining > 0 and user_messages and user_messages[-1].get("content"):
        content = cast(list[dict[str, Any]] | str | None, user_messages[-1].get("content"))
        if isinstance(content, list) and content:
            # RFC-0014: thinking/redacted_thinking blocks cache_control
            no_cache_types = {"thinking", "redacted_thinking"}
            for block in content:
                if block.get("type") not in no_cache_types:
                    block["cache_control"] = build_cache_control()
                    break


def call_llm_with_anthropic_chat_completion(
    client: Any,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
    cache_control_ttl: str | None = None,
) -> ModelResponse:
    """Call Anthropic chat completion with the given messages and return response content."""
    stream_requested = bool(kwargs.pop("stream", False))

    # Check if tracing is active (there's a current span and we have a tracer)
    should_trace = tracer is not None and get_current_span() is not None

    def _build_cache_control() -> dict[str, str]:
        cc: dict[str, str] = {"type": "ephemeral"}
        if cache_control_ttl:
            cc["ttl"] = cache_control_ttl
        return cc

    def _apply_cache_control(
        system_messages: list[dict[str, Any]],
        user_messages: list[dict[str, Any]],
    ) -> None:
        _apply_anthropic_cache_control(system_messages, user_messages, _build_cache_control)

    def _build_anthropic_messages() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if type(model_call_params) is not ModelCallParams:
            raise ValueError("Anthropic calls require explicit ModelCallParams with UMP messages")

        from nexau.core.adapters.anthropic_messages import AnthropicMessagesAdapter

        return AnthropicMessagesAdapter(
            allow_unsigned_thinking=bool(llm_config and llm_config.allow_unsigned_thinking),
        ).to_vendor_format(model_call_params.messages)

    def llm_call() -> Any:
        # Anthropic
        system_messages, user_messages = _build_anthropic_messages()
        _apply_cache_control(system_messages, user_messages)

        new_kwargs = kwargs.copy()
        new_kwargs.pop("messages", None)
        new_kwargs.pop("anthropic_cache_control_ttl", None)

        # Build the exact kwargs for tracing
        api_kwargs: dict[str, Any] = {"system": system_messages, "messages": user_messages, **new_kwargs}

        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "Anthropic messages.create", SpanType.LLM, inputs=api_kwargs)
            with trace_ctx:
                resp = client.messages.create(**api_kwargs)
                trace_ctx.set_outputs(_to_serializable_dict(resp))
                return resp
        else:
            resp = client.messages.create(**api_kwargs)
            return resp

    if not stream_requested:
        try:
            response = llm_call()
        except anthropic.APIStatusError as exc:
            model_call_params = _strip_or_raise_on_signature_error(exc, model_call_params, "non-stream")
            response = llm_call()
        return ModelResponse.from_anthropic_message(response)

    def llm_stream_call() -> ModelResponse:
        system_messages, user_messages = _build_anthropic_messages()
        _apply_cache_control(system_messages, user_messages)

        new_kwargs: dict[str, Any] = kwargs.copy()
        new_kwargs.pop("messages", None)
        new_kwargs.pop("anthropic_cache_control_ttl", None)

        # Build the exact kwargs for tracing
        api_kwargs: dict[str, Any] = {"system": system_messages, "messages": user_messages, **new_kwargs}

        # RFC-0023 § ③ - Set A is the single canonical aggregator. It
        # emits AG-UI events through ``emitter`` (the middleware's on_event
        # sink) and yields a typed ``AnthropicMessage`` via ``build``.
        run_id = _resolve_run_id(model_call_params)
        emitter = _get_event_emitter(middleware_manager)
        aggregator = AnthropicEventAggregator(on_event=emitter, run_id=run_id)

        try:
            if should_trace and tracer is not None:
                trace_ctx = TraceContext(tracer, "Anthropic messages.stream", SpanType.LLM, inputs=api_kwargs)
                with trace_ctx:
                    start_time = time.time()
                    first_token_time = None
                    # RFC-0001: shutdown_event
                    _shutdown_ev = model_call_params.shutdown_event if model_call_params else None
                    with client.messages.create(**api_kwargs, stream=True) as stream:
                        for event in stream:
                            if _shutdown_ev is not None and _shutdown_ev.is_set():
                                logger.info("🛑 Shutdown event detected during Anthropic streaming, finalizing partial response")
                                break
                            if first_token_time is None:
                                first_token_time = time.time()
                            processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                            if processed_event is None:
                                continue
                            aggregator.aggregate(processed_event)
                    message = aggregator.build()
                    trace_ctx.set_outputs(_to_serializable_dict(message))
                    if first_token_time is not None:
                        trace_ctx.set_attributes(
                            {
                                "time_to_first_token_ms": (first_token_time - start_time) * 1000,
                            }
                        )
                    return ModelResponse.from_anthropic_message(message)

            # RFC-0001: shutdown_event
            _shutdown_ev = model_call_params.shutdown_event if model_call_params else None
            with client.messages.create(**api_kwargs, stream=True) as stream:
                for event in stream:
                    if _shutdown_ev is not None and _shutdown_ev.is_set():
                        logger.info("🛑 Shutdown event detected during Anthropic streaming, finalizing partial response")
                        break
                    processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                    if processed_event is None:
                        continue
                    aggregator.aggregate(processed_event)
            return ModelResponse.from_anthropic_message(aggregator.build())
        except Exception as exc:
            wrapped_error = _maybe_wrap_stream_idle_timeout(
                exc,
                transport_name="anthropic stream",
                llm_config=llm_config,
            )
            if wrapped_error is not None:
                raise wrapped_error from exc
            raise

    try:
        return llm_stream_call()
    except anthropic.APIStatusError as exc:
        model_call_params = _strip_or_raise_on_signature_error(exc, model_call_params, "stream")
        return llm_stream_call()


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

    messages = _strip_responses_api_artifacts(kwargs.get("messages", []))
    # Some providers (eg. AWS Bedrock) reject assistant messages where content is an empty string.
    # Only strip content from assistant messages with tool_calls, where content is optional.
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
    stream_requested = bool(kwargs.pop("stream", False) or getattr(llm_config, "stream", False))

    # Check if tracing is active (there's a current span and we have a tracer)
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
                        # RFC-0001: shutdown_event
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
                # RFC-0001: shutdown_event
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
                return _chat_completion_to_model_response(aggregator.build())
            except Exception as exc:
                wrapped_error = _maybe_wrap_stream_idle_timeout(
                    exc,
                    transport_name="openai chat stream",
                    llm_config=llm_config,
                )
                if wrapped_error is not None:
                    raise wrapped_error from exc
                raise

        return call_llm_stream(kwargs)

    def _ensure_chat_completion(payload: object) -> ChatCompletion:
        if isinstance(payload, ChatCompletion):
            return payload

        # Allow duck-typed mocks in unit tests while still guarding against
        # obviously invalid payloads.
        if hasattr(payload, "choices"):
            return cast(ChatCompletion, payload)

        raise TypeError("Unexpected OpenAI response type")

    def _invoke_chat_completion(api_kwargs: dict[str, Any]) -> ChatCompletion:
        unvalidated_result: object = cast(object, client.chat.completions.create(**api_kwargs))
        return _ensure_chat_completion(unvalidated_result)

    def call_llm(api_kwargs: dict[str, Any]) -> ChatCompletion:
        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "OpenAI chat.completions.create", SpanType.LLM, inputs=api_kwargs)
            with trace_ctx:
                chat_response = _invoke_chat_completion(api_kwargs)
                trace_ctx.set_outputs(_to_serializable_dict(chat_response))
                return chat_response

        return _invoke_chat_completion(api_kwargs)

    response_payload: ChatCompletion = call_llm(kwargs)
    response_message: Any = response_payload.choices[0].message

    # Extract usage information from response
    usage = None
    if hasattr(response_payload, "usage") and response_payload.usage is not None:
        usage = _to_serializable_dict(response_payload.usage)
    return ModelResponse.from_openai_message(response_message, usage=usage)


def call_llm_with_openai_responses(
    client: Any,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Call OpenAI Responses API and normalize the outcome."""

    request_payload = kwargs.copy()

    messages = request_payload.pop("messages", None)
    if messages is not None:
        response_items, instructions = prepare_openai_responses_api_input(messages)
        if response_items:
            request_payload.setdefault("input", response_items)
        if instructions:
            existing_instructions = request_payload.get("instructions")
            if existing_instructions:
                combined_instructions = f"{existing_instructions.rstrip()}\n\n{instructions}"
            else:
                combined_instructions = instructions
            request_payload["instructions"] = combined_instructions.strip()

    # Responses API uses max_output_tokens instead of max_tokens
    max_tokens = request_payload.pop("max_tokens", None)
    if max_tokens is not None:
        request_payload.setdefault("max_output_tokens", max_tokens)

    tools = request_payload.get("tools")
    if tools:
        request_payload["tools"] = normalize_openai_responses_api_tools(tools)

    stream_requested = bool(request_payload.pop("stream", False) or getattr(llm_config, "stream", False))

    request_payload.pop("store", None)

    # default parallel_tool_calls; LLMConfig.extra_kwargs, configuration.
    request_payload.setdefault("parallel_tool_calls", _default_openai_responses_parallel_tool_calls(llm_config))

    # default detailed reasoning summary, reasoning item package.
    # summary, "detailed".
    reasoning_param = request_payload.get("reasoning")
    if isinstance(reasoning_param, dict) and "summary" not in reasoning_param:
        reasoning_param["summary"] = "detailed"

    # Always request encrypted reasoning content so that reasoning items can be
    # passed back in subsequent conversation turns (required for stateless / ZDR mode).
    include_value = request_payload.get("include")
    include_list: list[str] = []
    if isinstance(include_value, (list, tuple)):
        include_items = cast(list[object] | tuple[object, ...], include_value)
        include_list = [item for item in include_items if isinstance(item, str)]
    request_payload["include"] = include_list
    if "reasoning.encrypted_content" not in include_list:
        include_list.append("reasoning.encrypted_content")

    # ( prompt_cache_key) extra_body
    # OpenAI SDK v2+ kwargs.
    extra_body: dict[str, Any] = request_payload.pop("extra_body", None) or {}
    prompt_cache_key = request_payload.pop("prompt_cache_key", None)
    if prompt_cache_key is not None:
        extra_body["prompt_cache_key"] = prompt_cache_key
    final_prompt_cache_key = extra_body.get("prompt_cache_key")
    if isinstance(final_prompt_cache_key, str):
        extra_body["prompt_cache_key"] = _bound_openai_prompt_cache_key(final_prompt_cache_key)
    if extra_body:
        request_payload["extra_body"] = extra_body

    # Check if tracing is active (there's a current span and we have a tracer)
    should_trace = tracer is not None and get_current_span() is not None

    def call_llm(api_payload: dict[str, Any]) -> Any:
        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "OpenAI responses.create", SpanType.LLM, inputs=api_payload)
            with trace_ctx:
                response = client.responses.create(**api_payload)
                trace_ctx.set_outputs(_to_serializable_dict(response))
                return response
        else:
            response = client.responses.create(**api_payload)
            return response

    if not stream_requested:
        return ModelResponse.from_openai_response(call_llm(request_payload))

    def call_llm_stream(payload: dict[str, Any]) -> ModelResponse:
        run_id = _resolve_run_id(model_call_params)
        emitter = _get_event_emitter(middleware_manager)
        aggregator = OpenAIResponsesAggregator(on_event=emitter, run_id=run_id)
        # RFC-0001: shutdown_event
        _shutdown_ev = model_call_params.shutdown_event if model_call_params else None

        try:
            if should_trace and tracer is not None:
                trace_ctx = TraceContext(tracer, "OpenAI responses.stream", SpanType.LLM, inputs=payload)
                start_time = time.time()
                first_token_time = None
                with trace_ctx:
                    with client.responses.stream(**payload) as stream:
                        for event in stream:
                            if _shutdown_ev is not None and _shutdown_ev.is_set():
                                logger.info("🛑 Shutdown event detected during OpenAI Responses streaming, finalizing partial response")
                                break
                            if first_token_time is None:
                                first_token_time = time.time()
                            processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                            if processed_event is None:
                                continue
                            aggregator.aggregate(processed_event)
                    response = aggregator.build()
                    trace_ctx.set_outputs(_to_serializable_dict(response))
                    if first_token_time is not None:
                        trace_ctx.set_attributes(
                            {
                                "time_to_first_token_ms": (first_token_time - start_time) * 1000,
                            }
                        )
                    return ModelResponse.from_openai_response(response)

            with client.responses.stream(**payload) as stream:
                for event in stream:
                    if _shutdown_ev is not None and _shutdown_ev.is_set():
                        logger.info("🛑 Shutdown event detected during OpenAI Responses streaming, finalizing partial response")
                        break
                    processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                    if processed_event is None:
                        continue
                    aggregator.aggregate(processed_event)
            return ModelResponse.from_openai_response(aggregator.build())
        except Exception as exc:
            wrapped_error = _maybe_wrap_stream_idle_timeout(
                exc,
                transport_name="openai responses stream",
                llm_config=llm_config,
            )
            if wrapped_error is not None:
                raise wrapped_error from exc
            raise

    return call_llm_stream(request_payload)


# ── Async LLM call functions ────────────────────────────────────────
# async/sync: AsyncOpenAI / AsyncAnthropic / httpx.AsyncClient
# async, to_thread .
# force stop asyncio cancellation, .


async def call_llm_with_different_client_async(
    client: Any,
    llm_config: LLMConfig,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Async dispatcher — routes to the correct async provider function."""
    if llm_config.api_type == "anthropic_chat_completion":
        return await call_llm_with_anthropic_chat_completion_async(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
            cache_control_ttl=llm_config.cache_control_ttl,
        )
    elif llm_config.api_type == "openai_responses":
        return await call_llm_with_openai_responses_async(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    elif llm_config.api_type == "openai_chat_completion":
        return await call_llm_with_openai_chat_completion_async(
            client,
            kwargs,
            middleware_manager=middleware_manager,
            model_call_params=model_call_params,
            llm_config=llm_config,
            tracer=tracer,
        )
    elif llm_config.api_type in ("gemini_rest", "google_genai"):
        raise NotImplementedError(
            "Direct Google GenAI SDK and Gemini REST calls are disabled. "
            "Mash routes all models through the OpenAI-compatible Cloud API gateway (api_type='openai_chat_completion')."
        )
    else:
        raise ValueError(f"Invalid API type for async call: {llm_config.api_type}")


async def call_llm_with_openai_chat_completion_async(
    client: openai.AsyncOpenAI,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Async OpenAI chat completion — mirrors sync version with await."""

    messages = _strip_responses_api_artifacts(kwargs.get("messages", []))
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
    kwargs.pop("thinkingConfig", None)
    if "extra_body" in kwargs and isinstance(kwargs["extra_body"], dict):
        r = kwargs["extra_body"].get("reasoning")
        if isinstance(r, dict) and "effort" in r and "max_tokens" in r:
            r.pop("max_tokens", None)
    stream_requested = bool(kwargs.pop("stream", False) or getattr(llm_config, "stream", False))

    should_trace = tracer is not None and get_current_span() is not None

    if stream_requested:
        # 1.
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
                                logger.info("🛑 Shutdown event detected during async OpenAI streaming")
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
            else:
                stream_ctx = await client.chat.completions.create(stream=True, **payload)
                async with stream_ctx:
                    async for chunk in stream_ctx:
                        if _shutdown_ev is not None and _shutdown_ev.is_set():
                            logger.info("🛑 Shutdown event detected during async OpenAI streaming")
                            break
                        processed_chunk = _process_stream_chunk(chunk, middleware_manager, model_call_params)
                        if processed_chunk is None:
                            continue
                        aggregator.aggregate(processed_chunk)
                completion = aggregator.build()
        except Exception as exc:
            wrapped_error = _maybe_wrap_stream_idle_timeout(
                exc,
                transport_name="openai chat stream",
                llm_config=llm_config,
            )
            if wrapped_error is not None:
                raise wrapped_error from exc
            raise

        return _chat_completion_to_model_response(completion)

    # 2.
    async def _invoke(api_kwargs: dict[str, Any]) -> ChatCompletion:
        return cast(ChatCompletion, await client.chat.completions.create(**api_kwargs))

    if should_trace and tracer is not None:
        trace_ctx_nr = TraceContext(tracer, "OpenAI chat.completions.create (async)", SpanType.LLM, inputs=kwargs)
        with trace_ctx_nr:
            chat_response = await _invoke(kwargs)
            trace_ctx_nr.set_outputs(_to_serializable_dict(chat_response))
    else:
        chat_response = await _invoke(kwargs)

    response_message: Any = chat_response.choices[0].message
    usage = None
    if chat_response.usage is not None:
        usage = _to_serializable_dict(chat_response.usage)
    return ModelResponse.from_openai_message(response_message, usage=usage)


async def call_llm_with_anthropic_chat_completion_async(
    client: Any,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
    cache_control_ttl: str | None = None,
) -> ModelResponse:
    """Async Anthropic chat completion — mirrors sync version with await."""
    stream_requested = bool(kwargs.pop("stream", False))
    should_trace = tracer is not None and get_current_span() is not None

    def _build_cache_control() -> dict[str, str]:
        cc: dict[str, str] = {"type": "ephemeral"}
        if cache_control_ttl:
            cc["ttl"] = cache_control_ttl
        return cc

    def _apply_cache_control(
        system_messages: list[dict[str, Any]],
        user_messages: list[dict[str, Any]],
    ) -> None:
        _apply_anthropic_cache_control(system_messages, user_messages, _build_cache_control)

    def _build_anthropic_messages() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if type(model_call_params) is not ModelCallParams:
            raise ValueError("Anthropic calls require explicit ModelCallParams with UMP messages")

        from nexau.core.adapters.anthropic_messages import AnthropicMessagesAdapter

        return AnthropicMessagesAdapter(
            allow_unsigned_thinking=bool(llm_config and llm_config.allow_unsigned_thinking),
        ).to_vendor_format(model_call_params.messages)

    def _build_api_kwargs() -> dict[str, Any]:
        # 1. ( sync )
        system_messages, user_messages = _build_anthropic_messages()
        _apply_cache_control(system_messages, user_messages)

        new_kwargs = kwargs.copy()
        new_kwargs.pop("messages", None)
        new_kwargs.pop("anthropic_cache_control_ttl", None)
        return {"system": system_messages, "messages": user_messages, **new_kwargs}

    if not stream_requested:
        # 2.
        async def _invoke_non_stream() -> Any:
            api_kwargs_local = _build_api_kwargs()
            if should_trace and tracer is not None:
                trace_ctx = TraceContext(tracer, "Anthropic messages.create (async)", SpanType.LLM, inputs=api_kwargs_local)
                with trace_ctx:
                    resp_local = await client.messages.create(**api_kwargs_local)
                    trace_ctx.set_outputs(_to_serializable_dict(resp_local))
                    return resp_local
            return await client.messages.create(**api_kwargs_local)

        try:
            resp = await _invoke_non_stream()
        except anthropic.APIStatusError as exc:
            model_call_params = _strip_or_raise_on_signature_error(exc, model_call_params, "async non-stream")
            resp = await _invoke_non_stream()
        return ModelResponse.from_anthropic_message(resp)

    # 3.
    async def _invoke_stream() -> Any:
        api_kwargs_local = _build_api_kwargs()
        run_id = _resolve_run_id(model_call_params)
        emitter = _get_event_emitter(middleware_manager)
        aggregator = AnthropicEventAggregator(on_event=emitter, run_id=run_id)
        _shutdown_ev = model_call_params.shutdown_event if model_call_params else None

        if should_trace and tracer is not None:
            trace_ctx_s = TraceContext(tracer, "Anthropic messages.stream (async)", SpanType.LLM, inputs=api_kwargs_local)
            with trace_ctx_s:
                start_time = time.time()
                first_token_time = None
                async with client.messages.stream(**api_kwargs_local) as stream:
                    async for event in stream:
                        if _shutdown_ev is not None and _shutdown_ev.is_set():
                            logger.info("🛑 Shutdown event detected during async Anthropic streaming")
                            break
                        if first_token_time is None:
                            first_token_time = time.time()
                        processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                        if processed_event is None:
                            continue
                        aggregator.aggregate(processed_event)
                msg_local = aggregator.build()
                trace_ctx_s.set_outputs(_to_serializable_dict(msg_local))
                if first_token_time is not None:
                    trace_ctx_s.set_attributes({"time_to_first_token_ms": (first_token_time - start_time) * 1000})
                return msg_local
        else:
            async with client.messages.stream(**api_kwargs_local) as stream:
                async for event in stream:
                    if _shutdown_ev is not None and _shutdown_ev.is_set():
                        logger.info("🛑 Shutdown event detected during async Anthropic streaming")
                        break
                    processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                    if processed_event is None:
                        continue
                    aggregator.aggregate(processed_event)
            return aggregator.build()

    try:
        try:
            message = await _invoke_stream()
        except anthropic.APIStatusError as exc:
            model_call_params = _strip_or_raise_on_signature_error(exc, model_call_params, "async stream")
            message = await _invoke_stream()
    except Exception as exc:
        wrapped_error = _maybe_wrap_stream_idle_timeout(
            exc,
            transport_name="anthropic stream",
            llm_config=llm_config,
        )
        if wrapped_error is not None:
            raise wrapped_error from exc
        raise

    return ModelResponse.from_anthropic_message(message)


async def call_llm_with_openai_responses_async(
    client: Any,
    kwargs: dict[str, Any],
    *,
    middleware_manager: MiddlewareManager | None = None,
    model_call_params: ModelCallParams | None = None,
    llm_config: LLMConfig | None = None,
    tracer: BaseTracer | None = None,
) -> ModelResponse:
    """Async OpenAI Responses API — mirrors sync version with await."""

    request_payload = kwargs.copy()

    messages = request_payload.pop("messages", None)
    if messages is not None:
        response_items, instructions = prepare_openai_responses_api_input(messages)
        if response_items:
            request_payload.setdefault("input", response_items)
        if instructions:
            existing_instructions = request_payload.get("instructions")
            if existing_instructions:
                combined_instructions = f"{existing_instructions.rstrip()}\n\n{instructions}"
            else:
                combined_instructions = instructions
            request_payload["instructions"] = combined_instructions.strip()

    max_tokens = request_payload.pop("max_tokens", None)
    if max_tokens is not None:
        request_payload.setdefault("max_output_tokens", max_tokens)

    tools = request_payload.get("tools")
    if tools:
        request_payload["tools"] = normalize_openai_responses_api_tools(tools)

    stream_requested = bool(request_payload.pop("stream", False) or getattr(llm_config, "stream", False))

    request_payload.pop("store", None)

    # default parallel_tool_calls; LLMConfig.extra_kwargs, configuration.
    request_payload.setdefault("parallel_tool_calls", _default_openai_responses_parallel_tool_calls(llm_config))

    # default detailed reasoning summary, reasoning item package.
    reasoning_param = request_payload.get("reasoning")
    if isinstance(reasoning_param, dict) and "summary" not in reasoning_param:
        reasoning_param["summary"] = "detailed"

    include_value = request_payload.get("include")
    include_list: list[str] = []
    if isinstance(include_value, (list, tuple)):
        include_items = cast(list[object] | tuple[object, ...], include_value)
        include_list = [item for item in include_items if isinstance(item, str)]
    request_payload["include"] = include_list
    if "reasoning.encrypted_content" not in include_list:
        include_list.append("reasoning.encrypted_content")

    extra_body: dict[str, Any] = request_payload.pop("extra_body", None) or {}
    prompt_cache_key = request_payload.pop("prompt_cache_key", None)
    if prompt_cache_key is not None:
        extra_body["prompt_cache_key"] = prompt_cache_key
    final_prompt_cache_key = extra_body.get("prompt_cache_key")
    if isinstance(final_prompt_cache_key, str):
        extra_body["prompt_cache_key"] = _bound_openai_prompt_cache_key(final_prompt_cache_key)
    if extra_body:
        request_payload["extra_body"] = extra_body

    should_trace = tracer is not None and get_current_span() is not None

    if not stream_requested:
        if should_trace and tracer is not None:
            trace_ctx = TraceContext(tracer, "OpenAI responses.create (async)", SpanType.LLM, inputs=request_payload)
            with trace_ctx:
                response = await client.responses.create(**request_payload)
                trace_ctx.set_outputs(_to_serializable_dict(response))
        else:
            response = await client.responses.create(**request_payload)
        return ModelResponse.from_openai_response(response)

    run_id = _resolve_run_id(model_call_params)
    emitter = _get_event_emitter(middleware_manager)
    aggregator = OpenAIResponsesAggregator(on_event=emitter, run_id=run_id)
    _shutdown_ev = model_call_params.shutdown_event if model_call_params else None

    try:
        if should_trace and tracer is not None:
            trace_ctx_s = TraceContext(tracer, "OpenAI responses.stream (async)", SpanType.LLM, inputs=request_payload)
            start_time = time.time()
            first_token_time = None
            with trace_ctx_s:
                async with client.responses.stream(**request_payload) as stream:
                    async for event in stream:
                        if _shutdown_ev is not None and _shutdown_ev.is_set():
                            logger.info("🛑 Shutdown event detected during async OpenAI Responses streaming")
                            break
                        if first_token_time is None:
                            first_token_time = time.time()
                        processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                        if processed_event is None:
                            continue
                        aggregator.aggregate(processed_event)
                response_obj = aggregator.build()
                trace_ctx_s.set_outputs(_to_serializable_dict(response_obj))
                if first_token_time is not None:
                    trace_ctx_s.set_attributes({"time_to_first_token_ms": (first_token_time - start_time) * 1000})
        else:
            async with client.responses.stream(**request_payload) as stream:
                async for event in stream:
                    if _shutdown_ev is not None and _shutdown_ev.is_set():
                        logger.info("🛑 Shutdown event detected during async OpenAI Responses streaming")
                        break
                    processed_event = _process_stream_chunk(event, middleware_manager, model_call_params)
                    if processed_event is None:
                        continue
                    aggregator.aggregate(processed_event)
            response_obj = aggregator.build()
    except Exception as exc:
        wrapped_error = _maybe_wrap_stream_idle_timeout(
            exc,
            transport_name="openai responses stream",
            llm_config=llm_config,
        )
        if wrapped_error is not None:
            raise wrapped_error from exc
        raise

    return ModelResponse.from_openai_response(response_obj)


def _process_stream_chunk(
    chunk: Any,
    middleware_manager: MiddlewareManager | None,
    model_call_params: ModelCallParams | None,
) -> Any:
    """Run a raw stream chunk through middleware pipeline."""

    if middleware_manager is None or model_call_params is None:
        return chunk
    return middleware_manager.stream_chunk(chunk, model_call_params)


def _default_openai_responses_parallel_tool_calls(llm_config: LLMConfig | None) -> bool:
    """Resolve the default parallel_tool_calls setting for Responses API requests."""

    if llm_config is not None:
        configured_value = llm_config.extra_params.get("parallel_tool_calls")
        if isinstance(configured_value, bool):
            return configured_value
    return True


def _safe_get(item: Any, key: str, default: Any = None) -> Any:
    """Generic attribute/dict getter."""

    if isinstance(item, Mapping):
        mapping_item = cast(Mapping[str, Any], item)
        return mapping_item.get(key, default)
    return getattr(item, key, default)


def _to_serializable_dict(payload: Any) -> dict[str, Any]:
    """Convert SDK models into plain dictionaries."""

    if isinstance(payload, dict):
        return cast(dict[str, Any], payload)

    model_dump = getattr(payload, "model_dump", None)
    if callable(model_dump):
        try:
            # Pydantic v2 defaults `warnings="warn"` which can be noisy for some
            # third-party SDK models (e.g., OpenAI Responses typed generics).
            # Prefer a JSON-ready dump and silence serializer warnings.
            try:
                return cast(dict[str, Any], model_dump(mode="json", warnings=False))
            except TypeError:
                # Older/newer pydantic versions may not support all kwargs.
                try:
                    return cast(dict[str, Any], model_dump(warnings=False))
                except TypeError:
                    return cast(dict[str, Any], model_dump())
        except Exception:  # pragma: no cover - defensive
            pass

    result: dict[str, Any] = {}
    for attr in dir(payload):
        if attr.startswith("_"):
            continue
        try:
            value = getattr(payload, attr)
        except Exception:
            continue
        if callable(value):
            continue
        result[attr] = value
    return result


def _enrich_gemini_trace_outputs(
    output: dict[str, Any],
    model_name: str,
) -> dict[str, Any]:
    """Enrich Gemini REST trace output with model and usage for Langfuse.

    Gemini REST  modelVersion / usageMetadata,  Langfuse tracer
     end_span  output dict  model / usage  generation 
    model  token . function. 
    """
    enriched = dict(output)
    # 1. model (Langfuse generation )
    enriched["model"] = model_name
    # 2. usageMetadata Langfuse usage
    # Langfuse _sanitize_usage int value, int.
    usage_meta = output.get("usageMetadata")
    if isinstance(usage_meta, dict):
        meta: dict[str, object] = cast(dict[str, object], usage_meta)

        def _int_field(key: str) -> int:
            val = meta.get(key, 0)
            return int(val) if isinstance(val, int) else 0

        usage: dict[str, int] = {
            "input_tokens": _int_field("promptTokenCount"),
            "output_tokens": _int_field("candidatesTokenCount"),
            "total_tokens": _int_field("totalTokenCount"),
        }
        # token -, Langfuse
        cached = _int_field("cachedContentTokenCount")
        if cached > 0:
            usage["cached_tokens"] = cached
        thoughts = _int_field("thoughtsTokenCount")
        if thoughts > 0:
            usage["reasoning_tokens"] = thoughts
        enriched["usage"] = usage
    return enriched



def _gemini_sanitize_parameters(params: dict[str, object]) -> dict[str, object]:
    """Recursively sanitize schema for Gemini (strip $schema, additionalProperties, etc.)."""
    allowed = {"type", "properties", "required", "description", "enum", "items", "format", "nullable"}
    sanitized: dict[str, object] = {}
    for k, v in params.items():
        if k not in allowed:
            continue
        if k == "properties" and isinstance(v, dict):
            v_dict = cast(dict[str, object], v)
            sanitized[k] = {
                pk: _gemini_sanitize_parameters(cast(dict[str, object], pv)) for pk, pv in v_dict.items() if isinstance(pv, dict)
            }
        elif k == "items" and isinstance(v, dict):
            sanitized[k] = _gemini_sanitize_parameters(cast(dict[str, object], v))
        else:
            sanitized[k] = v
    return sanitized


def convert_tools_to_gemini(
    tools: Sequence[StructuredToolDefinitionLike],
) -> list[dict[str, Any]]:
    """Convert structured tool definitions to Gemini function declarations.

    RFC-0006: Gemini  structured tool adapter

    Gemini  neutral structured definition 
    ``functionDeclarations``,  OpenAI schema . 
    """

    gemini_tools: list[dict[str, Any]] = []
    for tool in tools:
        if hasattr(tool, "to_structured_definition"):
            tool = tool.to_structured_definition()
        try:
            normalized = normalize_structured_tool_definition(tool)
        except ValueError:
            if isinstance(tool, dict) and tool.get("type") != "function":
                continue
            raise

        gemini_tools.append(
            {
                "name": normalized["name"],
                "description": normalized["description"],
                "parameters": _gemini_sanitize_parameters(
                    cast(dict[str, object], normalized["input_schema"]),
                ),
            }
        )
    return gemini_tools


def _build_bifrost_headers(
    llm_config: LLMConfig,
    model_call_params: ModelCallParams | None = None,
) -> dict[str, str]:
    """Build telemetry and session headers for Bifrost / Cloud Gateway."""
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

    if hasattr(llm_config, "default_headers") and llm_config.default_headers:
        headers.update(llm_config.default_headers)
    return headers


def call_llm_with_google_genai(*args: Any, **kwargs: Any) -> Any:
    """Direct Google GenAI SDK calls are removed; all traffic routes through OpenAI gateway."""
    raise NotImplementedError(
        "Direct Google GenAI SDK calls have been removed. "
        "Mash routes all models through the OpenAI-compatible Cloud API gateway."
    )


async def call_llm_with_google_genai_async(*args: Any, **kwargs: Any) -> Any:
    """Direct Google GenAI SDK calls are removed; all traffic routes through OpenAI gateway."""
    raise NotImplementedError(
        "Direct Google GenAI SDK calls have been removed. "
        "Mash routes all models through the OpenAI-compatible Cloud API gateway."
    )


# Backward compatibility aliases
call_llm_with_gemini_rest = call_llm_with_google_genai
call_llm_with_gemini_rest_async = call_llm_with_google_genai_async