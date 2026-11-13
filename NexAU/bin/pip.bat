@echo off
set "BIN_DIR=%~dp0"
setlocal
if not defined LOCALAPPDATA set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
set "MASH_PY_ENV=%LOCALAPPDATA%\Mash\python_env"
if not exist "%MASH_PY_ENV%" mkdir "%MASH_PY_ENV%" 2>nul

if /i "%~1"=="install" (
    for /f "tokens=1* delims= " %%a in ("%*") do (
        "%BIN_DIR%uv.exe" pip install --python-version 3.13 --target "%MASH_PY_ENV%" %%b
    )
    exit /b %ERRORLEVEL%
) else (
    "%BIN_DIR%uv.exe" pip %*
    exit /b %ERRORLEVEL%
)
