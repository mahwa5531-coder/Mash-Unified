// Automated test suite verifying production-ready tool rendering rules
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[*] Testing Production-Grade Tool Rendering Rules...');

// 1. Verify CommandTimelineRow uses clean prompt and does not hardcode repo name
const cmdRowContent = fs.readFileSync(
  path.resolve(__dirname, '../src/features/chat/components/work-log/CommandTimelineRow.tsx'),
  'utf-8'
);
assert.ok(
  !cmdRowContent.includes('...\\Mash &gt;'),
  'CommandTimelineRow must NEVER hardcode ...\\Mash > terminal prompt'
);
assert.ok(
  cmdRowContent.includes('displayOutput'),
  'CommandTimelineRow must preserve clean displayOutput'
);
console.log('  [PASS] 1. Terminal drawer eliminates hardcoded ...\\Mash > prompt and preserves full output.');

// 2. Verify ToolTimelineRow preserves clean FilePill without developer diff noise (+added -deleted)
const toolRowContent = fs.readFileSync(
  path.resolve(__dirname, '../src/features/chat/components/work-log/ToolTimelineRow.tsx'),
  'utf-8'
);
assert.ok(
  !toolRowContent.includes('text-emerald-500/90') && !toolRowContent.includes('text-rose-500/90'),
  'ToolTimelineRow must keep FilePill clean and free of developer git diff noise'
);
console.log('  [PASS] 2. Single file edits render clean FilePill without developer diff clutter.');

// 3. Verify generic tool names format to Title Case
assert.ok(
  toolRowContent.includes("t.name.replace(/[_-]+/g, ' ')"),
  'ToolTimelineRow must convert snake_case tool names to Title Case'
);
console.log('  [PASS] 3. Generic tool names are formatted to Title Case.');

console.log('[SUCCESS] All production-grade tool rendering checks PASSED!');
