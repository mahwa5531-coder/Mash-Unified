# -*- mode: python ; coding: utf-8 -*-
# PyInstaller specification for Mash Desktop Connector (Sidecar binary)
# Target: Windows x86_64 standalone sidecar executable

import sys
from pathlib import Path

block_cipher = None

root_dir = Path(SPECPATH).parent.resolve()
connector_dir = root_dir / 'connector'
nexau_dir = root_dir / 'NexAU'

from PyInstaller.utils.hooks import copy_metadata

datas = [
    (str(connector_dir / 'app' / 'resources'), 'app/resources'),
    (str(connector_dir / 'app' / 'prompts'), 'app/prompts'),
    (str(connector_dir / 'native_picker.ps1'), '.'),
    (str(nexau_dir / 'nexau' / 'agents'), 'nexau/agents'),
    (str(nexau_dir / 'nexau' / 'archs'), 'nexau/archs'),
    (str(nexau_dir / 'nexau' / 'db' / 'migrations'), 'nexau/db/migrations'),
]
if (nexau_dir / 'bin' / 'rg.exe').exists():
    datas.append((str(nexau_dir / 'bin' / 'rg.exe'), 'nexau/bin'))
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
    'duckduckgo_search',
    'duckdb',
    'polars',
    'sqlmodel',
    'bs4',
    'multipart',
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
        'primp',
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
