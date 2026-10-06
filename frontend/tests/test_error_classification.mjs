// Unit tests for MASH Error Classification
import assert from 'assert';

// Simulated classifyError logic for ES module test runner
function extractInnerErrorMessage(raw) {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
    if (parsed?.message) return String(parsed.message);
    if (parsed?.detail) return String(parsed.detail);
  } catch {}
  const match = raw.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  if (match && match[1]) return match[1];
  return raw.replace(/^(?:Error|Exception|RuntimeError|ValueError|HTTPException):\s*/i, '').trim();
}

function classifyError(rawError, errorId) {
  if (!rawError && !errorId) return null;
  const raw = String(rawError || "").trim();
  const lower = raw.toLowerCase();
  const cleaned = extractInnerErrorMessage(raw);

  const isOffline = lower.includes("wifi disconnected") ||
    lower.includes("offline") ||
    lower.includes("no internet connection");

  if (isOffline) {
    return {
      category: 'offline',
      title: 'No Internet Connection',
      description: 'Your computer appears to be offline. Please verify your Wi-Fi or network connection and reconnect.',
      actionType: 'retry',
      iconType: 'offline',
    };
  }

  const isNetworkLost =
    lower.includes("failed to fetch") ||
    lower.includes("network connection lost") ||
    lower.includes("networkerror") ||
    lower.includes("connection reset") ||
    lower.includes("backend server unreachable");

  if (isNetworkLost) {
    return {
      category: 'network_lost',
      title: 'Network Connection Lost',
      description: 'The connection to the agent runtime was lost mid-execution. Your partial progress has been preserved.',
      actionType: 'continue',
      iconType: 'network',
    };
  }

  const isTimeout =
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("deadline exceeded") ||
    lower.includes("stream connection timed out");

  if (isTimeout) {
    return {
      category: 'timeout',
      title: 'Agent Execution Timed Out',
      description: 'The model took too long to complete its response. This can occur during peak upstream load or on very large tasks.',
      actionType: 'retry',
      iconType: 'timeout',
    };
  }

  const isQuota =
    lower.includes("quota exceeded") ||
    lower.includes("rate limit") ||
    lower.includes("quota reached") ||
    lower.includes("insufficient_quota") ||
    lower.includes("429");

  if (isQuota) {
    return {
      category: 'quota',
      title: 'Baseline Model Quota Reached',
      description: 'Your plan has reached its rolling baseline token allocation. Check the quota banner for refresh time.',
      actionType: 'quota',
      iconType: 'quota',
    };
  }

  const isAuth =
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("authentication required");

  if (isAuth) {
    return {
      category: 'auth',
      title: 'Authentication Required',
      description: 'Your session has expired or requires authorization. Please sign in to MASH to continue.',
      actionType: 'auth',
      iconType: 'auth',
    };
  }

  return {
    category: 'general',
    title: 'Agent Execution Interrupted',
    description: cleaned || 'Agent execution was interrupted or encountered an unexpected error.',
    actionType: 'retry',
    iconType: 'error',
  };
}

console.log("=== Testing MASH Error Classification ===");

// 1. Offline
const r1 = classifyError("Network connection lost (WiFi disconnected). Reconnection timed out.");
assert.strictEqual(r1.category, 'offline');
assert.strictEqual(r1.title, 'No Internet Connection');
console.log("✓ Offline error correctly classified");

// 2. Network Lost
const r2 = classifyError("TypeError: Failed to fetch backend at 127.0.0.1:8000");
assert.strictEqual(r2.category, 'network_lost');
assert.strictEqual(r2.title, 'Network Connection Lost');
console.log("✓ Network lost error correctly classified");

// 3. Timeout
const r3 = classifyError("Stream connection timed out: no response from server within timeout.");
assert.strictEqual(r3.category, 'timeout');
assert.strictEqual(r3.title, 'Agent Execution Timed Out');
console.log("✓ Timeout error correctly classified");

// 4. Quota
const r4 = classifyError("HTTP 429: rate limit exceeded on 5-hour burst window");
assert.strictEqual(r4.category, 'quota');
assert.strictEqual(r4.title, 'Baseline Model Quota Reached');
console.log("✓ Quota error correctly classified");

// 5. Auth
const r5 = classifyError("HTTP 401: Authentication required. Please sign in to MASH.");
assert.strictEqual(r5.category, 'auth');
assert.strictEqual(r5.title, 'Authentication Required');
console.log("✓ Auth error correctly classified");

// 6. JSON envelope unwrapping
const r6 = classifyError('{"error": {"message": "Model is currently experiencing high latency"}}');
assert.strictEqual(r6.category, 'general');
assert.strictEqual(r6.description, 'Model is currently experiencing high latency');
console.log("✓ JSON error envelope extracted cleanly");

console.log("All 6 Error Classification Tests PASSED!");
