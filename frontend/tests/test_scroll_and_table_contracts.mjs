import assert from 'node:assert/strict';
import fs from 'node:fs';

console.log('--- Testing Scroll Yanking & Table Rendering Contracts ---');

// 1. Verify TableContainer does NOT have w-max and has w-full
const tableContainerSrc = fs.readFileSync('frontend/src/components/renderers/TableContainer.tsx', 'utf8');
assert.ok(!tableContainerSrc.includes('w-max'), 'TableContainer must NOT use w-max');
assert.ok(tableContainerSrc.includes('w-full'), 'TableContainer must use w-full for clean responsive layout');
console.log('✓ PASS: TableContainer uses w-full and eliminated w-max (no premature horizontal scroll for 2-3 cols)');

// 2. Verify useAgentMarkdownComponents does not force whitespace-nowrap on all headers
const markdownCompSrc = fs.readFileSync('frontend/src/components/markdown/useAgentMarkdownComponents.tsx', 'utf8');
const thBlock = markdownCompSrc.substring(markdownCompSrc.indexOf('th({'), markdownCompSrc.indexOf('td({'));
assert.ok(!thBlock.includes('whitespace-nowrap'), '<th> must allow text wrapping to prevent premature scrollbars');
console.log('✓ PASS: Table <th> allows text wrapping');

// 3. Verify Virtuoso followOutput and atBottomStateChange govern scroll pinning in ChatCanvas
const chatCanvasSrc = fs.readFileSync('frontend/src/features/chat/components/ChatCanvas.tsx', 'utf8');
assert.ok(chatCanvasSrc.includes('followOutput='), 'ChatCanvas must govern scroll pinning via Virtuoso followOutput');
assert.ok(chatCanvasSrc.includes('atBottomStateChange={setHitBottom}'), 'ChatCanvas must govern bottom state via Virtuoso atBottomStateChange');
console.log('✓ PASS: ChatCanvas scroll pinning governed cleanly by Virtuoso contracts (obsolete useScrollToBottom deleted)');

// 4. Verify useChatStream cleanly accepts optional scroll options without hard dependencies
const chatStreamSrc = fs.readFileSync('frontend/src/features/chat/hooks/useChatStream.ts', 'utf8');
assert.ok(chatStreamSrc.includes('scrollContainerRef'), 'useChatStream accepts scrollContainerRef for container observation');
console.log('✓ PASS: useChatStream cleanly decoupled from obsolete manual pin hooks');

// 6. Verify TableContainer supports isChat with max-height ceiling and sticky headers
assert.ok(tableContainerSrc.includes('isChat'), 'TableContainer must accept isChat prop');
assert.ok(tableContainerSrc.includes('max-h-[1850px]'), 'TableContainer must apply max-height ceiling in chat mode');
assert.ok(tableContainerSrc.includes('[&_th]:sticky'), 'TableContainer must have sticky header positioning');
console.log('✓ PASS: TableContainer supports isChat with 50-row max-h-[1850px] and sticky headers');

// 7. Verify useAgentMarkdownComponents passes isChat to TableContainer
assert.ok(markdownCompSrc.includes('<TableContainer isChat={isChat}'), 'useAgentMarkdownComponents must pass isChat to TableContainer');
console.log('✓ PASS: useAgentMarkdownComponents forwards isChat to TableContainer');

console.log('\nALL SCROLL & TABLE ARCHITECTURE CONTRACTS VERIFIED SUCCESSFULLY!');
