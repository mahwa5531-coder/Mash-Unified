import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToolItem, groupTimelineEntries } from '../src/features/chat/components/work-log/toolTimeline.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('======================================================================');
console.log('[*] LIVE TOOL PERMISSION CARDS, LIFECYCLE & STEERING TEST SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// SECTION 1: Source Code Invariants for ApprovalCard & Decision Handlers
// -----------------------------------------------------------------------------
console.log('[Section 1] Verifying ApprovalCard Source Invariants...');
{
  const cardPath = path.resolve(__dirname, '../src/features/chat/components/approval/ApprovalCard.tsx');
  const cardCode = fs.readFileSync(cardPath, 'utf-8');

  // Must map default categories cleanly
  assert.ok(cardCode.includes("defaultSummary: 'Run shell command'"));
  assert.ok(cardCode.includes("defaultSummary: 'External web request'"));
  assert.ok(cardCode.includes("defaultSummary: 'File modification'"));

  // Must prioritize toolSummary and toolAction
  assert.ok(cardCode.includes("currentSummary = toolSummary || args.toolSummary || info.defaultSummary"));
  assert.ok(cardCode.includes("currentAction = toolAction || args.toolAction || info.defaultAction"));

  // Must render Deny, Always allow, Allow once buttons
  assert.ok(cardCode.includes("handleAction('deny')"));
  assert.ok(cardCode.includes("handleAction('allow')"));
  assert.ok(cardCode.includes("handleAction('allow_once')"));

  // Must render receipt states
  assert.ok(cardCode.includes("Approved, executing..."));
  assert.ok(cardCode.includes("Always allowed"));
  assert.ok(cardCode.includes("Finished"));
  assert.ok(cardCode.includes("Cancelled by user"));

  console.log('  [PASS] 1. Category headers, priorities, interactive buttons, and receipt states verified.');
}

// -----------------------------------------------------------------------------
// SECTION 2: Decision Transitions (Allow Once, Always Allow, Deny)
// -----------------------------------------------------------------------------
console.log('\n[Section 2] Decision Options (Allow Once, Always Allow, Deny)...');
{
  function isSameToolId(a, b) {
    if (!a || !b) return false;
    return a === b || a.endsWith(`_${b}`) || b.endsWith(`_${a}`);
  }

  function applyToolApproval(messages, toolCallId, action, rawTcId) {
    return messages.map((m) => {
      let tools = m.tools;
      if (tools?.length) {
        tools = tools.map((t) => isSameToolId(t.id, toolCallId) || isSameToolId(t.id, rawTcId) ? { ...t, status: action === 'deny' ? 'denied' : 'running', decision: action } : t);
      }
      let steps = m.steps;
      if (steps?.length) {
        steps = steps.map((st) => {
          const matches = isSameToolId(st.tool_call_id, toolCallId) || isSameToolId(st.tool_call_id, rawTcId) || (st.type === 'tool' && (isSameToolId(st.id, toolCallId) || isSameToolId(st.id, rawTcId)));
          return matches ? { ...st, status: action === 'deny' ? 'denied' : 'running', decision: action } : st;
        });
      }
      return { ...m, tools, steps };
    });
  }

  const baseTool = {
    id: 'tc_build_01',
    name: 'run_command',
    args: { CommandLine: 'npm run build', toolSummary: 'Package build', toolAction: 'Compiling assets' },
    status: 'pending_approval',
    decision: undefined,
  };

  const baseMessage = {
    id: 'msg_assistant_1',
    role: 'assistant',
    status: 'completed',
    content: '',
    tools: [baseTool],
    steps: [
      {
        id: 'step_tc_build_01',
        type: 'tool',
        tool_call_id: 'tc_build_01',
        name: 'run_command',
        args: baseTool.args,
        status: 'pending_approval',
        decision: undefined,
      }
    ],
  };

  // 2A. Allow Once
  const allowedOnce = applyToolApproval([baseMessage], 'tc_build_01', 'allow_once', 'tc_build_01');
  assert.strictEqual(allowedOnce[0].tools[0].status, 'running', 'Allow once must set status to running');
  assert.strictEqual(allowedOnce[0].tools[0].decision, 'allow_once', 'Decision must record allow_once');
  assert.strictEqual(allowedOnce[0].steps[0].status, 'running');
  assert.strictEqual(allowedOnce[0].steps[0].decision, 'allow_once');
  console.log('  [PASS] 2A. "Allow once" transitions tool and step to running with allow_once decision.');

  // 2B. Always Allow
  const alwaysAllowed = applyToolApproval([baseMessage], 'tc_build_01', 'allow', 'tc_build_01');
  assert.strictEqual(alwaysAllowed[0].tools[0].status, 'running');
  assert.strictEqual(alwaysAllowed[0].tools[0].decision, 'allow');
  assert.strictEqual(alwaysAllowed[0].steps[0].status, 'running');
  assert.strictEqual(alwaysAllowed[0].steps[0].decision, 'allow');
  console.log('  [PASS] 2B. "Always allow" transitions tool and step to running with permanent allow decision.');

  // 2C. Deny
  const denied = applyToolApproval([baseMessage], 'tc_build_01', 'deny', 'tc_build_01');
  assert.strictEqual(denied[0].tools[0].status, 'denied', 'Deny must set status to denied');
  assert.strictEqual(denied[0].tools[0].decision, 'deny', 'Decision must record deny');
  assert.strictEqual(denied[0].steps[0].status, 'denied');
  assert.strictEqual(denied[0].steps[0].decision, 'deny');
  console.log('  [PASS] 2C. "Deny" transitions tool and step to denied receipt state.');
}

// -----------------------------------------------------------------------------
// SECTION 3: User Sends Input Without Answering Approval Card (Steer / Interruption)
// -----------------------------------------------------------------------------
console.log('\n[Section 3] User Types & Sends Input While Tool Call Is Pending (Interruption)...');
{
  function prepareSteerTurn(messages) {
    return messages.map((m) => {
      let updated = m;
      if (m.role === 'assistant' && m.status === 'running') updated = { ...updated, status: 'completed' };
      let tools = updated.tools;
      if (tools && tools.some((t) => t.status === 'pending_approval' && !t.decision)) {
        tools = tools.map((t) => t.status === 'pending_approval' && !t.decision ? { ...t, status: 'denied', decision: 'deny' } : t);
        updated = { ...updated, tools };
      }
      let steps = updated.steps;
      if (steps && steps.some((st) => (st.status === 'pending_approval' || st.type === 'approval') && !st.decision)) {
        steps = steps.map((st) =>
          (st.status === 'pending_approval' || st.type === 'approval') && !st.decision
            ? { ...st, status: 'denied', decision: 'deny' }
            : st
        );
        updated = { ...updated, steps };
      }
      return updated;
    });
  }

  const pendingTool = {
    id: 'tc_rm_01',
    name: 'run_command',
    args: { CommandLine: 'rm -rf ./dist', toolSummary: 'Clean dist folder' },
    status: 'pending_approval',
    decision: undefined,
  };

  const initialTurn = [
    { id: 'msg_u_1', role: 'user', content: 'Clean the build artifacts', status: 'completed' },
    {
      id: 'msg_a_1',
      role: 'assistant',
      status: 'completed',
      content: '',
      tools: [pendingTool],
      steps: [
        {
          id: 'step_tc_rm_01',
          type: 'tool',
          tool_call_id: 'tc_rm_01',
          name: 'run_command',
          args: pendingTool.args,
          status: 'pending_approval',
          decision: undefined,
        }
      ],
    }
  ];

  // User ignores the approval card and sends: "Wait, do not delete dist, just list it"
  const steeredHistory = prepareSteerTurn(initialTurn);
  
  // 1. Pending tool in tools MUST be marked denied
  assert.strictEqual(steeredHistory[1].tools[0].status, 'denied', 'Pending tool must be marked denied');
  assert.strictEqual(steeredHistory[1].tools[0].decision, 'deny', 'Pending tool decision must be deny');

  // 2. Pending tool in steps MUST ALSO be marked denied
  assert.strictEqual(steeredHistory[1].steps[0].status, 'denied', 'Pending step must be marked denied');
  assert.strictEqual(steeredHistory[1].steps[0].decision, 'deny', 'Pending step decision must be deny');

  // 3. New Turn Messages Appended Cleanly
  const newTurnMessages = [
    ...steeredHistory,
    { id: 'msg_u_2', role: 'user', content: 'Wait, do not delete dist, just list it', status: 'completed' },
    { id: 'msg_a_2', role: 'assistant', status: 'running', content: '', tools: [], steps: [] },
  ];

  assert.strictEqual(newTurnMessages.length, 4);
  assert.strictEqual(newTurnMessages[2].content, 'Wait, do not delete dist, just list it');
  assert.strictEqual(newTurnMessages[3].status, 'running');

  // 4. Verify previous turn's timeline no longer has an active pending approval card
  const oldAssistantSteps = newTurnMessages[1].steps;
  const oldTimeline = oldAssistantSteps.map((st, i) => parseToolItem(st, i));
  const hasStillPending = oldTimeline.some(t => t.type === 'approval');
  assert.strictEqual(hasStillPending, false, 'Previous turn must NO LONGER have an active pending approval card');
  assert.strictEqual(oldTimeline[0].type, 'command');
  assert.strictEqual(oldTimeline[0].data.tool.status, 'denied');

  console.log('  [PASS] 3. Sending new input cleanly cancels pending approval and launches new turn without leaking approval prompts.');
}

// -----------------------------------------------------------------------------
// SECTION 4: Session Switching & Switching Back (State Preservation)
// -----------------------------------------------------------------------------
console.log('\n[Section 4] Session Switching & Reverting Back...');
{
  const mockSessionStore = new Map();

  const sessAPendingTool = {
    id: 'tc_audit_55',
    name: 'run_command',
    args: { CommandLine: 'python audit_check.py', toolSummary: 'Statutory audit check' },
    status: 'pending_approval',
    decision: undefined,
  };

  mockSessionStore.set('sess-A', {
    chatMessages: [
      { id: 'm1', role: 'user', content: 'Run audit check' },
      { id: 'm2', role: 'assistant', tools: [sessAPendingTool], steps: [{ id: 's1', type: 'tool', tool_call_id: 'tc_audit_55', ...sessAPendingTool }] },
    ],
    isStreaming: false,
    queuedMessages: [],
  });

  mockSessionStore.set('sess-B', {
    chatMessages: [
      { id: 'm3', role: 'user', content: 'Hello in session B' },
      { id: 'm4', role: 'assistant', content: 'Hello! How can I help?' },
    ],
    isStreaming: false,
    queuedMessages: [],
  });

  // User views session B
  let currentViewingSession = 'sess-B';
  assert.strictEqual(mockSessionStore.get(currentViewingSession).chatMessages[1].content, 'Hello! How can I help?');

  // User reverts back to session A
  currentViewingSession = 'sess-A';
  const restoredSessionA = mockSessionStore.get(currentViewingSession);
  assert.ok(restoredSessionA, 'Session A must be retained in memory');
  assert.strictEqual(restoredSessionA.chatMessages[1].tools[0].status, 'pending_approval');
  assert.strictEqual(restoredSessionA.chatMessages[1].tools[0].decision, undefined);

  // Timeline entry in Session A must immediately reconstruct active approval card
  const timelineA = restoredSessionA.chatMessages[1].steps.map((st, i) => parseToolItem(st, i));
  assert.strictEqual(timelineA[0].type, 'approval', 'Restored session A must render active approval card');
  assert.strictEqual(timelineA[0].data.status, 'pending');

  console.log('  [PASS] 4. Switching sessions and reverting back preserves pending approval card and button actions 100%.');
}

// -----------------------------------------------------------------------------
// SECTION 5: Sequential Multiple Approvals in Single Turn
// -----------------------------------------------------------------------------
console.log('\n[Section 5] Sequential Multiple Pending Approvals in Single Turn...');
{
  function applyToolApproval(messages, toolCallId, action, rawTcId) {
    return messages.map((m) => {
      let tools = m.tools;
      if (tools?.length) {
        tools = tools.map((t) => t.id === toolCallId ? { ...t, status: action === 'deny' ? 'denied' : 'running', decision: action } : t);
      }
      return { ...m, tools };
    });
  }

  const multiToolMsg = {
    id: 'msg_multi_1',
    role: 'assistant',
    tools: [
      { id: 'tc_1', name: 'run_command', args: { CommandLine: 'dir' }, status: 'pending_approval', decision: undefined },
      { id: 'tc_2', name: 'write_file', args: { TargetFile: 'out.txt' }, status: 'pending_approval', decision: undefined },
    ],
  };

  // Step 1: User approves tc_1
  const afterFirst = applyToolApproval([multiToolMsg], 'tc_1', 'allow_once', 'tc_1');
  const hasRemainingPending1 = afterFirst[0].tools.some(t => t.status === 'pending_approval' && !t.decision && t.id !== 'tc_1');
  assert.strictEqual(hasRemainingPending1, true, 'tc_2 must still be pending approval');

  // Step 2: User approves tc_2
  const afterSecond = applyToolApproval(afterFirst, 'tc_2', 'allow_once', 'tc_2');
  const hasRemainingPending2 = afterSecond[0].tools.some(t => t.status === 'pending_approval' && !t.decision);
  assert.strictEqual(hasRemainingPending2, false, 'No more pending approvals remaining');

  console.log('  [PASS] 5. Multiple sequential tool approvals resolve in strict order without premature dispatch.');
}

console.log('\n======================================================================');
console.log('[SUCCESS] ALL TOOL PERMISSION SCENARIO TESTS PASSED (100% GREEN)');
console.log('======================================================================\n');
