// Mash Desktop Backend Process Supervisor
// Orchestrates Python sidecar lifecycle, parent-death stdin pipe watchdog, UTF-8 runtime isolation,
// ephemeral port allocation, health probes, rotating disk logging, and native OS recovery dialogs.

const fs = require('fs');
const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { app, dialog } = require('electron');
const { getConnectorPaths } = require('./paths');

let log = console;
try {
  log = require('electron-log/main');
} catch (_) {}

const MAX_STDERR_BYTES = 65536; // 64 KiB rolling diagnostic buffer kept strictly in disk/main logs
const MAX_RESTARTS = 3;

let connectorProcess = null;
let assignedPort = 8000;
let assignedApiUrl = 'http://127.0.0.1:8000';
let isQuitting = false;
let restartCount = 0;
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

function getConnectorProcess() {
  return connectorProcess;
}

function setSupervisorQuitting(quitting) {
  isQuitting = Boolean(quitting);
}

// Native OS fatal recovery dialog (DeepSeek Harness pattern: zero source/tracebacks in renderer)
async function showFatalRecoveryDialog(isMissingBinary = false) {
  if (isQuitting || fatalDialogOpen || !dialog || typeof dialog.showMessageBox !== 'function') {
    return;
  }
  fatalDialogOpen = true;
  try {
    const detail = isMissingBinary
      ? 'A required application file is missing or blocked. Reinstalling Mash or checking antivirus settings may resolve this.'
      : 'A required background service stopped unexpectedly. Restarting Mash usually resolves this.';

    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: 'Mash',
      message: 'Mash could not start',
      detail,
      buttons: ['Restart Mash', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (response === 0 && !isQuitting) {
      restartBackendSupervisor({
        isRespawn: true,
        allocateFreshPort: true,
        resetAttempts: true,
      }).then((info) => {
        if (info?.portChanged && typeof windowReloader === 'function') {
          windowReloader();
        }
      }).catch((err) => {
        log.error('[Supervisor] Manual restart failed:', err?.message || err);
      });
    } else {
      isQuitting = true;
      terminateConnector();
      if (app && typeof app.quit === 'function') {
        app.quit();
      }
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

// 2. Health Probe Poller
function waitForBackendReady(port, timeoutMs = 45000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      if (isQuitting) {
        reject(new Error('Application shutting down'));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
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

// 3. Windows Process Tree Terminator (Zero Zombie Processes)
function terminateConnector() {
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
async function launchBackendSupervisor(port, { isRespawn = false } = {}) {
  assignedPort = port;
  assignedApiUrl = `http://127.0.0.1:${port}`;
  stderrTail = '';

  const isPackaged = app.isPackaged;
  const { command, args, cwd, runtimeDir } = getConnectorPaths(isPackaged);

  setBackendStatus({ status: isRespawn ? 'restarting' : 'starting' });

  if (isPackaged && !fs.existsSync(command)) {
    log.error(`[Supervisor] Binary missing at ${command}`);
    setBackendStatus({ status: 'error' });
    showFatalRecoveryDialog(true);
    throw new Error('Backend binary missing');
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    MASH_CONNECTOR_URL: assignedApiUrl,
    MASH_PYTHON_RUNTIME_DIR: runtimeDir,
    MASH_WATCH_PARENT_STDIN: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };

  let proc;
  try {
    // Keep stdin open as a parent-death pipe: if Electron dies unexpectedly, OS closes pipe & child exits.
    proc = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    log.error(`[Supervisor] Spawn exception: ${err?.message || err}`);
    setBackendStatus({ status: 'error' });
    showFatalRecoveryDialog(false);
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
    if (connectorProcess !== proc) return;
    log.error(`[MashConnector] Process error: ${err?.message || err}`);
    appendStderrTail(err?.message || 'Process error');
    setBackendStatus({ status: 'error' });
    showFatalRecoveryDialog(false);
  });

  function handleSidecarFailure() {
    if (isQuitting) return;
    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      log.warn(`[Supervisor] Silent respawn ${restartCount}/${MAX_RESTARTS}...`);
      setBackendStatus({ status: 'restarting' });
      setTimeout(() => {
        if (!isQuitting) {
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
      showFatalRecoveryDialog(false);
    }
  }

  proc.on('exit', (code, signal) => {
    if (connectorProcess !== proc) return;
    connectorProcess = null;
    log.warn(`[MashConnector] Exited with code ${code}, signal ${signal}. Tail: ${stderrTail.slice(-1000)}`);
    handleSidecarFailure();
  });

  try {
    await waitForBackendReady(port);
  } catch (err) {
    if (connectorProcess === proc && !isQuitting) {
      terminateConnector();
      log.error(`[Supervisor] Health probe failure: ${err?.message || err}`);
      handleSidecarFailure();
    }
    throw err;
  }

  if (connectorProcess === proc && !isQuitting) {
    setBackendStatus({ status: 'ready' });
    // QA-BUG-9 Fix: Only reset restart counter after sustained healthy runtime (60s)
    // to prevent rapid crash-loops from respawning indefinitely
    setTimeout(() => {
      if (connectorProcess === proc && !proc.killed) {
        restartCount = 0;
      }
    }, 60000);
  }
}

async function restartBackendSupervisor({ isRespawn = false, allocateFreshPort = false, resetAttempts = false } = {}) {
  const prevPort = assignedPort;
  if (resetAttempts) restartCount = 0;
  terminateConnector();
  const nextPort = allocateFreshPort ? await allocateEphemeralPort() : assignedPort;
  await launchBackendSupervisor(nextPort, { isRespawn });
  return { port: nextPort, apiUrl: assignedApiUrl, portChanged: nextPort !== prevPort };
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
  getBackendStatus,
  getConnectorProcess,
  setStatusListener,
  setWindowReloader,
  setSupervisorQuitting,
  allocateEphemeralPort,
  waitForBackendReady,
  terminateConnector,
  launchBackendSupervisor,
  restartBackendSupervisor,
  forwardDeepLinkToConnector,
};
