import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import json

import httpx
import respx

# Ensure test suite runs in isolated offline mock mode unless live LLM is explicitly requested
# QA-BUG-4 Hermetic Test Contract: provide default offline mock keys so fresh clones pass 100%
os.environ.setdefault("MOCK_LLM", "true")
os.environ.setdefault("LLM_API_KEY", "test-mock-key")
os.environ.setdefault("LLM_BASE_URL", "http://127.0.0.1:9777/v1")
os.environ.setdefault("LLM_MODEL", "mock-audit-v1")
os.environ["MASH_BYPASS_AUTH"] = "false"

@pytest.fixture
def anyio_backend():
    return "asyncio"

def pytest_collection_modifyitems(items):
    for item in items:
        if item.get_closest_marker("asyncio"):
            item.add_marker(pytest.mark.anyio)

@pytest.fixture(autouse=True)
def mock_llm_offline_environment():
    """Intercept dead http://mock endpoints so offline test runs never fail with DNS getaddrinfo."""
    if os.getenv("MOCK_LLM", "").lower() in ("true", "1", "yes"):
        def mock_chat_handler(request):
            try:
                body = json.loads(request.content)
            except Exception:
                body = {}
            if body.get("stream"):
                sse = (
                    'data: {"id":"chatcmpl-mock","choices":[{"index":0,"delta":{"role":"assistant","content":"Offline mock response."}}]}\n\n'
                    'data: [DONE]\n\n'
                )
                return httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})
            return httpx.Response(200, json={
                "id": "chatcmpl-mock",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "Offline mock response."}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            })

        with respx.mock(assert_all_called=False) as respx_mock:
            respx_mock.post("http://mock/chat/completions").mock(side_effect=mock_chat_handler)
            respx_mock.get("http://mock/models").mock(return_value=httpx.Response(200, json={"data": []}))
            yield
    else:
        yield


def pytest_sessionfinish(session, exitstatus):
    """Clean up background SQLAlchemy / aiosqlite connection pools so Python exits immediately."""
    import asyncio
    try:
        import app.dependencies as deps
        if deps._engine is not None:
            inner = deps._engine._inner
            if hasattr(inner, "_engine"):
                asyncio.run(inner._engine.dispose())
    except Exception:
        pass


