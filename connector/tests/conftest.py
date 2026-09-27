import os
import sys
from pathlib import Path
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Ensure test suite runs in isolated offline mock mode unless live LLM is explicitly requested
os.environ.setdefault("MOCK_LLM", "true")

@pytest.fixture
def anyio_backend():
    return "asyncio"

def pytest_collection_modifyitems(items):
    for item in items:
        if item.get_closest_marker("asyncio"):
            item.add_marker(pytest.mark.anyio)

