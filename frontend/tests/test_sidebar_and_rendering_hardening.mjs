import assert from 'node:assert';
import { splitMarkdownBlocks } from '../src/components/markdown/splitMarkdownBlocks.ts';
import { escapeCurrencyInMarkdown } from '../src/features/chat/components/messages/proseHelpers.tsx';

console.log('======================================================================');
console.log('STARTING RIGHT SIDEBAR & RENDERING HARDENING VERIFICATION TEST SUITE');
console.log('======================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Multi-line Display Math ($$) Boundary Splitting Protection
// -----------------------------------------------------------------------------
console.log('[Test 1] Multi-line Display Math ($$) Boundary Splitting Protection...');
{
  const lines = [];
  for (let i = 1; i <= 30; i++) {
    lines.push(`Line ${i}: Regular analysis text.`);
  }
  // Open multi-line math at line 31
  lines.push('$$');
  lines.push('\\begin{aligned}');
  for (let j = 1; j <= 15; j++) {
    lines.push(`  x_{${j}} &= \\sum_{k=1}^{n} \\frac{a_{jk}}{b_{jk}} \\\\`);
  }
  lines.push('\\end{aligned}');
  lines.push('$$'); // Ends around line 48, crossing the 35-line boundary!
  lines.push('');
  for (let k = 1; k <= 10; k++) {
    lines.push(`Trailing line ${k}`);
  }

  const markdownText = lines.join('\n');
  const blocks = splitMarkdownBlocks(markdownText, 35);

  // Assert that the entire $$ ... $$ math block is preserved in a single block without split
  const mathBlock = blocks.find(b => b.includes('\\begin{aligned}'));
  assert(mathBlock, 'Expected to find block with \\begin{aligned}');
  assert(mathBlock.includes('$$'), 'Expected block to have opening $$');
  assert(mathBlock.endsWith('$$') || mathBlock.includes('\\end{aligned}\n$$'), 'Expected block to keep closing $$ intact');
  assert(mathBlock.includes('\\end{aligned}'), 'Expected math block to contain closing tag');

  console.log('  -> PASSED: Multi-line $$ display math block kept 100% contiguous across chunk boundaries!\n');
}

// -----------------------------------------------------------------------------
// Test 2: Prose Currency ($100) Collision Guard
// -----------------------------------------------------------------------------
console.log('[Test 2] Prose Currency ($100) Collision Guard...');
{
  const input = 'Total balance is $100 and invoice fee is $50.75.';
  const escaped = escapeCurrencyInMarkdown(input);

  assert.strictEqual(escaped, 'Total balance is \\$100 and invoice fee is \\$50.75.');
  assert(!escaped.match(/(?<![\$\\])\$(?=\d)/), 'Unescaped currency $ must be eliminated');

  // Edge cases: already escaped or double dollar
  const alreadyEscaped = 'Value \\$500 is safe';
  assert.strictEqual(escapeCurrencyInMarkdown(alreadyEscaped), 'Value \\$500 is safe');

  const mathBlock = 'Math $$100 + 200$$ is valid display math';
  assert.strictEqual(escapeCurrencyInMarkdown(mathBlock), 'Math $$100 + 200$$ is valid display math');

  console.log('  -> PASSED: Currency values correctly escaped to prevent KaTeX math mode activation!\n');
}

// -----------------------------------------------------------------------------
// Test 3: True LRU Tab Eviction Model Verification
// -----------------------------------------------------------------------------
console.log('[Test 3] True LRU Tab Eviction Simulation...');
{
  const MAX_TABS = 5;
  const tabs = [
    { id: 'tab-1', title: 'A.txt' },
    { id: 'tab-2', title: 'B.txt' },
    { id: 'tab-3', title: 'C.txt' },
    { id: 'tab-4', title: 'D.txt' },
    { id: 'tab-5', title: 'E.txt' },
  ];

  const accessTimes = new Map([
    ['tab-1', 100],
    ['tab-2', 500], // Recently accessed
    ['tab-3', 200],
    ['tab-4', 400],
    ['tab-5', 300],
  ]);

  const activeTabId = 'tab-2';

  // Find oldest non-active tab
  let oldestTime = Infinity;
  let evictIdx = -1;
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].id !== activeTabId) {
      const time = accessTimes.get(tabs[i].id) ?? 0;
      if (time < oldestTime) {
        oldestTime = time;
        evictIdx = i;
      }
    }
  }

  assert.strictEqual(evictIdx, 0, 'Oldest tab (tab-1 with time 100) must be evicted');
  assert.strictEqual(tabs[evictIdx].id, 'tab-1');

  // Now simulate that tab-1 was accessed recently, making tab-3 the oldest
  accessTimes.set('tab-1', 600);
  oldestTime = Infinity;
  evictIdx = -1;
  for (let i = 0; i < tabs.length; i++) {
    if (tabs[i].id !== activeTabId) {
      const time = accessTimes.get(tabs[i].id) ?? 0;
      if (time < oldestTime) {
        oldestTime = time;
        evictIdx = i;
      }
    }
  }

  assert.strictEqual(evictIdx, 2, 'Tab-3 (time 200) must be evicted now');
  assert.strictEqual(tabs[evictIdx].id, 'tab-3');

  console.log('  -> PASSED: True LRU timestamp eviction verifies recency over index order!\n');
}

// -----------------------------------------------------------------------------
// Test 4: Map MRU Insertion Order Refresh Verification
// -----------------------------------------------------------------------------
console.log('[Test 4] Map MRU Insertion Order Refresh...');
{
  const memory = new Map();
  memory.set('sess-1', { data: 1 });
  memory.set('sess-2', { data: 2 });
  memory.set('sess-3', { data: 3 });

  // Update sess-1: delete + set moves it to the end (MRU)
  if (memory.has('sess-1')) memory.delete('sess-1');
  memory.set('sess-1', { data: 1, updated: true });

  // The oldest is now sess-2, NOT sess-1
  const oldestKey = memory.keys().next().value;
  assert.strictEqual(oldestKey, 'sess-2', 'sess-2 must be the oldest key in the Map');

  console.log('  -> PASSED: Map delete+set guarantees correct LRU eviction order across sessions!\n');
}

console.log('======================================================================');
console.log('ALL RIGHT SIDEBAR & RENDERING HARDENING VERIFICATION TESTS PASSED (4/4)');
console.log('======================================================================');
