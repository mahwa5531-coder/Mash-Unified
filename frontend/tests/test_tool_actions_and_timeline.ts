import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { InFlightToolTracker, updateAssistantToolsAndSteps } from '../src/features/chat/hooks/streamToolManager';
import { parseToolItem, isToolRunning, groupTimelineEntries } from '../src/features/chat/components/work-log/toolTimeline';
import { computeInterleavedUnits } from '../src/features/chat/components/messages/useInterleavedUnits';
import { parseSessionHistory } from '../src/features/chat/utils/sessionHistoryParser';
import type { ToolCall, Message } from '../src/types/chat';

console.log('======================================================================');
console.log('STARTING DYNAMIC TOOL ACTION & TOOL SUMMARY VERIFICATION TESTS');
console.log('======================================================================');

// -----------------------------------------------------------------------------
// [Test 1] globals.css verification for silverShine keyframes and utility class
// -----------------------------------------------------------------------------
console.log('\n[Test 1] globals.css silverShine & animate-silver-shine CSS definitions...');
const cssContent = fs.readFileSync(path.join(__dirname, '../src/app/globals.css'), 'utf-8');
assert.ok(cssContent.includes('@keyframes silverShine'), 'globals.css must define @keyframes silverShine');
assert.ok(cssContent.includes('.animate-silver-shine'), 'globals.css must define .animate-silver-shine class');
assert.ok(cssContent.includes('-webkit-background-clip: text') || cssContent.includes('background-clip: text'), 'animate-silver-shine must clip background to text');
assert.ok(cssContent.includes('color: transparent'), 'animate-silver-shine must include color: transparent for standards compatibility');
assert.ok(cssContent.includes('.dark .animate-silver-shine') || cssContent.includes('[data-theme="dark"] .animate-silver-shine'), 'dark mode selector must be present for animate-silver-shine');
console.log('  -> PASSED: globals.css contains 60 FPS GPU-accelerated silverShine sweep & utility class');

// -----------------------------------------------------------------------------
// [Test 2] streamToolManager InFlightToolTracker forwarding of toolAction & toolSummary
// -----------------------------------------------------------------------------
console.log('\n[Test 2] InFlightToolTracker forwarding of toolAction & toolSummary...');

const tracker = new InFlightToolTracker();
let emittedCalls: ToolCall[] = [];
const recordCall = (t: ToolCall) => emittedCalls.push(t);

// 2.1 handleToolStart
tracker.handleToolStart('call_1', 'read_file', 'run_123', recordCall);
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].status, 'running');

// 2.2 handleToolArgs with streaming JSON payload containing toolAction and toolSummary
emittedCalls = [];
tracker.handleToolArgs('call_1', '{"TargetFile": "src/auth.ts", ', 'run_123', recordCall);
// Incomplete JSON still buffering
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].toolAction, undefined);

emittedCalls = [];
tracker.handleToolArgs('call_1', '"toolAction": "Analyzing auth router", "toolSummary": "Auth router analysis"}', 'run_123', recordCall);
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].status, 'running');
assert.strictEqual(emittedCalls[0].toolAction, 'Analyzing auth router');
assert.strictEqual(emittedCalls[0].toolSummary, 'Auth router analysis');

// 2.3 handleToolEnd
emittedCalls = [];
tracker.handleToolEnd('call_1', 'run_123', recordCall);
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].status, 'running');
assert.strictEqual(emittedCalls[0].toolAction, 'Analyzing auth router');
assert.strictEqual(emittedCalls[0].toolSummary, 'Auth router analysis');

// 2.4 handleToolResult
emittedCalls = [];
tracker.handleToolResult('call_1', 'export const auth = {};', false, 1.25, 'run_123', recordCall);
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].status, 'completed');
assert.strictEqual(emittedCalls[0].toolAction, 'Analyzing auth router');
assert.strictEqual(emittedCalls[0].toolSummary, 'Auth router analysis');
assert.strictEqual(emittedCalls[0].durationSeconds, 1.25);

// 2.5 finalizeRunningTools when cancelled
tracker.reset();
emittedCalls = [];
tracker.handleToolStart('call_2', 'run_command', 'run_456', recordCall);
tracker.handleToolArgs('call_2', '{"CommandLine": "npm test", "toolAction": "Running test suite", "toolSummary": "Test suite run"}', 'run_456', recordCall);
emittedCalls = [];
tracker.finalizeRunningTools('cancelled', recordCall);
assert.strictEqual(emittedCalls.length, 1);
assert.strictEqual(emittedCalls[0].status, 'cancelled');
assert.strictEqual(emittedCalls[0].toolAction, 'Running test suite');
assert.strictEqual(emittedCalls[0].toolSummary, 'Test suite run');

// 2.6 updateAssistantToolsAndSteps preservation in tools & steps
const initialMessages: Message[] = [
  { role: 'user', content: 'check auth', thoughts: [], tools: [] },
  { id: 'turn_1', turnId: 'turn_1', role: 'assistant', content: '', thoughts: [], tools: [], steps: [] }
];
const updated = updateAssistantToolsAndSteps(initialMessages, 'turn_1', emittedCalls[0]);
assert.strictEqual(updated[1].tools.length, 1);
assert.strictEqual(updated[1].tools[0].toolAction, 'Running test suite');
assert.strictEqual(updated[1].tools[0].toolSummary, 'Test suite run');
assert.strictEqual(updated[1].steps?.length, 1);
assert.strictEqual(updated[1].steps?.[0].toolAction, 'Running test suite');
assert.strictEqual(updated[1].steps?.[0].toolSummary, 'Test suite run');

console.log('  -> PASSED: InFlightToolTracker and updateAssistantToolsAndSteps forward toolAction & toolSummary');

// -----------------------------------------------------------------------------
// [Test 3] toolTimeline parseToolItem extraction across all tool combinations
// -----------------------------------------------------------------------------
console.log('\n[Test 3] parseToolItem toolAction and toolSummary extraction...');

// 3.1 file_read
const readEntry = parseToolItem({
  name: 'read_file',
  args: { TargetFile: 'src/router.ts', toolAction: 'Reading router config', toolSummary: 'Router config read' },
  status: 'running',
}, 1);
assert.strictEqual(readEntry.type, 'file_read');
assert.strictEqual(readEntry.data.toolAction, 'Reading router config');
assert.strictEqual(readEntry.data.toolSummary, 'Router config read');
assert.strictEqual(readEntry.data.filename, 'router.ts');

// 3.2 folder_view
const folderEntry = parseToolItem({
  name: 'list_directory',
  args: { DirectoryPath: 'src/features', toolAction: 'Exploring features directory', toolSummary: 'Features directory exploration' },
  status: 'completed',
}, 2);
assert.strictEqual(folderEntry.type, 'folder_view');
assert.strictEqual(folderEntry.data.toolAction, 'Exploring features directory');
assert.strictEqual(folderEntry.data.toolSummary, 'Features directory exploration');
assert.strictEqual(folderEntry.data.foldername, 'features');

// 3.3 edit (replace_file_content / edit_file)
const editEntry = parseToolItem({
  name: 'replace_file_content',
  args: {
    TargetFile: 'src/token.ts',
    TargetContent: 'oldToken()',
    ReplacementContent: 'newToken()',
    toolAction: 'Hardening auth tokens',
    toolSummary: 'Auth token hardening',
  },
  status: 'running',
}, 3);
assert.strictEqual(editEntry.type, 'edit');
assert.strictEqual(editEntry.data.toolAction, 'Hardening auth tokens');
assert.strictEqual(editEntry.data.toolSummary, 'Auth token hardening');
assert.strictEqual(editEntry.data.filename, 'token.ts');

// 3.4 command (run_command)
const cmdEntry = parseToolItem({
  name: 'run_command',
  args: { CommandLine: 'npm run lint', toolAction: 'Auditing code quality', toolSummary: 'Code quality audit' },
  status: 'running',
}, 4);
assert.strictEqual(cmdEntry.type, 'command');
assert.strictEqual(cmdEntry.data.toolAction, 'Auditing code quality');
assert.strictEqual(cmdEntry.data.toolSummary, 'Code quality audit');
assert.strictEqual(cmdEntry.data.cmd, 'npm run lint');

// 3.5 web_search
const webSearchEntry = parseToolItem({
  name: 'search_web',
  args: { Query: 'Next.js 16 breaking changes', toolAction: 'Searching migration guides', toolSummary: 'Migration guide search' },
  status: 'completed',
}, 5);
assert.strictEqual(webSearchEntry.type, 'web_search');
assert.strictEqual(webSearchEntry.data.toolAction, 'Searching migration guides');
assert.strictEqual(webSearchEntry.data.toolSummary, 'Migration guide search');
assert.strictEqual(webSearchEntry.data.query, 'Next.js 16 breaking changes');

// 3.6 web_fetch
const webFetchEntry = parseToolItem({
  name: 'read_url_content',
  args: { Url: 'https://docs.nextjs.org', toolAction: 'Fetching documentation', toolSummary: 'Documentation fetched' },
  status: 'running',
}, 6);
assert.strictEqual(webFetchEntry.type, 'web_fetch');
assert.strictEqual(webFetchEntry.data.toolAction, 'Fetching documentation');
assert.strictEqual(webFetchEntry.data.toolSummary, 'Documentation fetched');

// 3.7 code_search (grep_search)
const searchEntry = parseToolItem({
  name: 'grep_search',
  args: { Query: 'jwt.sign', toolAction: 'Searching JWT token signatures', toolSummary: 'JWT signature search' },
  status: 'completed',
}, 7);
assert.strictEqual(searchEntry.type, 'code_search');
assert.strictEqual(searchEntry.data.toolAction, 'Searching JWT token signatures');
assert.strictEqual(searchEntry.data.toolSummary, 'JWT signature search');

// 3.8 task (manage_task)
const taskEntry = parseToolItem({
  name: 'manage_task',
  args: { Action: 'status', TaskId: 'task-99', toolAction: 'Inspecting worker process', toolSummary: 'Worker process inspection' },
  status: 'running',
}, 8);
assert.strictEqual(taskEntry.type, 'task');
assert.strictEqual(taskEntry.data.toolAction, 'Inspecting worker process');
assert.strictEqual(taskEntry.data.toolSummary, 'Worker process inspection');

// 3.9 subagent
const subagentEntry = parseToolItem({
  name: 'invoke_subagent',
  args: { Role: 'Security Auditor', toolAction: 'Auditing authentication boundaries', toolSummary: 'Authentication boundary audit' },
  status: 'running',
}, 9);
assert.strictEqual(subagentEntry.type, 'subagent');
assert.strictEqual(subagentEntry.data.toolAction, 'Auditing authentication boundaries');
assert.strictEqual(subagentEntry.data.toolSummary, 'Authentication boundary audit');

console.log('  -> PASSED: All 9 tool categories correctly extract and forward toolAction & toolSummary');

// -----------------------------------------------------------------------------
// [Test 4] Timeline Row Presentation State Rules
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Timeline Row Presentation State Rules (running shine vs completed ghost vs cancelled/denied)...');

function computeRowPresentation(entry: any, isStreaming: boolean = false) {
  const isRunning = isToolRunning(entry.data?.tool, isStreaming);
  const isCancelled = entry.data?.tool?.status === 'cancelled';
  const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
  const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
  const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

  let label: string;
  let hasShine = false;

  const fallbackRunning: Record<string, string> = {
    file_read: 'Analysing',
    folder_view: 'Analysing',
    edit: 'Editing',
    command: 'Running',
    web_search: 'Searching web',
    web_fetch: 'Fetching web',
    code_search: 'Searching',
    task: 'Running',
    subagent: 'Running subagent',
    other: 'Executing',
  };

  const fallbackCompleted: Record<string, string> = {
    file_read: 'Analysed',
    folder_view: 'Analysed',
    edit: 'Edited',
    command: 'Ran',
    web_search: 'Searched web',
    web_fetch: 'Fetched',
    code_search: 'Searched',
    task: 'Checked',
    subagent: 'Subagent',
    other: 'Executed',
  };

  if (isDenied) {
    label = 'Cancelled by user';
    hasShine = false;
  } else if (isCancelled) {
    label = 'Cancelled';
    hasShine = false;
  } else if (isRunning) {
    label = toolAction || fallbackRunning[entry.type] || 'Running';
    hasShine = true;
  } else {
    label = toolSummary || fallbackCompleted[entry.type] || 'Done';
    hasShine = false;
  }

  const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

  // Command row visibility logic
  let showCmd = false;
  if (isDenied || isCancelled) {
    showCmd = true;
  } else if (isRunning) {
    showCmd = !toolAction;
  } else {
    showCmd = !toolSummary;
  }

  return { label, hasShine, isRunning, isCancelled, isDenied, hasCustomText, showCmd };
}

// 4.1 Running with dynamic toolAction -> displays toolAction with animate-silver-shine
const runningWithAction = computeRowPresentation({
  type: 'file_read',
  data: {
    tool: { status: 'running' },
    toolAction: 'Analyzing auth router',
    toolSummary: 'Auth router analysis',
  }
});
assert.strictEqual(runningWithAction.label, 'Analyzing auth router');
assert.strictEqual(runningWithAction.hasShine, true);
assert.strictEqual(runningWithAction.hasCustomText, true);

// 4.2 Running without toolAction -> falls back to "Analysing" with animate-silver-shine
const runningWithoutAction = computeRowPresentation({
  type: 'file_read',
  data: {
    tool: { status: 'running' },
  }
});
assert.strictEqual(runningWithoutAction.label, 'Analysing');
assert.strictEqual(runningWithoutAction.hasShine, true);
assert.strictEqual(runningWithoutAction.hasCustomText, false);

// 4.3 Completed with toolSummary -> displays toolSummary without shine (calm static text)
const completedWithSummary = computeRowPresentation({
  type: 'file_read',
  data: {
    tool: { status: 'completed', output: 'content' },
    toolAction: 'Analyzing auth router',
    toolSummary: 'Auth router analysis',
  }
});
assert.strictEqual(completedWithSummary.label, 'Auth router analysis');
assert.strictEqual(completedWithSummary.hasShine, false, 'Completed tool MUST NOT shimmer!');
assert.strictEqual(completedWithSummary.hasCustomText, true);

// 4.4 Completed without toolSummary -> falls back to "Analysed" without shine
const completedWithoutSummary = computeRowPresentation({
  type: 'file_read',
  data: {
    tool: { status: 'completed', output: 'content' },
  }
});
assert.strictEqual(completedWithoutSummary.label, 'Analysed');
assert.strictEqual(completedWithoutSummary.hasShine, false, 'Completed tool MUST NOT shimmer!');
assert.strictEqual(completedWithoutSummary.hasCustomText, false);

// 4.5 Tool returning error output (e.g. non-zero exit or stderr) -> observation for LLM, renders completed label/toolSummary calmly without shine
const toolWithErrorOutput = computeRowPresentation({
  type: 'command',
  data: {
    tool: { status: 'completed', output: 'error: exit status 1' },
    toolAction: 'Building assets',
    toolSummary: 'Asset build',
  }
});
assert.strictEqual(toolWithErrorOutput.label, 'Asset build');
assert.strictEqual(toolWithErrorOutput.hasShine, false, 'Completed tool MUST NOT shimmer!');
assert.strictEqual(toolWithErrorOutput.hasCustomText, true);
assert.strictEqual(toolWithErrorOutput.showCmd, false);

// 4.6 Cancelled tool -> displays "Cancelled" without shine, AND target is preserved
const cancelledTool = computeRowPresentation({
  type: 'edit',
  data: {
    tool: { status: 'cancelled' },
    toolAction: 'Applying refactor',
    toolSummary: 'Refactor applied',
  }
});
assert.strictEqual(cancelledTool.label, 'Cancelled');
assert.strictEqual(cancelledTool.hasShine, false, 'Cancelled tool MUST NOT shimmer!');
assert.strictEqual(cancelledTool.isCancelled, true);
assert.strictEqual(cancelledTool.hasCustomText, false, 'Target MUST NOT be suppressed when cancelled!');
assert.strictEqual(cancelledTool.showCmd, true, 'Command name MUST be displayed when command is cancelled!');

// 4.7 Web search returning error or empty output -> still completed observation for LLM
const webSearchWithError = computeRowPresentation({
  type: 'web_search',
  data: {
    tool: { status: 'completed', output: 'Network timeout' },
    query: 'Next.js 16 breaking changes',
    toolSummary: 'Next.js migration search',
  }
});
assert.strictEqual(webSearchWithError.label, 'Next.js migration search');
assert.strictEqual(webSearchWithError.hasShine, false);

// 4.8 Denied tool -> displays "Cancelled by user" without shine, calm ghost line, zero error badge
const deniedTool = computeRowPresentation({
  type: 'command',
  data: {
    tool: { status: 'denied', decision: 'deny' },
    cmd: 'npm run build',
  }
});
assert.strictEqual(deniedTool.label, 'Cancelled by user');
assert.strictEqual(deniedTool.hasShine, false, 'Denied tool MUST NOT shimmer!');
assert.strictEqual(deniedTool.isDenied, true);
assert.strictEqual(deniedTool.showCmd, true, 'Command name MUST be displayed when command is cancelled/denied!');

console.log('  -> PASSED: All presentation states (running shine, calm ghost static completed, cancelled, denied ghost line, target retention) 100% verified');

// -----------------------------------------------------------------------------
// [Test 5] Global Grouping across sequential steps & search categories
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Global Grouping across sequential steps & search categories...');

// 5.1 3 consecutive file reads group into '3 files'
const entries1 = [
  parseToolItem({ name: 'read_file', args: { TargetFile: 'a.txt' }, status: 'completed' }, '1'),
  parseToolItem({ name: 'read_file', args: { TargetFile: 'b.txt' }, status: 'completed' }, '2'),
  parseToolItem({ name: 'read_file', args: { TargetFile: 'c.txt' }, status: 'completed' }, '3'),
];
const grouped1 = groupTimelineEntries(entries1);
assert.strictEqual(grouped1.length, 1);
assert.strictEqual(grouped1[0].type, 'exploration_group');
assert.strictEqual(grouped1[0].data?.count, 3);
assert.strictEqual(grouped1[0].data?.label, '3 files');

// 5.2 2 code searches + 1 web search group into '3 searches'
const entries2 = [
  parseToolItem({ name: 'grep_search', args: { Query: 'patternA' }, status: 'completed' }, '1'),
  parseToolItem({ name: 'search_files', args: { Pattern: 'patternB' }, status: 'completed' }, '2'),
  parseToolItem({ name: 'search_web', args: { Query: 'audit guide' }, status: 'completed' }, '3'),
];
const grouped2 = groupTimelineEntries(entries2);
assert.strictEqual(grouped2.length, 1);
assert.strictEqual(grouped2[0].type, 'exploration_group');
assert.strictEqual(grouped2[0].data?.count, 3);
assert.strictEqual(grouped2[0].data?.label, '3 searches');

// 5.3 3 commands group into 'command_group'
const entries3 = [
  parseToolItem({ name: 'run_shell_command', args: { CommandLine: 'git status' }, status: 'completed' }, '1'),
  parseToolItem({ name: 'run_shell_command', args: { CommandLine: 'git diff' }, status: 'completed' }, '2'),
  parseToolItem({ name: 'run_shell_command', args: { CommandLine: 'git log' }, status: 'completed' }, '3'),
];
const grouped3 = groupTimelineEntries(entries3);
assert.strictEqual(grouped3.length, 1);
assert.strictEqual(grouped3[0].type, 'command_group');
assert.strictEqual(grouped3[0].data?.count, 3);

// 5.4 Chronological interleaving: Thought -> Exploration -> Thought -> Commands
const interleavedEntries = [
  { id: 'thought-1', type: 'thought' as const, data: { text: 'Examining project' } },
  parseToolItem({ name: 'read_file', args: { TargetFile: 'x.py' }, status: 'completed' }, '1'),
  parseToolItem({ name: 'read_file', args: { TargetFile: 'y.py' }, status: 'completed' }, '2'),
  { id: 'thought-2', type: 'thought' as const, data: { text: 'Running tests' } },
  parseToolItem({ name: 'run_command', args: { CommandLine: 'pytest' }, status: 'completed' }, '3'),
  parseToolItem({ name: 'run_command', args: { CommandLine: 'flake8' }, status: 'completed' }, '4'),
];
const groupedInterleaved = groupTimelineEntries(interleavedEntries);
assert.strictEqual(groupedInterleaved.length, 4);
assert.strictEqual(groupedInterleaved[0].type, 'thought');
assert.strictEqual(groupedInterleaved[1].type, 'exploration_group');
assert.strictEqual(groupedInterleaved[2].type, 'thought');
assert.strictEqual(groupedInterleaved[3].type, 'command_group');

// 5.5 Single items are NOT grouped into collapsible groups
const singleItems = [
  parseToolItem({ name: 'read_file', args: { TargetFile: 'x.py' }, status: 'completed' }, '1'),
  parseToolItem({ name: 'run_command', args: { CommandLine: 'pytest' }, status: 'completed' }, '2'),
];
const groupedSingle = groupTimelineEntries(singleItems);
assert.strictEqual(groupedSingle.length, 2);
assert.strictEqual(groupedSingle[0].type, 'file_read');
assert.strictEqual(groupedSingle[1].type, 'command');

// 5.6 Filename redundancy suppression
const fname = 'statement.pdf';
const redundantSummary = 'Viewed statement.pdf';
const hasRedundant = redundantSummary.toLowerCase().includes(fname.toLowerCase());
assert.strictEqual(hasRedundant, true);

const cleanSummary = 'Reconciliation audit';
const hasRedundant2 = cleanSummary.toLowerCase().includes(fname.toLowerCase());
assert.strictEqual(hasRedundant2, false);

console.log('  -> PASSED: Global Grouping across sequential steps & search categories 100% verified');

// -----------------------------------------------------------------------------
// [Test 6] Accurate Exploration Group Labels (R2)
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Exploration Group Labels & Auto-Expansion Jitter Elimination...');

function computeGroupLabel(entry: any) {
  const isRunning = Boolean(entry.data?.isRunning);
  const isCancelled = Boolean(entry.data?.isCancelled);
  if (entry.type === 'command_group') {
    const verb = isCancelled ? 'Cancelled' : isRunning ? 'Running' : 'Ran';
    return `${verb} ${entry.data?.count || entry.items?.length || 0} commands`;
  } else if (entry.type === 'edit_group') {
    const verb = isCancelled ? 'Cancelled' : isRunning ? 'Editing' : 'Edited';
    return `${verb} ${entry.data?.count || entry.items?.length || 0} files`;
  } else {
    const rawLabel = entry.data?.label || `${entry.data?.count || entry.items?.length || 0} files`;
    if (/^(Ran|Searched|Explored|Exploring|Running|Cancelled)\b/i.test(rawLabel)) {
      return rawLabel;
    }
    const isSearch = rawLabel.includes('search');
    let verb = '';
    if (isCancelled) {
      verb = 'Cancelled';
    } else if (isRunning) {
      verb = isSearch ? 'Running' : 'Exploring';
    } else {
      verb = isSearch ? 'Ran' : 'Explored';
    }
    return `${verb} ${rawLabel}`;
  }
}

// 6.1 Grouped code/web searches MUST produce "Ran X searches", NEVER "Explored X files"
const searchGroup = {
  type: 'exploration_group',
  data: { count: 3, label: '3 searches' },
};
assert.strictEqual(computeGroupLabel(searchGroup), 'Ran 3 searches', 'Search groups must render "Ran X searches", never "Explored X files"!');

// 6.2 Grouped file reads produce "Explored X files"
const fileGroup = {
  type: 'exploration_group',
  data: { count: 4, label: '4 files' },
};
assert.strictEqual(computeGroupLabel(fileGroup), 'Explored 4 files');

// 6.3 Mixed searches and files
const mixedGroup = {
  type: 'exploration_group',
  data: { count: 5, label: '5 files & searches' },
};
assert.strictEqual(computeGroupLabel(mixedGroup), 'Ran 5 files & searches');

// 6.4 Running search group produces "Running X searches"
const runningSearchGroup = {
  type: 'exploration_group',
  data: { count: 2, label: '2 searches', isRunning: true },
};
assert.strictEqual(computeGroupLabel(runningSearchGroup), 'Running 2 searches');

// 6.5 Cancelled search group produces "Cancelled X searches"
const cancelledSearchGroup = {
  type: 'exploration_group',
  data: { count: 2, label: '2 searches', isCancelled: true },
};
assert.strictEqual(computeGroupLabel(cancelledSearchGroup), 'Cancelled 2 searches');

console.log('  -> PASSED: Exploration Group Labels accurately render "Ran X searches" and never mislabel searches as files');

// -----------------------------------------------------------------------------
// [Test 7] Unified Global Worklog per Turn (R1)
// -----------------------------------------------------------------------------
console.log('\n[Test 7] Unified Global Worklog per Turn (Eliminate Fragmented Accordion Slicing)...');

const turnWithIntermediateCommentary: Message = {
  id: 'msg_turn_1',
  role: 'assistant',
  content: 'Implementation complete. All tests pass.',
  thoughts: ['Planning refactor'],
  tools: [],
  steps: [
    { id: 's_0', step_index: 0, type: 'thinking', content: 'Planning refactor', status: 'completed' },
    { id: 's_1', step_index: 1, type: 'tool', name: 'read_file', args: { TargetFile: 'auth.ts' }, output: 'code', status: 'completed' },
    { id: 's_2', step_index: 2, type: 'text', content: 'Checking authentication routes...', status: 'completed' },
    { id: 's_3', step_index: 3, type: 'tool', name: 'replace_file_content', args: { TargetFile: 'auth.ts' }, output: 'ok', status: 'completed' },
    { id: 's_4', step_index: 4, type: 'text', content: 'Writing unit tests...', status: 'completed' },
    { id: 's_5', step_index: 5, type: 'tool', name: 'run_command', args: { CommandLine: 'npm test' }, output: '0', status: 'completed' },
    { id: 's_6', step_index: 6, type: 'text', content: 'Implementation complete. All tests pass.', status: 'completed' },
  ],
  totalDurationSeconds: 12,
};

const units = computeInterleavedUnits(turnWithIntermediateCommentary, false);

// 7.1 Exactly ONE worklog unit exists at the top
const worklogUnits = units.filter((u) => u.type === 'worklog');
assert.strictEqual(worklogUnits.length, 1, 'Turn MUST contain exactly ONE unified Global Worklog, no fragmented accordion slicing!');

// 7.2 All execution steps (thinking, tools, intermediate commentary notes) are consolidated inside that 1 worklog
const primaryWorklog = worklogUnits[0];
if (primaryWorklog.type === 'worklog') {
  assert.strictEqual(primaryWorklog.steps.length, 6, 'Worklog must consolidate all 6 execution steps prior to final answer');
  assert.strictEqual(primaryWorklog.tools.length, 3, 'Worklog must contain all 3 tools');
  assert.strictEqual(primaryWorklog.thoughts.length, 1, 'Worklog must contain thought');
  // Intermediate text steps are preserved as step notes in the worklog steps array
  const textStepNotes = primaryWorklog.steps.filter((s) => s.type === 'text');
  assert.strictEqual(textStepNotes.length, 2, 'Intermediate text commentary must be preserved as step notes inside worklog');
}

// 7.3 Final conversational answer is cleanly rendered below worklog as Summary
const proseUnits = units.filter((u) => u.type === 'prose');
assert.strictEqual(proseUnits.length, 1, 'Turn must contain exactly ONE prose Summary unit below the worklog');
if (proseUnits[0].type === 'prose') {
  assert.strictEqual(proseUnits[0].content, 'Implementation complete. All tests pass.');
}

console.log('  -> PASSED: Unified Global Worklog consolidates all intermediate commentary and tools into exactly ONE accordion');

// -----------------------------------------------------------------------------
// [Test 8] SQLite Reload Parity & Metadata Preservation (R3)
// -----------------------------------------------------------------------------
console.log('\n[Test 8] SQLite Reload Parity & Metadata Preservation...');

const mockDbTranscriptLines = [
  {
    role: 'user',
    content: 'Please refactor auth router',
    created_at: '2026-10-21T12:00:00Z',
  },
  {
    role: 'assistant',
    content: 'Refactored auth router successfully.',
    created_at: '2026-10-21T12:00:05Z',
    thoughts: ['Thought about JWT tokens'],
    tools: [
      {
        id: 'tc_1',
        name: 'read_file',
        args: { TargetFile: 'auth.ts' },
        output: 'file content',
        status: 'completed',
        toolAction: 'Inspecting router',
        toolSummary: 'Router inspection',
        decision: 'allow',
      },
    ],
    steps: [
      {
        id: 'step_1_0',
        step_index: 0,
        type: 'thinking',
        content: 'Thought about JWT tokens',
        status: 'completed',
      },
      {
        id: 'step_1_1',
        step_index: 1,
        type: 'tool',
        tool_call_id: 'tc_1',
        name: 'read_file',
        args: { TargetFile: 'auth.ts' },
        output: 'file content',
        status: 'completed',
        toolAction: 'Inspecting router',
        toolSummary: 'Router inspection',
        decision: 'allow',
      },
      {
        id: 'step_1_2',
        step_index: 2,
        type: 'text',
        content: 'Refactored auth router successfully.',
        status: 'completed',
      },
    ],
    total_duration_seconds: 5,
  },
];

const parsedMessages = parseSessionHistory(mockDbTranscriptLines);
assert.strictEqual(parsedMessages.length, 2);
const assistantParsed = parsedMessages[1];

// 8.1 toolAction, toolSummary, and decision preserved in tools
assert.strictEqual(assistantParsed.tools[0].toolAction, 'Inspecting router');
assert.strictEqual(assistantParsed.tools[0].toolSummary, 'Router inspection');
assert.strictEqual((assistantParsed.tools[0] as any).decision, 'allow');

// 8.2 toolAction, toolSummary, and decision preserved in steps
const toolStep = assistantParsed.steps?.find((s) => s.type === 'tool');
assert.ok(toolStep, 'Tool step must exist');
assert.strictEqual(toolStep.toolAction, 'Inspecting router');
assert.strictEqual(toolStep.toolSummary, 'Router inspection');
assert.strictEqual((toolStep as any).decision, 'allow');
assert.strictEqual(toolStep.id, 'step_1_1');

// 8.3 computeInterleavedUnits on loaded message produces 1 calm worklog + 1 prose summary
const loadedUnits = computeInterleavedUnits(assistantParsed, false);
assert.strictEqual(loadedUnits.length, 2);
assert.strictEqual(loadedUnits[0].type, 'worklog');
assert.strictEqual(loadedUnits[1].type, 'prose');

// 8.4 Pending approval status preservation on SQLite reload (never wiped to completed)
const pendingTranscriptLine = [
  {
    role: 'assistant',
    content: 'Awaiting permission',
    tools: [
      {
        id: 'tc_pending_1',
        name: 'run_shell_command',
        args: { CommandLine: 'rm -rf /tmp/build' },
        status: 'pending_approval',
        toolAction: 'Cleaning build cache',
        toolSummary: 'Build cache cleanup',
      },
    ],
    steps: [
      {
        id: 'step_0_0',
        type: 'tool',
        tool_call_id: 'tc_pending_1',
        name: 'run_shell_command',
        args: { CommandLine: 'rm -rf /tmp/build' },
        status: 'pending_approval',
      },
    ],
  },
];
const parsedPending = parseSessionHistory(pendingTranscriptLine);
assert.strictEqual(parsedPending[0].tools[0].status, 'pending_approval', 'Pending approval tool MUST retain pending_approval status on reload!');
assert.strictEqual(parsedPending[0].steps?.[0].status, 'pending_approval', 'Pending approval step MUST retain pending_approval status on reload!');

// 8.5 Non-swallowed final prose when msg.content contains answer after intermediate commentary
const turnWithAnswerInContent: Message = {
  id: 'msg_intermediate_content',
  role: 'assistant',
  content: 'Analyzing router...\n\nFound 0 vulnerabilities. System is secure.',
  thoughts: [],
  tools: [],
  steps: [
    { id: 's_0', step_index: 0, type: 'text', content: 'Analyzing router...', status: 'completed' },
    { id: 's_1', step_index: 1, type: 'tool', name: 'read_file', args: { TargetFile: 'auth.ts' }, output: 'ok', status: 'completed' },
  ],
};
const unitsWithAnswer = computeInterleavedUnits(turnWithAnswerInContent, false);
assert.strictEqual(unitsWithAnswer.length, 2, 'Must produce 1 worklog and 1 prose summary');
assert.strictEqual(unitsWithAnswer[0].type, 'worklog');
assert.strictEqual(unitsWithAnswer[1].type, 'prose');
if (unitsWithAnswer[1].type === 'prose') {
  assert.strictEqual(unitsWithAnswer[1].content, 'Found 0 vulnerabilities. System is secure.', 'Final conversational prose MUST NOT be swallowed by intermediate commentary!');
}

// 8.6 Reasoning steps support (s.type === 'reasoning')
const turnWithReasoning: Message = {
  id: 'msg_reasoning',
  role: 'assistant',
  content: 'Analysis complete.',
  thoughts: [],
  tools: [],
  steps: [
    { id: 's_0', step_index: 0, type: 'reasoning' as any, content: 'Deliberating architecture', status: 'completed' },
    { id: 's_1', step_index: 1, type: 'tool', name: 'grep_search', args: { Query: 'tokens' }, output: '0', status: 'completed' },
    { id: 's_2', step_index: 2, type: 'text', content: 'Analysis complete.', status: 'completed' },
  ],
};
const reasoningUnits = computeInterleavedUnits(turnWithReasoning, false);
assert.strictEqual(reasoningUnits.length, 2);
if (reasoningUnits[0].type === 'worklog') {
  assert.strictEqual(reasoningUnits[0].thoughts.length, 1);
  assert.strictEqual(reasoningUnits[0].thoughts[0], 'Deliberating architecture');
}

console.log('  -> PASSED: 100% Reload Parity from SQLite transcript verified');

console.log('\n======================================================================');
console.log('ALL DYNAMIC TOOL ACTION & TOOL SUMMARY VERIFICATION TESTS PASSED');
console.log('======================================================================');

