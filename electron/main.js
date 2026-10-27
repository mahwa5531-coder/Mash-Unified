// Mash Desktop Main Process Supervisor
// Orchestrates Python backend sidecar lifecycle, ephemeral port 0 binding,
// custom frameless window management, and zero-zombie-process cleanup on Windows.

const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const urlModule = require('url');
const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');

// Register custom privileged scheme for Next.js static asset resolution
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let connectorProcess = null;
let assignedPort = 8000;
let assignedApiUrl = 'http://127.0.0.1:8000';
let isQuitting = false;
let restartCount = 0;
const MAX_RESTARTS = 3;

// 1. Single Instance Mutex: prevent duplicate processes locking SQLite
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 2. Ephemeral Port 0 Allocation: kernel assigns free loopback port
function allocateEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = netSocket.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

// 3. Health Probe Poller
function waitForBackendReady(port, timeoutMs = 25000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - startTime < timeoutMs) {
          setTimeout(probe, 250);
        } else {
          reject(new Error(`Backend returned HTTP ${res.statusCode}`));
        }
      });
      req.on('error', () => {
        if (Date.now() - startTime < timeoutMs) {
          setTimeout(probe, 250);
        } else {
          reject(new Error('Backend health probe timed out'));
        }
      });
      req.setTimeout(1000, () => req.destroy());
    };
    probe();
  });
}

// 4. Windows Process Tree Terminator (Zero Zombie Processes)
function terminateConnector() {
  if (!connectorProcess || connectorProcess.killed) return;
  const pid = connectorProcess.pid;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
    } else {
      connectorProcess.kill('SIGTERM');
    }
  } catch (_) {}
  connectorProcess = null;
}

// 5. Backend Sidecar Process Supervisor
async function launchBackendSupervisor(port) {
  assignedPort = port;
  assignedApiUrl = `http://127.0.0.1:${port}`;

  const isPackaged = app.isPackaged;
  let command = 'python';
  let args = [];
  let cwd = path.resolve(__dirname, '..');

  if (isPackaged) {
    command = path.join(process.resourcesPath, 'bin', 'connector', 'connector.exe');
    cwd = path.join(process.resourcesPath, 'bin');
  } else {
    args = [path.resolve(__dirname, '../connector/run_server.py')];
  }

  const runtimeDir = isPackaged
    ? path.join(process.resourcesPath, 'bin', 'connector')
    : path.resolve(__dirname, '../connector');

  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    MASH_API_URL: assignedApiUrl,
    PYTHONUNBUFFERED: '1',
    MASH_PYTHON_RUNTIME_DIR: runtimeDir,
  };

  connectorProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  connectorProcess.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[MashConnector] ${line}`);
  });

  connectorProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[MashConnector:Err] ${line}`);
  });

  connectorProcess.on('exit', (code, signal) => {
    console.log(`[MashConnector] Exited with code ${code}, signal ${signal}`);
    if (!isQuitting && restartCount < MAX_RESTARTS) {
      restartCount++;
      console.warn(`[Supervisor] Unexpected exit. Respawning attempt ${restartCount}/${MAX_RESTARTS}...`);
      setTimeout(() => launchBackendSupervisor(port), 1000);
    }
  });

  await waitForBackendReady(port);
  restartCount = 0; // Reset restart counter once healthy
}

// 6. Window Creation & Native Controls
async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    backgroundColor: '#09090b',
    title: 'Mash',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!app.isPackaged && process.env.MASH_DEV_URL) {
    mainWindow.loadURL(process.env.MASH_DEV_URL);
  } else {
    mainWindow.loadURL('app://mash/index.html');
  }
}

// 7. IPC Handlers
ipcMain.on('mash-get-api-url', (event) => {
  event.returnValue = assignedApiUrl;
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// 8. Application Lifecycle
app.whenReady().then(async () => {
  // Protocol handler routing app://mash/* to frontend/out/*
  const outDir = path.resolve(__dirname, '../frontend/out');
  protocol.handle('app', (request) => {
    try {
      const parsed = new URL(request.url);
      let decodedPath = decodeURIComponent(parsed.pathname);
      if (decodedPath === '/' || decodedPath === '') {
        decodedPath = '/index.html';
      }
      let target = path.join(outDir, decodedPath);
      if (!fs.existsSync(target) && !path.extname(target)) {
        target = path.join(outDir, `${decodedPath}.html`);
      }
      if (!fs.existsSync(target)) {
        target = path.join(outDir, 'index.html');
      }
      return net.fetch(urlModule.pathToFileURL(target).toString());
    } catch (e) {
      console.error('[Protocol:app] Error resolving:', request.url, e);
      return new Response('Not Found', { status: 404 });
    }
  });

  try {
    const port = await allocateEphemeralPort();
    await launchBackendSupervisor(port);
    await createMainWindow();
  } catch (err) {
    console.error('[Supervisor] Startup error:', err);
    terminateConnector();
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  terminateConnector();
});

app.on('will-quit', () => {
  isQuitting = true;
  terminateConnector();
});

app.on('window-all-closed', () => {
  isQuitting = true;
  terminateConnector();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
