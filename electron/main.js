// Mash Desktop Main Process Supervisor
// Orchestrates Python backend sidecar lifecycle, ephemeral port 0 binding,
// custom frameless window management, and zero-zombie-process cleanup on Windows.

const { app } = require('electron');
let log = console;
try {
  log = require('electron-log/main');
  if (typeof log.initialize === 'function') {
    log.initialize();
  }
} catch (_) {}
const {
  registerPrivilegedSchemes,
  setupDefaultProtocolClient,
  registerCustomProtocolHandlers,
} = require('./protocols');
const {
  allocateEphemeralPort,
  launchBackendSupervisor,
  terminateConnector,
  forwardDeepLinkToConnector,
  getAssignedApiUrl,
  getBackendStatus,
  setStatusListener,
  setWindowReloader,
  setSupervisorQuitting,
  getConnectorProcess,
} = require('./supervisor');
const {
  createMainWindow,
  getMainWindow,
  saveWindowStateSync,
} = require('./windowManager');
const { registerIpcHandlers } = require('./ipcHandlers');

// 1. Privileged scheme and deep link protocol registration
registerPrivilegedSchemes();
setupDefaultProtocolClient();

// 2. Single Instance Mutex: prevent duplicate processes locking SQLite
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, commandLine) => {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  // Windows passes custom protocol URL in commandLine arguments
  const deepLink = commandLine.find((arg) => arg.startsWith('mash://'));
  if (deepLink) {
    forwardDeepLinkToConnector(deepLink);
  }
});

// 3. Application Lifecycle
app.whenReady().then(async () => {
  // Protocol handler routing app://mash/* to frontend/out/*
  registerCustomProtocolHandlers();

  // Register native IPC listeners
  registerIpcHandlers({
    getMainWindow,
    getAssignedApiUrl,
    getBackendStatus,
    saveWindowStateSync,
    terminateConnector,
  });

  setStatusListener((st) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('mash-backend-status', st);
    }
  });

  setWindowReloader(() => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
  });

  try {
    const port = await allocateEphemeralPort();
    // Launch backend supervisor asynchronously in background without blocking UI
    // ponytail: window renders immediately (< 1.0s); backend sidecar connects concurrently
    const supervisorPromise = launchBackendSupervisor(port).catch((err) => {
      log.error('[Supervisor] Background connector launch failed:', err?.message || err);
    });
    const mainWindow = await createMainWindow();
    mainWindow.webContents.on('did-finish-load', () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('mash-backend-status', getBackendStatus());
      }
    });

    const coldDeepLink = process.argv.find((arg) => arg.startsWith('mash://'));
    if (coldDeepLink) {
      supervisorPromise.then(() => forwardDeepLinkToConnector(coldDeepLink));
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
        autoUpdater.checkForUpdatesAndNotify().catch((e) =>
          console.log('[AutoUpdater] check skipped:', e?.message)
        );
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
  setSupervisorQuitting(true);
  saveWindowStateSync();
  terminateConnector();
});

app.on('will-quit', () => {
  setSupervisorQuitting(true);
  saveWindowStateSync();
  terminateConnector();
});

app.on('activate', async () => {
  if (!getMainWindow()) {
    if (!getConnectorProcess()) {
      const port = await allocateEphemeralPort();
      await launchBackendSupervisor(port);
    }
    await createMainWindow();
  }
});

app.on('window-all-closed', () => {
  setSupervisorQuitting(true);
  saveWindowStateSync();
  terminateConnector();
  app.quit();
});
