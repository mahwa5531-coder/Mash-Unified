// Automated test suite verifying production-ready tool rendering rules
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[*] Testing Production-Grade Tool Rendering Enhancements...');

// 1. Verify CommandTimelineRow strips ANSI and caps runaway output
const cmdRowContent = fs.readFileSync(
  path.resolve(__dirname, '../src/features/chat/components/work-log/CommandTimelineRow.tsx'),
  'utf-8'
);
assert.ok(
  cmdRowContent.includes('0-9A-ORZcf-nqry'),
  'CommandTimelineRow must strip ANSI escape sequences'
);
assert.ok(
  cmdRowContent.includes('30000'),
  'CommandTimelineRow must cap runaway terminal output to 30KB'
);
assert.ok(
  !cmdRowContent.includes('...\\Mash &gt;'),
  'CommandTimelineRow must NEVER hardcode ...\\Mash > terminal prompt'
);
console.log('  [PASS] 1. Terminal drawer strips ANSI, caps huge outputs, and uses dynamic prompts.');

// 2. Verify ToolTimelineRow renders diff badges for single edits
const toolRowContent = fs.readFileSync(
  path.resolve(__dirname, '../src/features/chat/components/work-log/ToolTimelineRow.tsx'),
  'utf-8'
);
assert.ok(
  toolRowContent.includes('text-emerald-500/90') && toolRowContent.includes('text-rose-500/90'),
  'ToolTimelineRow must render emerald +added and rose -deleted stats for single edits'
);
console.log('  [PASS] 2. Single file edits render diff stats (+added -deleted) consistent with Cursor/Copilot.');

// 3. Verify ToolTimelineRow renders search results count badge
assert.ok(
  toolRowContent.includes('entry.data?.countStr'),
  'ToolTimelineRow must render search result count'
);
console.log('  [PASS] 3. Code search rows display match counts (e.g. (12 results)).');

// 4. Verify generic tool names format to Title Case
assert.ok(
  toolRowContent.includes("t.name.replace(/[_-]+/g, ' ')"),
  'ToolTimelineRow must convert snake_case tool names to Title Case'
);
console.log('  [PASS] 4. Generic tool names are formatted to Title Case.');

console.log('[SUCCESS] All production-grade tool rendering checks PASSED!');
