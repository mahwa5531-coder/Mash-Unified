"""Unit tests for Google GenAI caller with Bifrost headers and native chunk ingestion."""

import asyncio
from unittest.mock import MagicMock, patch
from google.genai import types

from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.execution.hooks import ModelCallParams
from nexau.archs.main_sub.execution.llm_caller import (
    _build_bifrost_headers,
    _build_google_genai_client,
    _build_google_genai_config,
    call_llm_with_gemini_rest,
    call_llm_with_gemini_rest_async,
    call_llm_with_google_genai,
    call_llm_with_google_genai_async,
)
from nexau.core.messages import Message


def test_google_genai_caller_aliases() -> None:
    assert call_llm_with_gemini_rest is call_llm_with_google_genai
    assert call_llm_with_gemini_rest_async is call_llm_with_google_genai_async


def test_build_bifrost_headers() -> None:
    cfg = LLMConfig(
        model="gemini-2.5-flash",
        api_type="google_genai",
        base_url="https://bifrost.gateway.io/v1beta",
        api_key="test-key",
        timeout=45,
        extra_params={"session_id": "sess-alpha-123"},
    )
    headers = _build_bifrost_headers(cfg)
    assert "X-Machine-ID" in headers
    assert headers.get("X-Session-ID") == "sess-alpha-123"
    assert headers.get("X-Client-Version") == "Mash-Desktop/1.0.0"


def test_build_google_genai_client_http_options() -> None:
    cfg = LLMConfig(
        model="gemini-2.5-flash",
        api_type="google_genai",
        base_url="https://bifrost.gateway.io/v1beta",
        api_key="test-key",
        timeout=30,
        extra_params={"session_id": "sess-beta-456"},
    )
    client = _build_google_genai_client(cfg)
    http_opts = client._api_client._http_options
    assert http_opts.base_url == "https://bifrost.gateway.io"
    assert http_opts.api_version == "v1beta"
    assert http_opts.headers.get("X-Session-ID") == "sess-beta-456"
    assert http_opts.timeout == 30.0


def test_build_google_genai_config() -> None:
    cfg = LLMConfig(
        model="gemini-2.5-flash",
        api_type="google_genai",
        base_url="https://bifrost.gateway.io",
        api_key="test-key",
        temperature=0.2,
        max_tokens=256,
        extra_params={"thinkingConfig": {"thinkingBudget": 100}},
    )
    tools = [{"name": "lookup", "description": "Search info", "parameters": {"type": "OBJECT"}}]
    config = _build_google_genai_config(cfg, "You are a helpful assistant", tools)
    assert config.automatic_function_calling.disable is True
    assert config.temperature == 0.2
    assert config.max_output_tokens == 256
    assert config.system_instruction == "You are a helpful assistant"
    assert config.thinking_config.thinking_budget == 100
    assert config.thinking_config.include_thoughts is True


def test_streaming_native_chunk_ingestion() -> None:
    cfg = LLMConfig(
        model="gemini-2.5-flash",
        api_type="google_genai",
        base_url="https://bifrost.gateway.io",
        api_key="test-key",
    )
    params = ModelCallParams(
        messages=[Message.user("Hello")],
        max_tokens=50,
        force_stop_reason=None,
        agent_state=None,
        tool_call_mode="none",
        tools=None,
        api_params={},
    )
    mock_chunk1 = types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(parts=[types.Part.from_text(text="Chunk 1 ")], role="model"))]
    )
    mock_chunk2 = types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(parts=[types.Part.from_text(text="Chunk 2")], role="model"))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=4, candidates_token_count=6, total_token_count=10),
    )

    mock_client = MagicMock()
    mock_client.models.generate_content_stream.return_value = [mock_chunk1, mock_chunk2]

    with patch("nexau.archs.main_sub.execution.llm_caller._build_google_genai_client", return_value=mock_client):
        res = call_llm_with_google_genai({"stream": True}, model_call_params=params, llm_config=cfg)
        assert res.content == "Chunk 1 Chunk 2"
        assert res.usage.input_tokens == 4
        assert res.usage.completion_tokens == 6
        assert res.usage.total_tokens == 10


def test_streaming_async_native_chunk_ingestion() -> None:
    cfg = LLMConfig(
        model="gemini-2.5-flash",
        api_type="google_genai",
        base_url="https://bifrost.gateway.io",
        api_key="test-key",
    )
    params = ModelCallParams(
        messages=[Message.user("Hello async")],
        max_tokens=50,
        force_stop_reason=None,
        agent_state=None,
        tool_call_mode="none",
        tools=None,
        api_params={},
    )
    mock_chunk = types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(parts=[types.Part.from_text(text="Async chunk")], role="model"))],
        usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=3, candidates_token_count=2, total_token_count=5),
    )

    async def async_stream():
        yield mock_chunk

    mock_client = MagicMock()
    mock_client.aio.models.generate_content_stream.return_value = async_stream()

    with patch("nexau.archs.main_sub.execution.llm_caller._build_google_genai_client", return_value=mock_client):
        res = asyncio.run(call_llm_with_google_genai_async({"stream": True}, model_call_params=params, llm_config=cfg))
        assert res.content == "Async chunk"
        assert res.usage.total_tokens == 5
