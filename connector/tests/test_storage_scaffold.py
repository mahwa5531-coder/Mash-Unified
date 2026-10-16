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
