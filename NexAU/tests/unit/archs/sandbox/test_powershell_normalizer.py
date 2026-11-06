import pytest
from nexau.archs.sandbox.local_sandbox import LocalSandbox


class TestPowerShellNormalizer:
    def test_single_command_unchanged(self):
        cmd = "git status"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "git status"

    def test_and_chaining_powershell_51(self):
        cmd = "cd build && rm -rf *"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "cd build ; if ($?) { rm -rf * }"

    def test_or_chaining_powershell_51(self):
        cmd = "pytest || echo 'test failed'"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "pytest ; if (-not $?) { echo 'test failed' }"

    def test_multi_chaining_powershell_51(self):
        cmd = "cd build && pytest || echo 'failed'"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "cd build ; if ($?) { pytest ; if (-not $?) { echo 'failed' } }"

    def test_quoted_ampersands_preserved(self):
        cmd = 'git commit -m "feat: add A && B support"'
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == 'git commit -m "feat: add A && B support"'

    def test_pwsh_preserves_native_chaining(self):
        cmd = "cd build && rm -rf *"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=True)
        assert res == "cd build && rm -rf *"

    def test_which_at_start_converted_to_get_command(self):
        cmd = "which python"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "Get-Command python"

    def test_which_after_chaining_converted(self):
        cmd = "cd src && which npm"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert "Get-Command npm" in res

    def test_which_inside_argument_or_quote_not_touched(self):
        cmd = 'echo "which one do you want?"'
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert "Get-Command" not in res
        assert 'echo "which one do you want?"' == res

    def test_wsl_mount_path_converted(self):
        cmd = "ls /mnt/c/Users/rama/Desktop"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "ls c:/Users/rama/Desktop"

    def test_python3_converted_to_python(self):
        cmd = "python3 main.py"
        res = LocalSandbox._normalize_powershell_command(cmd, is_pwsh=False)
        assert res == "python main.py"
