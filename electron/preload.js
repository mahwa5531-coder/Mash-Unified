// Mash Desktop Preload Script
// Bridges native window controls and ephemeral API URL to renderer securely via contextBridge.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Synchronously query the assigned ephemeral backend URL from Main process
let backendUrl = 'http://127.0.0.1:8000';
try {
  backendUrl = ipcRenderer.sendSync('mash-get-api-url') || backendUrl;
} catch (_) {}

// Native window control bridge matching WindowTitleBar.tsx and useDesktopAutoUpdate.ts
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
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
});
