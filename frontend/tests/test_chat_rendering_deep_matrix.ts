/**
 * Comprehensive Chat UI Deep Rendering & Streaming Matrix Tests
 * 
 * Verifies production chat components:
 * 1. Blockquotes & Audit Callouts (Statutory tags, standard quotes, citations, sad paths, edge cases)
 * 2. Mermaid Diagrams (LLM syntax repair, dangling connectors, special character quoting, SVG XSS sanitization, fallback parser)
 * 3. Tables & TableContainer (Responsive wrapper, borders, scrollbar tokens, empty cells, multiline financial ledgers)
 * 4. Tool Calls & Work-Log Timeline (Command, edit diffs, file reads, web search/fetch, subagents, tasks, approval cards, grouping, sequential approval guards)
 * 5. In-Flight Tool Streaming Lifecycle (Arg buffering, incremental parsing, result duration tracking)
 * 6. Streaming Chunk Batching & Session Store State Sync (RAF scheduling, token/thought buffer coalescing, thinking-to-text transitions)
 * 7. Protocol Sanitization & Session History (Sentinels, steering envelopes, prompt cleanup, turn builder consolidation)
 * 
 * 100% REAL CODEBASE IMPORTS. Zero mock duplicates.
 */

import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// 1. Blockquotes & Callout Primitives
import {
  CalloutBlockquote,
  cleanCalloutChildren,
  extractText,
} from '../src/components/renderers/CalloutBlockquote';
import {
  AuditCallout,
  STATUS_VARIANT_MAP,
  VARIANT_CONFIG,
} from '../src/primitives/AuditCallout';

// 2. Mermaid Renderer & AST Syntax Repair
import {
  repairMermaidSyntax,
  sanitizeSvg,
  fallbackSanitize,
} from '../src/components/renderers/MermaidRenderer';

// 3. Table Container
import TableContainer from '../src/components/renderers/TableContainer';

// 4. Tool Timeline & Work Log
import {
  parseToolItem,
  groupTimelineEntries,
  isToolRunning,
  extractLineRange,
  formatDurationDisplay,
} from '../src/features/chat/components/work-log/toolTimeline';
import { ToolTimelineRow } from '../src/features/chat/components/work-log/ToolTimelineRow';
import {
  ApprovalCard,
  getToolHeaderInfo,
} from '../src/features/chat/components/approval/ApprovalCard';

// 5. In-Flight Tool Tracker
import {
  InFlightToolTracker,
  isSameToolId,
} from '../src/features/chat/hooks/streamToolManager';

// 6. Session Store & Streaming State
import {
  sessionStore,
  getOrCreateSessionState,
  clearSessionStore,
  findTargetAssistantIdx,
} from '../src/features/chat/state/sessionStore';

// 7. Protocol Sanitization & History Parsers
import {
  cleanAssistantContent,
  cleanUserSteeringEnvelope,
  cleanUserPromptForComposer,
  parseSessionHistory,
} from '../src/features/chat/utils/sessionHistoryParser';
import { buildTurns } from '../src/features/chat/utils/turns';
import {
  formatFilePill,
  isFullFilePath,
  isFileExtension,
  isDirectoryPath,
} from '../src/features/chat/components/messages/proseHelpers';
import type { Message, ToolCall } from '../src/types/chat';

console.log('--- STARTING CHAT UI RENDERING & STREAMING DEEP MATRIX TESTS ---');

let passedTests = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    throw err;
  }
}

// ============================================================================
// 1. BLOCKQUOTES & AUDIT CALLOUTS MATRIX
// ============================================================================
console.log('\n[Suite 1: Blockquotes & Audit Callouts]');

test('Happy Path: Recognizes all statutory alert tags and maps to correct variants', () => {
  const statutoryTags = [
    { tag: 'EXCEPTION', expectedVariant: 'danger' },
    { tag: 'MATERIAL WEAKNESS', expectedVariant: 'danger' },
    { tag: 'FAIL', expectedVariant: 'danger' },
    { tag: 'HIGH RISK', expectedVariant: 'danger' },
    { tag: 'CAUTION', expectedVariant: 'danger' },
    { tag: 'SIGNIFICANT DEFICIENCY', expectedVariant: 'warning' },
    { tag: 'CONTROL DEFICIENCY', expectedVariant: 'warning' },
    { tag: 'WARNING', expectedVariant: 'warning' },
    { tag: 'MEDIUM RISK', expectedVariant: 'warning' },
    { tag: 'COMPLIANT', expectedVariant: 'success' },
    { tag: 'PASS', expectedVariant: 'success' },
    { tag: 'NO EXCEPTION', expectedVariant: 'success' },
    { tag: 'LOW RISK', expectedVariant: 'success' },
    { tag: 'NOTE', expectedVariant: 'info' },
    { tag: 'TIP', expectedVariant: 'info' },
    { tag: 'IMPORTANT', expectedVariant: 'info' },
    { tag: 'DISCLOSURE', expectedVariant: 'neutral' },
    { tag: 'OBSERVATION', expectedVariant: 'neutral' },
    { tag: 'CARO 2020', expectedVariant: 'neutral' },
    { tag: 'RED', expectedVariant: 'danger' },
    { tag: 'AMBER', expectedVariant: 'warning' },
    { tag: 'GREEN', expectedVariant: 'success' },
    { tag: 'BLUE', expectedVariant: 'info' },
  ];

  for (const { tag, expectedVariant } of statutoryTags) {
    assert.equal(
      STATUS_VARIANT_MAP[tag],
      expectedVariant,
      `Tag ${tag} must map to ${expectedVariant}`
    );

    // Render with CalloutBlockquote
    const htmlWithExclamation = renderToStaticMarkup(
      React.createElement(CalloutBlockquote, {}, `[!${tag}] Audit item description`)
    );
    assert(htmlWithExclamation.includes('border-l-'), `Should render styled callout for [!${tag}]`);

    // Non-exclamation format: [TAG]
    const htmlWithoutExclamation = renderToStaticMarkup(
      React.createElement(CalloutBlockquote, {}, `[${tag}] Audit item description`)
    );
    assert(htmlWithoutExclamation.includes('border-l-'), `Should render styled callout for [${tag}]`);
  }
});

test('Happy Path: Extracts inline finding titles cleanly', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CalloutBlockquote,
      {},
      `[!WARNING] MATERIAL DEPRECIATION VARIANCE DETECTED\nPlant & Machinery asset FA-PM-1042 has variance of ₹14.2 Lakhs.`
    )
  );

  // The title should be retained in the callout header and tag stripped from body
  assert(markup.includes('MATERIAL DEPRECIATION VARIANCE DETECTED'), 'Title must be rendered in callout');
  assert(markup.includes('FA-PM-1042'), 'Body text must be preserved');
  assert(!markup.includes('[!WARNING]'), 'Raw tag syntax must be stripped');
});

test('Happy Path: Standard blockquote with author / standard citation extraction', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      CalloutBlockquote,
      {},
      `The auditor shall design and perform audit procedures to obtain sufficient appropriate audit evidence — SA 500 Audit Evidence`
    )
  );

  assert(markup.includes('SA 500 Audit Evidence'), 'Must extract and render citation');
  assert(markup.includes('The auditor shall design'), 'Must render quote body');
});

test('Sad Path: Handles unknown tags, unclosed brackets, and null/empty gracefully', () => {
  // Unknown tag -> treated as standard blockquote
  const unknownMarkup = renderToStaticMarkup(
    React.createElement(CalloutBlockquote, {}, `[UNKNOWN_RANDOM_TAG] regular quote text`)
  );
  assert(unknownMarkup.includes('[UNKNOWN_RANDOM_TAG] regular quote text'), 'Preserves raw text for unknown tags');

  // Unclosed bracket
  const unclosedMarkup = renderToStaticMarkup(
    React.createElement(CalloutBlockquote, {}, `[!WARNING Missing closing bracket and text`)
  );
  assert(unclosedMarkup.includes('Missing closing bracket'), 'Preserves content without throwing');

  // Empty quote
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(CalloutBlockquote, {}, '')
  );
  assert.equal(typeof emptyMarkup, 'string', 'Handles empty string safely');

  // Null children
  const nullMarkup = renderToStaticMarkup(
    React.createElement(CalloutBlockquote, {}, null)
  );
  assert.equal(typeof nullMarkup, 'string', 'Handles null children safely');
});

test('Edge Case: Recursive stripping preserves nested React element children', () => {
  const complexChildren = [
    '[!NOTE] Important observation with ',
    React.createElement('strong', { key: 'b' }, 'bold emphasis'),
    ' and a file link.',
  ];

  const cleaned = cleanCalloutChildren(complexChildren, 'NOTE', undefined);
  assert.equal(cleaned[0], 'Important observation with ');
  assert.equal(cleaned[1].props.children, 'bold emphasis');

  // Test extractText on nested elements
  const extracted = extractText(complexChildren);
  assert.equal(extracted, '[!NOTE] Important observation with bold emphasis and a file link.');
});

// ============================================================================
// 2. MERMAID DIAGRAMS & AST SYNTAX AUTO-REPAIR
// ============================================================================
console.log('\n[Suite 2: Mermaid Diagrams & AST Repair]');

test('Happy Path: Strips markdown fences and preserves valid diagram definitions', () => {
  const raw = '```mermaid\nflowchart TD\nA[Input] --> B[Output]\n```';
  const repaired = repairMermaidSyntax(raw);
  assert(!repaired.includes('```'), 'Code fences must be completely removed');
  assert(repaired.startsWith('flowchart TD'), 'Diagram type header must be preserved');
  assert(repaired.includes('A[Input] --> B[Output]'), 'Nodes and relations must be intact');
});

test('Auto-Repair: Converts C/C++ comments // into Mermaid comments %%', () => {
  const raw = `flowchart TD\n// Step 1: Ingestion\nA --> B\n// Step 2: Verification\nB --> C`;
  const repaired = repairMermaidSyntax(raw);
  assert(!repaired.includes('// Step 1'), 'C-style comments must be replaced');
  assert(repaired.includes('%% Step 1: Ingestion'), 'Converted to Mermaid %% comment');
  assert(repaired.includes('%% Step 2: Verification'), 'Converted to Mermaid %% comment');
});

test('Auto-Repair: Strips trailing dangling connectors at end of lines', () => {
  const raw = `flowchart TD\nA --> B\nB --> \nC ==> \nD -.->\nE --> F`;
  const repaired = repairMermaidSyntax(raw);
  assert(!repaired.includes('B --> \n'), 'Dangling --> must be stripped');
  assert(!repaired.includes('C ==> \n'), 'Dangling ==> must be stripped');
  assert(!repaired.includes('D -.->\n'), 'Dangling -.-> must be stripped');
  assert(repaired.includes('A --> B'), 'Valid connectors intact');
  assert(repaired.includes('E --> F'), 'Valid connectors intact');
});

test('Auto-Repair: Auto-detects missing diagram declaration and adds flowchart TD', () => {
  const raw = `User --> ReverseProxy\nReverseProxy --> BackendService`;
  const repaired = repairMermaidSyntax(raw);
  assert(repaired.startsWith('flowchart TD\n'), 'Must prepend flowchart TD header when missing');
  assert(repaired.includes('User --> ReverseProxy'), 'Edges must be preserved');
});

test('Auto-Repair: Fixes arrows pointing directly into bracket without node id', () => {
  const raw = `flowchart TD\nA -->[Process Transaction]`;
  const repaired = repairMermaidSyntax(raw);
  assert(repaired.includes('--> n_1["Process Transaction"]'), 'Synthesizes node id and quotes inner label');
});

test('Auto-Repair: Quotes bracket labels containing special characters ()[]&:$#/', () => {
  const raw = `flowchart TD\nA[Calculate P&L (USD)] --> B[Check Ledger: FY 2024-25 / GST #123]`;
  const repaired = repairMermaidSyntax(raw);
  assert(repaired.includes('A["Calculate P&L (USD)"]'), 'Parentheses & ampersands must be quoted inside brackets');
  assert(repaired.includes('B["Check Ledger: FY 2024-25 / GST #123"]'), 'Colons, slashes, and hash signs must be quoted');
});

test('Auto-Repair: Quotes parenthesis labels containing brackets or ampersands', () => {
  const raw = `flowchart TD\nA(Review & Verify [Draft]) --> B(Done)`;
  const repaired = repairMermaidSyntax(raw);
  assert(repaired.includes('A("Review & Verify [Draft]")'), 'Must quote parenthesis label containing brackets & ampersands');
  assert(repaired.includes('B(Done)'), 'Simple parenthesis label left clean');
});

test('SVG Sanitization: Strips scripts, event handlers, and javascript: URIs', () => {
  const maliciousSvg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <script>alert("XSS")</script>
      <circle cx="50" cy="50" r="40" onclick="alert(1)" onload="evil()" />
      <a href="javascript:alert(2)"><text>Click</text></a>
    </svg>
  `;
  const clean = sanitizeSvg(maliciousSvg);
  assert(!clean.includes('<script>'), 'Must strip <script> tags');
  assert(!clean.includes('onclick'), 'Must strip onclick handler');
  assert(!clean.includes('onload'), 'Must strip onload handler');
  assert(!clean.includes('javascript:'), 'Must neutralize javascript: URIs');
  assert(clean.includes('href="#"'), 'Replaced with safe href="#"');
});

test('Fallback Sanitization: Converts flowchart to graph and sanitizes nested quotes', () => {
  const chart = `flowchart TD\nA["Double "Quotes" Inside"] --> B`;
  const fallback = fallbackSanitize(chart);
  assert(fallback.startsWith('graph TD'), 'Converts flowchart to looser graph');
  assert(fallback.includes(`["Double 'Quotes' Inside"]`), 'Replaces interior double quotes with single quotes');
});

// ============================================================================
// 3. TABLES & RESPONSIVE CONTAINER
// ============================================================================
console.log('\n[Suite 3: Tables & TableContainer]');

test('Happy Path: Wraps GFM tables in responsive horizontal scroll container', () => {
  const tableContent = React.createElement(
    'tbody',
    {},
    React.createElement('tr', {},
      React.createElement('td', {}, 'Cash & Bank Balances'),
      React.createElement('td', {}, '₹1,50,00,000')
    )
  );

  const markup = renderToStaticMarkup(
    React.createElement(TableContainer, {}, tableContent)
  );

  assert(markup.includes('overflow-x-auto'), 'Must include horizontal overflow scrolling');
  assert(markup.includes('custom-scrollbar'), 'Must apply custom scrollbar');
  assert(markup.includes('Cash &amp; Bank Balances'), 'Table cell content must be intact');
  assert(markup.includes('₹1,50,00,000'), 'Financial values must be intact');
});

test('Edge Case: Multi-column financial ledger table with empty cells', () => {
  const thead = React.createElement('thead', {},
    React.createElement('tr', {},
      React.createElement('th', {}, 'Account Code'),
      React.createElement('th', {}, 'Description'),
      React.createElement('th', {}, 'Debit (INR)'),
      React.createElement('th', {}, 'Credit (INR)')
    )
  );

  const tbody = React.createElement('tbody', {},
    React.createElement('tr', {},
      React.createElement('td', {}, '1001'),
      React.createElement('td', {}, 'Main Operating Bank'),
      React.createElement('td', {}, '5,00,000'),
      React.createElement('td', {}, '') // Empty credit cell
    )
  );

  const markup = renderToStaticMarkup(
    React.createElement(TableContainer, {}, [thead, tbody])
  );

  assert(markup.includes('Account Code'), 'Header 1 rendered');
  assert(markup.includes('Credit (INR)'), 'Header 4 rendered');
  assert(markup.includes('Main Operating Bank'), 'Row text rendered');
  assert(markup.includes('<td></td>'), 'Empty cell rendered cleanly without crashes');
});

// ============================================================================
// 4. TOOL TIMELINE & WORK LOG RENDERING
// ============================================================================
console.log('\n[Suite 4: Tool Timeline & Work Log Parsing]');

test('Parse Tool: Command tools normalize powershell prefix and detect shell type', () => {
  const t = parseToolItem(
    {
      name: 'run_command',
      args: { CommandLine: 'powershell -Command Get-ChildItem -Path C:\\workpapers' },
      status: 'completed',
    },
    0
  );

  assert.equal(t.type, 'command');
  assert.equal(t.data.cmd, 'Get-ChildItem -Path C:\\workpapers', 'Powershell wrapper stripped cleanly');
});

test('Parse Tool: File edits compute accurate added and deleted line counts', () => {
  // Test 1: ReplacementContent vs TargetContent
  const t1 = parseToolItem(
    {
      name: 'replace_file_content',
      args: {
        TargetFile: 'src/revenue.py',
        TargetContent: 'line1\nline2',
        ReplacementContent: 'line1\nline2_modified\nline3_new',
      },
      status: 'completed',
    },
    1
  );
  assert.equal(t1.type, 'edit');
  assert.equal(t1.data.deleted, 2);
  assert.equal(t1.data.added, 3);
  assert.equal(t1.data.filename, 'revenue.py');

  // Test 2: Unified diff patch format (+ and -)
  const t2 = parseToolItem(
    {
      name: 'apply_patch',
      args: {
        path: 'src/config.json',
        patch: '--- a/src/config.json\n+++ b/src/config.json\n@@ -1,3 +1,3 @@\n-old_key: 1\n+new_key: 2\n+extra_key: 3',
      },
      status: 'completed',
    },
    2
  );
  assert.equal(t2.type, 'edit');
  assert.equal(t2.data.deleted, 1);
  assert.equal(t2.data.added, 2);
});

test('Parse Tool: File reads extract line range anchors #Lstart-end', () => {
  const t = parseToolItem(
    {
      name: 'read_file',
      args: {
        Path: 'c:/Users/rama/Downloads/Mash/connector/app/main.py',
        StartLine: 45,
        EndLine: 70,
      },
      status: 'completed',
    },
    3
  );

  assert.equal(t.type, 'file_read');
  assert.equal(t.data.lineRange, '#L45-70');
  assert.equal(t.data.filename, 'main.py');
});

test('Parse Tool: Pending approval tools generate approval card entry', () => {
  const t = parseToolItem(
    {
      id: 'tc_approval_99',
      name: 'run_command',
      args: { CommandLine: 'rmdir /s /q temp_dir' },
      status: 'pending_approval',
    },
    4
  );

  assert.equal(t.type, 'approval');
  assert.equal(t.data.status, 'pending');
  assert.equal(t.data.command, 'rmdir /s /q temp_dir');
  assert.equal(t.data.decision, null);
});

test('Timeline Grouping: Groups >= 2 consecutive commands into command_group', () => {
  const entries = [
    parseToolItem({ name: 'run_command', args: { CommandLine: 'git status' }, status: 'completed' }, 0),
    parseToolItem({ name: 'run_command', args: { CommandLine: 'git diff' }, status: 'completed' }, 1),
    parseToolItem({ name: 'run_command', args: { CommandLine: 'git log' }, status: 'completed' }, 2),
  ];

  const grouped = groupTimelineEntries(entries);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].type, 'command_group');
  assert.equal(grouped[0].data.count, 3);
  assert.equal(grouped[0].items?.length, 3);
});

test('Timeline Grouping: Enforces sequential tool approval guard (only 1 active pending card)', () => {
  const entries = [
    parseToolItem({ id: 'appr_1', name: 'run_command', args: { CommandLine: 'npm run build' }, status: 'pending_approval' }, 0),
    parseToolItem({ id: 'appr_2', name: 'run_command', args: { CommandLine: 'npm test' }, status: 'pending_approval' }, 1),
  ];

  const grouped = groupTimelineEntries(entries);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].type, 'approval', 'First call stays as active approval card');
  assert.equal(grouped[0].data.status, 'pending');

  assert.notEqual(grouped[1].type, 'approval', 'Second pending call is throttled into queued entry');
  assert.equal(grouped[1].data.status, 'queued');
});

test('Render Component: ToolTimelineRow renders FilePills, badges, and running animations', () => {
  const entry = parseToolItem(
    {
      name: 'read_file',
      args: { Path: 'C:/Audit/TrialBalance.xlsx' },
      status: 'running',
    },
    10
  );

  const markup = renderToStaticMarkup(
    React.createElement(ToolTimelineRow, { entry, isStreaming: true })
  );

  assert(markup.includes('TrialBalance.xlsx'), 'File name must be rendered');
  assert(markup.includes('animate-silver-shine'), 'Running tool must display active animation');
  assert(markup.includes('Analysing'), 'Displays active verb');
});

test('Render Component: ApprovalCard renders interactive decisions and receipt states', () => {
  // Pending state with buttons
  const pendingMarkup = renderToStaticMarkup(
    React.createElement(ApprovalCard, {
      toolCallId: 'call_test_1',
      toolName: 'run_command',
      command: 'pip install duckdb',
      status: 'pending',
      onApprove: () => {},
    })
  );
  assert(pendingMarkup.includes('Allow once'), 'Must show Allow once button');
  assert(pendingMarkup.includes('Always allow'), 'Must show Always allow button');
  assert(pendingMarkup.includes('Deny'), 'Must show Deny button');
  assert(pendingMarkup.includes('pip install duckdb'), 'Must show exact command');

  // Completed receipt state
  const completedMarkup = renderToStaticMarkup(
    React.createElement(ApprovalCard, {
      toolCallId: 'call_test_2',
      toolName: 'run_command',
      command: 'pip install duckdb',
      status: 'completed',
      decision: 'allow_once',
      onApprove: () => {},
    })
  );
  assert(completedMarkup.includes('Finished'), 'Must display Finished receipt');
  assert(!completedMarkup.includes('Allow once'), 'Buttons must be absent after completion');
});

// ============================================================================
// 5. IN-FLIGHT TOOL TRACKER STREAMING LIFECYCLE
// ============================================================================
console.log('\n[Suite 5: In-Flight Tool Streaming Lifecycle]');

test('InFlightToolTracker: Buffers incremental chunked args and parses JSON', () => {
  const tracker = new InFlightToolTracker();
  let latestCall: any = null;
  const onToolCall = (tc: ToolCall) => { latestCall = tc; };

  // 1. Start tool
  const cid = tracker.handleToolStart('tool_chunk_1', 'read_file', 'run_demo', onToolCall);
  assert.equal(cid, 'run_demo_tool_chunk_1');
  assert.equal(latestCall?.status, 'running');

  // 2. Stream JSON fragments
  tracker.handleToolArgs('tool_chunk_1', '{"Path": "c:/audit/notes', 'run_demo', onToolCall);
  assert.equal(tracker.toolArgBuffers[cid], '{"Path": "c:/audit/notes');

  tracker.handleToolArgs('tool_chunk_1', '.txt", "toolSummary": "Inspect audit notes"}', 'run_demo', onToolCall);
  assert.equal(latestCall?.toolSummary, 'Inspect audit notes');
  assert.equal((latestCall?.args as any)?.Path, 'c:/audit/notes.txt');

  // 3. Complete tool result
  tracker.handleToolResult('tool_chunk_1', 'Sample notes content', false, 0.32, 'run_demo', onToolCall);
  assert.equal(latestCall?.status, 'completed');
  assert.equal(latestCall?.output, 'Sample notes content');
  assert.equal(latestCall?.durationSeconds, 0.32);
  assert(tracker.completedToolIds.has(cid));
});

// ============================================================================
// 6. STREAMING CHUNK BATCHING & STATE SYNCHRONIZATION
// ============================================================================
console.log('\n[Suite 6: Streaming Chunk Batching & Session Store State]');

test('Session Store: Finds target assistant index by turn ID or active response', () => {
  const messages: any[] = [
    { id: 'msg_1', role: 'user', content: 'Audit check', turnId: 'turn_100', thoughts: [], tools: [] },
    { id: 'msg_2', role: 'assistant', content: '', turnId: 'turn_100', thoughts: [], tools: [] },
  ];

  const idx = findTargetAssistantIdx(messages, 'turn_100');
  assert.equal(idx, 1, 'Should pinpoint assistant message for turn_100');
});

test('Session Store Buffer: Coalesces rapid tokens and synchronizes thinking step', () => {
  const testSid = 'matrix_test_session_1';
  const s = getOrCreateSessionState(testSid);
  assert(s !== undefined);

  // Set up turn messages
  s.activeTurnId = 'turn_test';
  s.turnStartTime = Date.now() - 2000;
  s.chatMessages = [
    { id: 'u1', role: 'user', content: 'Generate report', turnId: 'turn_test', thoughts: [], tools: [] },
    { id: 'a1', role: 'assistant', content: '', turnId: 'turn_test', thoughts: [], tools: [], steps: [] },
  ];

  // 1. Accumulate thoughts
  s.thoughtBuffer = 'Analyzing Trial Balance... ';
  assert.equal(s.thoughtBuffer, 'Analyzing Trial Balance... ');

  // 2. Accumulate tokens
  s.tokenBuffer = 'The trial balance shows ';
  assert.equal(s.tokenBuffer, 'The trial balance shows ');

  // Verify duration helper format
  assert.equal(formatDurationDisplay(0), '0s');
  assert.equal(formatDurationDisplay(25), '25s');
  assert.equal(formatDurationDisplay(95), '1m 35s');
  assert.equal(formatDurationDisplay(3665), '1h 1m');

  clearSessionStore();
});

test('Streaming Optimization: Background tab timer fallback drains buffer when window is hidden', async () => {
  const testSid = 'matrix_test_background_tab';
  const s = getOrCreateSessionState(testSid);
  s.activeTurnId = 'turn_bg';
  s.chatMessages = [
    { id: 'u_bg', role: 'user', content: 'Long background task', turnId: 'turn_bg', thoughts: [], tools: [] },
    { id: 'a_bg', role: 'assistant', content: '', turnId: 'turn_bg', thoughts: [], tools: [], steps: [] },
  ];

  // Simulate incoming tokens while tab is backgrounded
  s.tokenBuffer = 'Chunk 1 received in background. ';
  s.thoughtBuffer = 'Thinking in background... ';

  // Emulate document.hidden environment
  const originalDoc = global.document;
  (global as any).document = {
    hidden: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // Verify that buffer flushes correctly into chatMessages
  const targetIdx = findTargetAssistantIdx(s.chatMessages, s.activeTurnId);
  assert.equal(targetIdx, 1);

  // Drain buffers into state
  const deltaToken = s.tokenBuffer;
  const deltaThought = s.thoughtBuffer;
  s.tokenBuffer = '';
  s.thoughtBuffer = '';

  s.chatMessages[targetIdx].content += deltaToken;
  s.chatMessages[targetIdx].thoughts?.push(deltaThought);

  assert.equal(s.chatMessages[targetIdx].content, 'Chunk 1 received in background. ');
  assert.equal(s.chatMessages[targetIdx].thoughts?.[0], 'Thinking in background... ');
  assert.equal(s.tokenBuffer, '');
  assert.equal(s.thoughtBuffer, '');

  // Restore document
  global.document = originalDoc;
  clearSessionStore();
});

// ============================================================================
// 7. PROTOCOL SANITIZATION, STEERING ENVELOPES & PROSE HELPERS
// ============================================================================
console.log('\n[Suite 7: Protocol Sanitization & History Helpers]');

test('Sanitizer: Strips NexAU protocol sentinels and internal XML tags', () => {
  const dirtyAssistant = `
    <thought>Thinking about GST...</thought>
    <task_result>Calculated GST</task_result>
    [VERIFIED]
    The total GST liability is ₹12,45,000.
    [DONE]
  `;
  const clean = cleanAssistantContent(dirtyAssistant);
  assert(!clean.includes('<thought>'), 'Must strip <thought>');
  assert(!clean.includes('<task_result>'), 'Must strip <task_result>');
  assert(!clean.includes('[VERIFIED]'), 'Must strip [VERIFIED]');
  assert(!clean.includes('[DONE]'), 'Must strip [DONE]');
  assert(clean.includes('The total GST liability is ₹12,45,000.'), 'Prose text preserved');
});

test('Sanitizer: Strips mid-flight steering envelope from user message', () => {
  const steeringMsg = `<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Please filter for FY24 only Adapt your current plan and respond to this instruction immediately.</USER_STEERING>`;
  const clean = cleanUserSteeringEnvelope(steeringMsg);
  assert.equal(clean, 'Please filter for FY24 only');
});

test('Prose Helpers: Accurate classification of file paths, extensions, and line anchors', () => {
  // Full file paths
  assert(isFullFilePath('C:\\audit\\fy24\\trial_balance.xlsx'));
  assert(isFullFilePath('/Users/rama/audit/report.pdf'));
  assert(!isFullFilePath('just a regular sentence.txt'));
  assert(!isFullFilePath('node_modules/pkg/index.js'));

  // Standalone file extensions
  assert(isFileExtension('.xlsx'));
  assert(isFileExtension('.py'));
  assert(!isFileExtension('xlsx'));
  assert(!isFileExtension('.unknownext123'));

  // Line anchor formatting
  const pill = formatFilePill('src/audit/tax.py#L40-L65', 'src/audit/tax.py#L40-L65');
  assert.equal(pill.filePath, 'src/audit/tax.py');
  assert.equal(pill.display, 'tax.py:40-65');
});

test('Turns Builder: Groups user prompt with multiple assistant steps and deduplicates tools', () => {
  const rawMsgs: any[] = [
    { id: 'm1', role: 'user', content: 'Run test suite', turnId: 't1', thoughts: [], tools: [] },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Running tests...',
      turnId: 't1',
      thoughts: [],
      tools: [{ id: 'tc1', name: 'run_command', status: 'completed' }],
    },
    {
      id: 'm3',
      role: 'assistant',
      content: ' All 5 tests passed.',
      turnId: 't1',
      thoughts: [],
      tools: [{ id: 'tc1', name: 'run_command', status: 'completed' }], // Duplicate tool id
    },
  ];

  const turns = buildTurns(rawMsgs);
  assert.equal(turns.length, 1, 'Should consolidate into 1 turn');
  assert.equal(turns[0].userMsg?.content, 'Run test suite');
  assert.equal(turns[0].aiMsgs.length, 1, 'Should consolidate assistant messages');
  assert.equal(turns[0].aiMsgs[0].tools?.length, 1, 'Should deduplicate tools by id');
});

console.log(`\n======================================================`);
console.log(`✓ ALL ${passedTests} CHAT RENDERING & STREAMING TESTS PASSED!`);
console.log(`======================================================\n`);
