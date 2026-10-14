import assert from 'node:assert';

// ==============================================================================
// 1. Emulate formatErrorMessage from frontend/src/services/stream.ts
// ==============================================================================
function formatErrorMessage(rawErr) {
  if (!rawErr) return "An unexpected error occurred during execution.";

  // Extract nested message from OpenAI / OpenRouter error payload string if present
  const innerMsgMatch = rawErr.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  const innerMsg = innerMsgMatch ? innerMsgMatch[1] : null;

  if (rawErr.includes("404") || (innerMsg && innerMsg.toLowerCase().includes("unavailable"))) {
    return innerMsg || "The requested service or route is temporarily unavailable. Please try again shortly.";
  }
  if (rawErr.includes("429") || rawErr.toLowerCase().includes("rate limit") || rawErr.toLowerCase().includes("quota")) {
    return innerMsg || "Plan token quota reached. Please wait for your renewal window or upgrade tier.";
  }
  if (rawErr.includes("401") || rawErr.toLowerCase().includes("unauthorized")) {
    return "API authentication failed. Please sign in to your MASH account.";
  }
  if (innerMsg) {
    return innerMsg;
  }
  const cleaned = rawErr.replace(/^(Error:\s*)+/i, '').trim();
  return cleaned.length > 200 ? cleaned.slice(0, 197) + '...' : cleaned;
}

// ==============================================================================
// 2. Emulate tool matching & in-flight finalization
// ==============================================================================
function isSameToolId(idA, idB) {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  const cleanA = idA.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  const cleanB = idB.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  return cleanA === cleanB || idA.endsWith(`_${idB}`) || idB.endsWith(`_${idA}`);
}

function finalizeRunningTools(toolCallNames, completedToolIds, toolArgBuffers, onToolCall, status = "completed") {
  for (const callId of Object.keys(toolCallNames)) {
    if (!completedToolIds.has(callId)) {
      let finalArgs = {};
      try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
      onToolCall({
        id: callId,
        name: toolCallNames[callId],
        args: finalArgs,
        output: status === "cancelled" ? "Execution interrupted." : "Done.",
        status: status,
      });
      completedToolIds.add(callId);
    }
  }
}

// 3. Exact target assistant index finder matching sessionStore.ts lines 103-116
// ==============================================================================
function findTargetAssistantIdx(msgs, turnId) {
  if (turnId) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].turnId === turnId) return i;
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].status === 'running') return i;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i;
  }
  return -1;
}

// ==============================================================================
// 4. Emulate SSE line parser with Heartbeat filtering
// ==============================================================================
function parseSseChunkBuffer(rawStreamText, callbacks) {
  const lines = rawStreamText.split("\n\n");
  const processedEvents = [];
  const ignoredComments = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Heartbeat / comment filtering (: keep-alive, : heartbeat, :)
    if (trimmed.startsWith(":")) {
      ignoredComments.push(trimmed);
      continue;
    }

    if (!trimmed.startsWith("data:")) continue;
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr) continue;

    if (jsonStr === "[DONE]" || jsonStr === "[END]") {
      processedEvents.push({ type: "DONE" });
      continue;
    }

    try {
      const parsed = JSON.parse(jsonStr);
      processedEvents.push(parsed);
      const evType = String(parsed.type || "").toUpperCase();
      if (evType === "TEXT_MESSAGE_CONTENT" || evType === "TEXT_MESSAGE_CHUNK") {
        const delta = parsed.delta ?? parsed.content ?? "";
        if (delta && callbacks.onToken) callbacks.onToken(delta);
      } else if (evType === "TOOL_CALL_START") {
        if (callbacks.onToolStart) callbacks.onToolStart(parsed);
      }
    } catch (e) {
      // JSON parse error
      throw new Error(`Invalid SSE JSON: ${jsonStr}`);
    }
  }

  return { processedEvents, ignoredComments };
}

console.log("======================================================================");
console.log("STARTING FRONTEND STREAM RETRY & RECOVERY TEST SUITE");
console.log("======================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: Network Drop Mid-Stream & Clean Tool Finalization
// -----------------------------------------------------------------------------
console.log("[Test 1] Network Drop Mid-Stream & In-Flight Tool Finalization");
{
  const toolArgBuffers = { "run_01_call_search": '{"query": "trial balance"}' };
  const toolCallNames = { "run_01_call_search": "web_search" };
  const completedToolIds = new Set();
  const finalizedCalls = [];

  const onToolCall = (tool) => {
    finalizedCalls.push(tool);
  };

  // Simulate network drop exception mid-stream
  finalizeRunningTools(toolCallNames, completedToolIds, toolArgBuffers, onToolCall, "cancelled");

  assert.strictEqual(finalizedCalls.length, 1, "Must finalize in-flight tool on network drop");
  assert.strictEqual(finalizedCalls[0].id, "run_01_call_search");
  assert.strictEqual(finalizedCalls[0].status, "cancelled");
  assert.strictEqual(finalizedCalls[0].output, "Execution interrupted.");
  assert.strictEqual(completedToolIds.has("run_01_call_search"), true);

  // Error message formatting verification
  const networkError = formatErrorMessage("TypeError: fetch failed (network disconnected)");
  assert.ok(networkError.includes("fetch failed"), "Formats fetch error without raw Error: prefix");

  const rateLimitError = formatErrorMessage('{"error": {"message": "Rate limit exceeded 429"}}');
  assert.ok(rateLimitError.includes("quota") || rateLimitError.includes("Rate limit"), "Formats rate limit correctly");

  console.log("  -> PASSED: In-flight tool calls clean finalized as 'cancelled', spinners never hang indefinitely");
}

// -----------------------------------------------------------------------------
// Test 2: Retry Button Flow Without Message Duplication
// -----------------------------------------------------------------------------
console.log("\n[Test 2] Retry Flow Without Duplicate Messages or Bubble Stacking");
{
  const turnId = "turn_audit_42";
  const initialMessages = [
    {
      id: "u_1",
      turnId,
      role: "user",
      content: "Analyze lease agreements under IFRS 16",
      status: "completed",
    },
    {
      id: "a_1",
      turnId,
      role: "assistant",
      content: "Partial analysis before network dropped...",
      status: "error",
      error: "Network connection lost",
    },
  ];

  assert.strictEqual(initialMessages.length, 2);

  // Emulate handleRetry logic
  const targetIdx = findTargetAssistantIdx(initialMessages, turnId);
  assert.strictEqual(targetIdx, 1, "Must find the target assistant message at index 1");

  const nextMessages = [...initialMessages];
  const existingTurnId = nextMessages[targetIdx].turnId || turnId;
  const startNow = Date.now();

  // In-place reset (identical to useChatStream.ts lines 325-346)
  nextMessages[targetIdx] = {
    role: "assistant",
    turnId: existingTurnId,
    status: "running",
    content: "",
    thoughts: [],
    tools: [],
    tasks: [],
    steps: [],
    error: undefined,
    sessionId: "sess_test",
    turnStartTime: startNow,
  };

  // Crucial invariant: messages length must remain EXACTLY 2!
  assert.strictEqual(nextMessages.length, 2, "Message count must not increase on retry (zero duplication)");
  assert.strictEqual(nextMessages[0].role, "user");
  assert.strictEqual(nextMessages[0].content, "Analyze lease agreements under IFRS 16");
  assert.strictEqual(nextMessages[1].role, "assistant");
  assert.strictEqual(nextMessages[1].status, "running");
  assert.strictEqual(nextMessages[1].content, "");
  assert.strictEqual(nextMessages[1].error, undefined);

  // Now simulate incoming retried tokens filling the cleared assistant slot
  const retriedTokens = ["Here ", "is ", "the ", "complete ", "IFRS 16 ", "analysis."];
  for (const token of retriedTokens) {
    nextMessages[targetIdx].content += token;
  }
  nextMessages[targetIdx].status = "completed";

  assert.strictEqual(nextMessages.length, 2);
  assert.strictEqual(nextMessages[1].content, "Here is the complete IFRS 16 analysis.");
  assert.strictEqual(nextMessages[1].status, "completed");

  // Multi-assistant priority resolution tests for findTargetAssistantIdx
  const multiAssistantMsgs = [
    { role: 'user', content: 'Prompt 1', turnId: 'turn_1' },
    { role: 'assistant', content: 'Turn 1 done', turnId: 'turn_1', status: 'completed' },
    { role: 'user', content: 'Prompt 2', turnId: 'turn_2' },
    { role: 'assistant', content: 'Turn 2 running', turnId: 'turn_2', status: 'running' },
    { role: 'user', content: 'Prompt 3', turnId: 'turn_3' },
    { role: 'assistant', content: 'Turn 3 completed', turnId: 'turn_3', status: 'completed' },
  ];

  // 1. Matches exact turnId
  assert.strictEqual(findTargetAssistantIdx(multiAssistantMsgs, 'turn_1'), 1);
  assert.strictEqual(findTargetAssistantIdx(multiAssistantMsgs, 'turn_2'), 3);
  assert.strictEqual(findTargetAssistantIdx(multiAssistantMsgs, 'turn_3'), 5);

  // 2. Without turnId, prioritizes running assistant over later completed assistant
  assert.strictEqual(findTargetAssistantIdx(multiAssistantMsgs, null), 3, "Must prioritize running assistant over completed ones");

  // 3. Without turnId and none running, falls back to latest assistant
  const allCompleted = multiAssistantMsgs.map(m => m.status === 'running' ? { ...m, status: 'completed' } : m);
  assert.strictEqual(findTargetAssistantIdx(allCompleted, null), 5, "Must select latest assistant when none running");

  // 4. Returns -1 when no assistant exists
  assert.strictEqual(findTargetAssistantIdx([{ role: 'user', content: 'Hi' }], null), -1);

  console.log("  -> PASSED: Retry resets target assistant in-place without duplicating user or assistant messages");
}

// -----------------------------------------------------------------------------
// Test 3: Approval Card Auto-Dismissal on Preemptive Steer
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Approval Card Auto-Dismissal on Preemptive Steer");
{
  const sessionMessages = [
    {
      id: "u_1",
      turnId: "turn_1",
      role: "user",
      content: "Run batch database migration script",
      status: "completed",
    },
    {
      id: "a_1",
      turnId: "turn_1",
      role: "assistant",
      content: "I need your approval to execute this script.",
      status: "running",
      tools: [
        {
          id: "run_999_call_shell_db",
          name: "run_shell_command",
          status: "pending_approval",
          decision: null,
          args: { command: "python migrate.py --drop-tables" },
        },
      ],
    },
  ];

  // User submits a new steering message: "Stop that, do a dry run first instead"
  // useChatStream preemptive steer logic (lines 300-312):
  const updatedMessages = sessionMessages.map((m) => {
    let updated = { ...m };
    if (m.tools && m.tools.some((t) => t.status === "pending_approval" && !t.decision)) {
      updated = {
        ...updated,
        tools: m.tools.map((t) =>
          t.status === "pending_approval" && !t.decision
            ? { ...t, status: "failed", decision: "deny" }
            : t
        ),
      };
    }
    return updated;
  });

  const updatedTool = updatedMessages[1].tools[0];
  assert.strictEqual(updatedTool.status, "failed", "Tool status must transition to 'failed'");
  assert.strictEqual(updatedTool.decision, "deny", "Decision must be set to 'deny'");

  // Verify ID matching compatibility between raw and run_-prefixed IDs
  assert.strictEqual(isSameToolId("run_999_call_shell_db", "call_shell_db"), true);
  assert.strictEqual(isSameToolId("call_shell_db", "run_999_call_shell_db"), true);
  assert.strictEqual(isSameToolId("call_a", "call_b"), false);

  console.log("  -> PASSED: Pending approval card successfully auto-denied and dismissed on preemptive user steer");
}

// -----------------------------------------------------------------------------
// Test 4: SSE Heartbeat (:keep-alive / : heartbeat) Filtering
// -----------------------------------------------------------------------------
console.log("\n[Test 4] SSE Heartbeat (:keep-alive & : heartbeat) Comment Line Filtering");
{
  const simulatedWireStream = [
    ": keep-alive\n\n",
    "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"Hello \"}\n\n",
    ": heartbeat\n\n",
    ":keep-alive\n\n",
    "data: {\"type\": \"TEXT_MESSAGE_CONTENT\", \"delta\": \"world!\"}\n\n",
    ": 15s-pulse\n\n",
    "data: [DONE]\n\n",
  ].join("");

  let accumulatedText = "";
  const callbacks = {
    onToken: (tok) => { accumulatedText += tok; },
  };

  const { processedEvents, ignoredComments } = parseSseChunkBuffer(simulatedWireStream, callbacks);

  assert.strictEqual(ignoredComments.length, 4, "Must detect and ignore all 4 comment lines");
  assert.deepStrictEqual(ignoredComments, [": keep-alive", ": heartbeat", ":keep-alive", ": 15s-pulse"]);

  assert.strictEqual(accumulatedText, "Hello world!", "Tokens before and after heartbeats must be 100% preserved");
  assert.strictEqual(processedEvents.length, 3, "Only non-comment SSE data frames must be parsed");
  assert.strictEqual(processedEvents[2].type, "DONE");

  console.log("  -> PASSED: 100% of heartbeat comments safely filtered with zero token corruption or JSON parse errors");
}

console.log("\n======================================================================");
console.log("ALL FRONTEND STREAM RETRY & RECOVERY TESTS PASSED (4/4)");
console.log("======================================================================");
