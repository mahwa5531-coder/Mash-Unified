import uuid
from datetime import datetime, timezone
import pytest
from app.main import app, lifespan
from app.dependencies import get_engine
from nexau.archs.session.models import AgentRunActionModel
from nexau.core.messages import Message, Role, TextBlock, ToolUseBlock, ToolResultBlock
from app.services.session_transcript import load_session_transcript

@pytest.mark.anyio
async def test_denied_tool_call_persists_as_denied_after_pending_cleared():
    """Verify Bug F-02 fix: Denied tool calls stay 'denied' in transcript even after pending_tool_calls is cleared."""
    async with lifespan(app):
        eng = get_engine()
        test_id = uuid.uuid4().hex[:8]
        sid = f"sess_denial_{test_id}"
        user_id = "default_user"
        tc_id = f"tc_deny_{test_id}"

        # 1. Create message history where tool was requested and denied
        action = AgentRunActionModel(
            user_id=user_id,
            session_id=sid,
            agent_id="main_agent",
            run_id=f"run_{test_id}",
            root_run_id=f"run_{test_id}",
            action_type="append",
            append_messages=[
                Message(
                    role=Role.ASSISTANT,
                    content=[
                        TextBlock(text="Attempting to purge directories."),
                        ToolUseBlock(
                            id=tc_id,
                            name="run_shell_command",
                            input={"command": "rm -rf sensitive_data"},
                        ),
                    ],
                ),
                Message(
                    role=Role.TOOL,
                    content=[
                        ToolResultBlock(
                            tool_use_id=tc_id,
                            content="Permission denied by user for run_shell_command",
                            is_error=True,
                        )
                    ],
                ),
            ],
            created_at=datetime.now(timezone.utc),
        )
        await eng.create(action)

        # 2. Load transcript with pending_tool_calls = None (already cleared after turn)
        transcript = await load_session_transcript(engine=eng, session_id=sid)
        lines = transcript["lines"]
        assert len(lines) >= 1

        asst_line = [l for l in lines if l.get("role") == "assistant"][0]
        assert len(asst_line["tools"]) == 1
        tool_data = asst_line["tools"][0]

        # Must be 'denied', NEVER 'completed'!
        assert tool_data["status"] == "denied", f"Expected 'denied', got {tool_data['status']}"
        assert tool_data["decision"] == "deny"
        assert "Permission denied" in tool_data["output"]
