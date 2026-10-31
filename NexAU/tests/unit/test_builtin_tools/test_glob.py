# Copyright (c) Nex-AGI. All rights reserved.
# Licensed under the Apache License, Version 2.0.
"""Unit tests for glob builtin tool."""

from pathlib import Path
from unittest.mock import MagicMock, patch

from nexau.archs.sandbox.local_sandbox import LocalSandbox
from nexau.archs.tool.builtin.file_tools.glob_tool import (
    glob,
    _python_glob,
    _rg_glob,
    _normalize_pattern,
)


def test_glob_basic_matching(tmp_path: Path):
    (tmp_path / "file1.txt").write_text("hello", encoding="utf-8")
    (tmp_path / "file2.py").write_text("print(1)", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "file3.txt").write_text("world", encoding="utf-8")

    res = glob(pattern="*.txt", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res["content"]
    assert "file1.txt" in res["content"]
    assert "file3.txt" in res["content"]


def test_glob_case_insensitive_by_default(tmp_path: Path):
    (tmp_path / "document.PDF").write_text("pdf", encoding="utf-8")
    (tmp_path / "ledger.csv").write_text("csv", encoding="utf-8")

    # Lowercase pattern matches uppercase file
    res = glob(pattern="*.pdf", dir_path=str(tmp_path))
    assert "document.PDF" in res["content"]

    # Uppercase pattern matches lowercase file
    res_upper = glob(pattern="*.CSV", dir_path=str(tmp_path))
    assert "ledger.csv" in res_upper["content"]


def test_glob_python_fallback(tmp_path: Path):
    (tmp_path / "data.json").write_text("{}", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "report.json").write_text("{}", encoding="utf-8")

    # Test direct python fallback execution
    matches = _python_glob(pattern="*.json", search_dir=str(tmp_path), max_matches=100)
    assert len(matches) == 2
    assert any("data.json" in m for m in matches)
    assert any("report.json" in m for m in matches)


def test_glob_patterns_with_slashes(tmp_path: Path):
    """Test all slash patterns: subdirectories, ./, backslashes, **, exact paths."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "app").mkdir()
    (tmp_path / "src" / "app" / "main.py").write_text("main", encoding="utf-8")
    (tmp_path / "src" / "app" / "util.py").write_text("util", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "readme.md").write_text("readme", encoding="utf-8")

    # 1. Standard subpath
    res1 = glob(pattern="src/app/*.py", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res1["content"]

    # 2. Leading ./
    res2 = glob(pattern="./src/app/*.py", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res2["content"]

    # 3. Windows backslash
    res3 = glob(pattern="src\\app\\*.py", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res3["content"]

    # 4. Recursive prefix **/
    res4 = glob(pattern="**/app/*.py", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res4["content"]

    # 5. Wildcard folder */
    res5 = glob(pattern="*/app/*.py", dir_path=str(tmp_path))
    assert "Found 2 matching file(s)" in res5["content"]

    # 6. Exact path with slashes
    res6 = glob(pattern="src/app/main.py", dir_path=str(tmp_path))
    assert "Found 1 matching file(s)" in res6["content"]

    # 7. Subdirectory dir_path with relative pattern containing slash
    res7 = glob(pattern="app/*.py", dir_path=str(tmp_path / "src"))
    assert "Found 2 matching file(s)" in res7["content"]

    # 8. Test Python fallback on slash patterns
    py_res = _python_glob(pattern="src/app/*.py", search_dir=str(tmp_path), max_matches=100)
    assert len(py_res) == 2
    assert any("main.py" in p for p in py_res)


def test_glob_nonexistent_directory():
    res = glob(pattern="*.py", dir_path="C:/nonexistent_folder_xyz_123")
    assert "Search path does not exist" in res["content"]
    assert res.get("error", {}).get("type") == "DIRECTORY_NOT_FOUND"


def test_glob_empty_matches(tmp_path: Path):
    (tmp_path / "test.txt").write_text("a", encoding="utf-8")
    res = glob(pattern="*.csv", dir_path=str(tmp_path))
    assert "No files found matching pattern" in res["content"]
    assert res["returnDisplay"] == "No files found"
