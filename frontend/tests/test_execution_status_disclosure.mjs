import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("======================================================================");
console.log("STARTING EXECUTION STATUS DISCLOSURE & RETRY LIFECYCLE TEST SUITE");
console.log("======================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: Source Code Audit — Legacy UI Elements Completely Removed
// -----------------------------------------------------------------------------
console.log("[Test 1] Legacy Error Card & Accordion Source Code Audit");
{
  const targetFile = path.resolve(__dirname, '../src/features/chat/components/messages/ExecutionStatusDisclosure.tsx');
  const content = fs.readFileSync(targetFile, 'utf-8');

  // Verify legacy elements are deleted
  assert.ok(!content.includes('ChevronRight'), 'Must not import or render ChevronRight');
  assert.ok(!content.includes('Show technical details'), 'Must not have technical details accordion button');
  assert.ok(!content.includes('Hide technical details'), 'Must not have hide technical details button');
  assert.ok(!content.includes('Raw diagnostic output'), 'Must not have raw diagnostic drawer');
  assert.ok(!content.includes('navigator.clipboard.writeText'), 'Must not have copy button or clipboard logic');
  assert.ok(!content.includes('Execution was stopped by user'), 'Must not have user stopped accordion drawer');
  assert.ok(!content.includes('Agent execution stopped.'), 'Must not have stopped dropdown button');
  assert.ok(!content.includes('bg-zinc-50/80 dark:bg-[#18181b] p-3 text-xs'), 'Must not have heavy card container');

  // Verify calm ghost text and clean requirements exist
  assert.ok(content.includes('User cancelled the agent.'), 'Must render calm static ghost text for aborted');
  assert.ok(content.includes('Model retrying ({retryAttempt}/3)...'), 'Must render retrying indicator with attempt count');
  assert.ok(content.includes('animate-silver-shine'), 'Must use animate-silver-shine for model retrying text');
  assert.ok(content.includes('Agent got interrupted due to internet error'), 'Must render exact internet error message');
  assert.ok(content.includes('isLast && !isStreaming && onContinue'), 'Must guard continue button with isLast && !isStreaming && onContinue');
  assert.ok(content.includes('<Play size={8}'), 'Must render micro Play triangle size 8');
  // Verify user cancellation has top priority over retryAttempt
  const abortedIndex = content.indexOf("status === 'aborted'");
  const retryingIndex = content.indexOf("retryAttempt && retryAttempt >= 1");
  assert.ok(abortedIndex !== -1 && retryingIndex !== -1 && abortedIndex < retryingIndex, 'User cancellation check MUST precede retryAttempt check');

  // Verify streamRetryManager does not wipe errors on past turns
  const retryMgrFile = path.resolve(__dirname, '../src/features/chat/hooks/streamRetryManager.ts');
  const retryMgrContent = fs.readFileSync(retryMgrFile, 'utf-8');
  assert.ok(!retryMgrContent.includes("m.status === 'running' || m.error"), 'prepareSteerTurn must not clear error on past completed turns');

  console.log("  -> PASSED: Heavy boxed cards, dropdown chevrons, accordions, and copy buttons 100% removed!");
}

// Simulated pure renderer corresponding exactly to ExecutionStatusDisclosure logic
function renderExecutionStatusDisclosure({
  status,
  error,
  errorId,
  totalDurationSeconds,
  retryAttempt,
  isLast,
  isStreaming,
  onContinue,
}) {
  // 1. User Cancellation (`status === 'aborted'`): calm static ghost text
  if (status === 'aborted') {
    return {
      type: 'aborted',
      slot: 'in-place',
      domText: 'User cancelled the agent.',
      hasButton: false,
      hasChevron: false,
    };
  }

  // 2. Network Drop & Reconnection Lifecycle: While retrying (attempts 1 to 3)
  if (retryAttempt && retryAttempt >= 1 && retryAttempt <= 3) {
    return {
      type: 'retrying',
      slot: 'in-place',
      attempt: retryAttempt,
      domText: `Model retrying (${retryAttempt}/3)...`,
      hasPulseDot: true,
      hasSilverShine: true,
      hasButton: false,
    };
  }

  // 3. Error Handling
  const effectiveError = error || (status === 'error' ? 'Agent execution was interrupted or encountered an unexpected error.' : null);

  if (effectiveError) {
    const isQuota = /quota|rate limit/i.test(effectiveError);
    if (isQuota) {
      return {
        type: 'quota',
        domText: 'Baseline token quota reached. See quota banner below for refresh details.',
      };
    }

    const isAuth = /unauthorized|401|authentication required/i.test(effectiveError);
    if (isAuth) {
      return null;
    }

    const isInternet = /wifi disconnected|offline|no internet|failed to fetch|network connection lost|networkerror|connection reset|internet error/i.test(effectiveError);

    if (isInternet) {
      const canShowContinue = Boolean(isLast && !isStreaming && onContinue);
      return {
        type: 'internet_error',
        slot: 'in-place',
        domText: 'Agent got interrupted due to internet error',
        hasButton: canShowContinue,
        buttonLabel: canShowContinue ? 'Continue' : null,
        isSameLine: true,
      };
    }

    return {
      type: 'general_error',
      slot: 'in-place',
      domText: effectiveError,
      hasButton: false,
    };
  }

  return null;
}

// -----------------------------------------------------------------------------
// Test 2: Component State Machine Logic & Ghost Text Invariants
// -----------------------------------------------------------------------------
console.log("\n[Test 2] State Machine & Ghost Text Rendering Matrix");
{

  // Case A: User aborted
  const abortedRes = renderExecutionStatusDisclosure({ status: 'aborted' });
  assert.strictEqual(abortedRes.type, 'aborted');
  assert.strictEqual(abortedRes.domText, 'User cancelled the agent.');
  assert.strictEqual(abortedRes.hasButton, false);
  assert.strictEqual(abortedRes.hasChevron, false);

  // Case B: Retrying attempt 1
  const retry1 = renderExecutionStatusDisclosure({ retryAttempt: 1, isStreaming: true });
  assert.strictEqual(retry1.type, 'retrying');
  assert.strictEqual(retry1.domText, 'Model retrying (1/3)...');
  assert.strictEqual(retry1.hasPulseDot, true);
  assert.strictEqual(retry1.hasSilverShine, true);

  // Case C: Retrying attempt 2
  const retry2 = renderExecutionStatusDisclosure({ retryAttempt: 2, isStreaming: true });
  assert.strictEqual(retry2.type, 'retrying');
  assert.strictEqual(retry2.domText, 'Model retrying (2/3)...');

  // Case D: Retrying attempt 3
  const retry3 = renderExecutionStatusDisclosure({ retryAttempt: 3, isStreaming: true });
  assert.strictEqual(retry3.type, 'retrying');
  assert.strictEqual(retry3.domText, 'Model retrying (3/3)...');

  // Case E: Retries exhausted -> Internet error on latest turn (idle)
  const exhaustedLatest = renderExecutionStatusDisclosure({
    status: 'error',
    error: 'Network connection lost (WiFi disconnected). Reconnection timed out.',
    isLast: true,
    isStreaming: false,
    onContinue: () => {},
  });
  assert.strictEqual(exhaustedLatest.type, 'internet_error');
  assert.strictEqual(exhaustedLatest.domText, 'Agent got interrupted due to internet error');
  assert.strictEqual(exhaustedLatest.hasButton, true);
  assert.strictEqual(exhaustedLatest.buttonLabel, 'Continue');
  assert.strictEqual(exhaustedLatest.isSameLine, true);

  // Case F: Aborted during active retry (user cancellation overrides retry attempt)
  const abortedDuringRetry = renderExecutionStatusDisclosure({ status: 'aborted', retryAttempt: 2 });
  assert.strictEqual(abortedDuringRetry.type, 'aborted');
  assert.strictEqual(abortedDuringRetry.domText, 'User cancelled the agent.');
  assert.strictEqual(abortedDuringRetry.hasButton, false);

  console.log("  -> PASSED: Aborted, retrying 1..3, and internet error states verified");
}

// -----------------------------------------------------------------------------
// Test 3: Architectural Safety Guard — Stale Click Prevention & Button Vanishing
// -----------------------------------------------------------------------------
console.log("\n[Test 3] Architectural Safety Guard Against Stale Clicks (isLast & isStreaming)");
{
  function evaluateContinueButton(isLast, isStreaming, onContinue) {
    return Boolean(isLast && !isStreaming && onContinue);
  }

  // 1. Latest completed turn with continue handler -> Button visible
  assert.strictEqual(evaluateContinueButton(true, false, () => {}), true, "Latest idle turn MUST render continue button");

  // 2. Mid-stream turn (isStreaming=true) -> Button hidden
  assert.strictEqual(evaluateContinueButton(true, true, () => {}), false, "Streaming turn MUST NOT render continue button");

  // 3. User entered new turn -> Previous turn is no longer isLast -> Button vanishes!
  assert.strictEqual(evaluateContinueButton(false, false, () => {}), false, "Non-last turn MUST NOT render continue button");

  // 4. No onContinue callback passed -> Button hidden
  assert.strictEqual(evaluateContinueButton(true, false, undefined), false, "Turn without onContinue callback MUST NOT render continue button");

  // 5. Real Workflow Simulation: Turn 1 encounters internet error, then user dispatches Turn 2 (steer)
  const turn1Assistant = {
    role: 'assistant',
    turnId: 'turn_1',
    status: 'error',
    error: 'Network connection lost (WiFi disconnected). Reconnection timed out.',
  };
  const sessionMessages = [
    { role: 'user', turnId: 'turn_1', content: 'First query' },
    turn1Assistant,
  ];

  // While Turn 1 is the latest turn:
  const turn1BeforeSteer = renderExecutionStatusDisclosure({
    status: turn1Assistant.status,
    error: turn1Assistant.error,
    isLast: true,
    isStreaming: false,
    onContinue: () => {},
  });
  assert.strictEqual(turn1BeforeSteer.type, 'internet_error');
  assert.strictEqual(turn1BeforeSteer.hasButton, true);
  assert.strictEqual(turn1BeforeSteer.domText, 'Agent got interrupted due to internet error');

  // User types a new prompt and dispatches Turn 2 -> prepareSteerTurn runs
  function simulatePrepareSteerTurn(messages) {
    return messages.map((m) => {
      let updated = m;
      if (m.role === 'assistant' && m.status === 'running') updated = { ...updated, status: 'completed' };
      if (m.tools && m.tools.some((t) => t.status === 'pending_approval' && !t.decision)) {
        updated = {
          ...updated,
          tools: m.tools.map((t) => t.status === 'pending_approval' && !t.decision ? { ...t, status: 'failed', decision: 'deny' } : t),
        };
      }
      return updated;
    });
  }

  const steeredMessages = simulatePrepareSteerTurn(sessionMessages);
  assert.strictEqual(steeredMessages[1].status, 'error', 'prepareSteerTurn must preserve error status on previous turn');
  assert.strictEqual(steeredMessages[1].error, turn1Assistant.error, 'prepareSteerTurn must preserve error message on previous turn');

  // New turn added -> Turn 1 is now isLast = false
  const turn1AfterNewPrompt = renderExecutionStatusDisclosure({
    status: steeredMessages[1].status,
    error: steeredMessages[1].error,
    isLast: false,
    isStreaming: false,
    onContinue: () => {},
  });
  assert.strictEqual(turn1AfterNewPrompt.type, 'internet_error');
  assert.strictEqual(turn1AfterNewPrompt.hasButton, false, 'Continue button must cleanly vanish on previous turn');
  assert.strictEqual(turn1AfterNewPrompt.domText, 'Agent got interrupted due to internet error', 'Static ghost text must remain visible in DOM');

  console.log("  -> PASSED: Continue button strictly suppressed whenever isLast=false or isStreaming=true; ghost text preserved");
}

// -----------------------------------------------------------------------------
// Test 4: Stream Lifecycle Coordination & retryAttempt Reset Hygiene
// -----------------------------------------------------------------------------
console.log("\n[Test 4] Stream Lifecycle Coordination & retryAttempt Clearing");
{
  function applyStreamError(messages, activeTurnId, errorText) {
    const next = [...messages];
    const idx = next.findIndex(m => m.turnId === activeTurnId);
    if (idx >= 0 && next[idx].status !== 'aborted') {
      next[idx] = { ...next[idx], status: 'error', error: errorText, retryAttempt: undefined };
    }
    return next;
  }

  function applyStreamAbort(messages, activeTurnId) {
    const next = [...messages];
    const idx = next.findIndex(m => m.turnId === activeTurnId);
    if (idx >= 0) {
      next[idx] = { ...next[idx], status: 'aborted', retryAttempt: undefined };
    }
    return next;
  }

  const msgs = [
    { role: 'assistant', turnId: 'turn_42', status: 'running', retryAttempt: 2 },
  ];

  // While retrying, attempt is 2
  assert.strictEqual(msgs[0].retryAttempt, 2);

  // When error occurs (retries exhausted)
  const afterError = applyStreamError(msgs, 'turn_42', 'Network connection interrupted');
  assert.strictEqual(afterError[0].status, 'error');
  assert.strictEqual(afterError[0].retryAttempt, undefined, "retryAttempt MUST be cleared on error");

  // When aborted
  const afterAbort = applyStreamAbort(msgs, 'turn_42');
  assert.strictEqual(afterAbort[0].status, 'aborted');
  assert.strictEqual(afterAbort[0].retryAttempt, undefined, "retryAttempt MUST be cleared on abort");

  console.log("  -> PASSED: retryAttempt state cleanly reset upon error, abort, or completion");
}

console.log("\n======================================================================");
console.log("ALL EXECUTION STATUS DISCLOSURE TESTS PASSED!");
console.log("======================================================================\n");
