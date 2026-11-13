# -*- mode: python ; coding: utf-8 -*-
# PyInstaller specification for Mash Desktop Connector (Sidecar binary)
# Target: Windows x86_64 standalone sidecar executable

import sys
from pathlib import Path

block_cipher = None

root_dir = Path(SPECPATH).parent.resolve()
connector_dir = root_dir / 'connector'
nexau_dir = root_dir / 'NexAU'
nexau_pkg_dir = nexau_dir / 'nexau'

from PyInstaller.utils.hooks import collect_submodules, copy_metadata

nexau_archs_dir = nexau_pkg_dir / 'archs'
# Bundle only non-Python assets from nexau/archs (.j2, .yaml, .sql, .md); Python modules live in PYZ.
nexau_archs_datas = [
    (
        str(p),
        'nexau/archs'
        if p.relative_to(nexau_archs_dir).parent == Path('.')
        else f"nexau/archs/{p.relative_to(nexau_archs_dir).parent.as_posix()}",
    )
    for p in nexau_archs_dir.rglob('*')
    if p.is_file() and p.suffix not in {'.py', '.pyc'} and '__pycache__' not in p.parts
]

# Enumerate all nexau modules (including YAML-imported PEP 420 middlewares & lazy submodules) for PYZ.
nexau_hiddenimports = sorted(
    'nexau'
    if (parts := p.relative_to(nexau_pkg_dir).with_suffix('').parts) == ('__init__',)
    else 'nexau.' + '.'.join(parts[:-1] if parts[-1] == '__init__' else parts)
    for p in nexau_pkg_dir.rglob('*.py')
    if '__pycache__' not in p.parts and 'migrations' not in p.parts
)

datas = [
    (str(connector_dir / 'app' / 'resources'), 'app/resources'),
    (str(connector_dir / 'app' / 'prompts'), 'app/prompts'),
    (str(connector_dir / 'app' / 'native_picker.ps1'), '.'),
    (str(nexau_dir / 'nexau' / 'agents'), 'nexau/agents'),
    (str(nexau_dir / 'nexau' / 'db' / 'migrations'), 'nexau/db/migrations'),
] + nexau_archs_datas
for bin_name in ('rg.exe', 'uv.exe'):
    bin_file = nexau_dir / 'bin' / bin_name
    if bin_file.exists():
        datas.append((str(bin_file), 'nexau/bin'))
datas += copy_metadata('duckdb') + copy_metadata('polars')

hiddenimports = [
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'aiosqlite',
    'sqlalchemy.dialects.sqlite',
    'alembic',
    'alembic.runtime',
    'alembic.runtime.migration',
    'alembic.script',
    'pathspec',
    'jinja2',
    'pydantic',
    'openai',
    'httpx',
    'ddgs',
    *collect_submodules('ddgs.engines'),
    'primp',
    'duckdb',
    'polars',
    'sqlmodel',
    'bs4',
    'multipart',
    'app.tools',
    *nexau_hiddenimports,
]

a = Analysis(
    ['run_server.py'],
    pathex=[str(connector_dir), str(nexau_dir)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'botocore',
        'boto3',
        'pytest',
        'unittest',
        'IPython',
        'jupyter',
        'notebook',
        'pyarrow',
        'babel',
        'anthropic',
        'mypy',
        'hypothesis',
        '_pytest',
        'traitlets',
        'werkzeug',
        'tornado',
        'fsspec',
        'aiohttp',
        'pyreadline3',
        'wolfxl',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='connector',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

py_exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='python',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    py_exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='connector',
)
