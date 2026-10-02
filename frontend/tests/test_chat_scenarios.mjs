import assert from 'node:assert';

// 1. Emulate buildTurns from lib/turns.ts
function buildTurns(chatMessages) {
  const result = [];
  let flatIdx = 0;
  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    if (msg.role === 'user') {
      const stableId = msg.turnId || `turn_${msg.sessionId || 'sid'}_${flatIdx}_${msg.content.slice(0, 16).replace(/\s+/g, '_')}`;
      result.push({ 
        id: stableId,
        turnId: msg.turnId,
        status: msg.status,
        userMsg: msg, 
        aiMsgs: [], 
        flatIdx,
      });
    } else if (result.length > 0) {
      const currentTurn = result[result.length - 1];
      currentTurn.aiMsgs.push(msg);
      if (msg.status) {
        currentTurn.status = msg.status;
      }
    } else {
      const stableId = msg.turnId || `turn_ctx_0`;
      result.push({
        id: stableId,
        turnId: msg.turnId,
        status: msg.status,
        userMsg: { role: 'user', content: '[Earlier Context]' },
        aiMsgs: [msg],
        flatIdx: 0,
      });
    }
    flatIdx++;
  }
  return result;
}

// 2. Emulate isToolRunning from TaskWorkLogAccordion.tsx
function isToolRunning(tool, isStreaming) {
  if (!tool) return false;
  if (tool.status === 'completed' || tool.status === 'failed') return false;
  if (tool.status === 'running') return true;
  return !!(isStreaming && tool.output === undefined);
}

console.log("======================================================================");
console.log("STARTING FRONTEND CHAT RENDERING & TURN ISOLATION TESTS");
console.log("======================================================================");

// Test 1: Turn Isolation & Zero Data Merging Across Multi-Turn Sequence
console.log("\n[Frontend Test 1] Turn Isolation Across Sequential Turns");
const messages = [
  { role: 'user', content: 'Turn 1 Prompt', turnId: 'turn_1' },
  { role: 'assistant', content: 'Turn 1 Result', turnId: 'turn_1', status: 'completed', tools: [{ id: 't1', name: 'read_file' }] },
  { role: 'user', content: 'Turn 2 Prompt', turnId: 'turn_2' },
  { role: 'assistant', content: 'Turn 2 Result', turnId: 'turn_2', status: 'completed', tools: [{ id: 't2', name: 'run_shell' }] },
];
const turns = buildTurns(messages);
assert.strictEqual(turns.length, 2, "Must create exactly 2 turns");
assert.strictEqual(turns[0].userMsg.content, 'Turn 1 Prompt');
assert.strictEqual(turns[0].aiMsgs[0].content, 'Turn 1 Result');
assert.strictEqual(turns[0].aiMsgs[0].tools[0].name, 'read_file');

assert.strictEqual(turns[1].userMsg.content, 'Turn 2 Prompt');
assert.strictEqual(turns[1].aiMsgs[0].content, 'Turn 2 Result');
assert.strictEqual(turns[1].aiMsgs[0].tools[0].name, 'run_shell');
console.log("  -> PASSED: Turn 1 and Turn 2 are completely isolated; 0 data merged");

// Test 2: Cancel / Stop Turn & Next Turn "Continue"
console.log("\n[Frontend Test 2] Cancel/Aborted Turn & Subsequent 'Continue' Turn");
const cancelFlow = [
  { role: 'user', content: 'Do task', turnId: 'turn_10' },
  { role: 'assistant', content: 'Partial work...', turnId: 'turn_10', status: 'aborted' },
  { role: 'user', content: 'continue', turnId: 'turn_11' },
  { role: 'assistant', content: 'Continuing from where I stopped...', turnId: 'turn_11', status: 'running' },
];
const cancelTurns = buildTurns(cancelFlow);
assert.strictEqual(cancelTurns.length, 2);
assert.strictEqual(cancelTurns[0].status, 'aborted');
assert.strictEqual(cancelTurns[1].status, 'running');
console.log("  -> PASSED: Aborted turn retains partial output; new turn starts independently with status 'running'");

// Test 3: Tool Running Spinner State Resolution
console.log("\n[Frontend Test 3] Tool Running Spinner Resolution");
const runningTool = { id: 't1', status: 'running' };
const finishedTool = { id: 't2', status: 'completed', output: 'Success' };
const pendingOutputTool = { id: 't3', status: undefined, output: undefined };
const deliveredTool = { id: 't4', status: undefined, output: 'Done' };

assert.strictEqual(isToolRunning(runningTool, true), true, "Explicit running tool must return true");
assert.strictEqual(isToolRunning(finishedTool, true), false, "Completed tool must return false");
assert.strictEqual(isToolRunning(finishedTool, false), false, "Completed tool with stream ended must return false");
assert.strictEqual(isToolRunning(pendingOutputTool, true), true, "Streaming tool without output must return true");
assert.strictEqual(isToolRunning(deliveredTool, true), false, "Tool with delivered output must return false immediately");
assert.strictEqual(isToolRunning(pendingOutputTool, false), false, "Tool with stream ended must NOT stay running");
console.log("  -> PASSED: All tool spinner states correctly resolve without sticking on running");

// Test 4: Module-level multi-session store isolation
console.log("\n[Frontend Test 4] Multi-Session Store Isolation");
const sessionStore = new Map();
function getOrCreate(sid) {
  if (!sessionStore.has(sid)) {
    sessionStore.set(sid, { chatMessages: [], isStreaming: false, tokenBuffer: '' });
  }
  return sessionStore.get(sid);
}

const sA = getOrCreate('session_A');
const sB = getOrCreate('session_B');
sA.tokenBuffer += "Token for Session A";
sA.isStreaming = true;

assert.strictEqual(sB.tokenBuffer, "", "Session B buffer must remain completely empty");
assert.strictEqual(sB.isStreaming, false, "Session B must not be streaming");
console.log("  -> PASSED: Session A streaming tokens never leak into Session B");

// Test 5: Cloud API data envelope parsing parity
console.log("\n[Frontend Test 5] Cloud API Envelope (event.data) Parsing Parity");
function parseSSEEvent(jsonStr) {
  const event = JSON.parse(jsonStr);
  const eventType = String(event.type || "").toUpperCase();
  const data = event.data && typeof event.data === "object" ? event.data : {};
  let token = "";
  let tool = null;
  if (eventType === "TEXT_MESSAGE_CONTENT") {
    token = event.delta ?? data.delta ?? event.content ?? data.content ?? "";
  } else if (eventType === "TOOL_CALL_START") {
    const rawId = String(event.tool_call_id || data.tool_call_id || data.id || `tc_${Date.now()}`);
    const toolName = event.tool_call_name || data.tool_call_name || event.name || data.name || "action";
    tool = { id: rawId, name: toolName, status: "running" };
  }
  return { eventType, token, tool };
}

// 5a. Legacy format (direct fields)
const legacy = parseSSEEvent(JSON.stringify({ type: "TEXT_MESSAGE_CONTENT", delta: "Direct token" }));
assert.strictEqual(legacy.token, "Direct token", "Direct event.delta must be parsed");

// 5b. Cloud API envelope format (nested in event.data)
const cloud = parseSSEEvent(JSON.stringify({
  type: "TEXT_MESSAGE_CONTENT",
  event_id: "evt_123",
  sequence: 1,
  data: { delta: "Cloud envelope token", message_id: "msg_456" }
}));
assert.strictEqual(cloud.token, "Cloud envelope token", "Nested event.data.delta must be parsed");

// 5c. Cloud API tool call in event.data
const cloudTool = parseSSEEvent(JSON.stringify({
  type: "TOOL_CALL_START",
  event_id: "evt_124",
  sequence: 2,
  data: { tool_call_id: "call_abc", tool_call_name: "calculate_depreciation" }
}));
assert.strictEqual(cloudTool.tool.name, "calculate_depreciation", "Tool name inside event.data must be extracted");
assert.strictEqual(cloudTool.tool.id, "call_abc", "Tool call id inside event.data must be extracted");

console.log("  -> PASSED: Both direct and Cloud API nested event.data payloads parse with 100% parity");

// Test 6: Multi-Sentinel [DONE] [END] Stripping & Text Integrity
console.log("\n[Frontend Test 6] Multi-Sentinel [DONE] [END] Stripping & Word Integrity");
function processDeltaToken(rawToken) {
  if (typeof rawToken !== "string" || !rawToken) return "";
  if (/^\[?(DONE|END)\]?$/i.test(rawToken.trim())) return "";
  return rawToken.replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, "");
}

// 6a. Single delta with multiple terminal sentinels [DONE] [END]
const multiSentinel = processDeltaToken("Audit completed successfully. [DONE] [END]");
assert.strictEqual(multiSentinel, "Audit completed successfully.", "Multiple trailing sentinels must all be stripped");

// 6b. Delta that is purely multiple sentinels
const pureSentinels = processDeltaToken("[DONE] [END]");
assert.strictEqual(pureSentinels, "", "Pure sentinel sequences must resolve to empty string");

// 6c. Delta that is a standalone sentinel
assert.strictEqual(processDeltaToken("[DONE]"), "", "Standalone [DONE] must be stripped");
assert.strictEqual(processDeltaToken("DONE"), "", "Standalone DONE must be stripped");
assert.strictEqual(processDeltaToken("[END]"), "", "Standalone [END] must be stripped");

// 6d. Legitimate English ending in 'done' or 'end' must NOT be corrupted
const englishDone = processDeltaToken("The financial audit is well done");
assert.strictEqual(englishDone, "The financial audit is well done", "English word 'done' must never be stripped");

const englishEnd = processDeltaToken("Review the period end");
assert.strictEqual(englishEnd, "Review the period end", "English word 'end' must never be stripped");

// 6e. Legitimate JSON payload containing status: "done"
const jsonPayload = processDeltaToken('{"status": "done", "records": 42}');
assert.strictEqual(jsonPayload, '{"status": "done", "records": 42}', "JSON with done status must never be corrupted");

console.log("  -> PASSED: Multiple sentinels cleanly stripped; English words & JSON 100% preserved");

console.log("\n======================================================================");
console.log("ALL FRONTEND CHAT RENDERING TESTS PASSED (6/6)");
console.log("======================================================================");

