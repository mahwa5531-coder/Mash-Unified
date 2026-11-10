// Mash Desktop Path & Environment Resolver
// Centralizes path resolution for development, packaged ASAR bundles, and user data.

const path = require('path');
const { app } = require('electron');

const WINDOW_STATE_FILENAME = 'window-state.json';

function getAppOutDir() {
  return path.resolve(__dirname, '../frontend/out');
}

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILENAME);
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getConnectorPaths(isPackaged) {
  if (isPackaged) {
    const cwd = path.join(process.resourcesPath, 'bin', 'connector');
    return {
      command: path.join(cwd, 'connector.exe'),
      args: [],
      cwd,
      runtimeDir: cwd,
    };
  }

  const cwd = path.resolve(__dirname, '..');
  const runtimeDir = path.resolve(__dirname, '../connector');
  return {
    command: 'python',
    args: [path.resolve(__dirname, '../connector/run_server.py')],
    cwd,
    runtimeDir,
  };
}

module.exports = {
  WINDOW_STATE_FILENAME,
  getAppOutDir,
  getWindowStateFilePath,
  getPreloadPath,
  getConnectorPaths,
};
