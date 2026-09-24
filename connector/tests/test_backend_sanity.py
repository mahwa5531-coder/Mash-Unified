import sys
from pathlib import Path
import pytest
import httpx

# Ensure roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_backend_sanity_and_health():
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            res = await client.get("/api/system/info")
            assert res.status_code == 200
            assert "installation_id" in res.json()

            res = await client.get("/api/capabilities")
            assert res.status_code == 200
            assert len(res.json()["capabilities"]) >= 3

            res = await client.get("/api/settings")
            assert res.status_code == 200
            assert "user" in res.json()

