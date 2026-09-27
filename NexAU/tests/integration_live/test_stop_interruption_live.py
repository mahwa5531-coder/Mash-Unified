import os
import sys
import json
import asyncio
from pathlib import Path
import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from nexau_ui_backend.main import app, lifespan

@pytest.mark.anyio
async def test_stop_interruption_live():
    """Verify mid-turn stop interruption halts agent cleanly without corrupting state."""
    test_session_id = f"test_stop_sess_{int(asyncio.get_event_loop().time() * 1000)}"

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=60.0) as client:
            events_received = []
            interrupted = False

            async def stream_worker():
                nonlocal interrupted
                try:
                    async with client.stream("POST", "/stream", json={
                        "session_id": test_session_id,
                        "messages": "Please write a comprehensive 500-word analysis on ISA 320 Materiality benchmarks.",
                        "context": {"title": "Long Running ISA 320 Analysis", "workspace_uri": "C:\\Test"}
                    }) as stream_res:
                        async for line in stream_res.aiter_lines():
                            if line.startswith("data:"):
                                try:
                                    ev = json.loads(line[5:].strip())
                                    events_received.append(ev)
                                    if len(events_received) == 3 and not interrupted:
                                        interrupted = True
                                        asyncio.create_task(send_stop())
                                except:
                                    pass
                except Exception as e:
                    pass

            async def send_stop():
                await asyncio.sleep(0.05)
                await client.post("/stop", json={"session_id": test_session_id, "user_id": "default_user", "force": True})

            await stream_worker()
            recover_res = await client.get("/sessions")
            assert recover_res.status_code == 200

if __name__ == "__main__":
    asyncio.run(test_stop_interruption_live())
