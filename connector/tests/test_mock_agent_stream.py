import asyncio
import os
import sys
from pathlib import Path
import pytest

# Ensure connector and NexAU are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.execution.llm_caller import (
    call_llm_with_different_client,
    call_llm_with_different_client_async,
    _is_mock_llm,
)


def test_is_mock_llm_detection():
    # Detects mock api key
    cfg_mock = LLMConfig(api_type="openai_chat_completion", api_key="mock", base_url="http://mock", model="mock-model")
    assert _is_mock_llm(cfg_mock) is True

    # Detects mock base_url
    cfg_base = LLMConfig(api_type="openai_chat_completion", api_key="sk-123", base_url="http://mock", model="mock-model")
    assert _is_mock_llm(cfg_base) is True


def test_sync_mock_chat_completion():
    cfg = LLMConfig(api_type="openai_chat_completion", api_key="mock", base_url="http://mock", model="mock-model")
    kwargs = {
        "messages": [{"role": "user", "content": "Hello agent"}],
        "stream": False,
    }
    resp = call_llm_with_different_client(client=None, llm_config=cfg, kwargs=kwargs)
    assert resp is not None
    assert "mock" in resp.content.lower() or "offline" in resp.content.lower()


@pytest.mark.anyio
async def test_async_mock_chat_completion_stream():
    cfg = LLMConfig(api_type="openai_chat_completion", api_key="mock", base_url="http://mock", model="mock-model")
    kwargs = {
        "messages": [{"role": "user", "content": "Testing offline streaming"}],
        "stream": True,
    }
    resp = await call_llm_with_different_client_async(client=None, llm_config=cfg, kwargs=kwargs)
    assert resp is not None
    assert len(resp.content) > 0


@pytest.mark.anyio
async def test_async_mock_tool_calling():
    cfg = LLMConfig(api_type="openai_chat_completion", api_key="mock", base_url="http://mock", model="mock-model")
    kwargs = {
        "messages": [{"role": "user", "content": "[TEST_TOOL] please read file"}],
        "tools": [{"type": "function", "function": {"name": "view_file", "parameters": {}}}],
        "stream": True,
    }
    resp = await call_llm_with_different_client_async(client=None, llm_config=cfg, kwargs=kwargs)
    assert resp is not None
    assert len(resp.tool_calls) == 1
    assert resp.tool_calls[0].name == "view_file"


@pytest.mark.anyio
async def test_mock_chat_stream_endpoint(monkeypatch):
    """Verify that the FastAPI /api/chat/stream SSE endpoint streams mock events offline."""
    monkeypatch.setenv("MOCK_LLM", "true")
    monkeypatch.setenv("LLM_API_KEY", "mock")
    import httpx
    from app.main import app, lifespan

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            async with client.stream(
                "POST",
                "/api/chat/stream",
                json={
                    "messages": "Hello offline test",
                    "session_id": f"sess_mock_{os.getpid()}",
                    "context": {"workspace_uri": "No Repo"},
                },
            ) as resp:
                assert resp.status_code == 200
                chunks = []
                async for chunk in resp.aiter_text():
                    chunks.append(chunk)
                    if len(chunks) >= 3:
                        break
                full_stream = "".join(chunks)
                assert "data:" in full_stream


