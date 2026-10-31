# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0.
"""Exhaustive end-to-end audit and verification of all 10 active runtime tools."""

import os
from pathlib import Path

from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin import (
    audit_skill_tool,
    duckduckgo_web_search,
    glob,
    replace_file_content,
    run_shell_command,
    search_file_content,
    view_file,
    web_fetch,
    write_file,
)
from nexau.archs.tool.builtin.background_task_manage_tool import background_task_manage_tool


def test_01_write_file_canonical_and_aliases(tmp_path: Path):
    target = tmp_path / "doc1.txt"

    # Canonical parameters
    res1 = write_file(file_path=str(target), content="Hello World\nLine 2")
    assert "Successfully created" in res1["content"]
    assert target.exists()

    # Alias parameters (Path, Content)
    target2 = tmp_path / "doc2.txt"
    res2 = write_file(Path=str(target2), Content="Alias content works")
    assert "Successfully created" in res2["content"]
    assert target2.read_text(encoding="utf-8") == "Alias content works"

    # Overwrite guard
    res3 = write_file(file_path=str(target), content="New content", overwrite=False)
    assert res3.get("error", {}).get("type") == "FILE_ALREADY_EXISTS"


def test_02_view_file_canonical_and_aliases(tmp_path: Path):
    target = tmp_path / "code.py"
    target.write_text("line1\nline2\nline3\nline4\nline5\n", encoding="utf-8")

    # Canonical AbsolutePath
    res1 = view_file(AbsolutePath=str(target), StartLine=1, EndLine=3)
    assert "line1" in res1["content"]
    assert "line3" in res1["content"]

    # Alias Path
    res2 = view_file(Path=str(target), StartLine=4, EndLine=5)
    assert "line4" in res2["content"]
    assert "line5" in res2["content"]

    # Non-existent file
    res3 = view_file(AbsolutePath="C:/non_existent_file_xyz_123.txt")
    assert "does not exist" in res3["content"]


def test_03_replace_file_content_canonical_and_aliases(tmp_path: Path):
    target = tmp_path / "replace_target.py"
    target.write_text("def old_func():\n    return 42\n", encoding="utf-8")

    # Canonical parameters
    res1 = replace_file_content(
        TargetFile=str(target),
        TargetContent="def old_func():\n    return 42\n",
        ReplacementContent="def new_func():\n    return 100\n",
    )
    assert "Successfully updated" in res1["content"]
    assert "def new_func():" in target.read_text(encoding="utf-8")

    # Alias Path
    res2 = replace_file_content(
        Path=str(target),
        TargetContent="def new_func():\n    return 100\n",
        ReplacementContent="def final_func():\n    return 200\n",
    )
    assert "Successfully updated" in res2["content"]
    assert "def final_func():" in target.read_text(encoding="utf-8")

    # Target not found
    res3 = replace_file_content(
        TargetFile=str(target),
        TargetContent="def non_existent_func():",
        ReplacementContent="def bar():",
    )
    assert "Error:" in res3["content"]


def test_04_search_file_content_canonical_and_aliases(tmp_path: Path):
    (tmp_path / "sample.py").write_text("SPECIAL_SEARCH_TOKEN_123 = True\n", encoding="utf-8")

    # Canonical pattern
    res1 = search_file_content(pattern="SPECIAL_SEARCH_TOKEN_123", dir_path=str(tmp_path))
    assert "SPECIAL_SEARCH_TOKEN_123" in res1["content"]

    # Alias Query
    res2 = search_file_content(Query="SPECIAL_SEARCH_TOKEN_123", SearchPath=str(tmp_path))
    assert "SPECIAL_SEARCH_TOKEN_123" in res2["content"]

    # Alias Pattern and Path
    res3 = search_file_content(Pattern="SPECIAL_SEARCH_TOKEN_123", Path=str(tmp_path))
    assert "SPECIAL_SEARCH_TOKEN_123" in res3["content"]


def test_05_glob_canonical_and_slashes(tmp_path: Path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "leaf.py").write_text("x = 1\n", encoding="utf-8")

    # Slash in pattern
    res1 = glob(pattern="sub/*.py", dir_path=str(tmp_path))
    assert "leaf.py" in res1["content"]

    # Windows backslash
    res2 = glob(pattern="sub\\*.py", dir_path=str(tmp_path))
    assert "leaf.py" in res2["content"]

    # Leading ./
    res3 = glob(pattern="./sub/*.py", dir_path=str(tmp_path))
    assert "leaf.py" in res3["content"]


def test_06_run_shell_command_canonical_and_aliases():
    # Canonical
    res1 = run_shell_command(command="python -c \"print('RUN_CMD_TEST_OK')\"")
    assert "RUN_CMD_TEST_OK" in res1["content"]

    # Alias CommandLine
    res2 = run_shell_command(CommandLine="python -c \"print('COMMAND_LINE_ALIAS_OK')\"")
    assert "COMMAND_LINE_ALIAS_OK" in res2["content"]

    # Alias cmd
    res3 = run_shell_command(cmd="python -c \"print('CMD_ALIAS_OK')\"")
    assert "CMD_ALIAS_OK" in res3["content"]


def test_07_background_task_manage_tool():
    # List
    res_list = background_task_manage_tool(action="list")
    assert res_list["status"] == "success"

    # Spawn real background process
    start_res = run_shell_command(
        command="python -c \"import time; time.sleep(15)\"",
        is_background=True,
    )
    pids = start_res.get("backgroundPids", [])
    assert len(pids) > 0
    bg_pid = pids[0]

    # Status via TaskId alias
    res_status = background_task_manage_tool(action="status", TaskId=str(bg_pid))
    assert res_status["status"] == "running"

    # Kill
    res_kill = background_task_manage_tool(action="kill", pid=bg_pid)
    assert res_kill["status"] == "success"


def test_08_duckduckgo_web_search_aliases():
    # Empty query error handling
    res_err = duckduckgo_web_search()
    assert res_err.get("error", {}).get("type") == "INVALID_QUERY"

    # Alias Query parameter
    res = duckduckgo_web_search(Query="test query")
    assert "Web search" in res["content"] or "results" in res["content"].lower()


def test_09_web_fetch_aliases():
    # Empty prompt error handling
    res_err = web_fetch()
    assert res_err.get("error", {}).get("type") == "INVALID_PROMPT"

    # Alias Url parameter
    res = web_fetch(Url="https://example.com")
    assert res.get("content") is not None
    assert "returnDisplay" in res


def test_10_audit_skill_tool_canonical_and_aliases():
    # Canonical action
    res1 = audit_skill_tool(action="get_guide")
    assert "Master Navigation Guide" in res1["content"]

    # Alias Action
    res2 = audit_skill_tool(Action="get_guide")
    assert "Master Navigation Guide" in res2["content"]

    # Skill retrieval
    res3 = audit_skill_tool(Action="get_skill", SkillName="audit-sampling-methodology")
    assert "Sampling" in res3["content"] or "Audit" in res3["content"]
