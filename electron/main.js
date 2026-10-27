// Mash Desktop Main Process Supervisor
// Orchestrates Python backend sidecar lifecycle, ephemeral port 0 binding,
// custom frameless window management, and zero-zombie-process cleanup on Windows.

const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const urlModule = require('url');
const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');

// Register custom deep link protocol: mash://auth/callback?code=...
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mash', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('mash');
}

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

// Helper to deliver OAuth code from deep link to local connector
function forwardDeepLinkToConnector(rawUrl) {
  if (!rawUrl || !rawUrl.startsWith('mash://')) return;
  try {
    const parsed = new URL(rawUrl);
    const code = parsed.searchParams.get('code');
    if (!code) return;

    const postData = JSON.stringify({ code });
    const req = http.request(
      `http://127.0.0.1:${assignedPort}/api/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        console.log(`[DeepLink] Forwarded mcode to connector, status: ${res.statusCode}`);
      }
    );
    req.on('error', (err) => {
      console.warn('[DeepLink] Failed to forward mcode to connector:', err.message);
    });
    req.write(postData);
    req.end();
  } catch (err) {
    console.warn('[DeepLink] Error parsing deep link:', err);
  }
}

// 1. Single Instance Mutex: prevent duplicate processes locking SQLite
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  // Windows passes the custom protocol URL in commandLine arguments
  const deepLink = commandLine.find((arg) => arg.startsWith('mash://'));
  if (deepLink) {
    forwardDeepLinkToConnector(deepLink);
  }
});

// 2. Ephemeral Port Allocation: tries standard loopback 8000 first, falls back to dynamic port
function allocateEphemeralPort() {
  return new Promise((resolve) => {
    const testSrv = netSocket.createServer();
    testSrv.once('error', () => {
      // Port 8000 in use: assign dynamic ephemeral port
      const dynamicSrv = netSocket.createServer();
      dynamicSrv.listen(0, '127.0.0.1', () => {
        const port = dynamicSrv.address().port;
        dynamicSrv.close(() => resolve(port));
      });
    });
    testSrv.once('listening', () => {
      testSrv.close(() => resolve(8000));
    });
    testSrv.listen(8000, '127.0.0.1');
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
    cwd = path.join(process.resourcesPath, 'bin', 'connector');
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
    MASH_CONNECTOR_URL: assignedApiUrl,
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

  // Open external links (such as Google OAuth) in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
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

ipcMain.on('mash-restart-and-install', () => {
  terminateConnector();
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.quitAndInstall(false, true);
      return;
    } catch (_) {}
  }
  app.relaunch();
  app.exit(0);
});

// 8. Application Lifecycle
app.whenReady().then(async () => {
  // Protocol handler routing app://mash/* to frontend/out/* (works inside asar AND unpacked)
  const outDir = path.resolve(__dirname, '../frontend/out');
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };

  protocol.handle('app', async (request) => {
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

      // Read via Node fs (which automatically penetrates app.asar transparently)
      const data = fs.readFileSync(target);
      const ext = path.extname(target).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    } catch (e) {
      console.error('[Protocol:app] Error resolving:', request.url, e);
      return new Response('Not Found', { status: 404 });
    }
  });

  try {
    const port = await allocateEphemeralPort();
    await launchBackendSupervisor(port);
    await createMainWindow();

    const coldDeepLink = process.argv.find((arg) => arg.startsWith('mash://'));
    if (coldDeepLink) {
      setTimeout(() => forwardDeepLinkToConnector(coldDeepLink), 500);
    }

    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        autoUpdater.on('download-progress', (progressObj) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mash-update-downloading', {
              progress: Math.round(progressObj.percent),
            });
          }
        });
        autoUpdater.on('update-downloaded', (info) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('mash-update-ready', {
              version: info?.version,
            });
          }
        });
        autoUpdater.checkForUpdatesAndNotify().catch((e) => console.log('[AutoUpdater] check skipped:', e?.message));
      } catch (e) {
        console.log('[AutoUpdater] init skipped:', e?.message);
      }
    }
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
