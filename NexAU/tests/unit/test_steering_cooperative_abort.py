from __future__ import annotations

import asyncio
from unittest.mock import Mock, MagicMock
import pytest

from nexau.archs.llm.llm_config import LLMConfig
from nexau.archs.main_sub.agent import Agent
from nexau.archs.main_sub.execution.executor import Executor
from nexau.archs.tool.tool_registry import ToolRegistry


def _make_executor(agent_id: str = "test") -> Executor:
    return Executor(
        agent_name=agent_id,
        agent_id=agent_id,
        tool_registry=ToolRegistry(),
        sub_agents={},
        stop_tools=set(),
        openai_client=Mock(),
        llm_config=LLMConfig(model="test-model", api_key="dummy"),
    )


@pytest.mark.anyio
async def test_steering_cooperative_tool_interruption():
    executor = _make_executor("test_steering")

    # 1. Simulate an in-flight tool running in _await_with_shutdown_race
    async def slow_tool():
        await asyncio.sleep(5)
        return "finished"

    # Start the tool race task
    race_task = asyncio.create_task(executor._await_with_shutdown_race(slow_tool(), poll_interval=0.02))

    await asyncio.sleep(0.05)

    # 2. Signal steering interrupt
    executor.signal_steering_interrupt()

    # 3. Must return TOOL_INTERRUPTED_BY_STEERING promptly
    result, interrupted = await race_task
    assert result == "TOOL_INTERRUPTED_BY_STEERING"
    assert interrupted is False


@pytest.mark.anyio
async def test_agent_enqueue_steering_triggers_interrupt():
    executor = _make_executor("test_enqueue")
    mock_agent = MagicMock(spec=Agent)
    mock_agent.executor = executor

    # Call actual enqueue_message logic
    Agent.enqueue_message(mock_agent, {
        "role": "user",
        "content": "<USER_STEERING>\n[USER MID-FLIGHT INSTRUCTION]: stop and check tests\n</USER_STEERING>"
    })

    assert len(executor.queued_messages) == 1
    assert executor._steering_interrupt_event.is_set()
