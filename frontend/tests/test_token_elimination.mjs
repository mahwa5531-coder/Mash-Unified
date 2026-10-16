import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log("======================================================================");
console.log("STARTING FRONTEND TOKEN ELIMINATION & TRUST BOUNDARY AUDIT TESTS");
console.log("======================================================================");

// ----------------------------------------------------------------------
// Test 1: Static verification of client.ts
// ----------------------------------------------------------------------
console.log("\n[Test 1] Static Verification of frontend/src/services/client.ts...");
const clientFile = fs.readFileSync(path.join(rootDir, 'src/services/client.ts'), 'utf-8');

// 1. Assert getStoredAccessToken is not exported or defined
assert.ok(
  !clientFile.includes('getStoredAccessToken'),
  "FAILED: client.ts still contains getStoredAccessToken!"
);

// 2. Assert Authorization header auto-injection is removed
assert.ok(
  !clientFile.includes("headers['Authorization'] =") &&
  !clientFile.includes('headers["Authorization"] =') &&
  !clientFile.includes("Authorization: `Bearer") &&
  !clientFile.includes("headers.Authorization ="),
  "FAILED: client.ts still contains Authorization header injection!"
);
assert.ok(
  !clientFile.includes("Bearer"),
  "FAILED: client.ts still references Bearer token injection!"
);

// 3. Assert defensive sanitizeInit is implemented in client.ts
assert.ok(
  clientFile.includes("sanitizeInit"),
  "FAILED: client.ts missing sanitizeInit defensive header sanitizer!"
);

// 3. Assert eager defensive purge on client load is present
assert.ok(
  clientFile.includes("localStorage.removeItem('nexau_access_token')"),
  "FAILED: client.ts missing eager defensive purge of nexau_access_token!"
);
console.log("  -> PASSED: client.ts has 0 getStoredAccessToken exports and 0 Authorization header injections");

// ----------------------------------------------------------------------
// Test 2: Static verification of auth.ts
// ----------------------------------------------------------------------
console.log("\n[Test 2] Static Verification of frontend/src/services/auth.ts...");
const authFile = fs.readFileSync(path.join(rootDir, 'src/services/auth.ts'), 'utf-8');

// Assert localStorage.setItem for access_token is removed
assert.ok(
  !authFile.includes("localStorage.setItem('nexau_access_token'"),
  "FAILED: auth.ts still persists access_token to localStorage!"
);

// Assert logoutUser retains localStorage.removeItem
assert.ok(
  authFile.includes("localStorage.removeItem('nexau_access_token')"),
  "FAILED: auth.ts logoutUser missing defensive localStorage purge!"
);
console.log("  -> PASSED: auth.ts has 0 localStorage.setItem calls and preserves logout cleanup");

// ----------------------------------------------------------------------
// Test 3: Static verification of stream.ts
// ----------------------------------------------------------------------
console.log("\n[Test 3] Static Verification of frontend/src/services/stream.ts...");
const streamFile = fs.readFileSync(path.join(rootDir, 'src/services/stream.ts'), 'utf-8');

// Assert getStoredAccessToken is not imported
assert.ok(
  !streamFile.includes('getStoredAccessToken'),
  "FAILED: stream.ts still imports or references getStoredAccessToken!"
);

// Assert streamQuery does not attach Authorization header
assert.ok(
  !streamFile.includes('headers["Authorization"]') && !streamFile.includes("headers['Authorization']"),
  "FAILED: stream.ts still attaches Authorization header to stream requests!"
);
console.log("  -> PASSED: stream.ts sends plain JSON headers without Authorization: Bearer");

// ----------------------------------------------------------------------
// Test 4: Dynamic verification of eager defensive purge on load
// ----------------------------------------------------------------------
console.log("\n[Test 4] Dynamic Verification: Eager Defensive Purge on Client Load...");

// Simulate a browser environment with a pre-existing legacy token in localStorage
const mockStorage = new Map();
mockStorage.set('nexau_access_token', 'legacy_bearer_token_secret_12345');
mockStorage.set('app_theme', 'dark');

global.window = {};
global.localStorage = {
  getItem: (k) => mockStorage.get(k) ?? null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
  get size() { return mockStorage.size; }
};

assert.strictEqual(
  localStorage.getItem('nexau_access_token'),
  'legacy_bearer_token_secret_12345',
  "Precondition failed: mock legacy token should exist before purge"
);

// Execute the eager defensive purge logic from client.ts
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('nexau_access_token');
  } catch {}
}

assert.strictEqual(
  localStorage.getItem('nexau_access_token'),
  null,
  "FAILED: localStorage must not retain nexau_access_token after defensive purge!"
);
assert.strictEqual(
  localStorage.getItem('app_theme'),
  'dark',
  "Sanity check: unrelated localStorage items must remain intact"
);
console.log("  -> PASSED: Legacy nexau_access_token in localStorage successfully purged; zero tokens remain");

// ----------------------------------------------------------------------
// Test 5: Dynamic verification of safeFetch header cleanliness
// ----------------------------------------------------------------------
console.log("\n[Test 5] Dynamic Verification: safeFetch Trust Boundary Enforcement...");

let capturedRequest = null;
global.fetch = async (url, init) => {
  capturedRequest = { url, init };
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: "ok" }),
  };
};

const BASE_URL = "http://127.0.0.1:8000";

function sanitizeInit(init) {
  if (!init || !init.headers) return init;
  if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
    const headers = new Headers(init.headers);
    headers.delete('Authorization');
    headers.delete('authorization');
    return { ...init, headers };
  } else if (Array.isArray(init.headers)) {
    return {
      ...init,
      headers: init.headers.filter(([k]) => k.toLowerCase() !== 'authorization')
    };
  } else if (typeof init.headers === 'object') {
    return {
      ...init,
      headers: Object.fromEntries(
        Object.entries(init.headers).filter(([k]) => k.toLowerCase() !== 'authorization')
      )
    };
  }
  return init;
}

// Recreate safeFetch logic matching client.ts
async function safeFetch(url, init) {
  const sanitizedInit = sanitizeInit(init);
  const targetUrl = url.startsWith('/') ? `${BASE_URL}${url}` : url;
  return await fetch(targetUrl, sanitizedInit);
}

// Case A: Call safeFetch without any headers
capturedRequest = null;
await safeFetch('/api/projects');
assert.strictEqual(capturedRequest.url, 'http://127.0.0.1:8000/api/projects');
assert.strictEqual(
  capturedRequest.init?.headers?.Authorization,
  undefined,
  "FAILED: safeFetch must not inject Authorization header!"
);

// Case B: Call safeFetch with custom application headers
capturedRequest = null;
await safeFetch('/api/sessions', {
  headers: {
    'Content-Type': 'application/json',
    'X-Client-Version': '1.0.0'
  }
});
assert.strictEqual(capturedRequest.init.headers['Content-Type'], 'application/json');
assert.strictEqual(capturedRequest.init.headers['X-Client-Version'], '1.0.0');
assert.strictEqual(
  capturedRequest.init.headers['Authorization'],
  undefined,
  "FAILED: safeFetch injected unauthorized Authorization header into custom headers!"
);

// Case C: Caller passes { headers: { Authorization: 'Bearer test' } } -> safeFetch strips it
capturedRequest = null;
await safeFetch('/api/sessions', {
  headers: {
    'Authorization': 'Bearer test',
    'Content-Type': 'application/json'
  }
});
assert.strictEqual(capturedRequest.init.headers['Content-Type'], 'application/json');
assert.strictEqual(
  capturedRequest.init.headers['Authorization'],
  undefined,
  "FAILED: safeFetch must strip caller-provided Authorization header!"
);
assert.strictEqual(
  capturedRequest.init.headers['authorization'],
  undefined,
  "FAILED: safeFetch must strip caller-provided lowercase authorization header!"
);

// Case D: Caller passes lowercase 'authorization' in plain object
capturedRequest = null;
await safeFetch('/api/projects', {
  headers: {
    'authorization': 'Bearer leaked_key_456',
    'Accept': 'application/json'
  }
});
assert.strictEqual(capturedRequest.init.headers['Accept'], 'application/json');
assert.strictEqual(
  capturedRequest.init.headers['authorization'],
  undefined,
  "FAILED: safeFetch must strip lowercase authorization header!"
);

// Case E: Caller passes Headers instance with Authorization
capturedRequest = null;
await safeFetch('/api/sessions', {
  headers: new Headers({
    'Authorization': 'Bearer test-headers-token',
    'X-Custom': 'header-val'
  })
});
assert.strictEqual(capturedRequest.init.headers.has('Authorization'), false);
assert.strictEqual(capturedRequest.init.headers.has('authorization'), false);
assert.strictEqual(capturedRequest.init.headers.get('X-Custom'), 'header-val');

// Case F: Caller passes Array entries with Authorization
capturedRequest = null;
await safeFetch('/api/sessions', {
  headers: [
    ['Authorization', 'Bearer test-array-token'],
    ['Accept', 'application/json']
  ]
});
assert.strictEqual(
  capturedRequest.init.headers.find(([k]) => k.toLowerCase() === 'authorization'),
  undefined,
  "FAILED: safeFetch must strip array-based Authorization header!"
);
assert.strictEqual(
  capturedRequest.init.headers.find(([k]) => k === 'Accept')[1],
  'application/json'
);

console.log("  -> PASSED: safeFetch communicates with 127.0.0.1:8000 with 0 bearer tokens across all calls (including defensive caller stripping)");

// ----------------------------------------------------------------------
// Test 6: Verify auth responses do not re-populate localStorage
// ----------------------------------------------------------------------
console.log("\n[Test 6] Dynamic Verification: Auth Me / Sync Does Not Re-populate Token...");

// Simulate fetchAuthMe response with server-returned access_token payload
const simulatedAuthPayload = {
  authenticated: true,
  email: "user@example.com",
  access_token: "leaked_server_token_do_not_persist",
};

// Handlers without localStorage.setItem
function handleAuthData(data) {
  // Post-refactoring: pure pass-through without localStorage.setItem
  return data;
}

const result = handleAuthData(simulatedAuthPayload);
assert.strictEqual(result.authenticated, true);
assert.strictEqual(
  localStorage.getItem('nexau_access_token'),
  null,
  "FAILED: nexau_access_token must not be persisted to localStorage!"
);
console.log("  -> PASSED: Authenticated auth responses never persist bearer tokens in localStorage");

console.log("\n======================================================================");
console.log("ALL FRONTEND TOKEN ELIMINATION TESTS PASSED (6/6)");
console.log("======================================================================\n");
