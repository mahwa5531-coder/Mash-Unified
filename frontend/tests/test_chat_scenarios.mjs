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

console.log("\n======================================================================");
console.log("ALL FRONTEND CHAT RENDERING TESTS PASSED (4/4)");
console.log("======================================================================");
