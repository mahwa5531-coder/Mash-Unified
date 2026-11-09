import assert from 'node:assert/strict';
import {
  parseSessionHistory,
  cleanAssistantContent,
} from '../src/features/chat/utils/sessionHistoryParser';
import {
  prepareRetryMessages,
  computeUndoMessages,
  finalizeStreamSession,
} from '../src/features/chat/hooks/streamRetryManager';
import {
  getOrCreateSessionState,
  clearSessionStore,
  persistSessionQueue,
  loadPersistedQueue,
  findTargetAssistantIdx,
  sessionStore,
} from '../src/features/chat/state/sessionStore';
import { dismissPendingApprovals } from '../src/features/chat/hooks/streamToolManager';

console.log('======================================================================');
console.log('[*] RUNNING TEST SUITE: PENDING FRONTEND SCENARIOS & RESTART REHYDRATION');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// SUITE 1: POSITIVE / HAPPY PATH
// Scenario: Full-Turn Multi-Phase State Transition
// User Prompt -> Thinking -> Tool Execution -> Tool Output -> Final Prose
// -----------------------------------------------------------------------------
console.log('[Suite 1: Happy Path] Full-Turn Multi-Phase State Transition...');
{
  const transcriptSteps = [
    {
      id: 'msg_u_1',
      session_id: 'sess_happy_1',
      turn_id: 'turn_1',
      role: 'user',
      content: 'Inspect src/lib/calc.ts and verify unit tests',
      thoughts: [],
      tools: [],
      steps: [{ id: 's_0', type: 'text', content: 'Inspect src/lib/calc.ts and verify unit tests' }],
    },
    {
      id: 'msg_a_1',
      session_id: 'sess_happy_1',
      turn_id: 'turn_1',
      role: 'assistant',
      content: 'Reading calc.ts...',
      thoughts: ['Need to read calc.ts first before summarizing'],
      tools: [
        {
          id: 'tc_read_calc',
          name: 'read_file',
          args: { Path: 'src/lib/calc.ts' },
          output: 'export function add(a: number, b: number) { return a + b; }',
          status: 'completed',
          toolSummary: 'Read calc.ts',
          toolAction: 'File read',
        },
      ],
      steps: [
        { id: 's_1', type: 'thinking', content: 'Need to read calc.ts first before summarizing' },
        { id: 's_2', type: 'tool', name: 'read_file', args: { Path: 'src/lib/calc.ts' }, output: 'export function add(a: number, b: number) { return a + b; }' },
      ],
    },
    {
      id: 'msg_a_2',
      session_id: 'sess_happy_1',
      turn_id: 'turn_1',
      role: 'assistant',
      content: 'The function `add` is implemented cleanly and is ready for production.',
      thoughts: ['Verified function syntax'],
      tools: [],
      steps: [{ id: 's_3', type: 'text', content: 'The function `add` is implemented cleanly and is ready for production.' }],
    },
  ];

  const parsed = parseSessionHistory(transcriptSteps);
  assert.strictEqual(parsed.length, 2, 'Consecutive assistant turns must merge into exactly 1 assistant message');
  
  const [userMsg, asstMsg] = parsed;
  assert.strictEqual(userMsg.role, 'user');
  assert.strictEqual(userMsg.content, 'Inspect src/lib/calc.ts and verify unit tests');
  
  assert.strictEqual(asstMsg.role, 'assistant');
  // Invariant: intermediate prose during tool call is folded; final verified prose is displayed
  assert.strictEqual(asstMsg.content, 'The function `add` is implemented cleanly and is ready for production.');
  assert.strictEqual(asstMsg.tools.length, 1);
  assert.strictEqual(asstMsg.tools[0].name, 'read_file');
  assert.strictEqual(asstMsg.tools[0].status, 'completed');
  assert.strictEqual(asstMsg.thoughts.length, 2);

  console.log('  [PASS] 1. Happy path: multi-phase turn correctly parsed and consolidated.');
}

// -----------------------------------------------------------------------------
// SUITE 2: NEGATIVE / UNHAPPY PATH
// Scenario A: Abrupt Stream Network Drop Mid-Generation & Retry In-Place
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Unhappy Path A] Abrupt Stream Drop & In-Place Retry...');
{
  const turnId = 'turn_dropped_99';
  const rawSessionMessages: any[] = [
    {
      id: 'u_1',
      turnId,
      role: 'user',
      content: 'Build the entire frontend bundle',
      status: 'completed',
    },
    {
      id: 'a_1',
      turnId,
      role: 'assistant',
      content: 'Compiling chunk 1, chunk 2...', // mid-stream partial tokens
      status: 'error',
      error: 'Network connection reset by peer (ECONNRESET)',
    },
  ];

  // Invariant: Prepare retry must reset target assistant in-place without duplicating the user message
  const { updatedMessages } = prepareRetryMessages(rawSessionMessages, turnId, 'sess_unhappy');
  assert.strictEqual(updatedMessages.length, 2, 'Message length must remain strictly 2 (zero bubble duplication)');
  assert.strictEqual(updatedMessages[0].role, 'user');
  assert.strictEqual(updatedMessages[0].content, 'Build the entire frontend bundle');
  assert.strictEqual(updatedMessages[1].role, 'assistant');
  assert.strictEqual(updatedMessages[1].status, 'running');
  assert.strictEqual(updatedMessages[1].content, '', 'Assistant content must clear for fresh incoming stream');
  assert.strictEqual(updatedMessages[1].error, undefined);

  console.log('  [PASS] 2A. Unhappy path: aborted stream safely resets target assistant without message duplication.');
}

// -----------------------------------------------------------------------------
// SUITE 2: NEGATIVE / UNHAPPY PATH
// Scenario B: Tool Execution Failure & Non-Zero Exit Code
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Unhappy Path B] Tool Non-Zero Exit Code / Tool Failure...');
{
  const failedToolTranscript = [
    {
      id: 'msg_u_2',
      session_id: 'sess_failed_tool',
      turn_id: 'turn_err',
      role: 'user',
      content: 'Run pytest on nonexistent test file',
      thoughts: [],
      tools: [],
      steps: [{ id: 's_0', type: 'text', content: 'Run pytest on nonexistent test file' }],
    },
    {
      id: 'msg_a_err',
      session_id: 'sess_failed_tool',
      turn_id: 'turn_err',
      role: 'assistant',
      content: 'Running tests...',
      thoughts: ['Executing pytest'],
      tools: [
        {
          id: 'tc_failed_pytest',
          name: 'run_shell_command',
          args: { CommandLine: 'pytest test_missing.py' },
          output: 'ERROR: file not found: test_missing.py\nExit code: 4',
          status: 'failed',
          toolSummary: 'Run pytest',
          toolAction: 'Test execution',
        },
      ],
      steps: [
        { id: 's_1', type: 'tool', name: 'run_shell_command', args: { CommandLine: 'pytest test_missing.py' }, output: 'ERROR: file not found: test_missing.py\nExit code: 4' },
      ],
    },
    {
      id: 'msg_a_final',
      session_id: 'sess_failed_tool',
      turn_id: 'turn_err',
      role: 'assistant',
      content: 'The test run failed because `test_missing.py` does not exist on disk.',
      thoughts: ['Explaining failure to user'],
      tools: [],
      steps: [{ id: 's_2', type: 'text', content: 'The test run failed because `test_missing.py` does not exist on disk.' }],
    },
  ];

  const parsedFailed = parseSessionHistory(failedToolTranscript);
  assert.strictEqual(parsedFailed.length, 2);
  const asst = parsedFailed[1];
  assert.strictEqual(asst.tools[0].status, 'failed', 'Tool status must be preserved as failed');
  assert.ok(asst.tools[0].output.includes('Exit code: 4'), 'Error output must be retained for inspection');
  assert.strictEqual(asst.content, 'The test run failed because `test_missing.py` does not exist on disk.');

  console.log('  [PASS] 2B. Tool failure non-zero exit code preserved and rendered without crash.');
}

// -----------------------------------------------------------------------------
// SUITE 2: NEGATIVE / UNHAPPY PATH
// Scenario C: Tool Permission Denial Flow
// -----------------------------------------------------------------------------
console.log('\n[Suite 2: Unhappy Path C] Tool Permission Denial & Preemptive Auto-Dismissal...');
{
  const pendingApprovalMsgs: any[] = [
    {
      id: 'msg_u_3',
      turnId: 'turn_deny',
      role: 'user',
      content: 'Drop production database',
      status: 'completed',
    },
    {
      id: 'msg_a_deny',
      turnId: 'turn_deny',
      role: 'assistant',
      content: 'I need your confirmation before dropping database.',
      status: 'running',
      tools: [
        {
          id: 'tc_drop_db',
          name: 'run_shell_command',
          args: { CommandLine: 'dropdb prod' },
          status: 'pending_approval',
          decision: null,
        },
      ],
    },
  ];

  // User steers or rejects -> tool auto-dismissed with 'deny'
  const deniedMsgs = dismissPendingApprovals(pendingApprovalMsgs);
  assert.strictEqual(deniedMsgs[1].tools[0].status, 'denied', 'Status must transition to denied');
  assert.strictEqual(deniedMsgs[1].tools[0].decision, 'deny');

  console.log('  [PASS] 2C. Tool denial correctly sets status to denied with zero side effects.');
}

// -----------------------------------------------------------------------------
// SUITE 3: WORKFLOW SCENARIOS
// Scenario: Mid-Flight Steering Queue + Abort + Resume Cycle
// -----------------------------------------------------------------------------
console.log('\n[Suite 3: Workflow] Mid-Flight Steering Queue -> Abort -> Resume...');
{
  clearSessionStore();
  const sid = 'sess_workflow_steer';
  const state = getOrCreateSessionState(sid);
  
  // 1. Session is actively streaming Turn 1
  state.isStreaming = true;
  state.activeTurnId = 'turn_1';

  // 2. User queues follow-up instructions while Turn 1 is streaming
  state.queuedMessages = ['Follow up: Run linter next', 'Follow up: Generate report'];
  assert.strictEqual(state.queuedMessages.length, 2);

  // 3. User clicks Stop (Abort) during streaming
  state.wasUserAborted = true;

  // 4. Stream finalizes after abort
  const { nextQueuedMsg } = finalizeStreamSession(sid);

  // Invariant: Queue must NOT auto-dispatch when user aborted; queue must be paused
  assert.strictEqual(nextQueuedMsg, null, 'Queued turn must NOT auto-dispatch on abort');
  assert.strictEqual(state.isQueuePaused, true, 'isQueuePaused flag must be true');
  assert.strictEqual(state.queuedMessages.length, 2, 'Queued items must remain intact');

  // 5. User clicks "Resume Queue"
  state.isQueuePaused = false;
  const resumedTurn = state.queuedMessages.shift();
  assert.strictEqual(resumedTurn, 'Follow up: Run linter next', 'Resumes first queued instruction');
  assert.strictEqual(state.queuedMessages.length, 1);

  console.log('  [PASS] 3. Mid-flight steering queue + abort + resume workflow verified.');
}

// -----------------------------------------------------------------------------
// SUITE 4: RESTARTING, PERSISTENCE & REHYDRATION
// Scenario A: Browser Full Reload (F5) with Queue Hydration from LocalStorage
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: Restart & Rehydration A] Browser Reload & LocalStorage Queue Hydration...');
{
  const storageMap = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => storageMap.set(k, v),
    removeItem: (k: string) => storageMap.delete(k),
  };

  const sid = 'sess_reload_test';

  // 1. Before reload: user has 2 queued messages
  persistSessionQueue(sid, ['Step 2: Generate summary table', 'Step 3: Export to CSV']);
  assert.ok(storageMap.has(`mash_queue_${sid}`));

  // 2. Simulate browser hard reload: memory wiped completely
  clearSessionStore();
  assert.strictEqual(sessionStore.size, 0, 'In-memory store completely wiped on browser reload');

  // 3. Page reloads: session state re-created
  const rehydratedState = getOrCreateSessionState(sid);

  // Invariant: Queued messages must be rehydrated from localStorage
  assert.deepStrictEqual(
    rehydratedState.queuedMessages,
    ['Step 2: Generate summary table', 'Step 3: Export to CSV'],
    'Queued messages must automatically hydrate from localStorage on reload'
  );

  console.log('  [PASS] 4A. Browser reload successfully hydrates persisted queue from localStorage.');
}

// -----------------------------------------------------------------------------
// SUITE 4: RESTARTING, PERSISTENCE & REHYDRATION
// Scenario B: Backend Process Crash & Restart (Session History Re-Fetch)
// -----------------------------------------------------------------------------
console.log('\n[Suite 4: Restart & Rehydration B] Backend Restart & Transcript Re-Fetch Invariant...');
{
  // Backend restarted: frontend requests GET /sessions/sess_reconnect/transcript
  const backendTranscriptAfterRestart = [
    {
      id: 'msg_u_prior',
      session_id: 'sess_reconnect',
      turn_id: 'turn_prior_1',
      role: 'user',
      content: 'Calculate profit margin',
      thoughts: [],
      tools: [],
      steps: [{ id: 's_0', type: 'text', content: 'Calculate profit margin' }],
    },
    {
      id: 'msg_a_prior',
      session_id: 'sess_reconnect',
      turn_id: 'turn_prior_1',
      role: 'assistant',
      content: 'Profit margin is 24.5%.',
      thoughts: [],
      tools: [],
      steps: [{ id: 's_1', type: 'text', content: 'Profit margin is 24.5%.' }],
    },
  ];

  // Invariant: parseSessionHistory must rebuild clean chat state without any ghost or hanging turns
  const reconnectedMessages = parseSessionHistory(backendTranscriptAfterRestart);
  assert.strictEqual(reconnectedMessages.length, 2);
  assert.strictEqual(reconnectedMessages[0].role, 'user');
  assert.strictEqual(reconnectedMessages[1].role, 'assistant');
  assert.strictEqual(reconnectedMessages[1].content, 'Profit margin is 24.5%.');

  console.log('  [PASS] 4B. Reconnected frontend cleanly parses backend transcript with 0 ghost messages.');
}

console.log('\n======================================================================');
console.log('[SUCCESS] ALL PENDING FRONTEND SCENARIOS & RESTART CHECKS PASSED (100%)');
console.log('======================================================================\n');
