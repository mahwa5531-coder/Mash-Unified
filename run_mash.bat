@echo off
title Mash / NexAU Launcher
color 0A
echo ====================================================================
echo                 MASH / NexAU PLATFORM LAUNCHER                      
echo ====================================================================
echo.

:: Detect Python
set PYTHON_EXE=C:\Python313\python.exe
if not exist "%PYTHON_EXE%" (
    set PYTHON_EXE=python
)

echo [*] Checking runtime dependencies...
"%PYTHON_EXE%" --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found! Please install Python 3.11+ or ensure it is in PATH.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js / npm not found! Please install Node.js 18+.
    pause
    exit /b 1
)

echo [OK] Python and Node.js detected.
echo.

:: Start Mash Desktop Connector in separate background window
echo [*] Starting Mash Desktop Connector on http://localhost:8000 ...
start "Mash Connector (Port 8000)" cmd /k "cd /d ""%~dp0connector"" && set ""PYTHONPATH=%~dp0NexAU;%~dp0connector"" && ""%PYTHON_EXE%"" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

:: Give connector a moment to bind port
timeout /t 3 /nobreak >nul

:: Start Next.js Frontend
echo [*] Starting Next.js UI Frontend on http://localhost:3000 ...
start "NexAU Frontend (Port 3000)" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

:: Wait and open browser
timeout /t 3 /nobreak >nul
echo [*] Opening NexAU in default browser...
start http://localhost:3000

echo.
echo ====================================================================
echo   Mash / NexAU is now RUNNING!
echo   - Backend:  http://localhost:8000
echo   - Frontend: http://localhost:3000
echo.
echo   Keep this window open or close it when done.
echo   To stop the servers, close the Backend and Frontend windows.
echo ====================================================================
pause
