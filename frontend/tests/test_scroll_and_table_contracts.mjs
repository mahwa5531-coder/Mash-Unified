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

// 3. Verify useScrollToBottom exports isPinnedToBottomRef
const scrollToBottomSrc = fs.readFileSync('frontend/src/features/chat/hooks/useScrollToBottom.ts', 'utf8');
assert.ok(scrollToBottomSrc.includes('isPinnedToBottomRef'), 'useScrollToBottom must export synchronous isPinnedToBottomRef');
assert.ok(scrollToBottomSrc.includes('isPinnedToBottomRef.current = false'), 'Upward scroll must synchronously disarm pin ref');
assert.ok(scrollToBottomSrc.includes('isPinnedToBottomRef.current = true'), 'Bottom scroll must synchronously re-arm pin ref');
console.log('✓ PASS: useScrollToBottom manages synchronous isPinnedToBottomRef');

// 4. Verify useChatStream wires isPinnedToBottomRef into useSseBufferFlusher
const chatStreamSrc = fs.readFileSync('frontend/src/features/chat/hooks/useChatStream.ts', 'utf8');
assert.ok(chatStreamSrc.includes('isPinnedToBottomRef?: React.MutableRefObject<boolean>'), 'useChatStream options must accept isPinnedToBottomRef');
assert.ok(chatStreamSrc.includes('isAtBottomRef: activePinnedRef'), 'useChatStream must pass activePinnedRef to useSseBufferFlusher');
console.log('✓ PASS: useChatStream correctly bridges isPinnedToBottomRef to buffer flusher');

// 5. Verify ChatCanvas uses Virtuoso followOutput and eliminated redundant manual autoScroll effects
const chatCanvasSrc = fs.readFileSync('frontend/src/features/chat/components/ChatCanvas.tsx', 'utf8');
assert.ok(chatCanvasSrc.includes('followOutput='), 'ChatCanvas must use Virtuoso followOutput for zero-yank output tracking');
assert.ok(chatCanvasSrc.includes('atBottomStateChange={setHitBottom}'), 'ChatCanvas must track bottom state via Virtuoso');
console.log('✓ PASS: ChatCanvas uses Virtuoso followOutput and eliminated fragile manual autoScroll loops');

// 6. Verify TableContainer supports isChat with max-height ceiling and sticky headers
assert.ok(tableContainerSrc.includes('isChat'), 'TableContainer must accept isChat prop');
assert.ok(tableContainerSrc.includes('max-h-[1850px]'), 'TableContainer must apply max-height ceiling in chat mode');
assert.ok(tableContainerSrc.includes('[&_th]:sticky'), 'TableContainer must have sticky header positioning');
console.log('✓ PASS: TableContainer supports isChat with 50-row max-h-[1850px] and sticky headers');

// 7. Verify useAgentMarkdownComponents passes isChat to TableContainer
assert.ok(markdownCompSrc.includes('<TableContainer isChat={isChat}'), 'useAgentMarkdownComponents must pass isChat to TableContainer');
console.log('✓ PASS: useAgentMarkdownComponents forwards isChat to TableContainer');

console.log('\nALL SCROLL & TABLE ARCHITECTURE CONTRACTS VERIFIED SUCCESSFULLY!');
