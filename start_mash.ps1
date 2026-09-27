# ====================================================================
# Mash / NexAU Platform PowerShell Launcher
# ====================================================================

$Host.UI.RawUI.WindowTitle = "Mash / NexAU Launcher"
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "                 MASH / NexAU PLATFORM LAUNCHER                     " -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

$pythonExe = "C:\Python313\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}

Write-Host "[*] Checking runtime dependencies..." -ForegroundColor Yellow
try {
    & $pythonExe --version | Out-Null
    Write-Host "[OK] Python detected ($pythonExe)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python not found in PATH." -ForegroundColor Red
    exit 1
}

try {
    npm --version | Out-Null
    Write-Host "[OK] Node.js / npm detected" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] npm not found in PATH." -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nexauDir = Join-Path $scriptDir "NexAU"
$connectorDir = Join-Path $scriptDir "connector"
$frontendDir = Join-Path $scriptDir "frontend"

$env:PYTHONPATH = "$nexauDir;$connectorDir"

Write-Host ""
Write-Host "[*] Starting Desktop Connector on http://localhost:8000 ..." -ForegroundColor Yellow
$backendProcess = Start-Process -FilePath $pythonExe -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload" -WorkingDirectory $connectorDir -PassThru

Start-Sleep -Seconds 3

Write-Host "[*] Starting Next.js UI Frontend on http://localhost:3000 ..." -ForegroundColor Yellow
$frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory $frontendDir -PassThru

Start-Sleep -Seconds 3

Write-Host "[*] Opening browser..." -ForegroundColor Yellow
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  Mash / NexAU is now RUNNING!" -ForegroundColor Green
Write-Host "  - Backend:  http://localhost:8000" -ForegroundColor White
Write-Host "  - Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "  Press Enter in this window to stop both servers gracefully." -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Green

Read-Host

Write-Host "[*] Stopping servers..." -ForegroundColor Yellow
if ($backendProcess -and -not $backendProcess.HasExited) {
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
}
if ($frontendProcess -and -not $frontendProcess.HasExited) {
    Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue
}
Write-Host "[OK] All servers stopped." -ForegroundColor Green
