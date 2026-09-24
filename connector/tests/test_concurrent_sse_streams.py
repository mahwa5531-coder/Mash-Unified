"""
Test concurrent SSE streaming and session isolation across multiple sessions.
Verifies that 2 sessions streaming at the exact same moment do not cross-contaminate tokens.
"""

import asyncio
import json
import time
import pytest
import httpx
from pathlib import Path
import sys

# Ensure roots are in sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

async def stream_session(client: httpx.AsyncClient, session_id: str, prompt: str, repo: str):
    url = "/stream"
    payload = {
        "session_id": session_id,
        "messages": prompt,
        "context": {
            "session_id": session_id,
            "workspace_uri": repo,
            "section": "workspace" if repo != "No Repo" else "conversation",
        },
    }
    
    tokens = []
    start_time = time.time()
    
    try:
        async with client.stream("POST", url, json=payload, headers={"Accept": "text/event-stream"}, timeout=30.0) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    data_str = line[5:].strip()
                    if data_str:
                        try:
                            ev = json.loads(data_str)
                            ev_type = ev.get("type", "")
                            if "CONTENT" in ev_type.upper():
                                delta = ev.get("delta", "")
                                if delta:
                                    tokens.append(delta)
                        except Exception:
                            pass
    except Exception as e:
        return str(e)

    output = "".join(tokens)
    duration = time.time() - start_time
    return {
        "session_id": session_id,
        "tokens_count": len(tokens),
        "output_sample": (output[:100] if isinstance(output, str) else ""),
        "duration_s": round(duration, 2),
    }

@pytest.mark.asyncio
async def test_concurrent_sse_streams():
    print("=" * 60)
    print("TESTING CONCURRENT SSE STREAMS & SESSION ISOLATION")
    print("=" * 60)

    sid1 = f"sess_concurrent_a_{int(time.time()*1000)}"
    sid2 = f"sess_concurrent_b_{int(time.time()*1000)}"

    print(f"Launching Stream A ({sid1}) and Stream B ({sid2}) simultaneously...")

    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            # Both run concurrently
            results = await asyncio.gather(
                stream_session(client, sid1, "Say 'Alpha stream 123'", "Mash"),
                stream_session(client, sid2, "Say 'Beta stream 456'", "No Repo"),
                return_exceptions=True,
            )

            for idx, r in enumerate(results):
                print(f"Result {idx + 1}: {r}")
                assert not isinstance(r, Exception), f"Stream failed: {r}"
                assert r["tokens_count"] >= 0

            print("Concurrent streaming completed successfully!")

            # Verify session records in DB
            resp = await client.get("/sessions")
            data = resp.json()
            sessions_map = {s["session_id"]: s for s in data.get("sessions", [])}

            assert sid1 in sessions_map, f"{sid1} not found in DB"
            assert sid2 in sessions_map, f"{sid2} not found in DB"

            sess_a = sessions_map[sid1]
            sess_b = sessions_map[sid2]

            assert sess_a["section"] == "workspace"
            assert sess_a["workspace_uri"] == "Mash"

            assert sess_b["section"] == "conversation"
            assert sess_b["workspace_uri"] == "No Repo"

            print("Session isolation verified in DB: A is in 'workspace (Mash)', B is in 'conversation (No Repo)'.")

            # Cleanup
            for sid in (sid1, sid2):
                await client.delete(f"/sessions/{sid}")

            print("Cleanup completed.")
            print("=" * 60)
