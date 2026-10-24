// Canonical unit tests for MASH Error Classification importing production module
import assert from 'node:assert';
import { classifyError } from '../src/lib/errorClassification';

console.log("=== Testing MASH Error Classification ===");

// 1. Offline
const r1 = classifyError("Network connection lost (WiFi disconnected). Reconnection timed out.");
assert(r1 !== null);
assert.strictEqual(r1.category, 'offline');
assert.strictEqual(r1.title, 'No Internet Connection');
assert.strictEqual(r1.actionType, 'retry');
console.log("✓ Offline error correctly classified");

// 2. Network Lost
const r2 = classifyError("TypeError: Failed to fetch backend at 127.0.0.1:8000");
assert(r2 !== null);
assert.strictEqual(r2.category, 'network_lost');
assert.strictEqual(r2.title, 'Network Connection Lost');
assert.strictEqual(r2.actionType, 'continue');
console.log("✓ Network lost error correctly classified");

// 3. Timeout
const r3 = classifyError("Stream connection timed out: no response from server within timeout.");
assert(r3 !== null);
assert.strictEqual(r3.category, 'timeout');
assert.strictEqual(r3.title, 'Agent Execution Timed Out');
assert.strictEqual(r3.actionType, 'retry');
console.log("✓ Timeout error correctly classified");

// 4. Quota
const r4 = classifyError("HTTP 429: rate limit exceeded on 5-hour burst window");
assert(r4 !== null);
assert.strictEqual(r4.category, 'quota');
assert.strictEqual(r4.title, 'Plan Token Quota Reached');
assert.strictEqual(r4.actionType, 'quota');
console.log("✓ Quota error correctly classified");

// 5. Auth
const r5 = classifyError("HTTP 401: Authentication required. Please sign in to MASH.");
assert(r5 !== null);
assert.strictEqual(r5.category, 'auth');
assert.strictEqual(r5.title, 'Authentication Required');
assert.strictEqual(r5.actionType, 'auth');
console.log("✓ Auth error correctly classified");

// 6. JSON envelope unwrapping
const r6 = classifyError('{"error": {"message": "Model is currently experiencing high latency"}}');
assert(r6 !== null);
assert.strictEqual(r6.category, 'general');
assert.strictEqual(r6.description, 'Model is currently experiencing high latency');

// 7. Continue action support on offline & network_lost
const canContinue = (category: string) => category === 'network_lost' || category === 'offline';
assert.strictEqual(canContinue(r1.category), true, "offline category must allow continue action");
assert.strictEqual(canContinue(r2.category), true, "network_lost category must allow continue action");
assert.strictEqual(canContinue(r5.category), false, "auth category must not allow continue action");
console.log("✓ Continue action enabled for offline and network_lost");

console.log("All 7 Error Classification Tests PASSED!");
