# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0.
"""Unit tests for background_task_manage_tool."""

import time
from pathlib import Path
from unittest.mock import MagicMock

from nexau.archs.sandbox.base_sandbox import CommandResult, SandboxStatus
from nexau.archs.tool.builtin.background_task_manage_tool import background_task_manage_tool


def test_background_task_list_empty():
    res = background_task_manage_tool(action="list")
    assert res["status"] == "success"
    assert res["action"] == "list"
    assert isinstance(res["tasks"], list)


def test_background_task_missing_pid():
    res_status = background_task_manage_tool(action="status")
    assert res_status["status"] == "error"
    assert "pid is required" in res_status["error"]

    res_kill = background_task_manage_tool(action="kill")
    assert res_kill["status"] == "error"
    assert "pid is required" in res_kill["error"]


def test_background_task_unknown_action():
    res = background_task_manage_tool(action="restart", pid=123)
    assert res["status"] == "error"
    assert "Unknown action" in res["error"]


def test_background_task_pid_aliases():
    mock_sandbox = MagicMock()
    mock_sandbox.list_background_tasks.return_value = {}
    mock_sandbox.get_background_task_status.return_value = CommandResult(
        status=SandboxStatus.RUNNING,
        stdout="running...",
        stderr="",
        exit_code=-1,
        duration_ms=500,
    )
    mock_agent_state = MagicMock()
    mock_agent_state.get_sandbox.return_value = mock_sandbox

    # Test TaskId alias
    res1 = background_task_manage_tool(action="status", TaskId="42", agent_state=mock_agent_state)
    assert res1["status"] == "running"
    assert res1["pid"] == 42

    # Test task_id alias
    res2 = background_task_manage_tool(action="status", task_id=99, agent_state=mock_agent_state)
    assert res2["status"] == "running"
    assert res2["pid"] == 99


def test_background_task_not_found():
    mock_sandbox = MagicMock()
    mock_sandbox.list_background_tasks.return_value = {}
    mock_sandbox.get_background_task_status.return_value = CommandResult(
        status=SandboxStatus.ERROR,
        error="Background task not found: pid=9999",
        exit_code=-1,
        duration_ms=0,
    )
    mock_agent_state = MagicMock()
    mock_agent_state.get_sandbox.return_value = mock_sandbox

    res = background_task_manage_tool(action="status", pid=9999, agent_state=mock_agent_state)
    assert res["status"] == "not_found"
    assert res["pid"] == 9999
