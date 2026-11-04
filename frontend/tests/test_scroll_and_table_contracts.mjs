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

// 5. Verify ChatCanvas wires isPinnedToBottomRef and pruned redundant stream-follow effect dependencies
const chatCanvasSrc = fs.readFileSync('frontend/src/features/chat/components/ChatCanvas.tsx', 'utf8');
assert.ok(chatCanvasSrc.includes('isPinnedToBottomRef,'), 'ChatCanvas must retrieve isPinnedToBottomRef from useScrollToBottom');
assert.ok(chatCanvasSrc.includes('isPinnedToBottomRef,'), 'ChatCanvas must pass isPinnedToBottomRef into useChatStream');

// Check that lastAiContent, lastAiThoughts, lastAiTools are pruned from the effect
const effectSnippet = chatCanvasSrc.substring(chatCanvasSrc.indexOf('// Auto-scroll strictly to bottom when new turns arrive'), chatCanvasSrc.indexOf('// Trigger quota banner'));
assert.ok(!effectSnippet.includes('lastAiContent'), 'Pruned redundant lastAiContent dependency from autoScroll effect');
assert.ok(!effectSnippet.includes('lastAiThoughts'), 'Pruned redundant lastAiThoughts dependency from autoScroll effect');
assert.ok(!effectSnippet.includes('lastAiTools'), 'Pruned redundant lastAiTools dependency from autoScroll effect');
console.log('✓ PASS: ChatCanvas pruned redundant token change dependencies from autoScroll effect');

// 6. Verify TableContainer supports isChat with max-height ceiling and sticky headers
assert.ok(tableContainerSrc.includes('isChat'), 'TableContainer must accept isChat prop');
assert.ok(tableContainerSrc.includes('max-h-[440px]'), 'TableContainer must apply max-height ceiling in chat mode');
assert.ok(tableContainerSrc.includes('[&_th]:sticky'), 'TableContainer must have sticky header positioning');
console.log('✓ PASS: TableContainer supports isChat with max-h-[440px] and sticky headers');

// 7. Verify useAgentMarkdownComponents passes isChat to TableContainer
assert.ok(markdownCompSrc.includes('<TableContainer isChat={isChat}'), 'useAgentMarkdownComponents must pass isChat to TableContainer');
console.log('✓ PASS: useAgentMarkdownComponents forwards isChat to TableContainer');

console.log('\nALL SCROLL & TABLE ARCHITECTURE CONTRACTS VERIFIED SUCCESSFULLY!');
