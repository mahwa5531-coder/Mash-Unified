import assert from 'node:assert';
import {
  cleanAssistantContent,
  cleanUserSteeringEnvelope,
  cleanUserPromptForComposer,
  parseSessionHistory,
} from '../src/features/chat/utils/sessionHistoryParser';
import { isFullFilePath } from '../src/features/chat/components/messages/proseHelpers';

console.log('[*] Running SessionHistoryParser & ProseHelpers Test Suite...');

// 1. cleanAssistantContent
assert.strictEqual(cleanAssistantContent('[empty]'), '');
assert.strictEqual(cleanAssistantContent('[DONE]'), '');
assert.strictEqual(cleanAssistantContent('[END]'), '');
assert.strictEqual(cleanAssistantContent('Here is the plan [DONE]'), 'Here is the plan');
// Audit markers like [VERIFIED] must be preserved so AuditBadge renders them on reload
assert.strictEqual(cleanAssistantContent('[VERIFIED] Here is the plan'), '[VERIFIED] Here is the plan');
assert.strictEqual(cleanAssistantContent('<user_message>Here is the plan</user_message>'), 'Here is the plan');
console.log('  [PASS] 1. cleanAssistantContent strips sentinels and protocol tags.');

// 2. cleanUserSteeringEnvelope
const steered = '<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Pause and inspect log Adapt your current plan and respond to this instruction immediately.</USER_STEERING>';
assert.strictEqual(cleanUserSteeringEnvelope(steered), 'Pause and inspect log');
console.log('  [PASS] 2. cleanUserSteeringEnvelope extracts pure steering instruction.');

// 3. cleanUserPromptForComposer
const attached = 'Please inspect and analyze the attached audit documents: [Attached files: report.xlsx] Here is my prompt';
assert.strictEqual(cleanUserPromptForComposer(attached), 'Here is my prompt');
console.log('  [PASS] 3. cleanUserPromptForComposer prunes attachment boilerplate.');

// 4. isFullFilePath rejects web URLs (preventing false FilePills)
assert.strictEqual(isFullFilePath('https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html'), false);
assert.strictEqual(isFullFilePath('http://example.com/index.html'), false);
assert.strictEqual(isFullFilePath('C:\\Users\\rama\\mahes_projects\\kmeans.ipynb'), true);
assert.strictEqual(isFullFilePath('src/app.py'), true);
console.log('  [PASS] 4. isFullFilePath rejects http/https web URLs and permits valid disk files.');

// 5. parseSessionHistory: Real normalized backend payload
const transcriptPayload = [
  {
    id: 'msg_user_1',
    session_id: 'sess_test_1',
    turn_id: 'turn_1',
    role: 'user',
    content: 'Please run tool test',
    thoughts: [],
    tools: [],
    steps: [{ id: 'st_0', type: 'text', content: 'Please run tool test' }],
  },
  {
    id: 'msg_asst_1',
    session_id: 'sess_test_1',
    turn_id: 'turn_1',
    role: 'assistant',
    content: 'Running tool now',
    thoughts: ['Model thinking trace'],
    tools: [
      {
        id: 'tc_1',
        name: 'run_shell_command',
        args: { CommandLine: 'dir' },
        output: '', // Empty output must NOT become 'Done.'
        status: 'completed',
        toolSummary: 'Directory listing',
        toolAction: 'command',
      },
    ],
    steps: [
      { id: 'st_1', type: 'thinking', content: 'Model thinking trace' },
      { id: 'st_2', type: 'tool', name: 'run_shell_command', args: { CommandLine: 'dir' }, output: '' },
    ],
  },
  {
    id: 'msg_asst_2',
    session_id: 'sess_test_1',
    turn_id: 'turn_1',
    role: 'assistant',
    content: 'Final verified prose answer.',
    thoughts: ['Wrap-up thinking'],
    tools: [],
    steps: [{ id: 'st_3', type: 'text', content: 'Final verified prose answer.' }],
  },
  {
    type: 'compaction_boundary',
    summary: 'Previous 5 turns compacted to conserve tokens',
  },
];

const messages = parseSessionHistory(transcriptPayload);
assert.strictEqual(messages.length, 2, 'Consecutive assistant turns must merge into one assistant message');

const [userMsg, asstMsg] = messages;
assert.strictEqual(userMsg.role, 'user');
assert.strictEqual(userMsg.content, 'Please run tool test');

assert.strictEqual(asstMsg.role, 'assistant');
// Intermediate prose during tool execution was filtered; final prose retained
assert.strictEqual(asstMsg.content, 'Final verified prose answer.');
assert.strictEqual(asstMsg.thoughts.length, 2);
assert.strictEqual(asstMsg.tools.length, 1);
assert.strictEqual(asstMsg.tools[0].output, '', 'Empty tool output must remain empty string without fabricated Done.');

// Compaction boundary check
assert.strictEqual(asstMsg.compactionBoundary, true);
assert.strictEqual(asstMsg.compactionSummary, 'Previous 5 turns compacted to conserve tokens');
console.log('  [PASS] 5. parseSessionHistory merges turns cleanly, honors compactions, and avoids fabricating tool output.');

// Error & errorId preserved on reloaded assistant turns
{
  const parsedErr = parseSessionHistory([
    { id: 'u_e', role: 'user', turn_id: 't_e', content: 'Run check' },
    { id: 'a_e', role: 'assistant', turn_id: 't_e', status: 'error', error: 'TypeError: Failed to fetch', error_id: 'err_42', content: 'Partial' },
  ]);
  assert.strictEqual(parsedErr[1].status, 'error');
  assert.strictEqual(parsedErr[1].error, 'TypeError: Failed to fetch');
  assert.strictEqual(parsedErr[1].errorId, 'err_42');
  console.log('  [PASS] 6. Error and errorId preserved across transcript parsing.');
}

console.log('[SUCCESS] All SessionHistoryParser & ProseHelpers tests passed cleanly!');
