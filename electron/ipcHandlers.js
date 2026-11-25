// Mash Desktop IPC Handlers
// Bridges native window controls, ephemeral backend API URL, shell file opening,
// and auto-update lifecycle securely between main process and renderer.

const path = require('path');
const fs = require('fs');
const { app, ipcMain, shell, dialog } = require('electron');

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse',
  '.wsf', '.wsh', '.com', '.msi', '.scr', '.pif', '.sh', '.bin'
]);

function registerIpcHandlers({
  getMainWindow,
  getAssignedApiUrl,
  getBackendStatus,
  saveWindowStateSync,
  terminateConnector,
}) {
  ipcMain.on('mash-get-api-url', (event) => {
    event.returnValue = getAssignedApiUrl();
  });

  ipcMain.on('mash-get-backend-status', (event) => {
    event.returnValue = getBackendStatus ? getBackendStatus() : { status: 'ready', port: 8000 };
  });

  ipcMain.on('mash-get-version', (event) => {
    event.returnValue = app.getVersion();
  });

  ipcMain.handle('mash-select-folder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Workspace Folder',
    });
    if (result.canceled || !result.filePaths || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.on('window-is-maximized', (event) => {
    const win = getMainWindow();
    event.returnValue = win ? win.isMaximized() : false;
  });

  ipcMain.on('window-minimize', () => {
    const win = getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.on('window-maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    const win = getMainWindow();
    if (win) win.close();
  });

  ipcMain.handle('mash-open-path', async (_event, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return 'Invalid path';
    try {
      const resolved = path.resolve(targetPath);
      if (!fs.existsSync(resolved)) return 'Path does not exist';

      // Defense-in-depth: block arbitrary executable/script launching via IPC
      const ext = path.extname(resolved).toLowerCase();
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
}

module.exports = {
  registerIpcHandlers,
};
