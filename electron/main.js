// Mash Desktop Main Process Supervisor
// Orchestrates Python backend sidecar lifecycle, ephemeral port 0 binding,
// custom frameless window management, and zero-zombie-process cleanup on Windows.

const { app, BrowserWindow, ipcMain, protocol, net, shell, screen } = require('electron');
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
  // QA-BUG-9 Fix: Only reset restart counter after sustained healthy runtime (60s)
  // to prevent rapid crash-loops from respawning indefinitely
  const activeProc = connectorProcess;
  setTimeout(() => {
    if (connectorProcess === activeProc && !connectorProcess?.killed) {
      restartCount = 0;
    }
  }, 60000);
}

// 6. Window State Persistence Manager (VS Code / DeepSeek standard)
const WINDOW_STATE_FILENAME = 'window-state.json';
const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  x: undefined,
  y: undefined,
  isMaximized: false,
};

let cachedNormalBounds = null;
let saveDebounceTimer = null;

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILENAME);
}

function loadWindowState() {
  let state = { ...DEFAULT_WINDOW_STATE };
  const filePath = getWindowStateFilePath();

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.width === 'number' && Number.isFinite(parsed.width)) {
          state.width = Math.max(DEFAULT_WINDOW_STATE.minWidth, Math.round(parsed.width));
        }
        if (typeof parsed.height === 'number' && Number.isFinite(parsed.height)) {
          state.height = Math.max(DEFAULT_WINDOW_STATE.minHeight, Math.round(parsed.height));
        }
        if (typeof parsed.x === 'number' && Number.isFinite(parsed.x)) {
          state.x = Math.round(parsed.x);
        }
        if (typeof parsed.y === 'number' && Number.isFinite(parsed.y)) {
          state.y = Math.round(parsed.y);
        }
        if (typeof parsed.isMaximized === 'boolean') {
          state.isMaximized = parsed.isMaximized;
        }
      }
    }
  } catch (err) {
    console.warn('[WindowState] Error reading saved state, falling back to defaults:', err?.message);
    state = { ...DEFAULT_WINDOW_STATE };
  }

  // Multi-display workArea clamping and disconnection protection (VS Code / DSH standard)
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const targetDisplay = (state.x !== undefined && state.y !== undefined)
      ? (screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height }) || primaryDisplay)
      : primaryDisplay;

    if (targetDisplay && targetDisplay.workArea) {
      const { x: waX, y: waY, width: waW, height: waH } = targetDisplay.workArea;

      // Ensure window bounds never exceed target display's workArea
      state.width = Math.min(state.width, waW);
      state.height = Math.min(state.height, waH);

      if (state.x !== undefined && state.y !== undefined) {
        // Verify titlebar and window body are visible within the active display workArea
        const isPartiallyVisible =
          state.x + state.width > waX + 100 &&
          state.x < waX + waW - 100 &&
          state.y >= waY &&
          state.y < waY + waH - 40;

        if (!isPartiallyVisible) {
          // Off-screen (e.g. disconnected external monitor): center window in active display
          state.x = Math.round(waX + (waW - state.width) / 2);
          state.y = Math.round(waY + (waH - state.height) / 2);
        } else {
          // Clamp position so the titlebar stays fully reachable and doesn't tuck behind taskbar
          state.x = Math.max(waX, Math.min(state.x, waX + waW - 100));
          state.y = Math.max(waY, Math.min(state.y, waY + waH - 40));
        }
      }
    }
  } catch (err) {
    console.warn('[WindowState] Error validating display geometry:', err?.message);
  }

  return state;
}

function saveWindowStateSync() {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const isMax = mainWindow.isMaximized();
    // Root Cause Fix: When maximized, unmaximize/restore down needs normal floating bounds
    const bounds = (!isMax && !mainWindow.isMinimized() && !mainWindow.isFullScreen())
      ? mainWindow.getBounds()
      : cachedNormalBounds;

    const stateToSave = {
      x: bounds?.x,
      y: bounds?.y,
      width: bounds?.width || DEFAULT_WINDOW_STATE.width,
      height: bounds?.height || DEFAULT_WINDOW_STATE.height,
      isMaximized: isMax,
    };

    const filePath = getWindowStateFilePath();
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(stateToSave, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    console.warn('[WindowState] Failed to save state atomically:', err?.message);
  }
}

function debounceSaveWindowState(delayMs = 300) {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    saveWindowStateSync();
  }, delayMs);
}

// 7. Window Creation & Native Controls
async function createMainWindow() {
  const windowState = loadWindowState();

  const windowOptions = {
    width: windowState.width,
    height: windowState.height,
    minWidth: DEFAULT_WINDOW_STATE.minWidth,
    minHeight: DEFAULT_WINDOW_STATE.minHeight,
    frame: false,
    backgroundColor: '#09090b',
    title: 'Mash',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
    },
  };

  if (windowState.x !== undefined && windowState.y !== undefined) {
    windowOptions.x = windowState.x;
    windowOptions.y = windowState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Initialize cached floating normal bounds
  cachedNormalBounds = {
    x: windowOptions.x ?? mainWindow.getBounds().x,
    y: windowOptions.y ?? mainWindow.getBounds().y,
    width: windowOptions.width,
    height: windowOptions.height,
  };

  const notifyMaximizeChange = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximize-change', mainWindow.isMaximized());
    }
  };

  // Bidirectional sync and state debouncing
  mainWindow.on('maximize', () => {
    notifyMaximizeChange();
    debounceSaveWindowState();
  });

  mainWindow.on('unmaximize', () => {
    notifyMaximizeChange();
    debounceSaveWindowState();
  });

  mainWindow.on('restore', () => {
    notifyMaximizeChange();
    debounceSaveWindowState();
  });

  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      cachedNormalBounds = mainWindow.getBounds();
    }
    debounceSaveWindowState();
  });

  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized() && !mainWindow.isFullScreen()) {
      cachedNormalBounds = mainWindow.getBounds();
    }
    debounceSaveWindowState();
  });

  mainWindow.on('close', () => {
    saveWindowStateSync();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links (such as Google OAuth) in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    // Hardening (QA-BUG-3): deny all child window popups regardless of protocol
    return { action: 'deny' };
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Defensive fallback in case ready-to-show was already triggered or delayed
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1000);

  if (!app.isPackaged && process.env.MASH_DEV_URL) {
    mainWindow.loadURL(process.env.MASH_DEV_URL);
  } else {
    mainWindow.loadURL('app://mash/index.html');
  }
}

// 8. IPC Handlers
ipcMain.on('mash-get-api-url', (event) => {
  event.returnValue = assignedApiUrl;
});

ipcMain.on('window-is-maximized', (event) => {
  event.returnValue = mainWindow ? mainWindow.isMaximized() : false;
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

ipcMain.handle('mash-open-path', async (_event, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return 'Invalid path';
  try {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) return 'Path does not exist';

    // Defense-in-depth: block arbitrary executable/script launching via IPC
    const ext = path.extname(resolved).toLowerCase();
    const BLOCKED_EXTENSIONS = new Set([
      '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse',
      '.wsf', '.wsh', '.com', '.msi', '.scr', '.pif', '.sh', '.bin'
    ]);
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return 'Execution of executable binaries or scripts is prohibited';
    }

    return await shell.openPath(resolved);
  } catch (err) {
    return err?.message || 'Failed to open path';
  }
});

ipcMain.on('mash-restart-and-install', () => {
  saveWindowStateSync();
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
      // Clean HTML routing for Next.js static exports (QA-BUG-10c)
      if (!fs.existsSync(target) || (fs.existsSync(target) && fs.statSync(target).isDirectory())) {
        const cleanPath = decodedPath.replace(/\/+$/, '');
        if (fs.existsSync(path.join(outDir, `${cleanPath}.html`))) {
          target = path.join(outDir, `${cleanPath}.html`);
        } else if (fs.existsSync(path.join(outDir, cleanPath, 'index.html'))) {
          target = path.join(outDir, cleanPath, 'index.html');
        } else {
          target = path.join(outDir, 'index.html');
        }
      }

      // Hard path traversal containment (QA-BUG-3):
      // Target must resolve strictly within frontend/out
      const resolvedTarget = path.resolve(target);
      const normalizedOutDir = path.resolve(outDir);
      if (!resolvedTarget.startsWith(normalizedOutDir + path.sep) && resolvedTarget !== normalizedOutDir && resolvedTarget !== path.join(normalizedOutDir, 'index.html')) {
        console.warn('[Protocol:app] Traversal attempt blocked:', request.url);
        return new Response('Forbidden', { status: 403 });
      }

      // Read via Node fs (which automatically penetrates app.asar transparently)
      const data = fs.readFileSync(resolvedTarget);
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
  saveWindowStateSync();
  terminateConnector();
});

app.on('will-quit', () => {
  isQuitting = true;
  saveWindowStateSync();
  terminateConnector();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (!connectorProcess) {
      const port = await allocateEphemeralPort();
      await launchBackendSupervisor(port);
    }
    await createMainWindow();
  }
});

app.on('window-all-closed', () => {
  isQuitting = true;
  saveWindowStateSync();
  terminateConnector();
  app.quit();
});
