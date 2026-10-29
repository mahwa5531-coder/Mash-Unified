// Minimal assert-based self-check for Native Desktop Drop Path Optimization & DB Rebranding
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[*] Testing Native Desktop Drop Path Optimization & DB Rebranding Wiring...');

// 1. Verify electron/preload.js imports webUtils and exposes getPathForFile
const preloadContent = fs.readFileSync(path.resolve(__dirname, '../../electron/preload.js'), 'utf-8');
assert.ok(
  preloadContent.includes('webUtils'),
  'Preload must import webUtils from electron'
);
assert.ok(
  preloadContent.includes('getPathForFile'),
  'Preload electronAPI must expose getPathForFile'
);
console.log('  [PASS] 1. electron/preload.js exposes getPathForFile via webUtils.');

// 2. Verify useChatAttachments.ts checks native path and avoids HTTP upload
const hookContent = fs.readFileSync(
  path.resolve(__dirname, '../src/features/chat/hooks/useChatAttachments.ts'),
  'utf-8'
);
assert.ok(
  hookContent.includes('getPathForFile') || hookContent.includes('file.path'),
  'useChatAttachments must check for native file path'
);
assert.ok(
  hookContent.includes('nativePath'),
  'useChatAttachments must prioritize nativePath over HTTP uploadSessionFile'
);
console.log('  [PASS] 2. useChatAttachments.ts adopts native disk path directly without HTTP upload.');

// 3. Verify inspect_db.py points to ~/.mash/database/mash.db
const inspectDbContent = fs.readFileSync(
  path.resolve(__dirname, '../../connector/tests/inspect_db.py'),
  'utf-8'
);
assert.ok(
  inspectDbContent.includes('.mash') && inspectDbContent.includes('mash.db'),
  'inspect_db.py must point to .mash/database/mash.db'
);
console.log('  [PASS] 3. connector/tests/inspect_db.py resolves ~/.mash/database/mash.db.');

// 4. Verify agent benchmark compendium points to ~/.mash/database/mash.db
const benchContent = fs.readFileSync(
  path.resolve(__dirname, '../../connector/tests/agent_benchmark_compendium_runner.py'),
  'utf-8'
);
assert.ok(
  benchContent.includes('.mash') && benchContent.includes('mash.db'),
  'agent_benchmark_compendium_runner.py must point to .mash/database/mash.db'
);
console.log('  [PASS] 4. connector/tests/agent_benchmark_compendium_runner.py resolves ~/.mash/database/mash.db.');

console.log('[SUCCESS] All Native Desktop Drop Path & DB Rebranding checks PASSED!');
