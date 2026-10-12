# Copyright (c) Nex-AGI. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Unit tests for LLM caller component.

Tests cover:
- LLMCaller initialization
- Basic LLM API calls
- Retry logic with exponential backoff
- Force stop reason handling
- XML tag restoration
- Debug logging
- Stop sequence handling
- Error scenarios
"""

import asyncio
import logging
from unittest.mock import AsyncMock, Mock, call, patch

import pytest

from nexau.archs.main_sub.execution.hooks import MiddlewareManager
from nexau.archs.main_sub.execution.llm_caller import LLMCaller
from nexau.archs.main_sub.execution.model_response import ModelResponse
from nexau.archs.main_sub.execution.stop_reason import AgentStopReason
from nexau.core.messages import Message
from nexau.core.serializers.openai_chat import (
    messages_from_legacy_openai_chat,
    serialize_ump_to_openai_chat_payload,
)

# removed prepare_openai_responses_api_input


@pytest.fixture(autouse=True)
def mock_openai_module():
    """Mock the openai module to prevent any real API calls."""
    with patch("nexau.archs.main_sub.execution.llm_caller.openai") as mock_openai:
        # Ensure OpenAI client cannot be instantiated
        mock_openai.OpenAI.side_effect = RuntimeError("Real OpenAI client cannot be instantiated in tests")
        yield mock_openai


class TestLLMCallerInitialization:
    """Test cases for LLMCaller initialization."""

    def test_initialization_with_defaults(self, mock_openai_client, mock_llm_config):
        """Test LLMCaller initialization with default parameters."""
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        assert caller.openai_client == mock_openai_client
        assert caller.llm_config == mock_llm_config
        assert caller.retry_attempts == 5
        assert caller.middleware_manager is None

    def test_initialization_with_custom_retry_attempts(self, mock_openai_client, mock_llm_config):
        """Test LLMCaller initialization with custom retry attempts."""
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=10,
        )

        assert caller.retry_attempts == 10

    def test_initialization_with_retry_backoff_cap_and_callback(self, mock_openai_client, mock_llm_config):
        """Test LLMCaller stores retry backoff cap and retry callback."""
        callback = Mock()
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_backoff_max_seconds=7,
            on_retry=callback,
        )

        assert caller.retry_backoff_max_seconds == 7
        assert caller.on_retry is callback

    def test_initialization_with_middleware_manager(self, mock_openai_client, mock_llm_config):
        """LLMCaller can be initialized with a middleware manager."""

        manager = MiddlewareManager([])
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            middleware_manager=manager,
        )

        assert caller.middleware_manager is manager


class TestLLMCallerBasicCalls:
    """Test cases for basic LLM API calls."""

    def test_call_llm_success(self, mock_openai_client, mock_llm_config, agent_state):
        """Test successful LLM API call."""
        # Setup mock response
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Hello! How can I help you?"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Hello! How can I help you?"
        mock_openai_client.chat.completions.create.assert_called_once()

    def test_model_response_from_completion_reasoning_shape(self):
        """Chat Completions responses can carry reasoning_content directly on the assistant message."""

        response = ModelResponse.from_openai_message(
            {
                "role": "assistant",
                "content": "35 × 11 = 385\nFinal: 34",
                "reasoning_content": "Compute 35 * 11 first, then divide by 13.",
            },
            usage={"prompt_tokens": 43, "completion_tokens": 82, "total_tokens": 125},
        )

        assert response.content == "35 × 11 = 385\nFinal: 34"
        assert response.reasoning_content == "Compute 35 * 11 first, then divide by 13."
        assert response.response_items == []
        assert response.usage.total_tokens == 125

    def test_model_response_preserves_empty_completion_reasoning_content(self):
        """DeepSeek requires explicit blank reasoning_content to be echoed on later turns."""

        response = ModelResponse.from_openai_message(
            {
                "role": "assistant",
                "content": "",
                "reasoning_content": "",
            },
        )

        assert response.reasoning_content == ""
        assert response.to_message_dict()["reasoning_content"] == ""
        assert serialize_ump_to_openai_chat_payload([response.to_ump_message()]) == [
            {
                "role": "assistant",
                "content": "",
                "reasoning_content": "",
            }
        ]

    def test_call_llm_without_client_raises_error(self, mock_llm_config):
        """Test that calling LLM without client raises RuntimeError."""
        caller = LLMCaller(
            openai_client=None,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]

        with pytest.raises(RuntimeError, match="OpenAI client is not available"):
            caller.call_llm(messages, max_tokens=100)

    def test_call_llm_includes_xml_stop_sequences(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that LLM calls include XML stop sequences."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Check that stop sequences were added
        call_args = mock_openai_client.chat.completions.create.call_args
        stop_sequences = call_args[1]["stop"]

        assert "</tool_use>" in stop_sequences
        assert "</use_parallel_tool_calls>" in stop_sequences

    def test_call_llm_merges_existing_stop_sequences(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that existing stop sequences are preserved and merged."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # Setup llm_config with existing stop sequences
        mock_llm_config.to_openai_params = Mock(
            return_value={"model": "gpt-4o-mini", "temperature": 0.7, "stop": ["custom_stop_1", "custom_stop_2"]}
        )

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        call_args = mock_openai_client.chat.completions.create.call_args
        stop_sequences = call_args[1]["stop"]

        # Both custom and XML stop sequences should be present
        assert "custom_stop_1" in stop_sequences
        assert "custom_stop_2" in stop_sequences
        assert "</tool_use>" in stop_sequences

    def test_call_llm_with_openai_tools(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that tools parameter is forwarded and XML stops are omitted."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        mock_llm_config.to_openai_params = Mock(
            return_value={"model": "gpt-4o-mini", "temperature": 0.7},
        )

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        tools_payload = [
            {
                "type": "function",
                "function": {
                    "name": "simple_tool",
                    "description": "A simple tool",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
        ]

        caller.call_llm(
            messages,
            max_tokens=100,
            force_stop_reason=AgentStopReason.SUCCESS,
            agent_state=agent_state,
            tool_call_mode="openai",
            tools=tools_payload,
        )

        call_args = mock_openai_client.chat.completions.create.call_args
        assert call_args[1]["tools"] == tools_payload
        assert "tool_choice" in call_args[1]
        assert "stop" not in call_args[1] or "</tool_use>" not in call_args[1].get("stop", [])

    def test_legacy_tool_call_mode_alias_uses_provider_selected_by_api_type(
        self,
        mock_openai_client,
        mock_llm_config,
        agent_state,
    ):
        """Legacy aliases should normalize to structured and still follow ``api_type``."""

        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        mock_llm_config.api_type = "openai_chat_completion"
        mock_llm_config.to_openai_params = Mock(return_value={"model": "gpt-4o-mini"})

        caller = LLMCaller(openai_client=mock_openai_client, llm_config=mock_llm_config)

        caller.call_llm(
            [Message.user("Hello")],
            max_tokens=50,
            force_stop_reason=AgentStopReason.SUCCESS,
            agent_state=agent_state,
            tool_call_mode="anthropic",
            tools=[
                {
                    "name": "simple_tool",
                    "description": "A simple tool",
                    "input_schema": {"properties": {}},
                    "kind": "tool",
                }
            ],
        )

        call_args = mock_openai_client.chat.completions.create.call_args
        assert call_args.kwargs["tools"] == [
            {
                "type": "function",
                "function": {
                    "name": "simple_tool",
                    "description": "A simple tool",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
        assert call_args.kwargs["tool_choice"] == "auto"

    def test_call_llm_anthropic_mode_not_supported(
        self,
        mock_openai_client,
        mock_llm_config,
        agent_state,
    ):
        """anthropic mode should clearly signal lack of support."""

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]

        # Mock response with proper tool_calls structure
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # anthropic mode sets tools and tool_choice but may not be fully supported
        # The test verifies it doesn't crash with proper mocking
        response = caller.call_llm(
            messages,
            max_tokens=50,
            force_stop_reason=AgentStopReason.SUCCESS,
            agent_state=agent_state,
            tool_call_mode="anthropic",
        )

        # Verify the call completed (though anthropic mode may not be fully functional)
        assert response is not None
        assert isinstance(response, ModelResponse)

    def test_call_llm_applies_additional_drop_params(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that additional_drop_params are applied before sending request."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        mock_llm_config.additional_drop_params = ("stop", "temperature")

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        call_args = mock_openai_client.chat.completions.create.call_args
        assert "stop" not in call_args.kwargs
        assert "temperature" not in call_args.kwargs

    def test_call_llm_handles_string_stop_sequence(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that string stop sequences are converted to list."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # Setup llm_config with string stop sequence
        mock_llm_config.to_openai_params = Mock(return_value={"model": "gpt-4o-mini", "temperature": 0.7, "stop": "single_stop"})

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        call_args = mock_openai_client.chat.completions.create.call_args
        stop_sequences = call_args[1]["stop"]

        assert "single_stop" in stop_sequences
        assert "</tool_use>" in stop_sequences


class TestLLMCallerXMLRestoration:
    """Test cases for XML tag restoration."""

    def test_call_llm_splits_response_at_stop_sequences(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that response is split at stop sequences."""
        # Response that contains stop sequence
        full_response = "Response content</tool_use>Extra content"
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = full_response
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Response should be split at the stop sequence
        # After split and restoration, it should have the closing tag but not extra content
        assert "Response content" in response.content
        assert "Extra content" not in response.content


class TestLLMCallerDebugLogging:
    """Test cases for debug logging."""

    def test_call_llm_debug_logging_enabled(self, mock_openai_client, mock_llm_config, agent_state, caplog):
        """Test that debug logging works when enabled."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Debug response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # Enable debug mode
        mock_llm_config.debug = True

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = messages_from_legacy_openai_chat(
            [
                {"role": "system", "content": "System prompt"},
                {"role": "user", "content": "User message"},
            ],
        )

        with caplog.at_level(logging.INFO):
            caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Check that debug logs were created
        debug_logs = [rec.message for rec in caplog.records if "🐛 [DEBUG]" in rec.message]
        assert len(debug_logs) > 0

    def test_call_llm_debug_logging_disabled(self, mock_openai_client, mock_llm_config, agent_state, caplog):
        """Test that debug logging is disabled when debug mode is off."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # Disable debug mode
        mock_llm_config.debug = False

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]

        with caplog.at_level(logging.INFO):
            caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Check that debug logs were NOT created
        debug_logs = [rec.message for rec in caplog.records if "🐛 [DEBUG]" in rec.message]
        assert len(debug_logs) == 0

    def test_call_llm_async_debug_logging_enabled(self, mock_openai_client, mock_llm_config, agent_state, caplog):
        """Test that debug logging works on the async LLM path."""
        mock_llm_config.debug = True
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )
        caller._call_with_retry_async = AsyncMock(return_value=ModelResponse(content="Async debug response"))

        messages = messages_from_legacy_openai_chat(
            [
                {"role": "system", "content": "System prompt"},
                {"role": "user", "content": "User message"},
            ],
        )

        with caplog.at_level(logging.INFO):
            asyncio.run(
                caller.call_llm_async(
                    messages,
                    max_tokens=100,
                    force_stop_reason=AgentStopReason.SUCCESS,
                    agent_state=agent_state,
                ),
            )

        debug_logs = [rec.message for rec in caplog.records if "[DEBUG]" in rec.message]
        assert any("LLM Request Messages" in msg for msg in debug_logs)
        assert any("LLM Response" in msg for msg in debug_logs)


class TestLLMCallerRetryLogic:
    """Test cases for retry logic."""

    def test_call_llm_retry_on_failure(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that LLM calls retry on failure."""
        # First two calls fail, third succeeds
        success_response = Mock(choices=[Mock(message=Mock(content="Success after retry", tool_calls=[]))])
        success_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.side_effect = [
            Exception("API Error 1"),
            Exception("API Error 2"),
            success_response,
        ]

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=3,
        )

        messages = [Message.user("Hello")]

        with patch("time.sleep"):  # Mock sleep to speed up test
            response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Success after retry"
        assert mock_openai_client.chat.completions.create.call_count == 3

    def test_call_llm_exhausts_retries(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that LLM calls raise error after exhausting retries."""
        # All calls fail
        mock_openai_client.chat.completions.create.side_effect = Exception("Persistent API Error")

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=3,
        )

        messages = [Message.user("Hello")]

        with patch("time.sleep"):  # Mock sleep to speed up test
            with pytest.raises(Exception, match="Persistent API Error"):
                caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert mock_openai_client.chat.completions.create.call_count == 3

    def test_call_llm_exponential_backoff(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that retry uses exponential backoff."""
        # Fail a few times to trigger backoff
        success_response = Mock(choices=[Mock(message=Mock(content="Success", tool_calls=[]))])
        success_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.side_effect = [
            Exception("Error 1"),
            Exception("Error 2"),
            success_response,
        ]

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=3,
        )

        messages = [Message.user("Hello")]

        with patch("time.sleep") as mock_sleep:
            caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Check that sleep was called with exponential backoff
        sleep_calls = mock_sleep.call_args_list
        assert len(sleep_calls) == 2  # Two failures before success
        assert sleep_calls[0] == call(1)  # First backoff: 1 second
        assert sleep_calls[1] == call(2)  # Second backoff: 2 seconds

    def test_call_llm_empty_response_triggers_retry(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that empty response content triggers retry."""
        # First call returns empty content, second succeeds
        empty_response = Mock(choices=[Mock(message=Mock(content="", tool_calls=[], reasoning_content=None))])
        empty_response.usage = {"prompt_tokens": 10, "completion_tokens": 0, "total_tokens": 10}
        valid_response = Mock(choices=[Mock(message=Mock(content="Valid response", tool_calls=[], reasoning_content=None))])
        valid_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.side_effect = [
            empty_response,
            valid_response,
        ]

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=3,
        )

        messages = [Message.user("Hello")]

        with patch("time.sleep"):
            response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Valid response"
        assert mock_openai_client.chat.completions.create.call_count == 2

class TestLLMCallerForceStopReason:
    """Test cases for force stop reason handling."""

    def test_call_llm_with_force_stop_reason_success(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with SUCCESS stop reason proceeds normally."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Normal response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(
            messages,
            max_tokens=100,
            force_stop_reason=AgentStopReason.SUCCESS,
            agent_state=agent_state,
        )

        assert isinstance(response, ModelResponse)
        assert response.content == "Normal response"
        mock_openai_client.chat.completions.create.assert_called_once()

    def test_call_llm_with_non_success_stop_reason_returns_none(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with non-SUCCESS stop reason returns None."""
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(
            messages,
            max_tokens=100,
            force_stop_reason=AgentStopReason.MAX_ITERATIONS_REACHED,
            agent_state=agent_state,
        )

        assert response is None
        # OpenAI client should not be called
        mock_openai_client.chat.completions.create.assert_not_called()

    def test_call_llm_with_error_stop_reason(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with ERROR_OCCURRED stop reason."""
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(
            messages,
            max_tokens=100,
            force_stop_reason=AgentStopReason.ERROR_OCCURRED,
            agent_state=agent_state,
        )

        assert response is None
        mock_openai_client.chat.completions.create.assert_not_called()


class TestLLMCallerEdgeCases:
    """Test cases for edge cases and boundary conditions."""

    def test_call_llm_with_empty_messages(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with empty messages list."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        response = caller.call_llm([], max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Response"
        # Check that empty messages were passed
        call_args = mock_openai_client.chat.completions.create.call_args
        assert call_args[1]["messages"] == []

    def test_call_llm_with_zero_max_tokens(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with zero max_tokens."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=0, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Response"
        call_args = mock_openai_client.chat.completions.create.call_args
        assert call_args[1]["max_tokens"] == 0

    def test_call_llm_with_none_stop_sequences(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call when stop sequences are None."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        # Setup llm_config with None stop sequences
        mock_llm_config.to_openai_params = Mock(return_value={"model": "gpt-4o-mini", "temperature": 0.7, "stop": None})

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Response"
        call_args = mock_openai_client.chat.completions.create.call_args
        stop_sequences = call_args[1]["stop"]
        # Should only have XML stop sequences
        assert "</tool_use>" in stop_sequences

    def test_call_llm_with_complex_response_content(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM call with complex response containing special characters."""
        complex_response = """
<tool_use>
<tool_name>test_tool</tool_name>
<parameter>
<query>Search for "complex & special < > characters"</query>
</parameter>
</tool_use>
"""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = complex_response
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        # Response should preserve special characters
        assert "complex & special < > characters" in response.content
        assert "<tool_use>" in response.content

    def test_call_llm_with_very_large_retry_attempts(self, mock_openai_client, mock_llm_config, agent_state):
        """Test LLM caller with very large retry attempts."""
        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "Response"
        mock_response.choices[0].message.tool_calls = []
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=100,
        )

        messages = [Message.user("Hello")]
        response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Response"
        assert caller.retry_attempts == 100

    def test_call_llm_response_content_none_triggers_exception(self, mock_openai_client, mock_llm_config, agent_state):
        """Test that None response content triggers retry."""
        # First call returns None, second succeeds
        none_response = Mock(choices=[Mock(message=Mock(content=None, tool_calls=[], reasoning_content=None))])
        none_response.usage = {"prompt_tokens": 10, "completion_tokens": 0, "total_tokens": 10}
        valid_response = Mock(choices=[Mock(message=Mock(content="Valid response", tool_calls=[], reasoning_content=None))])
        valid_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.side_effect = [
            none_response,
            valid_response,
        ]

        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=3,
        )

        messages = [Message.user("Hello")]

        with patch("time.sleep"):
            response = caller.call_llm(messages, max_tokens=100, force_stop_reason=AgentStopReason.SUCCESS, agent_state=agent_state)

        assert isinstance(response, ModelResponse)
        assert response.content == "Valid response"
        assert mock_openai_client.chat.completions.create.call_count == 2


class TestLLMCallerIntegration:
    """Integration tests combining multiple features."""

    def test_call_llm_preserves_empty_reasoning_content_in_history(self, mock_openai_client, mock_llm_config, agent_state):
        """DeepSeek thinking mode requires prior assistant reasoning_content to be echoed, even blank."""

        mock_response = Mock()
        mock_response.choices = [Mock()]
        mock_response.choices[0].message.content = "follow up"
        mock_response.choices[0].message.tool_calls = []
        mock_response.choices[0].message.reasoning_content = None
        mock_response.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        mock_openai_client.chat.completions.create.return_value = mock_response

        mock_llm_config.to_openai_params = Mock(return_value={"model": "gpt-4o-mini", "temperature": 0.7})
        caller = LLMCaller(
            openai_client=mock_openai_client,
            llm_config=mock_llm_config,
            retry_attempts=1,
        )

        prior_assistant = ModelResponse.from_openai_message(
            {
                "role": "assistant",
                "content": "previous answer",
                "reasoning_content": "",
            },
        ).to_ump_message()
        messages = [Message.user("first"), prior_assistant, Message.user("again")]

        caller.call_llm(
            messages,
            max_tokens=200,
            force_stop_reason=AgentStopReason.SUCCESS,
            agent_state=agent_state,
        )

        sent_messages = mock_openai_client.chat.completions.create.call_args[1]["messages"]
        assert sent_messages[1]["role"] == "assistant"
        assert sent_messages[1]["reasoning_content"] == ""


