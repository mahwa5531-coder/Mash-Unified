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

console.log('All timeline grouping tests PASSED successfully!');
