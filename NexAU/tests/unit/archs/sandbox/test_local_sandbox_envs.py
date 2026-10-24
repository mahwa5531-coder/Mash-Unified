"""Unit tests for LocalSandbox environment sanitization and Python runtime resolution."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from nexau.archs.sandbox.local_sandbox import LocalSandbox


def test_build_local_envs_strips_toxic_vars(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies PYTHONHOME, PYTHONPATH, and VIRTUAL_ENV are stripped from subprocess env."""
    monkeypatch.setenv("PYTHONHOME", r"C:\ToxicPythonHome")
    monkeypatch.setenv("PYTHONPATH", r"C:\ToxicLib;C:\AnotherToxicLib")
    monkeypatch.setenv("VIRTUAL_ENV", r"C:\ToxicVenv")

    sandbox = LocalSandbox(sandbox_id="test_toxic_vars", work_dir=tmp_path)
    envs = sandbox._build_local_envs()

    assert envs is not None
    assert "PYTHONHOME" not in envs
    assert "PYTHONPATH" not in envs
    assert "VIRTUAL_ENV" not in envs
    assert envs.get("PYTHONIOENCODING") == "utf-8"
    assert envs.get("PYTHONUTF8") == "1"

    # Per-call envs should be merged without restoring ambient toxic vars
    merged_envs = sandbox._build_local_envs({"CUSTOM_AGENT_VAR": "enabled"})
    assert merged_envs is not None
    assert merged_envs.get("CUSTOM_AGENT_VAR") == "enabled"
    assert "PYTHONHOME" not in merged_envs
    assert "PYTHONPATH" not in merged_envs
    assert "VIRTUAL_ENV" not in merged_envs


def test_build_local_envs_smart_usersite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies PYTHONNOUSERSITE is set in venvs/frozen mode, but preserved on host system Python."""
    sandbox = LocalSandbox(sandbox_id="test_usersite", work_dir=tmp_path)

    # Case 1: In a virtual environment (sys.prefix != sys.base_prefix) -> isolate user site
    monkeypatch.setattr(sys, "prefix", r"C:\project\.venv")
    monkeypatch.setattr(sys, "base_prefix", r"C:\Python313")
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    envs_venv = sandbox._build_local_envs()
    assert envs_venv is not None
    assert envs_venv.get("PYTHONNOUSERSITE") == "1"

    # Case 2: In PyInstaller frozen desktop app -> isolate user site
    monkeypatch.setattr(sys, "prefix", r"C:\Python313")
    monkeypatch.setattr(sys, "base_prefix", r"C:\Python313")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    envs_frozen = sandbox._build_local_envs()
    assert envs_frozen is not None
    assert envs_frozen.get("PYTHONNOUSERSITE") == "1"

    # Case 3: On host system Python (sys.prefix == sys.base_prefix, not frozen) -> allow %APPDATA% user site
    monkeypatch.setattr(sys, "prefix", r"C:\Python313")
    monkeypatch.setattr(sys, "base_prefix", r"C:\Python313")
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("PYTHONNOUSERSITE", "1")  # Simulate ambient flag
    envs_host = sandbox._build_local_envs()
    assert envs_host is not None
    assert "PYTHONNOUSERSITE" not in envs_host


def test_build_local_envs_prepends_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies PATH prepends the runtime Python directories without duplicating existing entries."""
    runtime_dir = tmp_path / "mock_py_runtime"
    scripts_dir = runtime_dir / "Scripts"
    scripts_dir.mkdir(parents=True)
    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", str(runtime_dir))

    existing_bin1 = str(tmp_path / "bin1")
    existing_bin2 = str(runtime_dir)  # Intentionally duplicate runtime_dir in PATH
    monkeypatch.setenv("PATH", f"{existing_bin1}{os.pathsep}{existing_bin2}")

    sandbox = LocalSandbox(sandbox_id="test_path_prepends", work_dir=tmp_path)
    envs = sandbox._build_local_envs()
    assert envs is not None

    path_str = envs.get("PATH", "")
    entries = path_str.split(os.pathsep)

    # First entries must be Scripts and python root
    assert entries[0] == str(scripts_dir)
    assert entries[1] == str(runtime_dir)
    assert existing_bin1 in entries

    # Verify deduplication: runtime_dir should appear exactly once
    norm_runtime = os.path.normcase(os.path.normpath(str(runtime_dir)))
    normalized_entries = [os.path.normcase(os.path.normpath(p)) for p in entries]
    assert normalized_entries.count(norm_runtime) == 1


def test_audit_libraries_importable_in_subshell(tmp_path: Path) -> None:
    """Live smoke test executing python -c importing pandas, numpy, openpyxl, duckdb in subshell."""
    sandbox = LocalSandbox(sandbox_id="test_audit_libs", work_dir=tmp_path)
    python_cmd = sandbox.get_python_command()
    code = "import pandas, numpy, openpyxl, duckdb; print('AUDIT_OK')"
    result = sandbox.execute_shell(f'{python_cmd} -c "{code}"')

    assert result.exit_code == 0, f"Subshell execution failed: {result.stderr or result.stdout}"
    assert "AUDIT_OK" in result.stdout


def test_resolve_runtime_python_dirs_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies MASH_PYTHON_RUNTIME_DIR override returns [Scripts, root] correctly."""
    override_dir = tmp_path / "custom_python"
    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", str(override_dir))

    dirs = LocalSandbox._resolve_runtime_python_dirs()
    assert dirs == [override_dir / "Scripts", override_dir]

    # If pointing directly to Scripts
    scripts_dir = override_dir / "Scripts"
    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", str(scripts_dir))
    dirs_scripts = LocalSandbox._resolve_runtime_python_dirs()
    assert dirs_scripts == [scripts_dir, override_dir]


def test_resolve_runtime_python_dirs_frozen_candidates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies frozen desktop app probes runtime/python and resources/python_runtime."""
    fake_exe = tmp_path / "MashApp.exe"
    monkeypatch.setattr(sys, "executable", str(fake_exe))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("MASH_PYTHON_RUNTIME_DIR", raising=False)

    # Candidate 1: runtime/python
    runtime_py = tmp_path / "runtime" / "python"
    runtime_py.mkdir(parents=True)
    dirs = LocalSandbox._resolve_runtime_python_dirs()
    assert dirs == [runtime_py]

    # Candidate 1 with Scripts
    scripts = runtime_py / "Scripts"
    scripts.mkdir()
    dirs_with_scripts = LocalSandbox._resolve_runtime_python_dirs()
    assert dirs_with_scripts == [scripts, runtime_py]


def test_get_python_command_probes_runtime_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verifies get_python_command finds python.exe in runtime dirs before falling back to sys.executable."""
    runtime_dir = tmp_path / "mock_runtime"
    runtime_dir.mkdir(parents=True)
    fake_python_exe = runtime_dir / "python.exe"
    fake_python_exe.write_text("#!fake", encoding="utf-8")

    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", str(runtime_dir))
    sandbox = LocalSandbox(sandbox_id="test_probe_py", work_dir=tmp_path)

    cmd = sandbox.get_python_command()
    assert str(fake_python_exe) in cmd


def test_build_local_envs_preserves_custom_path_and_deduplicates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies per-call or sandbox custom PATH does NOT clobber prepended runtime python dirs."""
    runtime_dir = tmp_path / "py_runtime"
    scripts_dir = runtime_dir / "Scripts"
    scripts_dir.mkdir(parents=True)
    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", str(runtime_dir))

    custom_bin = str(tmp_path / "custom_tools_bin")
    sandbox = LocalSandbox(sandbox_id="test_custom_path", work_dir=tmp_path)

    # Calling with custom PATH override (using 'Path' casing common on Windows)
    envs = sandbox._build_local_envs({"Path": custom_bin})
    assert envs is not None

    # Only single canonical PATH key should exist
    assert "Path" not in envs
    assert "PATH" in envs

    entries = envs["PATH"].split(os.pathsep)
    # Runtime dirs MUST still be first
    assert entries[0] == str(scripts_dir)
    assert entries[1] == str(runtime_dir)
    # Custom bin MUST be included, not lost
    assert custom_bin in entries


def test_build_local_envs_purges_toxic_vars_from_per_call_envs(tmp_path: Path) -> None:
    """Verifies toxic variables passed directly via per-call envs or instance envs are purged."""
    sandbox = LocalSandbox(
        sandbox_id="test_toxic_per_call",
        work_dir=tmp_path,
        envs={"PYTHONHOME": r"C:\InstanceToxicHome"},
    )
    envs = sandbox._build_local_envs({
        "pythonpath": r"C:\PerCallToxicPath",
        "VIRTUAL_ENV": r"C:\PerCallToxicVenv",
        "SAFE_AGENT_VAR": "valid",
    })
    assert envs is not None
    assert envs.get("SAFE_AGENT_VAR") == "valid"
    assert "PYTHONHOME" not in envs
    assert "pythonpath" not in envs
    assert "PYTHONPATH" not in envs
    assert "VIRTUAL_ENV" not in envs


def test_get_python_command_frozen_prevents_runaway_loop(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies frozen desktop app NEVER returns the app binary (sys.executable) when bundled python is absent."""
    fake_mash_exe = tmp_path / "MashApp.exe"
    fake_mash_exe.write_text("#!mash", encoding="utf-8")

    monkeypatch.setattr(sys, "executable", str(fake_mash_exe))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("MASH_PYTHON_RUNTIME_DIR", raising=False)

    sandbox = LocalSandbox(sandbox_id="test_no_runaway", work_dir=tmp_path)
    cmd = sandbox.get_python_command()

    # The command MUST NOT contain MashApp.exe (which would cause a runaway loop)
    assert str(fake_mash_exe) not in cmd
    assert "MashApp.exe" not in cmd


def test_resolve_runtime_python_dirs_probes_candidate_2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies that if candidate 1 is empty, candidate 2 with python.exe is selected."""
    fake_exe = tmp_path / "MashApp.exe"
    monkeypatch.setattr(sys, "executable", str(fake_exe))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.delenv("MASH_PYTHON_RUNTIME_DIR", raising=False)

    # Candidate 1: runtime/python (empty directory, no python)
    c1 = tmp_path / "runtime" / "python"
    c1.mkdir(parents=True)

    # Candidate 2: resources/python_runtime (contains python.exe)
    c2 = tmp_path / "resources" / "python_runtime"
    c2.mkdir(parents=True)
    (c2 / "python.exe").write_text("#!fake", encoding="utf-8")

    dirs = LocalSandbox._resolve_runtime_python_dirs()
    # Candidate 2 MUST be prioritized because it contains python.exe
    assert c2 in dirs


def test_resolve_runtime_python_dirs_quoted_and_file_override(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies MASH_PYTHON_RUNTIME_DIR handles surrounding quotes and pointing directly to python.exe."""
    override_dir = tmp_path / "quoted_python"
    override_dir.mkdir(parents=True)
    fake_py = override_dir / "python.exe"
    fake_py.write_text("#!fake", encoding="utf-8")

    # Point directly to python.exe with quotes
    monkeypatch.setenv("MASH_PYTHON_RUNTIME_DIR", f'"{fake_py}"')
    dirs = LocalSandbox._resolve_runtime_python_dirs()
    assert override_dir in dirs

