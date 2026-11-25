// Mash Desktop Preload Script
// Bridges native window controls and ephemeral API URL to renderer securely via contextBridge.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Synchronously query the assigned ephemeral backend URL and version from Main process
let backendUrl = 'http://127.0.0.1:8000';
let appVersion = '0.1.0';
try {
  backendUrl = ipcRenderer.sendSync('mash-get-api-url') || backendUrl;
  appVersion = ipcRenderer.sendSync('mash-get-version') || appVersion;
} catch (_) {}

// Native window control bridge matching WindowTitleBar.tsx and useDesktopAutoUpdate.ts
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => {
    try {
      return Boolean(ipcRenderer.sendSync('window-is-maximized'));
    } catch (_) {
      return false;
    }
  },
  onMaximizeChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, isMax) => callback(Boolean(isMax));
    ipcRenderer.on('window-maximize-change', handler);
    return () => {
      try {
        ipcRenderer.removeListener('window-maximize-change', handler);
      } catch (_) {}
    };
  },
  openPath: (targetPath) => ipcRenderer.invoke('mash-open-path', targetPath),
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (_) {}
    return file?.path || null;
  },
  restartAndInstall: () => ipcRenderer.send('mash-restart-and-install'),
  selectFolder: () => ipcRenderer.invoke('mash-select-folder'),
  getBackendStatus: () => {
    try {
      return ipcRenderer.sendSync('mash-get-backend-status');
    } catch (_) {
      return { status: 'ready', port: 8000 };
    }
  },
  onBackendStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mash-backend-status', handler);
    return () => ipcRenderer.removeListener('mash-backend-status', handler);
  },
  onUpdateDownloading: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mash-update-downloading', handler);
    return () => ipcRenderer.removeListener('mash-update-downloading', handler);
  },
  onUpdateReady: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('mash-update-ready', handler);
    return () => ipcRenderer.removeListener('mash-update-ready', handler);
  },
});

// Expose desktop environment configuration to client transport
contextBridge.exposeInMainWorld('__MASH_DESKTOP__', {
  apiUrl: backendUrl,
  platform: process.platform,
  isDesktop: true,
  version: appVersion,
  selectFolder: () => ipcRenderer.invoke('mash-select-folder'),
});
