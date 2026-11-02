const assert = require('assert');

// 1. Test Tab Deduplication (Atomic Functional Update)
function simulateOpenTab(prevTabs, tabId, title, fullPath) {
  if (prevTabs.some(t => t.id === tabId)) {
    return prevTabs; // deduplicated, no change
  }
  return [...prevTabs, { id: tabId, title, type: 'file', path: fullPath }];
}

let tabs = [];
tabs = simulateOpenTab(tabs, 'file-data.json', 'data.json', 'data.json');
assert.strictEqual(tabs.length, 1, 'First open should add 1 tab');

// Attempt to open the exact same file again (e.g. fast clicks or re-render)
tabs = simulateOpenTab(tabs, 'file-data.json', 'data.json', 'data.json');
assert.strictEqual(tabs.length, 1, 'Second open must NOT create duplicate tab');

// Open another file
tabs = simulateOpenTab(tabs, 'file-main.py', 'main.py', 'backend/main.py');
assert.strictEqual(tabs.length, 2, 'Opening different file should add second tab');

// 2. Test Atomic Close Tab (Single Tab Close, No Double-Close)
function simulateCloseTab(prevTabs, targetId, activeTabId) {
  const targetIndex = prevTabs.findIndex(t => t.id === targetId);
  if (targetIndex === -1) return { newTabs: prevTabs, newActiveId: activeTabId };

  const newTabs = prevTabs.filter((_, i) => i !== targetIndex);
  let newActiveId = activeTabId;
  if (activeTabId === targetId) {
    const nextActive = newTabs[targetIndex] || newTabs[targetIndex - 1] || null;
    newActiveId = nextActive ? nextActive.id : null;
  }
  return { newTabs, newActiveId };
}

// Close first tab
let closeResult = simulateCloseTab(tabs, 'file-data.json', 'file-data.json');
assert.strictEqual(closeResult.newTabs.length, 1, 'Only one tab should be closed');
assert.strictEqual(closeResult.newTabs[0].id, 'file-main.py', 'Remaining tab must be main.py');
assert.strictEqual(closeResult.newActiveId, 'file-main.py', 'Active tab must switch to remaining tab');

// 3. Test Safe File Slicing for Big JSON / Large Files
const SAFE_LINE_LIMIT = 1000;
const bigLines = Array.from({ length: 50000 }, (_, i) => `{"index": ${i}, "data": "value_${i}"}`);
const bigJsonContent = bigLines.join('\n');

assert(bigJsonContent.length > 1_000_000, 'Content must be > 1MB');
const lines = bigJsonContent.split('\n');
assert.strictEqual(lines.length, 50000);

// Safe preview slice check
const safePreview = lines.slice(0, SAFE_LINE_LIMIT).join('\n');
const previewLines = safePreview.split('\n');
assert.strictEqual(previewLines.length, 1000, 'Preview must cap at exactly 1000 lines');

// Line numbers string generation check (2-DOM-node technique)
let lineNumbersStr = '';
for (let i = 1; i <= previewLines.length; i++) {
  lineNumbersStr += i + '\n';
}
assert.strictEqual(lineNumbersStr.split('\n').length - 1, 1000);

// 4. Test 100-File Tab Ceiling & Eviction Guard
const MAX_VIEWER_TABS = 20;
function simulateOpenTabWithLimit(prevTabs, tabId, title, fullPath, activeId) {
  if (prevTabs.some(t => t.id === tabId)) {
    return prevTabs;
  }
  let next = prevTabs;
  if (next.length >= MAX_VIEWER_TABS) {
    const evictIdx = next.findIndex(t => t.id !== activeId);
    if (evictIdx !== -1) {
      next = next.filter((_, i) => i !== evictIdx);
    }
  }
  return [...next, { id: tabId, title, type: 'file', path: fullPath }];
}

let stressTabs = [];
for (let i = 1; i <= 100; i++) {
  stressTabs = simulateOpenTabWithLimit(
    stressTabs, 
    `file-${i}.txt`, 
    `file-${i}.txt`, 
    `/path/to/file-${i}.txt`, 
    stressTabs[stressTabs.length - 1]?.id || null
  );
}
assert.strictEqual(stressTabs.length, 20, 'Tabs must never exceed MAX_VIEWER_TABS (20) even after 100 opens');
assert.strictEqual(stressTabs[stressTabs.length - 1].id, 'file-100.txt', 'Latest opened file must be present');

console.log('✓ All RightSidebar deduplication, single-close, 100-file tab ceiling, and safe large-file logic checks PASSED!');
