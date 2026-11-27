// Mash Desktop Backend Process Supervisor
// Orchestrates Python sidecar lifecycle, parent-death stdin pipe watchdog, UTF-8 runtime isolation,
// ephemeral port allocation, health probes, rotating disk logging, and native OS recovery dialogs.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { app, dialog, shell } = require('electron');
const { getConnectorPaths } = require('./paths');

let log = console;
try {
  log = require('electron-log/main');
} catch (_) {}

const MAX_STDERR_BYTES = 65536; // 64 KiB rolling diagnostic buffer kept strictly in disk/main logs
const MAX_RESTARTS = 3;
const ipcToken = crypto.randomBytes(32).toString('hex');

let connectorProcess = null;
let assignedPort = 8000;
let assignedApiUrl = 'http://127.0.0.1:8000';
let isQuitting = false;
let restartCount = 0;
let currentAttemptId = 0;
let lifecycleQueue = Promise.resolve();
let fatalDialogOpen = false;
let stderrTail = '';
let statusListener = null;
let windowReloader = null;
let backendStatus = {
  status: 'starting', // 'starting' | 'ready' | 'restarting' | 'error'
  port: assignedPort,
};

function appendStderrTail(text) {
  stderrTail = stderrTail + text + '\n';
  if (stderrTail.length > MAX_STDERR_BYTES) {
    stderrTail = stderrTail.slice(-MAX_STDERR_BYTES);
  }
}

function setBackendStatus(next) {
  backendStatus = { ...backendStatus, ...next, port: assignedPort };
  if (typeof statusListener === 'function') {
    try {
      statusListener(backendStatus);
    } catch (_) {}
  }
}

function setStatusListener(fn) {
  statusListener = typeof fn === 'function' ? fn : null;
}

function setWindowReloader(fn) {
  windowReloader = typeof fn === 'function' ? fn : null;
}

function getBackendStatus() {
  return { ...backendStatus };
}

function getAssignedPort() {
  return assignedPort;
}

function getAssignedApiUrl() {
  return assignedApiUrl;
}

function getIpcToken() {
  return ipcToken;
}

function getConnectorProcess() {
  return connectorProcess;
}

function setSupervisorQuitting(quitting) {
  isQuitting = Boolean(quitting);
}

function enqueueLifecycle(task) {
  const next = lifecycleQueue.then(task, task);
  lifecycleQueue = next.catch(() => {});
  return next;
}

function resolveMainLogPath() {
  try {
    const file = log?.transports?.file?.getFile?.();
    if (file?.path) return file.path;
  } catch (_) {}
  try {
    return path.join(app.getPath('logs'), 'main.log');
  } catch (_) {
    return '';
  }
}

// Native OS fatal recovery dialog loop (DeepSeek Harness pattern: zero source/tracebacks in renderer)
async function showFatalRecoveryDialog({
  isMissingBinary = false,
  mode = 'backend',
  message = 'Mash could not start',
  detail,
} = {}) {
  if (isQuitting || fatalDialogOpen || !dialog || typeof dialog.showMessageBox !== 'function') {
    return;
  }
  fatalDialogOpen = true;
  try {
    let heading = message;
    let body = detail || (isMissingBinary
      ? 'A required application file is missing or blocked. Reinstalling Mash or checking antivirus settings may resolve this.'
      : 'A required background service stopped unexpectedly. Restarting Mash usually resolves this.');

    while (!isQuitting) {
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: 'Mash',
        message: heading,
        detail: body,
        buttons: ['Restart Mash', 'Open Log File', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });

      if (response === 1) {
        try {
          const logFile = resolveMainLogPath();
          if (logFile && fs.existsSync(logFile) && typeof shell?.showItemInFolder === 'function') {
            shell.showItemInFolder(logFile);
          } else if (typeof app?.getPath === 'function' && typeof shell?.openPath === 'function') {
            await shell.openPath(app.getPath('logs'));
          }
        } catch (err) {
          log.warn('[Supervisor] Failed to open log location:', err?.message || err);
        }
        continue;
      }

      if (response === 0 && !isQuitting) {
        if (mode === 'app') {
          isQuitting = true;
          terminateConnector();
          if (app && typeof app.relaunch === 'function') {
            app.relaunch();
            app.exit(0);
          }
          return;
        }
        try {
          const info = await restartBackendSupervisor({
            isRespawn: true,
            allocateFreshPort: true,
            resetAttempts: true,
          });
          if (info?.portChanged && typeof windowReloader === 'function') {
            windowReloader();
          }
          return;
        } catch (err) {
          log.error('[Supervisor] Manual restart failed:', err?.message || err);
          heading = 'Mash still could not start';
          body = 'Restarting the background service failed. You can try again, inspect the log file, or quit Mash.';
          continue;
        }
      }

      isQuitting = true;
      terminateConnector();
      if (app && typeof app.quit === 'function') {
        app.quit();
      }
      return;
    }
  } finally {
    fatalDialogOpen = false;
  }
}

// 1. Ephemeral Port Allocation: tries standard loopback 8000 first, falls back to dynamic port
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

// 2. Health Probe Poller (stops immediately if superseded or child exited)
function waitForBackendReady(port, timeoutMs = 45000, isAttemptActive = () => true) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (isQuitting || !isAttemptActive()) {
        reject(new Error('Sidecar attempt superseded or stopped'));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        if (isQuitting || !isAttemptActive()) {
          reject(new Error('Sidecar attempt superseded or stopped'));
          return;
        }
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - startTime < timeoutMs) {
          setTimeout(probe, 250);
        } else {
          reject(new Error(`Backend returned HTTP ${res.statusCode}`));
        }
      });
      req.on('error', () => {
        if (isQuitting || !isAttemptActive()) {
          reject(new Error('Sidecar attempt superseded or stopped'));
          return;
        }
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

// 3. Windows Process Tree Terminator (Zero Zombie Processes)
function terminateConnector() {
  currentAttemptId++;
  const proc = connectorProcess;
  connectorProcess = null;
  if (!proc || proc.killed) return;
  try {
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.end();
    }
  } catch (_) {}
  const pid = proc.pid;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (_) {}
}

// 4. Backend Sidecar Process Supervisor
async function launchAttempt(port, { isRespawn = false } = {}) {
  terminateConnector();
  const attemptId = ++currentAttemptId;
  let attemptHandled = false;

  assignedPort = port;
  assignedApiUrl = `http://127.0.0.1:${port}`;
  stderrTail = '';

  const isPackaged = app.isPackaged;
  const { command, args, cwd, runtimeDir } = getConnectorPaths(isPackaged);

  setBackendStatus({ status: isRespawn ? 'restarting' : 'starting' });

  if (isPackaged && !fs.existsSync(command)) {
    log.error(`[Supervisor] Binary missing at ${command}`);
    setBackendStatus({ status: 'error' });
    void showFatalRecoveryDialog({ isMissingBinary: true });
    throw new Error('Backend binary missing');
  }

  function handleSidecarFailure(reason) {
    if (attemptHandled || attemptId !== currentAttemptId || isQuitting) return;
    attemptHandled = true;
    if (reason) log.warn(`[Supervisor] ${reason}`);

    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      log.warn(`[Supervisor] Silent respawn ${restartCount}/${MAX_RESTARTS}...`);
      setBackendStatus({ status: 'restarting' });
      setTimeout(() => {
        if (!isQuitting && attemptId === currentAttemptId) {
          restartBackendSupervisor({ isRespawn: true, allocateFreshPort: true })
            .then((info) => {
              if (info?.portChanged && typeof windowReloader === 'function') {
                windowReloader();
              }
            })
            .catch((err) => {
              log.error('[Supervisor] Respawn failed:', err?.message || err);
            });
        }
      }, 1000);
    } else {
      setBackendStatus({ status: 'error' });
      void showFatalRecoveryDialog();
    }
  }

  let proc;
  try {
    const env = {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      MASH_CONNECTOR_URL: assignedApiUrl,
      MASH_IPC_TOKEN: ipcToken,
      MASH_PYTHON_RUNTIME_DIR: runtimeDir,
      MASH_WATCH_PARENT_STDIN: '1',
      PYTHONUNBUFFERED: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    // Keep stdin open as a parent-death pipe: if Electron dies unexpectedly, OS closes pipe & child exits.
    proc = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    log.error(`[Supervisor] Spawn exception: ${err?.message || err}`);
    handleSidecarFailure(`Spawn exception: ${err?.message || err}`);
    throw err;
  }

  connectorProcess = proc;
  if (proc.stdin) {
    proc.stdin.on('error', () => {});
  }

  proc.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) log.info(`[MashConnector] ${line}`);
  });

  proc.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) {
      log.error(`[MashConnector:Err] ${line}`);
      appendStderrTail(line);
    }
  });

  proc.on('error', (err) => {
    if (connectorProcess === proc) connectorProcess = null;
    log.error(`[MashConnector] Process error: ${err?.message || err}`);
    appendStderrTail(err?.message || 'Process error');
    handleSidecarFailure(`Process error: ${err?.message || err}`);
  });

  proc.on('exit', (code, signal) => {
    if (connectorProcess === proc) connectorProcess = null;
    log.warn(`[MashConnector] Exited with code ${code}, signal ${signal}. Tail: ${stderrTail.slice(-1000)}`);
    handleSidecarFailure(`Exited with code ${code}, signal ${signal}`);
  });

  const isAttemptActive = () => !attemptHandled && attemptId === currentAttemptId && connectorProcess === proc;

  try {
    await waitForBackendReady(port, 45000, isAttemptActive);
  } catch (err) {
    if (!attemptHandled && attemptId === currentAttemptId && !isQuitting) {
      if (connectorProcess === proc) connectorProcess = null;
      if (proc && !proc.killed) {
        try {
          if (process.platform === 'win32') execSync(`taskkill /pid ${proc.pid} /t /f`, { stdio: 'ignore' });
          else proc.kill('SIGTERM');
        } catch (_) {}
      }
      log.error(`[Supervisor] Health probe failure: ${err?.message || err}`);
      handleSidecarFailure(`Health probe failure: ${err?.message || err}`);
    }
    throw err;
  }

  if (attemptId === currentAttemptId && connectorProcess === proc && !isQuitting) {
    setBackendStatus({ status: 'ready' });
    // QA-BUG-9 Fix: Only reset restart counter after sustained healthy runtime (60s)
    // to prevent rapid crash-loops from respawning indefinitely
    setTimeout(() => {
      if (attemptId === currentAttemptId && connectorProcess === proc && !proc.killed) {
        restartCount = 0;
      }
    }, 60000);
  }
}

async function launchBackendSupervisor(port, options = {}) {
  return enqueueLifecycle(() => launchAttempt(port, options));
}

async function restartBackendSupervisor({ isRespawn = false, allocateFreshPort = false, resetAttempts = false } = {}) {
  return enqueueLifecycle(async () => {
    const prevPort = assignedPort;
    if (resetAttempts) restartCount = 0;
    const nextPort = allocateFreshPort ? await allocateEphemeralPort() : assignedPort;
    await launchAttempt(nextPort, { isRespawn });
    return { port: nextPort, apiUrl: assignedApiUrl, portChanged: nextPort !== prevPort };
  });
}

// 5. OAuth Deep Link Forwarder
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
          'X-Mash-Token': ipcToken,
        },
      },
      (res) => {
        log.info(`[DeepLink] Forwarded mcode to connector, status: ${res.statusCode}`);
      }
    );
    req.on('error', (err) => {
      log.warn('[DeepLink] Failed to forward mcode to connector:', err.message);
    });
    req.write(postData);
    req.end();
  } catch (err) {
    log.warn('[DeepLink] Error parsing deep link:', err);
  }
}

module.exports = {
  getAssignedPort,
  getAssignedApiUrl,
  getIpcToken,
  getBackendStatus,
  getConnectorProcess,
  setStatusListener,
  setWindowReloader,
  setSupervisorQuitting,
  showFatalRecoveryDialog,
  allocateEphemeralPort,
  waitForBackendReady,
  terminateConnector,
  launchBackendSupervisor,
  restartBackendSupervisor,
  forwardDeepLinkToConnector,
};
