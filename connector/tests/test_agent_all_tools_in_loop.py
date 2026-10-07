# Copyright (c) Mash. All rights reserved.
"""End-to-end verification of all 10 tools executed inside the live Agent loop."""

import os
import sys
import json
from pathlib import Path
from unittest.mock import Mock
import pytest
import httpx
import respx

from nexau import Agent
from app.main import _build_agent_config

from openai.types.chat import ChatCompletion, ChatCompletionMessage
from openai.types.chat.chat_completion_message_tool_call import (
    ChatCompletionMessageToolCall,
    Function,
)
from openai.types.completion_usage import CompletionUsage


def _execute_tool_in_agent_loop(tool_name: str, arguments: dict, task_prompt: str):
    """Executes a real Agent instance, tasking it with a prompt and delivering a tool call for tool_name."""
    cfg = _build_agent_config()
    cfg.llm_config.stream = False

    tool_call_id = f"call_{tool_name}_live"
    tool_call = ChatCompletionMessageToolCall(
        id=tool_call_id,
        type="function",
        function=Function(
            name=tool_name,
            arguments=json.dumps(arguments),
        ),
    )

    resp_with_tool = ChatCompletion(
        id=f"chatcmpl-{tool_name}-1",
        choices=[{
            "index": 0,
            "message": ChatCompletionMessage(role="assistant", content=None, tool_calls=[tool_call]),
            "finish_reason": "tool_calls",
        }],
        created=1234567890,
        model="mock-model",
        object="chat.completion",
        usage=CompletionUsage(completion_tokens=15, prompt_tokens=25, total_tokens=40),
    )

    captured_tool_result = []
    call_count = 0

    def mock_create(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return resp_with_tool

        messages = kwargs.get("messages", [])
        for m in messages:
            if isinstance(m, dict) and m.get("role") == "tool" and m.get("tool_call_id") == tool_call_id:
                captured_tool_result.append(m.get("content"))

        return ChatCompletion(
            id=f"chatcmpl-{tool_name}-2",
            choices=[{
                "index": 0,
                "message": ChatCompletionMessage(
                    role="assistant",
                    content=f"Tool {tool_name} executed successfully inside agent.",
                ),
                "finish_reason": "stop",
            }],
            created=1234567891,
            model="mock-model",
            object="chat.completion",
            usage=CompletionUsage(completion_tokens=20, prompt_tokens=50, total_tokens=70),
        )

    mock_client = Mock()
    mock_client.chat.completions.create.side_effect = mock_create

    agent = Agent(config=cfg)
    final_output = agent.run(
        message=task_prompt,
        custom_llm_client_provider=lambda name: mock_client,
    )

    return final_output, captured_tool_result


def test_agent_file_tools_in_loop(tmp_path):
    """Verify write_file, view_file, replace_file_content, search_file_content, and glob inside Agent."""
    memo_file = tmp_path / "audit_checklist.txt"
    memo_str = str(memo_file).replace("\\", "/")

    # 1. write_file
    _, tool_res = _execute_tool_in_agent_loop(
        "write_file",
        {"file_path": memo_str, "content": "Header: Statutory Audit\nStatus: Pending Verification\n", "overwrite": True},
        "Create audit checklist file.",
    )
    assert memo_file.exists(), "write_file failed to create file"
    assert len(tool_res) > 0, "Agent did not receive write_file output"

    # 2. view_file
    _, tool_res = _execute_tool_in_agent_loop(
        "view_file",
        {"AbsolutePath": memo_str},
        "View the audit checklist.",
    )
    assert len(tool_res) > 0 and "Statutory Audit" in str(tool_res[0]), "view_file content missing in agent output"

    # 3. replace_file_content
    _, tool_res = _execute_tool_in_agent_loop(
        "replace_file_content",
        {
            "TargetFile": memo_str,
            "StartLine": 2,
            "EndLine": 2,
            "TargetContent": "Status: Pending Verification",
            "ReplacementContent": "Status: Completed and Signed Off",
        },
        "Update audit checklist status.",
    )
    assert "Signed Off" in memo_file.read_text(encoding="utf-8"), "replace_file_content failed to modify file"

    # 4. search_file_content
    _, tool_res = _execute_tool_in_agent_loop(
        "search_file_content",
        {"pattern": "Signed Off", "dir_path": str(tmp_path).replace("\\", "/")},
        "Search for signed off items in workspace.",
    )
    assert len(tool_res) > 0 and "Signed Off" in str(tool_res[0]), "search_file_content pattern not found"

    # 5. glob
    _, tool_res = _execute_tool_in_agent_loop(
        "glob",
        {"pattern": "audit_checklist.*", "dir_path": str(tmp_path).replace("\\", "/")},
        "Locate checklist files.",
    )
    assert len(tool_res) > 0 and "audit_checklist.txt" in str(tool_res[0]), "glob failed to find file"


def test_agent_execution_and_domain_tools_in_loop():
    """Verify run_shell_command, audit_skill_tool, and background_task_manage_tool inside Agent."""
    # 6. run_shell_command
    _, tool_res = _execute_tool_in_agent_loop(
        "run_shell_command",
        {"command": "echo LIVE_AGENT_OK"},
        "Run echo command.",
    )
    assert len(tool_res) > 0 and "LIVE_AGENT_OK" in str(tool_res[0]), "run_shell_command failed in agent"

    # 7. audit_skill_tool
    _, tool_res = _execute_tool_in_agent_loop(
        "audit_skill_tool",
        {"action": "get_skill", "skill_name": "accounts-payable-testing"},
        "Retrieve accounts payable procedure.",
    )
    assert len(tool_res) > 0 and "Accounts Payable" in str(tool_res[0]), "audit_skill_tool failed in agent"

    # 8. background_task_manage_tool
    _, tool_res = _execute_tool_in_agent_loop(
        "background_task_manage_tool",
        {"action": "list"},
        "List running background tasks.",
    )
    assert len(tool_res) > 0, "background_task_manage_tool failed in agent"


def test_agent_web_tools_in_loop():
    """Verify web_fetch and web_search inside Agent."""
    # 9. web_fetch
    with respx.mock(assert_all_called=False) as respx_mock:
        respx_mock.get("https://audit-standard.example.org").mock(
            return_value=httpx.Response(200, text="<html><body><h1>ICAI Guidance 2026</h1><p>Standard text</p></body></html>")
        )
        _, tool_res = _execute_tool_in_agent_loop(
            "web_fetch",
            {"url": "https://audit-standard.example.org"},
            "Fetch online standard.",
        )
    assert len(tool_res) > 0 and "ICAI Guidance 2026" in str(tool_res[0]), "web_fetch failed in agent"

    # 10. web_search
    with respx.mock(assert_all_called=False) as respx_mock:
        respx_mock.post("https://html.duckduckgo.com/html/").mock(
            return_value=httpx.Response(
                200,
                text='<html><body><div class="results"><a class="result__url" href="https://icai.org">ICAI</a><a class="result__snippet">Statutory Audit Guidelines</a></div></body></html>',
            )
        )
        _, tool_res = _execute_tool_in_agent_loop(
            "web_search",
            {"query": "ICAI Audit Guidelines"},
            "Search for ICAI guidelines.",
        )
    assert len(tool_res) > 0, "web_search failed in agent"
