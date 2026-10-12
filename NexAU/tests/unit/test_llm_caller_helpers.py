# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0

"""Mock-based unit tests for ``llm_caller`` helpers + Set A edge cases.

These cover paths that are awkward to exercise via live e2e:

- ``_maybe_wrap_stream_idle_timeout`` exception normalization
- ``_get_event_emitter`` middleware-chain walk
- ``_chat_completion_to_model_response`` adapter shape handling
- ``_process_stream_chunk`` middleware drop semantics
- Set A Anthropic aggregator: duplicate ``content_block_start`` and
  truncated streams (message_stop never arrives)

The corresponding live e2e tests in
``tests/integration/test_aggregator_live_e2e.py`` cover the
positive paths against real provider endpoints; this file pins
the negative / error-handling branches.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest
import requests
from openai.types.chat import ChatCompletion
from openai.types.chat.chat_completion import Choice
from openai.types.chat.chat_completion_message import ChatCompletionMessage
from openai.types.completion_usage import CompletionUsage

from nexau.archs.llm.llm_aggregators.events import Event
from nexau.archs.main_sub.execution.hooks import Middleware, MiddlewareManager, ModelCallParams
from nexau.archs.main_sub.execution.llm_caller import (
    StreamIdleTimeoutError,
    _chat_completion_to_model_response,
    _get_event_emitter,
    _maybe_wrap_stream_idle_timeout,
    _process_stream_chunk,
    _resolve_run_id,
)

# ── _maybe_wrap_stream_idle_timeout ──────────────────────────────────


class TestMaybeWrapStreamIdleTimeout:
    def test_wraps_httpx_read_timeout(self):
        exc = httpx.ReadTimeout("read timed out")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="stream", llm_config=None)
        assert isinstance(wrapped, StreamIdleTimeoutError)

    def test_wraps_requests_read_timeout(self):
        exc = requests.exceptions.ReadTimeout("read timed out")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="gemini stream", llm_config=None)
        assert isinstance(wrapped, StreamIdleTimeoutError)
        assert "gemini stream" in str(wrapped)

    def test_wraps_builtin_timeout_error(self):
        exc = TimeoutError("frame timeout")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="openai stream", llm_config=None)
        assert isinstance(wrapped, StreamIdleTimeoutError)

    def test_wraps_duck_typed_class_name_match(self):
        # SDKs sometimes ship their own Timeout class hierarchy that
        # doesn't subclass the stdlib / httpx ones; the helper falls
        # back to a class-name check.
        class APITimeoutError(Exception):
            pass

        exc = APITimeoutError("upstream slow")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="x", llm_config=None)
        assert isinstance(wrapped, StreamIdleTimeoutError)

    def test_returns_none_for_unrelated_exception(self):
        exc = ValueError("not a timeout")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="x", llm_config=None)
        assert wrapped is None

    def test_returns_none_for_runtime_error(self):
        exc = RuntimeError("aggregator state error")
        wrapped = _maybe_wrap_stream_idle_timeout(exc, transport_name="x", llm_config=None)
        assert wrapped is None


# ── _get_event_emitter ──────────────────────────────────────────────


class TestGetEventEmitter:
    def test_no_manager_returns_noop(self):
        emitter = _get_event_emitter(None)
        # Should be callable with any event without raising.
        emitter(MagicMock())

    def test_empty_manager_returns_noop(self):
        manager = MiddlewareManager(middlewares=[])
        emitter = _get_event_emitter(manager)
        emitter(MagicMock())

    def test_walks_chain_for_first_middleware_with_handler(self):
        events: list[Event] = []

        class _CapturingMiddleware(Middleware):
            def __init__(self, sink: list[Event]) -> None:
                self.on_event = sink.append

        # Two middlewares, only the second has on_event — emitter must
        # find it via ``get_event_handler``.
        plain = Middleware()
        capturing = _CapturingMiddleware(events)
        manager = MiddlewareManager(middlewares=[plain, capturing])

        emitter = _get_event_emitter(manager)
        sentinel = MagicMock()
        emitter(sentinel)

        assert events == [sentinel]


# ── _resolve_run_id ─────────────────────────────────────────────────


class TestResolveRunId:
    def test_none_params_returns_default(self):
        assert _resolve_run_id(None) == "stream"

    def test_no_agent_state_returns_default(self):
        params = ModelCallParams(
            messages=[],
            max_tokens=None,
            force_stop_reason=None,
            agent_state=None,
            tool_call_mode="auto",
            tools=None,
            api_params={},
        )
        assert _resolve_run_id(params) == "stream"

    def test_agent_state_run_id_returned(self):
        agent_state = MagicMock()
        agent_state.run_id = "run_xyz"
        params = ModelCallParams(
            messages=[],
            max_tokens=None,
            force_stop_reason=None,
            agent_state=agent_state,
            tool_call_mode="auto",
            tools=None,
            api_params={},
        )
        assert _resolve_run_id(params) == "run_xyz"


# ── _chat_completion_to_model_response ──────────────────────────────


class TestChatCompletionToModelResponse:
    def test_extracts_message_and_usage_from_completion(self):
        completion = ChatCompletion(
            id="cmpl_test",
            object="chat.completion",
            created=0,
            model="m",
            choices=[
                Choice(
                    finish_reason="stop",
                    index=0,
                    message=ChatCompletionMessage(role="assistant", content="hi there"),
                    logprobs=None,
                )
            ],
            usage=CompletionUsage(prompt_tokens=3, completion_tokens=2, total_tokens=5),
        )

        response = _chat_completion_to_model_response(completion)

        assert response.content == "hi there"
        assert response.usage is not None
        assert response.usage.total_tokens == 5

    def test_empty_choices_raises_value_error(self):
        # Set A's ``build()`` already raises ``RuntimeError`` if no
        # chunks were observed, so a no-choice completion shouldn't
        # reach this helper in normal flow. Document the contract:
        # if it ever does, ``from_openai_message`` raises
        # ``ValueError("message cannot be None")`` rather than
        # silently corrupting state.
        completion = ChatCompletion(
            id="cmpl_test",
            object="chat.completion",
            created=0,
            model="m",
            choices=[],
            usage=None,
        )
        with pytest.raises(ValueError, match="message cannot be None"):
            _chat_completion_to_model_response(completion)


# ── _process_stream_chunk ───────────────────────────────────────────


class TestProcessStreamChunk:
    def test_no_manager_passes_chunk_through_unmodified(self):
        chunk = {"id": "x"}
        result = _process_stream_chunk(chunk, None, None)
        assert result is chunk

    def test_no_params_passes_chunk_through_unmodified(self):
        chunk = {"id": "x"}
        manager = MiddlewareManager(middlewares=[])
        result = _process_stream_chunk(chunk, manager, None)
        assert result is chunk

    def test_middleware_can_drop_chunk_by_returning_none(self):
        class _DroppingMiddleware(Middleware):
            def stream_chunk(self, chunk, params):  # noqa: ARG002 — interface match
                return None

        manager = MiddlewareManager(middlewares=[_DroppingMiddleware()])
        params = ModelCallParams(
            messages=[],
            max_tokens=None,
            force_stop_reason=None,
            agent_state=None,
            tool_call_mode="auto",
            tools=None,
            api_params={},
        )

        result = _process_stream_chunk({"id": "x"}, manager, params)
        # Manager returns None when any middleware drops; llm_caller's
        # streaming loop honors this with ``if processed_chunk is None:
        # continue`` so the aggregator never sees the dropped chunk.
        assert result is None

    def test_middleware_can_mutate_chunk(self):
        replacement = {"id": "replaced"}

        class _ReplacingMiddleware(Middleware):
            def stream_chunk(self, chunk, params):  # noqa: ARG002
                return replacement

        manager = MiddlewareManager(middlewares=[_ReplacingMiddleware()])
        params = ModelCallParams(
            messages=[],
            max_tokens=None,
            force_stop_reason=None,
            agent_state=None,
            tool_call_mode="auto",
            tools=None,
            api_params={},
        )

        result = _process_stream_chunk({"id": "original"}, manager, params)
        assert result is replacement


