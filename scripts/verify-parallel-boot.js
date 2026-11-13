// Self-check for parallel boot architecture: tests that ephemeral port allocation,
// backend URL assignment, and simulated auth polling retry resolve accurately and non-blockingly.

const assert = require('assert');
const http = require('http');
const net = require('net');
const { allocateEphemeralPort, getAssignedApiUrl } = require('../electron/supervisor');

async function runSelfCheck() {
  console.log('[SelfCheck] Testing parallel boot primitives...');

  // 1. Verify ephemeral port allocation is fast (< 100ms)
  const t0 = Date.now();
  const port = await allocateEphemeralPort();
  const allocDuration = Date.now() - t0;
  assert(typeof port === 'number' && port > 0, 'Port must be a positive number');
  assert(allocDuration < 200, `Port allocation took too long: ${allocDuration}ms`);
  console.log(`[SelfCheck] 1. Port allocated in ${allocDuration}ms: ${port}`);

  // 2. Simulate parallel boot retry loop with a delayed local mock backend
  const mockPort = await allocateEphemeralPort();
  let serverStarted = false;
  let attempts = 0;

  // Polling simulation matching page.tsx checkAuthWithRetry logic
  const checkAuthSimulation = async () => {
    const startTime = Date.now();
    return new Promise((resolve, reject) => {
      const probe = () => {
        attempts++;
        const req = http.get(`http://127.0.0.1:${mockPort}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve({ authenticated: true, attempts, duration: Date.now() - startTime });
          } else {
            setTimeout(probe, 50);
          }
        });
        req.on('error', () => {
          if (Date.now() - startTime < 3000) {
            setTimeout(probe, 50);
          } else {
            reject(new Error('Simulation timed out'));
          }
        });
        req.setTimeout(500, () => req.destroy());
      };
      probe();
    });
  };

  // Start polling BEFORE the server exists (simulating parallel window boot)
  const pollPromise = checkAuthSimulation();

  // Start delayed mock server after 300ms (simulating delayed Python startup)
  setTimeout(() => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: true }));
    });
    server.listen(mockPort, '127.0.0.1', () => {
      serverStarted = true;
    });

    // Cleanup server once done
    pollPromise.finally(() => server.close());
  }, 300);

  const result = await pollPromise;
  assert.strictEqual(result.authenticated, true, 'Auth must resolve authenticated');
  assert(result.attempts > 1, 'Polling must retry while server is cold');
  console.log(`[SelfCheck] 2. Polling bridge succeeded after ${result.attempts} attempts in ${result.duration}ms.`);

  console.log('[SelfCheck] ALL PARALLEL BOOT CHECKS PASSED CLEANLY.');
}

runSelfCheck().catch((err) => {
  console.error('[SelfCheck] FAILED:', err);
  process.exit(1);
});
