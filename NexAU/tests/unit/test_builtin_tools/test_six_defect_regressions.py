# Copyright 2026 Google LLC
# SPDX-License-Identifier: Apache-2.0
"""
Regression test suite for the 6 architectural defects from Mash-Unified Tool Test Report:
1. DEF-01: search_file_content & glob exclusion parity (no node_modules leak)
2. DEF-06: run_shell_command output truncation threshold alignment
3. DEF-03: background task registry session isolation
4. Schema promise: killed tasks removed from tracking & list
5. DEF-04: web_fetch schema anyOf prompt-only invocation
6. DEF-09: glob case_sensitive strict discrimination
"""

import tempfile
import pytest
from pathlib import Path
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.file_tools.search_file_content import search_file_content
from nexau.archs.tool.builtin.file_tools.glob_tool import glob
from nexau.archs.tool.builtin.shell_tools.run_shell_command import run_shell_command, TRUNCATE_OUTPUT_THRESHOLD
from nexau.archs.tool.builtin.background_task_manage_tool import background_task_manage_tool
from nexau.archs.tool.builtin.web_tools.web_fetch import web_fetch
from nexau.archs.tool.tool import Tool


def test_def_01_search_and_glob_exclude_node_modules():
    """Verify search_file_content and glob do NOT leak files in node_modules even with absolute paths."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        nm = root / "node_modules" / "pkg"
        nm.mkdir(parents=True, exist_ok=True)
        secret_file = nm / "secret.js"
        secret_file.write_text("const SECRET_API_KEY = 'LEAK1234';", encoding="utf-8")

        clean_dir = root / "src"
        clean_dir.mkdir(parents=True, exist_ok=True)
        good_file = clean_dir / "app.js"
        good_file.write_text("const PUBLIC_KEY = 'SAFE';", encoding="utf-8")

        # 1. search_file_content with absolute path
        res = search_file_content(pattern="SECRET_API_KEY", dir_path=str(root))
        assert "LEAK1234" not in res["content"]
        assert "0 match" in res["returnDisplay"].lower() or "no matches" in res["returnDisplay"].lower()

        # 2. glob with absolute path
        res_glob = glob(pattern="*.js", dir_path=str(root))
        assert "secret.js" not in res_glob["content"]
        assert "app.js" in res_glob["content"]


def test_def_06_run_shell_truncation_threshold():
    """Verify run_shell_command truncation threshold matches sandbox layer (10KB)."""
    assert TRUNCATE_OUTPUT_THRESHOLD == 10_000


def test_foreground_command_timeout_eviction():
    """Verify foreground commands killed by timeout are strictly evicted from task tracking."""
    sandbox = LocalSandbox(work_dir=Path.cwd(), sandbox_id="test-timeout-evict")
    res = run_shell_command(
        command='python -c "import time; time.sleep(10)"',
        timeout_ms=500,
        sandbox=sandbox,
    )
    assert "timed out" in res["content"].lower() or "timed out" in str(res.get("error", "")).lower()
    assert len(sandbox._background_tasks) == 0
    LocalSandbox.clear_session_tasks("test-timeout-evict")


def test_def_03_background_task_session_isolation():
    """Verify background tasks are scoped per session and do NOT leak across sessions."""
    sandbox_a = LocalSandbox(work_dir=Path.cwd(), sandbox_id="session-alpha")
    sandbox_b = LocalSandbox(work_dir=Path.cwd(), sandbox_id="session-beta")

    # Start task in session A
    res_a = sandbox_a.execute_shell('python -c "import time; time.sleep(10)"', background=True)
    pid_a = res_a.background_pid
    assert pid_a is not None

    # Verify task exists in session A
    assert pid_a in sandbox_a.list_background_tasks()

    # Verify session B is completely isolated
    assert pid_a not in sandbox_b.list_background_tasks()

    # Cleanup
    sandbox_a.kill_background_task(pid_a)
    LocalSandbox.clear_session_tasks("session-alpha")
    LocalSandbox.clear_session_tasks("session-beta")


def test_def_03_killed_tasks_evicted_from_list():
    """Verify killed tasks are evicted and no longer appear in the background task list."""
    sandbox = LocalSandbox(work_dir=Path.cwd(), sandbox_id="test-kill-session")
    start_res = sandbox.execute_shell('python -c "import time; time.sleep(10)"', background=True)
    bg_pid = start_res.background_pid
    assert bg_pid is not None

    # Verify it shows up initially
    assert bg_pid in sandbox.list_background_tasks()

    # Kill task via tool
    kill_res = background_task_manage_tool(action="kill", pid=bg_pid, sandbox=sandbox)
    assert kill_res["status"] == "success"

    # List tasks - schema promise: after killing a task, it no longer appears in the list
    list_res = background_task_manage_tool(action="list", sandbox=sandbox)
    assert list_res["status"] == "success"
    pids_in_list = [t["pid"] for t in list_res["tasks"]]
    assert bg_pid not in pids_in_list

    LocalSandbox.clear_session_tasks("test-kill-session")


def test_def_04_web_fetch_schema_allows_prompt_only():
    """Verify web_fetch schema accepts prompt without url and parses target URL."""
    schema_path = Path(__file__).resolve().parents[3] / "nexau" / "archs" / "tool" / "builtin" / "schemas" / "web_fetch.tool.yaml"
    tool = Tool.from_yaml(str(schema_path), "nexau.archs.tool.builtin.web_tools.web_fetch:web_fetch")

    # Validation must succeed for prompt only
    params = {"prompt": "Please fetch https://httpbin.org/get and report back"}
    tool.validate_params(params)


def test_def_09_glob_case_sensitive():
    """Verify glob respects case_sensitive=True vs False."""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        lower_file = root / "report.md"
        lower_file.write_text("lower content", encoding="utf-8")

        # Case insensitive (default / False): finds report.md with *.MD pattern
        res_insensitive = glob(pattern="*.MD", dir_path=str(root), case_sensitive=False)
        assert "report.md" in res_insensitive["content"]

        # Case sensitive (True): *.MD should NOT match lowercase report.md
        res_sensitive = glob(pattern="*.MD", dir_path=str(root), case_sensitive=True)
        assert "report.md" not in res_sensitive["content"]
        assert "No files found" in res_sensitive["returnDisplay"]


def test_d01_path_traversal_permission_denied():
    """Verify check_path_permission normalizes path traversal preventing bypass."""
    import pytest
    from nexau.archs.main_sub.framework_context import FrameworkContext
    from nexau.archs.permissions.helpers import check_path_permission
    from nexau.archs.permissions.types import PermissionDenied

    ctx = FrameworkContext.for_testing(
        allow_rules=["work/**"],
        deny_rules=[".git/**"],
    )
    with pytest.raises(PermissionDenied):
        check_path_permission(ctx, "work/../.git/config")


def test_d04_claim_task_available_to_teammates():
    """Verify claim_task is included in teammate tools for self-claim."""
    from nexau.archs.main_sub.team.tools import get_teammate_tools
    tools = get_teammate_tools()
    tool_names = [t.name for t in tools]
    assert "claim_task" in tool_names


@pytest.mark.anyio
async def test_d05_task_status_transition_validation():
    """Verify task board validates state transitions (pending -> in_progress -> completed)."""
    import pytest
    from nexau.archs.main_sub.team.task_board import TaskBoard
    from nexau.archs.session.models.team_task import TeamTaskModel
    from nexau.archs.session.models.team_task_lock import TeamTaskLockModel
    from nexau.archs.session.orm import InMemoryDatabaseEngine
    from nexau.archs.session.task_lock_service import TaskLockService

    engine = InMemoryDatabaseEngine()
    await engine.setup_models([TeamTaskModel, TeamTaskLockModel])
    lock_svc = TaskLockService(engine=engine)
    board = TaskBoard(
        engine=engine,
        task_lock_service=lock_svc,
        user_id="u1",
        session_id="s1",
        team_id="t1",
    )
    info = await board.create_task(title="Test", created_by="leader")
    task_id = info.task_id

    # Disallow pending -> completed directly
    with pytest.raises(ValueError, match="Invalid task status transition"):
        await board.update_status(task_id=task_id, status="completed")

    # Allow pending -> in_progress
    await board.update_status(task_id=task_id, status="in_progress")
    t = await board._get_task(task_id)
    assert t.status == "in_progress"

    # Allow in_progress -> completed
    await board.update_status(task_id=task_id, status="completed")
    t = await board._get_task(task_id)
    assert t.status == "completed"

    # Disallow completed -> pending
    with pytest.raises(ValueError, match="Invalid task status transition"):
        await board.update_status(task_id=task_id, status="pending")


def test_d06_d08_csv_delimiter_and_binary_rejection():
    """Verify delimiter detection for TSV/semicolon and rejection of binary files."""
    from nexau.ingestion_pipeline.csv_to_md_parquet import parse_csv_to_markdown
    with tempfile.TemporaryDirectory() as tmpdir:
        # TSV
        tsv_path = Path(tmpdir) / "data.tsv"
        tsv_path.write_text("name\tage\tcity\nAlice\t30\tParis\nBob\t25\tRome", encoding="utf-8")
        tsv_res = parse_csv_to_markdown(str(tsv_path))
        assert "3 columns" in tsv_res
        assert "Alice" in tsv_res

        # Semicolon CSV
        semi_path = Path(tmpdir) / "data.csv"
        semi_path.write_text("colA;colB;colC\n1;2;3\n4;5;6", encoding="utf-8")
        semi_res = parse_csv_to_markdown(str(semi_path))
        assert "3 columns" in semi_res

        # Binary file with .csv extension
        bin_path = Path(tmpdir) / "corrupt.csv"
        bin_path.write_bytes(b"\x00\x01\x02\xffbinarydata")
        bin_res = parse_csv_to_markdown(str(bin_path))
        assert "appears to be binary" in bin_res


def test_d07_resolve_path_rfc8089_file_uri():
    """Verify resolve_path retains root slash for POSIX file:/// paths."""
    from nexau.archs.tool.builtin._sandbox_utils import resolve_path
    from nexau.archs.sandbox.local_sandbox import LocalSandbox
    sandbox = LocalSandbox(work_dir=Path("/workspace"))
    res = resolve_path("file:///etc/hosts", sandbox)
    assert res in ("/etc/hosts", "\\etc\\hosts", "C:\\etc\\hosts")
