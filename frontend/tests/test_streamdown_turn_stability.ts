import assert from 'node:assert';
import { buildTurns } from '../src/features/chat/utils/turns';
import type { Message } from '../src/types/chat';

console.log('=== RUNNING STREAMDOWN & TURN STABILITY CONTRACT TEST ===');

// 1. Verify structural sharing across streaming token arrivals
const initialMessages: Message[] = [
  { id: 'u1', turnId: 'turn_1', role: 'user', content: 'What is ISA 500?', status: 'completed', thoughts: [], tools: [] },
  { id: 'a1', turnId: 'turn_1', role: 'assistant', content: 'ISA 500 deals with audit evidence.', status: 'completed', thoughts: [], tools: [] },
  { id: 'u2', turnId: 'turn_2', role: 'user', content: 'List audit procedures', status: 'completed', thoughts: [], tools: [] },
  { id: 'a2', turnId: 'turn_2', role: 'assistant', content: 'Here are the', status: 'running', thoughts: [], tools: [] },
];

const turns1 = buildTurns(initialMessages);
assert.strictEqual(turns1.length, 2, 'Should build 2 turns');
assert.strictEqual(turns1[0].id, 'turn_1', 'Turn 1 ID matches');
assert.strictEqual(turns1[1].id, 'turn_2', 'Turn 2 ID matches');

// Simulate token delta arriving on active turn 2
const tokenUpdatedMessages: Message[] = [
  initialMessages[0],
  initialMessages[1],
  initialMessages[2],
  { ...initialMessages[3], content: 'Here are the audit procedures for testing:' },
];

const turns2 = buildTurns(tokenUpdatedMessages);
assert.strictEqual(turns2.length, 2, 'Should still have 2 turns');

// CRITICAL ASSERTION: Turn 1 MUST maintain the exact same object reference!
assert.strictEqual(
  turns1[0],
  turns2[0],
  'Structural sharing failure: completed Turn 1 must maintain exact object reference across streaming token flushes!'
);

// Turn 2 was modified, so its turn object must be fresh
assert.notStrictEqual(
  turns1[1],
  turns2[1],
  'Active Turn 2 must update when receiving streaming tokens'
);
assert.strictEqual(
  turns2[1].aiMsgs[0].content,
  'Here are the audit procedures for testing:',
  'Turn 2 must reflect latest streamed token content'
);

console.log('✓ Test 1: Completed Turn 1 maintains 100% object reference stability across streaming token flushes');

// 2. Verify subsequent token delta preserves Turn 1 reference continuously
const secondTokenMessages: Message[] = [
  initialMessages[0],
  initialMessages[1],
  initialMessages[2],
  { ...initialMessages[3], content: 'Here are the audit procedures for testing: 1. Inspection 2. Observation' },
];

const turns3 = buildTurns(secondTokenMessages);
assert.strictEqual(
  turns3[0],
  turns1[0],
  'Turn 1 reference must remain identical across continuous 60fps token streaming'
);

console.log('✓ Test 2: Turn 1 reference remains stable across continuous streaming ticks');

// 3. Verify that completing Turn 2 freezes it too
const completedMessages: Message[] = [
  initialMessages[0],
  initialMessages[1],
  initialMessages[2],
  { ...initialMessages[3], content: 'Here are the audit procedures for testing: 1. Inspection 2. Observation', status: 'completed' },
];

const turns4 = buildTurns(completedMessages);
// Now send a new Turn 3
const turn3Messages: Message[] = [
  ...completedMessages,
  { id: 'u3', turnId: 'turn_3', role: 'user', content: 'Thanks!', status: 'completed', thoughts: [], tools: [] },
  { id: 'a3', turnId: 'turn_3', role: 'assistant', content: 'You are welcome', status: 'running', thoughts: [], tools: [] },
];

const turns5 = buildTurns(turn3Messages);
assert.strictEqual(turns5.length, 3, 'Should have 3 turns');
assert.strictEqual(turns5[0], turns1[0], 'Turn 1 reference still unchanged');
assert.strictEqual(turns5[1], turns4[1], 'Turn 2 now frozen and maintains exact reference');

console.log('✓ Test 3: Newly completed Turn 2 freezes and preserves reference when Turn 3 streams');

console.log('=== ALL STREAMDOWN & TURN STABILITY CONTRACT TESTS PASSED (3/3) ===');
