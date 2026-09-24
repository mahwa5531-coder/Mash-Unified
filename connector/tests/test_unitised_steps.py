import sys
import os
from pathlib import Path
import pytest
import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "NexAU"))

from app.main import app, lifespan
from app import dependencies as deps
from nexau.archs.session.models import SessionModel, AgentRunActionModel
from nexau.archs.session.orm import ComparisonFilter
from nexau.core.messages import Message

@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"

@pytest.mark.anyio
async def test_unitised_steps_extraction_and_correlation():
    """Verify that get_transcript returns ordered unitised steps with action classification."""
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", timeout=15.0) as client:
            engine = deps.get_engine()
            test_sid = f"test_sess_unitised_{os.getpid()}"
            test_user = "test_user_steps"

            # 1. Create test session
            session_obj = SessionModel(
                session_id=test_sid,
                user_id=test_user,
                context={"title": "Test Unitised Steps"}
            )
            await engine.create(session_obj)

            # 2. Add an assistant action with interleaved blocks:
            # - reasoning block
            # - text block 1
            # - tool_use block
            # - text block 2
            from nexau.core.messages import (
                Message,
                Role,
                ReasoningBlock,
                TextBlock,
                ToolUseBlock,
                ToolResultBlock,
            )

            assistant_msg = Message(
                role=Role.ASSISTANT,
                content=[
                    ReasoningBlock(text="I should read config.json first."),
                    TextBlock(text="Checking the configuration file now..."),
                    ToolUseBlock(
                        id="call_view_123",
                        name="view_file",
                        input={"TargetFile": "config.json", "StartLine": 1, "EndLine": 10},
                    ),
                    TextBlock(text="File read initiated. Next I will edit."),
                ]
            )

            act_assistant = AgentRunActionModel(
                session_id=test_sid,
                user_id=test_user,
                agent_id="test_agent",
                run_id="run_step_01",
                root_run_id="run_step_01",
                agent_name="assistant",
                action_type="append",
                append_messages=[assistant_msg],
                created_at_ns=1000000000,
            )
            await engine.create(act_assistant)

            # 3. Add tool result action correlating to call_view_123
            tool_msg = Message(
                role=Role.USER,
                content=[
                    ToolResultBlock(
                        tool_use_id="call_view_123",
                        content='{"setting": "enabled"}',
                    )
                ]
            )
            act_tool_res = AgentRunActionModel(
                session_id=test_sid,
                user_id=test_user,
                agent_id="test_agent",
                run_id="run_step_01",
                root_run_id="run_step_01",
                agent_name="tool",
                action_type="append",
                append_messages=[tool_msg],
                created_at_ns=2000000000,
            )
            await engine.create(act_tool_res)

            # 4. Fetch transcript from API
            res = await client.get(f"/sessions/{test_sid}/transcript")
            assert res.status_code == 200
            data = res.json()
            lines = data["lines"]

            # Filter assistant messages
            ai_lines = [l for l in lines if l.get("role") == "assistant"]
            assert len(ai_lines) == 1
            ai_msg = ai_lines[0]

            # Assert steps array exists and has the interleaved items
            steps = ai_msg.get("steps")
            assert steps is not None
            assert len(steps) == 4

            # Step 0: Thinking
            assert steps[0]["type"] == "thinking"
            assert steps[0]["content"] == "I should read config.json first."
            assert steps[0]["step_index"] == 0

            # Step 1: Text
            assert steps[1]["type"] == "text"
            assert steps[1]["content"] == "Checking the configuration file now..."
            assert steps[1]["step_index"] == 1

            # Step 2: Tool call with action_type='read' and correlated output
            assert steps[2]["type"] == "tool"
            assert steps[2]["name"] == "view_file"
            assert steps[2]["tool_call_id"] == "call_view_123"
            assert steps[2]["action_type"] == "read"
            assert "enabled" in steps[2]["output"]
            assert steps[2]["status"] == "completed"
            assert steps[2]["step_index"] == 2

            # Step 3: Text after tool
            assert steps[3]["type"] == "text"
            assert steps[3]["content"] == "File read initiated. Next I will edit."
            assert steps[3]["step_index"] == 3
