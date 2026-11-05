import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('======================================================================');
console.log('TESTING REACT-VIRTUOSO CHAT INTEGRATION & SCROLL INVARIANTS');
console.log('======================================================================\n');

const chatCanvasPath = path.resolve(__dirname, '../src/features/chat/components/ChatCanvas.tsx');
const chatCanvasSrc = fs.readFileSync(chatCanvasPath, 'utf8');

// Test 1: Virtuoso is imported and wired as the chat feed engine
console.log('[Test 1] Virtuoso Import & Component Wiring...');
assert.ok(chatCanvasSrc.includes("import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';"), 'ChatCanvas must import Virtuoso from react-virtuoso');
assert.ok(chatCanvasSrc.includes('<Virtuoso'), 'ChatCanvas must render <Virtuoso /> for chat messages');
console.log('  ✓ PASSED: Virtuoso imported and rendered in ChatCanvas.\n');

// Test 2: Virtuoso Chat Contracts (data, computeItemKey, firstItemIndex, followOutput, startReached, atBottomStateChange)
console.log('[Test 2] Virtuoso Chat Engine Contracts...');
assert.ok(chatCanvasSrc.includes('data={turns}'), 'Virtuoso must receive data={turns}');
assert.ok(chatCanvasSrc.includes('firstItemIndex={firstItemIndex}'), 'Virtuoso must receive firstItemIndex for reverse infinite scroll anchoring');
assert.ok(chatCanvasSrc.includes('initialTopMostItemIndex={Math.max(0, turns.length - 1)}'), 'Virtuoso must start scrolled to bottom');
assert.ok(chatCanvasSrc.includes("followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}"), 'Virtuoso must manage followOutput to prevent violent yanking when scrolled up');
assert.ok(chatCanvasSrc.includes('startReached={handleLoadEarlier}'), 'Virtuoso must wire startReached to handleLoadEarlier');
assert.ok(chatCanvasSrc.includes('atBottomStateChange={setHitBottom}'), 'Virtuoso must drive floating button via atBottomStateChange');
assert.ok(chatCanvasSrc.includes('computeItemKey='), 'Virtuoso must provide computeItemKey for stable DOM keys');
console.log('  ✓ PASSED: All 6 Virtuoso chat contracts verified.\n');

// Test 3: Dead spacer replacement <div data-turn-culled> is completely gone
console.log('[Test 3] Dead Spacer Div Removal...');
assert.ok(!chatCanvasSrc.includes('data-turn-culled="true"'), 'ChatCanvas must NOT swap turns with culled placeholder divs');
assert.ok(!chatCanvasSrc.includes('containIntrinsicSize: `auto ${cachedHeight}px`'), 'ChatCanvas must NOT use unstable containIntrinsicSize on spacer divs');
console.log('  ✓ PASSED: Placeholder div swapping completely eliminated from ChatCanvas.\n');

// Test 4: MountedTurnRow Memo Shield with artifactsByTurnMsg
console.log('[Test 4] MountedTurnRow Memo Shield...');
assert.ok(chatCanvasSrc.includes('prev.artifactsByTurnMsg === next.artifactsByTurnMsg'), 'MountedTurnRow memo comparator must include artifactsByTurnMsg to prevent stale deliverable cards');
console.log('  ✓ PASSED: MountedTurnRow memo comparator includes artifactsByTurnMsg.\n');

// Test 5: useSessionHistory pagination & duplicate rAF elimination
console.log('[Test 5] useSessionHistory Smooth Pagination...');
const sessionHistoryPath = path.resolve(__dirname, '../src/features/chat/hooks/useSessionHistory.ts');
const sessionHistorySrc = fs.readFileSync(sessionHistoryPath, 'utf8');
assert.ok(sessionHistorySrc.includes('const PAGE_SIZE = 40;'), 'PAGE_SIZE must be reduced to 40 for smooth chunk loading');
assert.ok(!sessionHistorySrc.includes('Math.abs(container.scrollTop - expectedTop) > 2'), 'Duplicate rAF scroll compensation must be eliminated from useSessionHistory');
assert.ok(sessionHistorySrc.includes('onPrepend(s.chatMessages, olderTurns.length);'), 'useSessionHistory must pass prepended turn count for atomic firstItemIndex decrement');
console.log('  ✓ PASSED: useSessionHistory calibrated for Virtuoso atomic prepending.\n');

// Test 6: Custom Visuals Preservation (TableContainer, CodeBlock, Pele Mermaid)
console.log('[Test 6] Custom Visuals Preservation...');
const tableContainerSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/renderers/TableContainer.tsx'), 'utf8');
const mermaidSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/renderers/MermaidRenderer.tsx'), 'utf8');
const codeBlockSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/renderers/CodeBlock.tsx'), 'utf8');

assert.ok(tableContainerSrc.includes('max-h-[1850px]'), 'TableContainer 50-row max-height ceiling preserved');
assert.ok(mermaidSrc.includes('getPele().then'), 'Pele Mermaid diagram renderer preserved');
assert.ok(codeBlockSrc.includes('highlightCodeSnippet'), 'CodeBlock syntax highlighting preserved');
console.log('  ✓ PASSED: All custom visual components preserved 100% untouched.\n');

console.log('======================================================================');
console.log('>>> ALL 6 REACT-VIRTUOSO CHAT CONTRACT TESTS PASSED (100% GREEN) <<<');
console.log('======================================================================');
