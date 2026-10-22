from pathlib import Path
from unittest.mock import patch

import pytest
from app.services.session_transcript import (
    messages_to_transcript_lines,
    redact_sensitive_content,
)
from nexau.core.messages import Message, Role, TextBlock, ToolResultBlock, ToolUseBlock


def test_redact_sensitive_content_connector():
    """Verify regex redaction of secrets in connector transcript service."""
    # API keys
    assert redact_sensitive_content("OpenAI key sk-1234567890abcdef12345678") == "OpenAI key [REDACTED]"
    assert redact_sensitive_content("Anthropic key sk-ant-api03-1234567890abcdef") == "Anthropic key [REDACTED]"
    assert redact_sensitive_content("Github token ghp_1234567890abcdef12345678") == "Github token [REDACTED]"
    assert redact_sensitive_content("Google key AIzaSyD-1234567890abcdef1234") == "Google key [REDACTED]"

    # Bearer tokens
    assert redact_sensitive_content("Bearer eyJhbGciOiJIUzI1Ni.secret.sig") == "Bearer [REDACTED]"
    assert redact_sensitive_content("header Bearer abc123def456_xyz789") == "header Bearer [REDACTED]"

    # Auth headers
    assert redact_sensitive_content('{"Authorization": "Bearer tok_123"}') == '{"Authorization": "[REDACTED]"}'
    assert redact_sensitive_content("{'Authorization': 'Basic dXNlcjpwYXNz'}") == "{'Authorization': '[REDACTED]'}"


def test_messages_to_transcript_lines_redacts_secrets():
    """Verify messages_to_transcript_lines cleanses secrets before returning lines to UI."""
    msg_user = Message(
        role=Role.USER,
        content=[TextBlock(text="Here is my token: Bearer eyJhbGciOiJIUzI1Ni.secret.sig and sk-1234567890abcdef12345678")],
    )

    msg_assistant = Message(
        role=Role.ASSISTANT,
        content=[
            ToolUseBlock(
                id="call_123",
                name="bash",
                input={"command": "curl -H 'Authorization: Bearer my_secret_token' https://api.com", "toolAction": "Running curl"},
            ),
            TextBlock(text="Executing command with sk-ant-api03-1234567890abcdef"),
        ],
    )

    msg_tool = Message(
        role=Role.TOOL,
        content=[
            ToolResultBlock(
                tool_use_id="call_123",
                content='{"Authorization": "Bearer response_token", "status": "ok"}',
            )
        ],
    )

    lines = messages_to_transcript_lines([msg_user, msg_assistant, msg_tool])
    assert len(lines) == 2  # user and assistant lines

    # User line text check
    assert "Bearer [REDACTED]" in lines[0]["content"]
    assert "[REDACTED]" in lines[0]["content"]
    assert "eyJhbGci" not in lines[0]["content"]
    assert "sk-1234" not in lines[0]["content"]

    # Assistant line tool check
    tool_entry = lines[1]["tools"][0]
    assert "Bearer [REDACTED]" in tool_entry["args"]["command"]
    assert "my_secret_token" not in tool_entry["args"]["command"]

    # Tool output check
    assert "[REDACTED]" in tool_entry["output"]
    assert "response_token" not in tool_entry["output"]


def test_messages_to_transcript_lines_metadata_and_unique_step_ids():
    """Verify messages_to_transcript_lines preserves toolSummary, toolAction, decision and enforces unique step IDs."""
    msg_assistant = Message(
        role=Role.ASSISTANT,
        content=[
            TextBlock(text="Checking files..."),
            ToolUseBlock(
                id="call_read_01",
                name="read_file",
                input={"TargetFile": "auth.ts", "toolAction": "Inspecting auth router", "toolSummary": "Auth router inspection"},
            ),
            TextBlock(text="Refactored code."),
        ],
    )
    msg_tool = Message(
        role=Role.TOOL,
        content=[ToolResultBlock(tool_use_id="call_read_01", content="file content")],
    )

    pending_map = {"call_read_01": {"decision": "allow", "prompt": "Auth router inspection"}}
    lines = messages_to_transcript_lines([msg_assistant, msg_tool], pending_map=pending_map)

    assert len(lines) == 1
    asst_line = lines[0]

    # Verify tool entry metadata
    assert len(asst_line["tools"]) == 1
    t = asst_line["tools"][0]
    assert t["toolAction"] == "Inspecting auth router"
    assert t["toolSummary"] == "Auth router inspection"
    assert t["decision"] == "allow"

    # Verify step entry metadata and strictly unique step IDs
    assert len(asst_line["steps"]) == 3
    s0 = asst_line["steps"][0]
    s1 = asst_line["steps"][1]
    s2 = asst_line["steps"][2]

    assert s0["id"] == "step_0_0"
    assert s0["type"] == "text"

    assert s1["id"] == "step_0_1"
    assert s1["type"] == "tool"
    assert s1["tool_call_id"] == "call_read_01"
    assert s1["toolAction"] == "Inspecting auth router"
    assert s1["toolSummary"] == "Auth router inspection"
    assert s1["decision"] == "allow"

    assert s2["id"] == "step_0_2"
    assert s2["type"] == "text"

    # Ensure step IDs are strictly unique per turn
    step_ids = [s["id"] for s in asst_line["steps"]]
    assert len(step_ids) == len(set(step_ids))


def test_tasks_brain_resolution_order(tmp_path):
    """Verify tasks router searches .mash/brain before .nexau/brain."""
    fake_home = tmp_path / "userhome"
    mash_log = fake_home / ".mash" / "brain" / "sess_1" / ".system_generated" / "tasks" / "task-101.log"
    nexau_log = fake_home / ".nexau" / "brain" / "sess_2" / ".system_generated" / "tasks" / "task-102.log"
    mash_log.parent.mkdir(parents=True, exist_ok=True)
    nexau_log.parent.mkdir(parents=True, exist_ok=True)
    mash_log.write_text("MASH_LOG_DATA", encoding="utf-8")
    nexau_log.write_text("NEXAU_LOG_DATA", encoding="utf-8")

    from app.routers.tasks import get_task_log
    import asyncio
    import inspect

    with patch("pathlib.Path.home", return_value=fake_home):
        if inspect.iscoroutinefunction(get_task_log):
            out_mash = asyncio.run(get_task_log("101"))
            out_nexau = asyncio.run(get_task_log("102"))
        else:
            out_mash = get_task_log("101")
            out_nexau = get_task_log("102")

        assert out_mash["content"] == "MASH_LOG_DATA"
        assert out_nexau["content"] == "NEXAU_LOG_DATA"


def test_system_folder_candidates_includes_mash(tmp_path):
    """Verify system resolve_folder_endpoint includes ~/.mash/projects."""
    fake_home = tmp_path / "userhome"
    target_proj = fake_home / ".mash" / "projects" / "my_mash_proj"
    target_proj.mkdir(parents=True, exist_ok=True)

    from app.routers.system import ResolveFolderRequest, resolve_folder_endpoint
    import asyncio

    with patch("pathlib.Path.home", return_value=fake_home):
        req = ResolveFolderRequest(folder_name="my_mash_proj")
        res = asyncio.run(resolve_folder_endpoint(req))
        assert res["status"] == "success"
        assert res["folder_path"] == str(target_proj.resolve())


@pytest.mark.anyio
async def test_create_session_normalizes_null_project_id():
    """D-03: Passing 'null', 'undefined', or empty string as project_id must normalize to None."""
    from unittest.mock import AsyncMock, MagicMock, patch
    from app.services.session_lifecycle import create_new_session, list_project_sessions

    mock_engine = MagicMock()
    mock_engine.find_first = AsyncMock(return_value=None)
    mock_engine.find_many = AsyncMock(return_value=[])
    mock_engine.create = AsyncMock()

    with patch("app.routers.chat._sse_server", None):
        # create_new_session with string 'null'
        res = await create_new_session(engine=mock_engine, session_id="sess_test_null_proj", project_id="null")
        assert res["status"] == "success"

        created_model = mock_engine.create.call_args[0][0]
        assert created_model.context["project_id"] is None

        # list_project_sessions with 'null'
        list_res = await list_project_sessions(engine=mock_engine, project_id="null")
        assert list_res == {"sessions": []}


@pytest.mark.anyio
async def test_chat_preserves_custom_session_title_on_subsequent_turns():
    """D5: Subsequent chat turns must not clobber custom or already generated session titles."""
    from unittest.mock import AsyncMock, MagicMock
    from nexau.archs.session.models import SessionModel
    from app.routers.chat import _ensure_project_and_context

    existing_session = SessionModel(
        session_id="sess_custom_title_test",
        user_id="default_user",
        context={"title": "Q3 Financial Audit Plan", "custom_title": "Q3 Financial Audit Plan"},
    )

    mock_engine = MagicMock()
    mock_engine.find_first = AsyncMock(return_value=existing_session)
    mock_engine.update = AsyncMock()

    resolved_ctx = {
        "_raw_message": "Tell me what time it is right now in Tokyo",
        "working_directory": None,
    }

    await _ensure_project_and_context(
        eng=mock_engine,
        user_id="default_user",
        sid="sess_custom_title_test",
        resolved_context=resolved_ctx,
        workspace_target="No Repo",
    )

    # 1. resolved_context passed to NexAU must retain the custom title
    assert resolved_ctx["title"] == "Q3 Financial Audit Plan"
    assert resolved_ctx["custom_title"] == "Q3 Financial Audit Plan"

    # 2. Database update must retain the custom title
    updated_session = mock_engine.update.call_args[0][0]
    assert updated_session.context["title"] == "Q3 Financial Audit Plan"
    assert updated_session.context["custom_title"] == "Q3 Financial Audit Plan"



