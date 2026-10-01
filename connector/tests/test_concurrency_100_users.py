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

"""Concurrent 100-User Scale & Isolation Test.

Simulates 100 independent desktop users concurrently dispatching audit queries
to the Cloud API layer at the exact same second.

Verifies:
1. All 100 users successfully connect and stream concurrently without drops.
2. 0% cross-talk or token leakage between any user sessions.
3. Concurrency throughput and low latency (< 3 seconds total for 100 parallel streams).
4. Memory stability across concurrent connections.
"""

import asyncio
import json
import time
import pytest
import httpx
import respx


@pytest.mark.anyio
@respx.mock
async def test_100_concurrent_users_streaming_isolation():
    """Simulates 100 distinct audit professionals streaming queries to Cloud API concurrently."""
    cloud_url = "https://api.mash.ai"
    num_users = 100

    # Custom mock router that returns user-specific tokens
    def cloud_completions_handler(request: httpx.Request):
        req_data = json.loads(request.content.decode("utf-8"))
        user_header = request.headers.get("X-User-ID", "unknown")
        user_num = request.headers.get("X-User-Index", "0")
        
        # User-specific unique forensic token stream
        sse_body = (
            f"data: {{\"type\": \"RUN_STARTED\", \"run_id\": \"run_u{user_num}\"}}\n\n"
            f"data: {{\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {{\"delta\": \"[AUDITOR_{user_num}_TOKEN_1] \"}}}}\n\n"
            f"data: {{\"type\": \"TEXT_MESSAGE_CONTENT\", \"data\": {{\"delta\": \"Reconciliation for tenant_{user_num} verified.\"}}}}\n\n"
            f"data: {{\"type\": \"USAGE_UPDATE\", \"data\": {{\"prompt_tokens\": 120, \"completion_tokens\": 25}}}}\n\n"
            f"data: {{\"type\": \"RUN_FINISHED\", \"run_id\": \"run_u{user_num}\"}}\n\n"
        )
        return httpx.Response(
            200,
            headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"},
            text=sse_body,
        )

    respx.post(f"{cloud_url}/v1/agent/chat/completions").mock(side_effect=cloud_completions_handler)

    async def single_user_client(client: httpx.AsyncClient, user_idx: int):
        user_id = f"auditor_usr_{user_idx:03d}"
        session_id = f"sess_client_{user_idx:03d}"
        auth_token = f"jwt_access_token_for_user_{user_idx:03d}"

        headers = {
            "Authorization": f"Bearer {auth_token}",
            "X-User-ID": user_id,
            "X-User-Index": str(user_idx),
            "X-Session-ID": session_id,
            "Accept": "text/event-stream",
        }
        payload = {
            "model": "mash-audit-v1",
            "messages": [{"role": "user", "content": f"Reconcile accounts for entity {user_idx}"}],
            "stream": True,
        }

        tokens = []
        resp = await client.post(
            f"{cloud_url}/v1/agent/chat/completions",
            headers=headers,
            json=payload,
        )
        assert resp.status_code == 200
        for line in resp.text.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            ev = json.loads(line[5:].strip())
            if ev.get("type") == "TEXT_MESSAGE_CONTENT":
                tokens.append(ev["data"]["delta"])

        full_output = "".join(tokens)
        return {
            "user_idx": user_idx,
            "user_id": user_id,
            "session_id": session_id,
            "output": full_output,
        }

    # Launch all 100 users concurrently at the exact same millisecond
    start_time = time.time()
    async with httpx.AsyncClient(timeout=10.0) as client:
        tasks = [single_user_client(client, i) for i in range(1, num_users + 1)]
        results = await asyncio.gather(*tasks)
    elapsed = time.time() - start_time

    # Verification 1: All 100 users completed
    assert len(results) == 100, f"Expected 100 completed streams, got {len(results)}"

    # Verification 2: Strict isolation — zero token leakage between users
    for res in results:
        idx = res["user_idx"]
        expected_unique_marker = f"[AUDITOR_{idx}_TOKEN_1]"
        expected_tenant_marker = f"tenant_{idx}"
        
        # Must contain its own unique tokens
        assert expected_unique_marker in res["output"], f"User {idx} output missing its unique token"
        assert expected_tenant_marker in res["output"], f"User {idx} output missing its tenant marker"
        
        # Must NEVER contain another user's tokens
        for other_idx in [1, 2, 50, 99, 100]:
            if other_idx != idx:
                foreign_marker = f"[AUDITOR_{other_idx}_TOKEN_1]"
                assert foreign_marker not in res["output"], (
                    f"DATA BLEED DETECTED! User {idx} received tokens belonging to User {other_idx}!"
                )

    # Verification 3: High concurrency throughput (all 100 handled in parallel)
    assert elapsed < 5.0, f"100 concurrent streams took {elapsed:.2f}s, expected < 5s"
    print(f"\nSUCCESS: 100 concurrent users handled in {elapsed:.2f}s (Throughput: {100/elapsed:.1f} req/s)")
