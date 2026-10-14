import assert from 'node:assert';

// 1. Verify prefix-agnostic tool ID matching
function isSameToolId(idA, idB) {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  const cleanA = idA.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  const cleanB = idB.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  return cleanA === cleanB || idA.endsWith(`_${idB}`) || idB.endsWith(`_${idA}`);
}

assert.strictEqual(isSameToolId('run_tc1', 'tc1'), true, 'run_ prefix must match raw id');
assert.strictEqual(isSameToolId('run_abc123_tc1', 'tc1'), true, 'run_<runId>_ prefix must match raw id');
assert.strictEqual(isSameToolId('run_abc123_tc1', 'run_tc1'), true, 'mismatched run prefix must match identical raw id');
assert.strictEqual(isSameToolId('tc1', 'tc2'), false, 'different IDs must not match');

// 2. Verify extractEditedFiles logic guards against pending/unexecuted tools
function extractEditedFilesSimulated(msg) {
  const fileMap = new Map();
  if (msg.tools && msg.tools.length > 0) {
    for (const t of msg.tools) {
      if (t.status === 'failed' || t.status === 'pending_approval' || t.status === 'running' || !t.output) continue;
      const out = String(t.output).trim().toLowerCase();
      if (out.startsWith('error:') || out.startsWith('failed:')) continue;
      const path = t.args?.path || t.args?.TargetFile;
      if (path) fileMap.set(path, { path });
    }
  }
  return Array.from(fileMap.values());
}

// Case A: Tool is pending approval -> must NOT appear in generated files drawer
const pendingMsg = {
  tools: [
    {
      id: 'tc_write_1',
      name: 'write_file',
      args: { path: '/workspace/src/new_service.ts' },
      status: 'pending_approval',
      output: undefined,
    }
  ]
};
assert.strictEqual(extractEditedFilesSimulated(pendingMsg).length, 0, 'Pending approval tool must not yield files');

// Case B: Tool is actively running -> must NOT appear
const runningMsg = {
  tools: [
    {
      id: 'tc_write_1',
      name: 'write_file',
      args: { path: '/workspace/src/new_service.ts' },
      status: 'running',
      output: undefined,
    }
  ]
};
assert.strictEqual(extractEditedFilesSimulated(runningMsg).length, 0, 'Running tool must not yield files');

// Case C: Tool is completed with valid output -> MUST appear
const completedMsg = {
  tools: [
    {
      id: 'tc_write_1',
      name: 'write_file',
      args: { path: '/workspace/src/new_service.ts' },
      status: 'completed',
      output: 'Wrote 150 lines to /workspace/src/new_service.ts',
    }
  ]
};
assert.strictEqual(extractEditedFilesSimulated(completedMsg).length, 1, 'Completed tool must yield edited file');

console.log('✓ All phantom file prevention and tool matching tests passed!');
