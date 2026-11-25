// Mash Desktop Backend Process Supervisor
// Orchestrates Python sidecar lifecycle, ephemeral port allocation, health probes,
// crash backoff recovery, rotating disk logging, and zero-zombie-process cleanup on Windows.

const fs = require('fs');
const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const { getConnectorPaths } = require('./paths');

let log = console;
try {
  log = require('electron-log/main');
} catch (_) {}

const MAX_STDERR_BYTES = 65536; // 64 KiB rolling diagnostic buffer (DSH pattern)
const MAX_RESTARTS = 3;

let connectorProcess = null;
let assignedPort = 8000;
let assignedApiUrl = 'http://127.0.0.1:8000';
let isQuitting = false;
let restartCount = 0;
let stderrTail = '';
let statusListener = null;
let backendStatus = {
  status: 'starting', // 'starting' | 'ready' | 'restarting' | 'error'
  message: 'Starting local engine...',
  detail: '',
  port: assignedPort,
};

function appendStderrTail(text) {
  stderrTail = (stderrTail + text + '\n');
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

  setBackendStatus({
    status: isRespawn ? 'restarting' : 'starting',
    message: isRespawn ? 'Restarting local engine...' : 'Starting local engine...',
    detail: '',
  });

  if (isPackaged && !fs.existsSync(command)) {
    const msg = `Local engine binary missing at ${command} (antivirus may have quarantined it).`;
    log.error(`[Supervisor] ${msg}`);
    setBackendStatus({ status: 'error', message: msg, detail: '' });
    throw new Error(msg);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    MASH_CONNECTOR_URL: assignedApiUrl,
    PYTHONUNBUFFERED: '1',
    MASH_PYTHON_RUNTIME_DIR: runtimeDir,
  };

  let proc;
  try {
    proc = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err?.message || 'Failed to spawn local engine process.';
    log.error(`[Supervisor] Spawn exception: ${msg}`);
    setBackendStatus({ status: 'error', message: msg, detail: '' });
    throw err;
  }

  connectorProcess = proc;

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
    const msg = err?.message || 'Failed to start local engine.';
    log.error(`[MashConnector] Process error: ${msg}`);
    appendStderrTail(msg);
    setBackendStatus({
      status: 'error',
      message: 'Failed to launch local engine.',
      detail: stderrTail.slice(-1500),
    });
  });

  proc.on('exit', (code, signal) => {
    if (connectorProcess !== proc) return;
    connectorProcess = null;
    log.warn(`[MashConnector] Exited with code ${code}, signal ${signal}`);
    if (isQuitting) return;

    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      log.warn(`[Supervisor] Unexpected exit. Respawning attempt ${restartCount}/${MAX_RESTARTS}...`);
      setBackendStatus({
        status: 'restarting',
        message: `Local engine exited unexpectedly. Restarting (${restartCount}/${MAX_RESTARTS})...`,
        detail: '',
      });
      setTimeout(() => {
        if (!isQuitting) {
          restartBackendSupervisor({ isRespawn: true, allocateFreshPort: true }).catch((err) => {
            log.error('[Supervisor] Respawn failed:', err?.message || err);
          });
        }
      }, 1000);
    } else {
      setBackendStatus({
        status: 'error',
        message: `Local engine stopped unexpectedly (exit code ${code ?? 'unknown'}).`,
        detail: stderrTail.slice(-1500),
      });
    }
  });

  try {
    await waitForBackendReady(port);
  } catch (err) {
    if (connectorProcess === proc && !isQuitting) {
      terminateConnector();
      const msg = err?.message || 'Local engine failed health check.';
      log.error(`[Supervisor] ${msg}`);
      setBackendStatus({
        status: 'error',
        message: msg,
        detail: stderrTail.slice(-1500),
      });
    }
    throw err;
  }

  if (connectorProcess === proc && !isQuitting) {
    setBackendStatus({ status: 'ready', message: '', detail: '' });
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
  setSupervisorQuitting,
  allocateEphemeralPort,
  waitForBackendReady,
  terminateConnector,
  launchBackendSupervisor,
  restartBackendSupervisor,
  forwardDeepLinkToConnector,
};
