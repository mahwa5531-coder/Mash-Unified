# -*- coding: utf-8 -*-
"""Live verification of Mash Built-in Tools:
Tests run_shell_command, file tools, and bundled Python runtime end-to-end.
"""
import sys
import os
from pathlib import Path
from types import SimpleNamespace

# Add NexAU and connector to sys.path
root_dir = Path(__file__).parent.resolve()
sys.path.insert(0, str(root_dir / "NexAU"))
sys.path.insert(0, str(root_dir / "connector"))

from nexau.archs.main_sub.framework_context import FrameworkContext
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.shell_tools.run_shell_command import run_shell_command
from nexau.archs.tool.builtin.file_tools.write_file import write_file
from nexau.archs.tool.builtin.file_tools.view_file import view_file

def main():
    print("=" * 65)
    print("STARTING LIVE MASH BUILTIN TOOL EXECUTION VERIFICATION")
    print("=" * 65)

    test_workdir = root_dir / "temp_tool_test"
    test_workdir.mkdir(exist_ok=True)

    sandbox = LocalSandbox(
        sandbox_id="test_session_live_tools",
        work_dir=test_workdir,
    )

    agent_state = SimpleNamespace(
        get_sandbox=lambda: sandbox,
    )

    ctx = FrameworkContext.for_testing()

    # TEST 1: Echo command via run_shell_command
    print("\n[Test 1] Testing run_shell_command with standard echo...")
    res1 = run_shell_command(
        command="Write-Output 'Mash Shell Tool Active'",
        agent_state=agent_state,
        ctx=ctx,
    )
    print(f"  -> Result Content: {res1.get('content')}")
    assert "Mash Shell Tool Active" in res1.get("content", ""), f"Test 1 Failed: {res1}"
    print("  -> PASSED: Shell command executed cleanly!")

    # TEST 2: In-memory DuckDB and Polars calculation via run_shell_command
    print("\n[Test 2] Testing Python code execution through run_shell_command...")
    python_cmd = (
        'python -c "import polars as pl; import duckdb; '
        'df = pl.DataFrame({\'amounts\': [100.50, 200.75, 300.25]}); '
        'total = df[\'amounts\'].sum(); '
        'gst = duckdb.query(f\'SELECT {total} * 0.18 AS tax\').fetchone()[0]; '
        'print(f\'AUDIT_TAX_TOTAL: {gst:.2f}\')"'
    )
    res2 = run_shell_command(
        command=python_cmd,
        agent_state=agent_state,
        ctx=ctx,
    )
    print(f"  -> Result Content: {res2.get('content')}")
    assert "AUDIT_TAX_TOTAL: 108.27" in res2.get("content", ""), f"Test 2 Failed: {res2}"
    print("  -> PASSED: Python, Polars, and DuckDB executed inside tool without error!")

    # TEST 3: Builtin File Tool (write_file and view_file)
    print("\n[Test 3] Testing write_file and view_file tools...")
    file_path = test_workdir / "statutory_audit_finding.md"
    write_res = write_file(
        file_path=str(file_path),
        content="# Statutory Audit Memorandum\nFinding: Unreconciled GST input credit of $108.27 detected.",
        agent_state=agent_state,
        ctx=ctx,
    )
    print(f"  -> Write Result: {write_res.get('content')}")
    assert file_path.exists(), "File was not written to disk!"

    view_res = view_file(
        file_path=str(file_path),
        agent_state=agent_state,
    )
    print(f"  -> View Result Preview: {view_res.get('content')[:80]}...")
    assert "Unreconciled GST input credit of $108.27" in view_res.get("content", ""), f"Test 3 Failed: {view_res}"
    print("  -> PASSED: File write and view tools verified!")

    # Cleanup test workdir
    try:
        import shutil
        shutil.rmtree(test_workdir, ignore_errors=True)
    except Exception:
        pass

    print("\n" + "=" * 65)
    print("ALL MASH BUILTIN TOOL EXECUTION TESTS 100% PASSED!")
    print("=" * 65)

if __name__ == "__main__":
    main()
