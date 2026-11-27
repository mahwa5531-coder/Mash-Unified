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
  showFatalRecoveryDialog,
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

let isAppQuitting = false;
let relaunchOnQuit = false;

function beginShutdown() {
  isAppQuitting = true;
  setSupervisorQuitting(true);
  saveWindowStateSync();
  terminateConnector();
}

async function openOrFocusMainWindow() {
  if (isAppQuitting) {
    // User reopened Mash mid-shutdown: hand off to fresh instance once teardown frees locks
    relaunchOnQuit = true;
    return null;
  }
  let win = getMainWindow();
  if (!win || win.isDestroyed()) {
    win = await createMainWindow();
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) {
        win.webContents.send('mash-backend-status', getBackendStatus());
      }
    });
    return win;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  return win;
}

app.on('second-instance', (_event, commandLine) => {
  void openOrFocusMainWindow().catch((err) => {
    log.error('[Window] Failed to focus or recreate main window:', err?.message || err);
  });

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
      if (win.webContents.isLoading()) win.webContents.stop();
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
    const mainWindow = await openOrFocusMainWindow();

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
          log.info('[AutoUpdater] check skipped:', e?.message)
        );
      } catch (e) {
        log.info('[AutoUpdater] init skipped:', e?.message);
      }
    }
  } catch (err) {
    log.error('[Supervisor] Startup error:', err);
    terminateConnector();
    await showFatalRecoveryDialog({
      mode: 'app',
      message: 'Mash could not start',
      detail: 'An unexpected startup error prevented Mash from opening. Restarting Mash usually resolves this.',
    });
  }
});

app.on('before-quit', () => {
  beginShutdown();
});

app.on('will-quit', () => {
  beginShutdown();
  if (relaunchOnQuit) {
    relaunchOnQuit = false;
    app.relaunch();
  }
});

app.on('activate', async () => {
  if (isAppQuitting) return;
  if (!getMainWindow() && !getConnectorProcess()) {
    const port = await allocateEphemeralPort();
    void launchBackendSupervisor(port).catch((err) => {
      log.error('[Supervisor] Activate connector launch failed:', err?.message || err);
    });
  }
  await openOrFocusMainWindow();
});

app.on('window-all-closed', () => {
  beginShutdown();
  app.quit();
});
