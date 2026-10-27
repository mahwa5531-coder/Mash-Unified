# Copyright (c) Mash. All rights reserved.
"""Direct verification of real workspace coding tasks and tool efficiency without compiling binaries."""

import os
import subprocess
import tempfile
from pathlib import Path

import pytest
from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.file_tools.glob_tool import glob
from nexau.archs.tool.builtin.file_tools.replace_file_content import replace_file_content
from nexau.archs.tool.builtin.file_tools.search_file_content import search_file_content
from nexau.archs.tool.builtin.file_tools.view_file import view_file
from nexau.archs.tool.builtin.file_tools.write_file import write_file
from nexau.archs.tool.builtin.shell_tools.run_shell_command import run_shell_command


def test_real_workspace_code_modifications_and_shell_execution():
    """Verify that agent tools manipulate real codebase files and execute commands with complete diagnostics."""
    workspace_dir = Path(__file__).resolve().parent.parent
    sandbox = LocalSandbox(work_dir=workspace_dir)

    test_subfolder = workspace_dir / "tests" / "fixtures" / "live_scenario"
    test_subfolder.mkdir(parents=True, exist_ok=True)
    target_code_file = test_subfolder / "sample_financial_math.py"

    try:
        # Scenario 1: write_file creates real Python code in workspace
        initial_code = (
            "def calculate_depreciation(cost: float, salvage: float, life_years: int) -> float:\n"
            "    # Initial implementation with bug (adds salvage instead of subtracting)\n"
            "    return (cost + salvage) / life_years\n"
        )
        res_write = write_file(
            file_path=str(target_code_file),
            content=initial_code,
            sandbox=sandbox,
        )
        assert not res_write.get("isError"), f"write_file failed: {res_write}"
        assert target_code_file.exists(), "Target file was not created on disk in workspace!"

        # Scenario 2: search_file_content finds code symbols across workspace
        res_search = search_file_content(
            pattern="calculate_depreciation",
            dir_path=str(test_subfolder),
            sandbox=sandbox,
        )
        assert not res_search.get("isError"), f"search_file_content failed: {res_search}"
        assert "sample_financial_math.py" in str(res_search.get("content")), "Symbol search failed!"

        # Scenario 3: run_shell_command executes Python test against the real file
        test_cmd = (
            f"python -c \"import sys; sys.path.insert(0, r'{test_subfolder}'); "
            "from sample_financial_math import calculate_depreciation; "
            "val = calculate_depreciation(100.0, 20.0, 5); "
            "print('RESULT:', val); "
            "assert val == 16.0, f'Expected 16.0 but got {val}'\""
        )
        res_run1 = run_shell_command(command=test_cmd, sandbox=sandbox)
        # Expected to fail initially because of bug (120/5 = 24.0, not 16.0)
        assert res_run1.get("isError") or "AssertionError" in str(res_run1.get("content")), (
            "Expected assertion error on buggy code did not trigger!"
        )

        # Scenario 4: replace_file_content surgically fixes the real code
        res_edit = replace_file_content(
            TargetFile=str(target_code_file),
            TargetContent="    return (cost + salvage) / life_years",
            ReplacementContent="    return (cost - salvage) / life_years",
            Instruction="Fix depreciation formula to subtract salvage value",
            sandbox=sandbox,
        )
        assert not res_edit.get("isError"), f"replace_file_content failed: {res_edit}"

        # Scenario 5: Re-running shell test passes with exit code 0
        res_run2 = run_shell_command(command=test_cmd, sandbox=sandbox)
        assert not res_run2.get("isError"), f"Shell command failed on fixed code: {res_run2}"
        assert "RESULT: 16.0" in str(res_run2.get("content")), f"Wrong output: {res_run2}"

        # Scenario 6: Embedded DuckDB & Polars analysis on real CSV data in workspace
        csv_file = test_subfolder / "transactions.csv"
        csv_data = "account,amount\n1010,500.0\n1010,250.0\n2010,-750.0\n"
        csv_file.write_text(csv_data, encoding="utf-8")

        duckdb_sql_cmd = (
            f"python -c \"import duckdb; "
            f"res = duckdb.query('SELECT account, sum(amount) as net FROM read_csv_auto(\\'{csv_file.as_posix()}\\') GROUP BY account ORDER BY account').fetchall(); "
            "print('DUCKDB_NET:', res); "
            "assert len(res) == 2, 'DuckDB aggregation failed'\""
        )
        res_duckdb = run_shell_command(command=duckdb_sql_cmd, sandbox=sandbox)
        assert not res_duckdb.get("isError"), f"DuckDB shell command failed: {res_duckdb}"
        assert "DUCKDB_NET: [(1010, 750.0), (2010, -750.0)]" in str(res_duckdb.get("content"))

        # Scenario 7: Verify exit code and error diagnostic handling for invalid shell commands
        invalid_cmd = "python -c \"raise RuntimeError('Intentional Test Exception for Agent Self-Correction')\""
        res_err = run_shell_command(command=invalid_cmd, sandbox=sandbox)
        assert "Intentional Test Exception for Agent Self-Correction" in str(res_err.get("content")), (
            "Error diagnostic output was lost!"
        )

        print("\n[OK] All 7 real workspace scenarios passed with 100% precision!")

    finally:
        # Cleanup fixtures
        if target_code_file.exists():
            target_code_file.unlink()
        csv_path = test_subfolder / "transactions.csv"
        if csv_path.exists():
            csv_path.unlink()
        if test_subfolder.exists():
            try:
                test_subfolder.rmdir()
                test_subfolder.parent.rmdir()
            except OSError:
                pass


if __name__ == "__main__":
    test_real_workspace_code_modifications_and_shell_execution()
