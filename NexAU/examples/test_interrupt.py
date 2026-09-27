# RFC-0001 : Agent 
#
# ：
#   1.  sleep_tool  Agent（）
#   2.  sleep_tool 20 
#   3.  5  stop
#   4. ，
#
# ：
#   uv run python examples/test_interrupt.py          #  agent.stop()
#   uv run python examples/test_interrupt.py direct    # 
#   uv run python examples/test_interrupt.py http      #  HTTP transport POST /stop

import asyncio
import json
import logging
from typing import Any
import sys
import threading
import time

import httpx

from nexau import Agent, AgentConfig
from nexau.archs.llm.llm_aggregators.events import Event, ToolCallResultEvent
from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.execution.middleware.agent_events_middleware import (
    AgentEventsMiddleware,
)
from nexau.archs.session import InMemoryDatabaseEngine
from nexau.archs.tool import Tool
from nexau.archs.transports.http import HTTPConfig, SSETransportServer

logging.basicConfig(level=logging.WARNING)

# ──  ──────────────────────────────────────────────

tool_call_count = 0


def sleep_tool(seconds: int = 1) -> str:
    """Sleep for the given number of seconds and return a confirmation."""
    global tool_call_count
    tool_call_count += 1
    current = tool_call_count
    print(f"  🔧 sleep_tool  {current} ， {seconds}s ...")
    time.sleep(seconds)
    return f"Slept for {seconds} second(s). This is call #{current}."


sleep = Tool(
    name="sleep_tool",
    description=(
        "Sleep for a given number of seconds. "
        "Use this tool when asked to sleep or wait. "
        "IMPORTANT: You can only call this tool ONCE per response. "
        "Wait for the result before calling it again."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "seconds": {
                "type": "integer",
                "description": "Number of seconds to sleep",
                "default": 1,
            },
        },
        "required": [],
    },
    implementation=sleep_tool,
    disable_parallel=True,
)

SYSTEM_PROMPT = (
    "You are a helpful assistant. "
    "CRITICAL RULE: You must NEVER call more than ONE tool per response. "
    "After calling a tool, you MUST stop and wait for the result. "
    "Only after receiving the result can you call the tool again in your next response. "
    "Calling multiple tools in a single response is STRICTLY FORBIDDEN."
)

USER_MESSAGE = " sleep_tool  20 ， 1 。： sleep_tool，。"

FOLLOWUP_MESSAGE = " sleep_tool？。"


# ── Mode 1:  agent.stop() ─────────────────────────


async def main_direct() -> None:
    """Test stop via direct agent.stop() call."""
    global tool_call_count

    print("=" * 60)
    print("RFC-0001 : Agent  (direct mode)")
    print("=" * 60)

    tool_result_count = 0
    interrupt_triggered = threading.Event()

    def on_event(event: Event) -> None:
        nonlocal tool_result_count
        if isinstance(event, ToolCallResultEvent):
            tool_result_count += 1
            print(f"  📩  {tool_result_count} ")
            if tool_result_count >= 5:
                print("  ⚡  5 ， stop ...")
                interrupt_triggered.set()

    # 1.  Agent（）
    middleware = AgentEventsMiddleware(
        session_id="interrupt_test",
        on_event=on_event,
    )

    config = AgentConfig(
        name="interrupt_test_agent",
        system_prompt=SYSTEM_PROMPT,
        llm_config=LLMConfig(stream=True),
        tools=[sleep],
        middlewares=[middleware],
        max_iterations=25,
    )

    agent = Agent(config=config)

    # 2. ： sleep_tool 20 
    print("\n📤 :  sleep_tool 20 ， 1 ")
    print("-" * 60)

    async def run_agent() -> str:
        resp = await agent.run_async(message=USER_MESSAGE)
        return resp if isinstance(resp, str) else resp[0]

    agent_task = asyncio.create_task(run_agent())

    #  5 
    while not interrupt_triggered.is_set():
        await asyncio.sleep(0.2)
    await asyncio.sleep(0.5)

    # 3.  stop
    print("\n🛑  stop(force=True) ...")
    result = await agent.stop(force=True)
    print(f"  ✅ stop ")
    print(f"  📊 stop_reason = {result.stop_reason.name}")
    print(f"  📊  = {len(result.messages)}")
    print(f"  📊  = {tool_call_count}")

    #  agent_task 
    try:
        response = await asyncio.wait_for(agent_task, timeout=5.0)
        print(f"\n📥 : {response[:200]}...")
    except (asyncio.TimeoutError, asyncio.CancelledError, Exception) as e:
        print(f"\n📥 : {type(e).__name__}")

    # 4. ：
    print("\n" + "=" * 60)
    print("📤 :  sleep_tool？")
    print("-" * 60)

    response2_raw = await agent.run_async(message=FOLLOWUP_MESSAGE)
    response2 = response2_raw if isinstance(response2_raw, str) else response2_raw[0]
    print(f"\n📥 :\n{response2}")

    # 5. 
    _print_summary(tool_call_count, tool_result_count, len(result.messages), response2)

    await agent.stop(force=True)


# ── Mode 2:  HTTP transport POST /stop ────────────────

HTTP_PORT = 18765
BASE_URL = f"http://127.0.0.1:{HTTP_PORT}"
SESSION_ID = "http_stop_test"
USER_ID = "test_user"


async def main_http() -> None:
    """Test stop via HTTP transport POST /stop endpoint."""
    global tool_call_count

    print("=" * 60)
    print("RFC-0001 : Agent  (http mode)")
    print("=" * 60)

    # 1.  SSE Transport Server
    engine = InMemoryDatabaseEngine()
    agent_config = AgentConfig(
        name="interrupt_test_agent",
        system_prompt=SYSTEM_PROMPT,
        llm_config=LLMConfig(stream=True),
        tools=[sleep],
        max_iterations=25,
    )

    server = SSETransportServer(
        engine=engine,
        config=HTTPConfig(port=HTTP_PORT),
        default_agent_config=agent_config,
    )

    # 2.  uvicorn 
    import uvicorn

    server_thread = threading.Thread(
        target=lambda: uvicorn.run(
            server.app,
            host="127.0.0.1",
            port=HTTP_PORT,
            log_level="warning",
        ),
        daemon=True,
    )
    server_thread.start()

    await _wait_for_server(BASE_URL)
    print("✅ HTTP ")

    # 3.  5  stop
    tool_result_count = 0
    stop_result_data: dict[str, Any] | None = None

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=120.0) as client:
        # （）
        stream_done = asyncio.Event()

        async def consume_stream() -> None:
            nonlocal tool_result_count
            try:
                async with client.stream(
                    "POST",
                    "/stream",
                    json={
                        "messages": USER_MESSAGE,
                        "user_id": USER_ID,
                        "session_id": SESSION_ID,
                    },
                ) as response:
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        try:
                            data = json.loads(line[6:])
                        except json.JSONDecodeError:
                            continue
                        event_type = data.get("type", "")
                        if event_type == "TOOL_CALL_RESULT":
                            tool_result_count += 1
                            print(f"  📩 [SSE]  {tool_result_count} ")
            except httpx.RemoteProtocolError:
                #  stop 
                pass
            except Exception as e:
                print(f"  ⚠️ : {type(e).__name__}: {e}")
            finally:
                stream_done.set()

        stream_task = asyncio.create_task(consume_stream())

        #  5 
        print("\n📤  (via POST /stream):  sleep_tool 20 ")
        print("-" * 60)

        while tool_result_count < 5 and not stream_done.is_set():
            await asyncio.sleep(0.2)

        if tool_result_count >= 5:
            await asyncio.sleep(0.5)  #  5 

            # 4.  POST /stop
            print(f"\n🛑  POST /stop (force=True) ...")
            stop_resp = await client.post(
                "/stop",
                json={
                    "user_id": USER_ID,
                    "session_id": SESSION_ID,
                    "force": True,
                    "timeout": 30.0,
                },
            )
            stop_result_data = stop_resp.json()
            print(f"  ✅ /stop : {stop_result_data}")
        else:
            print("  ⚠️ ， 5 ")

        await asyncio.wait_for(stream_task, timeout=10.0)

        # 5. ： POST /query 
        print("\n" + "=" * 60)
        print("📤  (via POST /query):  sleep_tool？")
        print("-" * 60)

        query_resp = await client.post(
            "/query",
            json={
                "messages": FOLLOWUP_MESSAGE,
                "user_id": USER_ID,
                "session_id": SESSION_ID,
            },
        )
        query_data = query_resp.json()
        response2 = query_data.get("response", "")
        print(f"\n📥 :\n{response2}")

    # 6. 
    message_count = int(stop_result_data.get("message_count", 0)) if stop_result_data else 0
    _print_summary(tool_call_count, tool_result_count, message_count, response2)


# ──  ──────────────────────────────────────────────


async def _wait_for_server(base_url: str, retries: int = 20) -> None:
    """Poll server until it responds to health check."""
    async with httpx.AsyncClient() as client:
        for _ in range(retries):
            try:
                resp = await client.get(f"{base_url}/docs")
                if resp.status_code == 200:
                    return
            except httpx.ConnectError:
                pass
            await asyncio.sleep(0.3)
    raise RuntimeError(f"Server at {base_url} did not start in time")


def _print_summary(calls: int, results: int, message_count: int, response2: str) -> None:
    """Print verification summary."""
    print("\n" + "=" * 60)
    print("📊 :")
    print(f"  - : {calls}")
    print(f"  - : {results}")
    print(f"  - : {message_count}")
    print(f"  - : {'' if response2 else ''}")
    print("=" * 60)


# ──  ──────────────────────────────────────────────────

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "direct"
    if mode == "http":
        asyncio.run(main_http())
    else:
        asyncio.run(main_direct())