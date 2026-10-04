import assert from 'node:assert';

// Verification of formatting and edge-case behavior for reasoning primitive logic
function formatReasoningDuration(secs) {
  if (!secs || secs <= 0) return '0s';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

console.log('Testing formatReasoningDuration...');
assert.strictEqual(formatReasoningDuration(0), '0s');
assert.strictEqual(formatReasoningDuration(-5), '0s');
assert.strictEqual(formatReasoningDuration(1), '1s');
assert.strictEqual(formatReasoningDuration(14), '14s');
assert.strictEqual(formatReasoningDuration(59), '59s');
assert.strictEqual(formatReasoningDuration(60), '1m');
assert.strictEqual(formatReasoningDuration(74), '1m 14s');
assert.strictEqual(formatReasoningDuration(3600), '1h');
assert.strictEqual(formatReasoningDuration(3665), '1h 1m');
console.log('✓ formatReasoningDuration all edge cases PASSED');

// Test label formatting logic
function getReasoningLabel({ isStreaming, durationSeconds, liveSeconds }) {
  const effectiveSecs = isStreaming
    ? (liveSeconds || 1)
    : (durationSeconds || liveSeconds || 1);
  const formatted = formatReasoningDuration(effectiveSecs);
  return isStreaming ? `Thinking (${formatted})...` : `Thought for ${formatted}`;
}

assert.strictEqual(getReasoningLabel({ isStreaming: true, liveSeconds: 5 }), 'Thinking (5s)...');
assert.strictEqual(getReasoningLabel({ isStreaming: false, durationSeconds: 14 }), 'Thought for 14s');
assert.strictEqual(getReasoningLabel({ isStreaming: false, durationSeconds: 75 }), 'Thought for 1m 15s');
console.log('✓ getReasoningLabel dynamic states PASSED');

console.log('All reasoning primitive logic tests PASSED!');
