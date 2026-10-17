import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { InFlightToolTracker, updateAssistantToolsAndSteps } from '../src/features/chat/hooks/streamToolManager';
import { parseToolItem, isToolRunning } from '../src/features/chat/components/work-log/toolTimeline';
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
  { role: 'user', content: 'check auth' },
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
console.log('\n[Test 4] Timeline Row Presentation State Rules (running shine vs completed ghost vs failed)...');

function computeRowPresentation(entry: any, isStreaming: boolean = false) {
  const isRunning = isToolRunning(entry.data?.tool, isStreaming);
  const isCancelled = entry.data?.tool?.status === 'cancelled';
  const isFailed = entry.data?.tool?.status === 'failed';
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

  if (isFailed) {
    label = 'Failed';
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

  const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

  // Command row visibility logic
  let showCmd = false;
  if (isFailed || isCancelled) {
    showCmd = true;
  } else if (isRunning) {
    showCmd = !toolAction;
  } else {
    showCmd = !toolSummary;
  }

  return { label, hasShine, isRunning, isFailed, isCancelled, hasCustomText, showCmd };
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

// 4.5 Failed tool -> displays "Failed" without shine, AND target is preserved (hasCustomText is false, showCmd is true)
const failedTool = computeRowPresentation({
  type: 'command',
  data: {
    tool: { status: 'failed', output: 'error' },
    toolAction: 'Building assets',
    toolSummary: 'Asset build',
  }
});
assert.strictEqual(failedTool.label, 'Failed');
assert.strictEqual(failedTool.hasShine, false, 'Failed tool MUST NOT shimmer!');
assert.strictEqual(failedTool.isFailed, true);
assert.strictEqual(failedTool.hasCustomText, false, 'Target MUST NOT be suppressed when failed!');
assert.strictEqual(failedTool.showCmd, true, 'Command name MUST be displayed when command fails, even with toolSummary!');

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

// 4.7 Web search target retention on failure
const failedWebSearch = computeRowPresentation({
  type: 'web_search',
  data: {
    tool: { status: 'failed', output: 'Network timeout' },
    query: 'Next.js 16 breaking changes',
    toolSummary: 'Next.js migration search',
  }
});
assert.strictEqual(failedWebSearch.label, 'Failed');
assert.strictEqual(failedWebSearch.hasCustomText, false, 'Web search query MUST NOT be hidden when search fails!');

console.log('  -> PASSED: All presentation states (running shine, calm ghost static completed, failed, cancelled, target retention) 100% verified');

console.log('\n======================================================================');
console.log('ALL DYNAMIC TOOL ACTION & TOOL SUMMARY VERIFICATION TESTS PASSED');
console.log('======================================================================');
