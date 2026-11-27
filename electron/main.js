// Mash Desktop Main Process Supervisor
// Orchestrates Python backend sidecar lifecycle, ephemeral port 0 binding,
// custom frameless window management, and zero-zombie-process cleanup on Windows.

const { app, session } = require('electron');
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
  getIpcToken,
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
let latestUpdateEvent = null;

function notifyMainWindow(channel, payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

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
        if (latestUpdateEvent) {
          win.webContents.send(latestUpdateEvent.channel, latestUpdateEvent.payload);
        }
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

  // Inject per-boot IPC capability token exclusively into requests from Mash's own window
  // targeting the local sidecar; keeps the secret unreadable by renderer JS, extensions, or other local apps.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1/*'] },
    (details, callback) => {
      const apiUrl = getAssignedApiUrl();
      const win = getMainWindow();
      const headers = { ...details.requestHeaders };
      if (
        apiUrl &&
        win &&
        !win.isDestroyed() &&
        details.webContentsId === win.webContents.id &&
        details.url.startsWith(`${apiUrl}/`)
      ) {
        headers['X-Mash-Token'] = getIpcToken();
      }
      callback({ requestHeaders: headers });
    }
  );

  // Register native IPC listeners
  registerIpcHandlers({
    getMainWindow,
    getAssignedApiUrl,
    getBackendStatus,
    saveWindowStateSync,
    terminateConnector,
  });

  setStatusListener((st) => {
    notifyMainWindow('mash-backend-status', st);
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
    await openOrFocusMainWindow();

    const coldDeepLink = process.argv.find((arg) => arg.startsWith('mash://'));
    if (coldDeepLink) {
      supervisorPromise.then(() => forwardDeepLinkToConnector(coldDeepLink));
    }

    if (app.isPackaged) {
      try {
        const { autoUpdater } = require('electron-updater');
        for (const [eventName, channel, mapPayload] of [
          ['download-progress', 'mash-update-downloading', (p) => ({ progress: Math.round(p.percent) })],
          ['update-downloaded', 'mash-update-ready', (info) => ({ version: info?.version })],
        ]) {
          autoUpdater.on(eventName, (arg) => {
            latestUpdateEvent = { channel, payload: mapPayload(arg) };
            notifyMainWindow(latestUpdateEvent.channel, latestUpdateEvent.payload);
          });
        }
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
