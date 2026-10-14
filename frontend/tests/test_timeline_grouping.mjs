import assert from 'node:assert';

// Mock timeline grouping logic
function isToolRunning(tool) {
  if (!tool) return false;
  return tool.status === 'running';
}

function groupTimelineEntries(entries) {
  const result = [];
  let i = 0;

  while (i < entries.length) {
    const current = entries[i];

    // Preserved standalone: Approval Cards must never be bundled into a collapsible group.
    // Deduplicate by raw toolCallId / command so stream retries never stack duplicate cards (Fix 3)
    if (current.type === 'approval') {
      const tcId = String(current.data?.toolCallId || current.data?.tool?.id || current.id);
      const cleanId = tcId.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
      const isDuplicate = result.some((r) => {
        if (r.type !== 'approval') return false;
        const rId = String(r.data?.toolCallId || r.data?.tool?.id || r.id).replace(/^run_[^_]+_/, '').replace(/^run_/, '');
        return rId === cleanId || (current.data?.command && r.data?.command === current.data?.command);
      });
      if (!isDuplicate) {
        result.push(current);
      }
      i++;
      continue;
    }

    // 1. Group consecutive commands (>= 2)
    if (current.type === 'command') {
      const group = [current];
      let j = i + 1;
      while (j < entries.length && entries[j].type === 'command') {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        result.push({
          id: `cmd-group-${i}`,
          type: 'command_group',
          data: {
            count: group.length,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // 2. Group consecutive edits (>= 2)
    if (current.type === 'edit') {
      const group = [current];
      let j = i + 1;
      while (j < entries.length && entries[j].type === 'edit') {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        let totalAdded = 0;
        let totalDeleted = 0;
        group.forEach(e => {
          totalAdded += e.data?.added || 0;
          totalDeleted += e.data?.deleted || 0;
        });
        result.push({
          id: `edit-group-${i}`,
          type: 'edit_group',
          data: {
            count: group.length,
            added: totalAdded,
            deleted: totalDeleted,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // 3. Group consecutive file reads / searches / folder views (>= 2)
    if (current.type === 'search' || current.type === 'file_read' || current.type === 'folder_view') {
      const group = [current];
      let j = i + 1;
      while (
        j < entries.length && 
        (entries[j].type === 'search' || entries[j].type === 'file_read' || entries[j].type === 'folder_view')
      ) {
        group.push(entries[j]);
        j++;
      }
      if (group.length > 1) {
        const isRunning = group.some(e => isToolRunning(e.data?.tool));
        const isCancelled = group.some(e => e.data?.tool?.status === 'cancelled');
        const allReads = group.every(e => e.type === 'file_read');
        const allSearches = group.every(e => e.type === 'search');
        const label = allReads 
          ? `${group.length} files` 
          : allSearches 
            ? `${group.length} searches` 
            : `${group.length} files & searches`;
        result.push({
          id: `exploration-group-${i}`,
          type: 'exploration_group',
          data: {
            count: group.length,
            label,
            isRunning,
            isCancelled,
          },
          items: group,
        });
        i = j;
        continue;
      }
    }

    // Otherwise single item
    result.push(current);
    i++;
  }

  return result;
}

console.log('Testing timeline grouping logic...');

// Test 1: Single command should NOT be grouped
const singleCmd = [{ id: 'c1', type: 'command', data: { cmd: 'ls' } }];
assert.strictEqual(groupTimelineEntries(singleCmd).length, 1);
assert.strictEqual(groupTimelineEntries(singleCmd)[0].type, 'command');
console.log('✓ Test 1: Single item remains un-grouped');

// Test 2: 3 consecutive commands become 1 command_group
const tripleCmd = [
  { id: 'c1', type: 'command', data: { cmd: 'ls' } },
  { id: 'c2', type: 'command', data: { cmd: 'pwd' } },
  { id: 'c3', type: 'command', data: { cmd: 'git status' } },
];
const groupedCmd = groupTimelineEntries(tripleCmd);
assert.strictEqual(groupedCmd.length, 1);
assert.strictEqual(groupedCmd[0].type, 'command_group');
assert.strictEqual(groupedCmd[0].data.count, 3);
assert.strictEqual(groupedCmd[0].items.length, 3);
console.log('✓ Test 2: 3 consecutive commands grouped into command_group');

// Test 3: 3 consecutive edits become edit_group with summed lines
const edits = [
  { id: 'e1', type: 'edit', data: { added: 10, deleted: 2 } },
  { id: 'e2', type: 'edit', data: { added: 25, deleted: 8 } },
];
const groupedEdits = groupTimelineEntries(edits);
assert.strictEqual(groupedEdits.length, 1);
assert.strictEqual(groupedEdits[0].type, 'edit_group');
assert.strictEqual(groupedEdits[0].data.added, 35);
assert.strictEqual(groupedEdits[0].data.deleted, 10);
console.log('✓ Test 3: Edits grouped with correct line diff sum (+35 -10)');

// Test 4: Consecutive reads become exploration_group
const reads = [
  { id: 'r1', type: 'file_read', data: { filename: 'a.txt' } },
  { id: 'r2', type: 'file_read', data: { filename: 'b.txt' } },
  { id: 'r3', type: 'file_read', data: { filename: 'c.txt' } },
];
const groupedReads = groupTimelineEntries(reads);
assert.strictEqual(groupedReads.length, 1);
assert.strictEqual(groupedReads[0].type, 'exploration_group');
assert.strictEqual(groupedReads[0].data.label, '3 files');
console.log('✓ Test 4: Consecutive reads grouped into exploration_group');

// Test 5: Step unit isolation: sequential steps remain independent units, while parallel tools in one step group cleanly
function processStepsTimeline(steps) {
  const fullTimeline = [];
  steps.forEach((step, sIdx) => {
    if (step.type === 'tool') {
      fullTimeline.push(step);
    } else if (step.tools && step.tools.length > 0) {
      if (step.tools.length === 1) {
        fullTimeline.push(step.tools[0]);
      } else {
        const grouped = groupTimelineEntries(step.tools);
        fullTimeline.push(...grouped);
      }
    }
  });
  return fullTimeline;
}

const sequentialSteps = [
  { id: 's1', type: 'tool', tool_type: 'file_read', data: { filename: 'a.ts' } },
  { id: 's2', type: 'tool', tool_type: 'file_read', data: { filename: 'b.ts' } },
  { id: 's3', type: 'tool', tool_type: 'command', data: { cmd: 'npm test' } },
];
const sequentialResult = processStepsTimeline(sequentialSteps);
assert.strictEqual(sequentialResult.length, 3, 'Sequential steps must remain 3 distinct units');
assert.strictEqual(sequentialResult[0].data.filename, 'a.ts');
assert.strictEqual(sequentialResult[1].data.filename, 'b.ts');
assert.strictEqual(sequentialResult[2].data.cmd, 'npm test');
console.log('✓ Test 5A: Sequential steps remain unattached independent units');

const stepWithParallelTools = [
  {
    id: 's1',
    tools: [
      { id: 'p1', type: 'file_read', data: { filename: 'x.ts' } },
      { id: 'p2', type: 'file_read', data: { filename: 'y.ts' } },
      { id: 'p3', type: 'file_read', data: { filename: 'z.ts' } },
    ]
  },
  {
    id: 's2',
    type: 'tool',
    data: { filename: 'solo.ts' }
  }
];
const parallelResult = processStepsTimeline(stepWithParallelTools);
assert.strictEqual(parallelResult.length, 2, 'Should have 1 grouped parallel step and 1 solo step');
assert.strictEqual(parallelResult[0].type, 'exploration_group');
assert.strictEqual(parallelResult[0].data.count, 3);
assert.strictEqual(parallelResult[1].data.filename, 'solo.ts');
console.log('✓ Test 5B: Parallel tools inside a single step group into exploration_group without leaking into solo step');

// ---------------------------------------------------------------------------
// Test 6: Ephemeral Approval Card & Normal Tool Call Rendering
// ---------------------------------------------------------------------------
function parseToolItem(t, tIdx) {
  const name = (t.name || '').toLowerCase();
  let args = t.args || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  // The interactive approval card is ONLY rendered while waiting for human permission.
  // As soon as the user makes a decision (allow/deny) or status transitions, the card vanishes
  // and the tool call renders as its normal canonical timeline item (command, file_view, etc.).
  if (t.status === 'pending_approval' && !t.decision) {
    const rawCmd = args.CommandLine || args.command || args.cmd || '';
    return {
      id: `tool-${tIdx}`,
      type: 'approval',
      data: {
        tool: t,
        toolCallId: t.id || `tc_${tIdx}`,
        toolName: t.name,
        command: rawCmd,
        status: 'pending',
        decision: null,
      }
    };
  }

  if (name.includes('run_shell_command') || name.includes('shell')) {
    const rawCmd = args.CommandLine || args.command || args.cmd || '';
    return {
      id: `tool-${tIdx}`,
      type: 'command',
      data: { tool: t, cmd: rawCmd }
    };
  }
  return { id: `tool-${tIdx}`, type: 'tool', data: { tool: t } };
}

// 6A. While waiting for permission -> type: 'approval'
const pendingTool = {
  id: 'tc_del_1',
  name: 'run_shell_command',
  args: { command: 'rm -rf node_modules' },
  status: 'pending_approval',
  decision: null,
};
const pendingEntry = parseToolItem(pendingTool, 0);
assert.strictEqual(pendingEntry.type, 'approval', 'Pending tool without decision MUST render as approval card');
assert.strictEqual(pendingEntry.data.status, 'pending');

// 6B. When user allows -> Card vanishes immediately, renders as normal 'command' tool
const allowedTool = {
  ...pendingTool,
  status: 'running',
  decision: 'allow',
};
const allowedEntry = parseToolItem(allowedTool, 0);
assert.strictEqual(allowedEntry.type, 'command', 'Approved tool MUST vanish approval card and render as normal command tool');
assert.strictEqual(allowedEntry.data.cmd, 'rm -rf node_modules');

// 6C. When user denies -> Card vanishes immediately, renders as normal 'command' tool with failed status
const deniedTool = {
  ...pendingTool,
  status: 'failed',
  decision: 'deny',
};
const deniedEntry = parseToolItem(deniedTool, 0);
assert.strictEqual(deniedEntry.type, 'command', 'Denied tool MUST vanish approval card and render as normal tool');
assert.strictEqual(deniedEntry.data.tool.status, 'failed');

console.log('✓ Test 6: Ephemeral approval card vanishes immediately upon decision and renders normal tool call');

// ---------------------------------------------------------------------------
// Test 7: Duplicate Approval Card Deduplication (Fix 3)
// ---------------------------------------------------------------------------
// When stream reconnects or retries, two pending approval events for the exact
// same underlying command / tool_call_id MUST be collapsed to exactly ONE card.
const dupApproval1 = {
  id: 'tool-0',
  type: 'approval',
  data: {
    toolCallId: 'run_123_call_delete_abc',
    toolName: 'run_shell_command',
    command: 'rm -rf build_cache',
    status: 'pending',
    decision: null,
  }
};
const dupApproval2 = {
  id: 'tool-1',
  type: 'approval',
  data: {
    toolCallId: 'run_456_call_delete_abc',
    toolName: 'run_shell_command',
    command: 'rm -rf build_cache',
    status: 'pending',
    decision: null,
  }
};
const dedupedTimeline = groupTimelineEntries([dupApproval1, dupApproval2]);
assert.strictEqual(dedupedTimeline.length, 1, 'Duplicate approval events MUST collapse into exactly ONE card');
assert.strictEqual(dedupedTimeline[0].data.command, 'rm -rf build_cache');
console.log('✓ Test 7: Duplicate approval cards from stream retries cleanly deduplicated');

console.log('All timeline grouping tests PASSED successfully!');
