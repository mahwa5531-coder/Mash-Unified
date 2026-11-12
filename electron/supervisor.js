// Mash Desktop Backend Process Supervisor
// Orchestrates Python sidecar lifecycle, ephemeral port 0 allocation, health probes,
// crash backoff recovery, and zero-zombie-process tree termination on Windows.

const netSocket = require('net');
const http = require('http');
const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const { getConnectorPaths } = require('./paths');

let connectorProcess = null;
let assignedPort = 8000;
let assignedApiUrl = 'http://127.0.0.1:8000';
let isQuitting = false;
let restartCount = 0;
const MAX_RESTARTS = 3;

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
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
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
  if (!connectorProcess || connectorProcess.killed) return;
  const pid = connectorProcess.pid;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore' });
    } else {
      connectorProcess.kill('SIGTERM');
    }
  } catch (_) {}
  connectorProcess = null;
}

// 4. Backend Sidecar Process Supervisor
async function launchBackendSupervisor(port) {
  assignedPort = port;
  assignedApiUrl = `http://127.0.0.1:${port}`;

  const isPackaged = app.isPackaged;
  const { command, args, cwd, runtimeDir } = getConnectorPaths(isPackaged);

  const env = {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    MASH_CONNECTOR_URL: assignedApiUrl,
    PYTHONUNBUFFERED: '1',
    MASH_PYTHON_RUNTIME_DIR: runtimeDir,
  };

  connectorProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  connectorProcess.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[MashConnector] ${line}`);
  });

  connectorProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[MashConnector:Err] ${line}`);
  });

  connectorProcess.on('exit', (code, signal) => {
    console.log(`[MashConnector] Exited with code ${code}, signal ${signal}`);
    if (!isQuitting && restartCount < MAX_RESTARTS) {
      restartCount++;
      console.warn(`[Supervisor] Unexpected exit. Respawning attempt ${restartCount}/${MAX_RESTARTS}...`);
      setTimeout(() => launchBackendSupervisor(port), 1000);
    }
  });

  await waitForBackendReady(port);

  // QA-BUG-9 Fix: Only reset restart counter after sustained healthy runtime (60s)
  // to prevent rapid crash-loops from respawning indefinitely
  const activeProc = connectorProcess;
  setTimeout(() => {
    if (connectorProcess === activeProc && !connectorProcess?.killed) {
      restartCount = 0;
    }
  }, 60000);
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
        console.log(`[DeepLink] Forwarded mcode to connector, status: ${res.statusCode}`);
      }
    );
    req.on('error', (err) => {
      console.warn('[DeepLink] Failed to forward mcode to connector:', err.message);
    });
    req.write(postData);
    req.end();
  } catch (err) {
    console.warn('[DeepLink] Error parsing deep link:', err);
  }
}

module.exports = {
  getAssignedPort,
  getAssignedApiUrl,
  getConnectorProcess,
  setSupervisorQuitting,
  allocateEphemeralPort,
  waitForBackendReady,
  terminateConnector,
  launchBackendSupervisor,
  forwardDeepLinkToConnector,
};
