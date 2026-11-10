// Mash Desktop Window Manager & State Persistence
// Implements VS Code / DeepSeek standard window state persistence:
// - Atomic temp-then-rename writes
// - Separate cached normal floating bounds from maximized state
// - Multi-display workArea clamping and phantom window recovery
// - Bidirectional maximize/restore event sync

const fs = require('fs');
const { app, BrowserWindow, screen, shell } = require('electron');
const { getWindowStateFilePath, getPreloadPath } = require('./paths');

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  x: undefined,
  y: undefined,
  isMaximized: false,
};

let mainWindow = null;
let cachedNormalBounds = null;
let saveDebounceTimer = null;

function getMainWindow() {
  return mainWindow;
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

function notifyMaximizeChange() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window-maximize-change', mainWindow.isMaximized());
  }
}

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
      preload: getPreloadPath(),
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

  return mainWindow;
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  getMainWindow,
  loadWindowState,
  saveWindowStateSync,
  debounceSaveWindowState,
  notifyMaximizeChange,
  createMainWindow,
};
