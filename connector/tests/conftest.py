import os
import sys
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent

import json
import httpx
import respx

# Ensure test suite runs in isolated offline mock mode unless live LLM is explicitly requested
os.environ.setdefault("MOCK_LLM", "true")

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

