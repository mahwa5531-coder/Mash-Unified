#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const testSuites = [
  { name: 'Chat Scenarios', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_chat_scenarios.mjs'] },
  { name: 'Right Sidebar Logic', cmd: 'node', args: ['tests/test_right_sidebar_logic.cjs'] },
  { name: 'Virtualized Desktop Optimizations', cmd: 'npx', args: ['tsx', 'tests/test_virtualized_desktop_optimizations.mjs'] },
  { name: 'RAM Memory & Virtualization Coverage', cmd: 'npx', args: ['tsx', 'tests/test_ram_memory_and_virtualization_coverage.mjs'] },
  { name: 'DSA Frontend Optimizations', cmd: 'node', args: ['tests/test_dsa_frontend_optimizations.mjs'] },
  { name: 'Error Classification', cmd: 'npx', args: ['tsx', 'tests/test_error_classification.ts'] },
  { name: 'Stream Retry & Recovery', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_stream_retry_and_recovery.ts'] },
  { name: 'File Viewer & Composer', cmd: 'node', args: ['tests/test_file_viewer_and_composer.mjs'] },
  { name: 'Clean Title & Tags', cmd: 'npx', args: ['tsx', 'tests/test_clean_title_and_tags.ts'] },
  { name: 'Tool Actions & Timeline', cmd: 'npx', args: ['tsx', 'tests/test_tool_actions_and_timeline.ts'] },
  { name: 'Deletion Error Handling', cmd: 'npx', args: ['tsx', 'tests/test_deletion_error_handling.ts'] },
  { name: 'Execution Status Disclosure', cmd: 'node', args: ['tests/test_execution_status_disclosure.mjs'] },
  { name: 'Stream Idempotency & CRLF', cmd: 'npx', args: ['tsx', 'tests/test_stream_idempotency_and_crlf.ts'] },
  { name: 'Viewport Windowing & DOM Culling', cmd: 'npx', args: ['tsx', 'tests/test_viewport_windowing_and_dom_culling.ts'] },
  { name: 'Reverse Scroll & Island Deferral', cmd: 'npx', args: ['tsx', 'tests/test_reverse_scroll_and_island_deferral.ts'] },
  { name: 'Attachment Limit', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_attachment_limit.ts'] },
  { name: 'Sidebar Scenarios', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_sidebar_scenarios.ts'] },
  { name: 'Adversarial Challenger M1 Token Stream', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/adversarial_challenger_m1_token_and_stream.ts'] },
  { name: 'Challenger M1 Rep Streaming Stability', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/challenger_m1_rep_streaming_stability.ts'] },
  { name: 'Multi-Tab Concurrency', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_multi_tab_concurrency.ts'] },
  { name: 'Fuzz Viewer Tabs & Cache', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/fuzz_viewer_tabs_and_cache.ts'] },
  { name: 'Virtuoso Chat Contracts', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_virtuoso_chat_contracts.ts'] },
  { name: 'Project Scope Selector', cmd: 'node', args: ['tests/test_project_scope_selector.mjs'] },
  { name: 'Electron PDF Wiring', cmd: 'node', args: ['tests/test_electron_pdf_wiring.mjs'] },
  { name: 'Frontend Complete Matrix', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_frontend_complete_matrix.ts'] },
  { name: 'Chat Rendering Deep Matrix', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_chat_rendering_deep_matrix.ts'] },
  { name: 'Senior Challenger Full Spectrum', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/senior_challenger_full_spectrum.ts'] },
  { name: 'Pending Frontend Scenarios', cmd: 'npx', args: ['tsx', '--tsconfig', 'tsconfig.json', 'tests/test_pending_frontend_scenarios.ts'] },
];

console.log(`\n===============================================================`);
console.log(`  Mash Frontend Test Harness - Running ${testSuites.length} Test Suites`);
console.log(`===============================================================\n`);

let passedCount = 0;
let failedCount = 0;
const isWindows = process.platform === 'win32';

for (let i = 0; i < testSuites.length; i++) {
  const suite = testSuites[i];
  const prefix = `[${i + 1}/${testSuites.length}]`;
  process.stdout.write(`${prefix} ${suite.name} ... `);
  const start = Date.now();

  const executable = isWindows && suite.cmd !== 'node' ? `${suite.cmd}.cmd` : suite.cmd;
  const result = spawnSync(executable, suite.args, {
    stdio: 'pipe',
    encoding: 'utf-8',
    shell: isWindows,
  });

  const duration = Date.now() - start;

  if (result.status === 0) {
    passedCount++;
    console.log(`PASS (${duration}ms)`);
  } else {
    failedCount++;
    console.log(`FAIL (${duration}ms)`);
    if (result.stderr) console.error(result.stderr);
    if (result.stdout) console.log(result.stdout);
    process.exit(1);
  }
}

console.log(`\n===============================================================`);
console.log(`  All ${passedCount} Frontend Test Suites Passed Successfully!`);
console.log(`===============================================================\n`);
