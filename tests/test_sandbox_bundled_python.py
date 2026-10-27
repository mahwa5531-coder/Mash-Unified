import os
import sys
from pathlib import Path

# Add project root and NexAU to sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / 'NexAU'))
sys.path.insert(0, str(root_dir / 'connector'))

from nexau.archs.sandbox.local_sandbox import LocalSandbox

os.environ['MASH_PYTHON_RUNTIME_DIR'] = str((root_dir / 'dist' / 'bin' / 'connector').resolve())
sandbox = LocalSandbox(sandbox_id='test_live_audit', work_dir=root_dir)

cmd = sandbox.get_python_command()
print('RESOLVED PYTHON COMMAND:', cmd)

envs = sandbox._build_local_envs()
first_path = envs['PATH'].split(';')[0]
print('PREPENDED PATH:', first_path)

# Live execution in sandbox
code = "import duckdb, polars; con = duckdb.connect(); print('DUCKDB_VER:', duckdb.__version__); print('POLARS_ROWS:', len(polars.DataFrame({'x': [10, 20]})))"
res = sandbox.execute_shell(f'{cmd} -c "{code}"')
print('EXIT CODE:', res.exit_code)
print('STDOUT:\n' + res.stdout)
if res.stderr:
    print('STDERR:\n' + res.stderr)

assert res.exit_code == 0
assert 'DUCKDB_VER: 1.5.4' in res.stdout
assert 'POLARS_ROWS: 2' in res.stdout
print('>>> ALL SANDBOX CHECKS PASSED 100%! <<<')
