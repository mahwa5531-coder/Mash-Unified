import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.routers.artifacts import get_file_content


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_file_content_rejects_unregistered_downloads_root() -> None:
    """Local Downloads is not an app workspace unless the user registers it."""
    with pytest.raises(HTTPException) as exc_info:
        await get_file_content(path=str(Path.home() / "Downloads"), engine=None)

    assert exc_info.value.status_code == 403


@pytest.mark.anyio
async def test_file_content_allows_the_app_workspace() -> None:
    response = await get_file_content(path=str(Path(__file__)), engine=None)

    assert "test_file_content_allows_the_app_workspace" in response["content"]
