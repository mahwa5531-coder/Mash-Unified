import assert from 'node:assert';
import {
  estimateTurnHeight,
  computeVisibleRange,
} from '../src/features/chat/hooks/useTurnViewportWindow';
import type { Turn, Message } from '../src/types/chat';

function makeTurn(index: number, userContent = 'Test prompt', aiContent = 'Assistant reply'): Turn {
  const userMsg: Message = {
    role: 'user',
    content: userContent,
    thoughts: [],
    tools: [],
  };
  const aiMsg: Message = {
    role: 'assistant',
    content: aiContent,
    thoughts: [],
    tools: [],
  };
  return {
    id: `adv_turn_${index}`,
    userMsg,
    aiMsgs: [aiMsg],
    flatIdx: index,
    turnIndex: index,
  };
}

console.log('======================================================================');
console.log('STARTING ADVERSARIAL STRESS TESTS FOR VIEWPORT WINDOWING (M1)');
console.log('======================================================================');

// Adversarial Test 1: Empty & Boundary Turn Counts (0, 1, 2)
console.log('\n[Adv Test 1] Empty and Single-Turn Sessions...');
{
  const emptyRange = computeVisibleRange(null, [], new Map(), 2);
  assert.strictEqual(emptyRange.startIndex, 0);
  assert.strictEqual(emptyRange.endIndex, 0);

  const oneTurn = [makeTurn(0)];
  const oneRange = computeVisibleRange(null, oneTurn, new Map(), 2);
  assert.strictEqual(oneRange.startIndex, 0);
  assert.strictEqual(oneRange.endIndex, 0);

  const twoTurns = [makeTurn(0), makeTurn(1)];
  const twoRange = computeVisibleRange(null, twoTurns, new Map(), 2);
  assert.strictEqual(twoRange.startIndex, 0);
  assert.strictEqual(twoRange.endIndex, 1);
  console.log('  -> PASSED: Handled 0, 1, and 2 turns cleanly without out-of-bounds');
}

// Adversarial Test 2: Extreme & Invalid Container Dimensions
console.log('\n[Adv Test 2] Extreme and Invalid Container Dimensions...');
{
  const turns = Array.from({ length: 50 }, (_, i) => makeTurn(i));
  const cache = new Map<string, number>();

  // Negative scrollTop (iOS bounce)
  const bounceContainer = { clientHeight: 800, scrollTop: -400 } as unknown as HTMLDivElement;
  const bounceRange = computeVisibleRange(bounceContainer, turns, cache, 2);
  assert.strictEqual(bounceRange.startIndex, 0);
  assert.ok(bounceRange.endIndex >= 5);

  // Massive scrollTop (scrolled way past total height)
  const massiveContainer = { clientHeight: 800, scrollTop: 99999999 } as unknown as HTMLDivElement;
  const massiveRange = computeVisibleRange(massiveContainer, turns, cache, 2);
  assert.strictEqual(massiveRange.startIndex, 49);
  assert.strictEqual(massiveRange.endIndex, 49);

  // ClientHeight = 0 fallback
  const zeroHeightContainer = { clientHeight: 0, scrollTop: 100 } as unknown as HTMLDivElement;
  const zeroRange = computeVisibleRange(zeroHeightContainer, turns, cache, 2);
  assert.ok(zeroRange.startIndex >= 0 && zeroRange.endIndex < 50);
  assert.ok(zeroRange.startIndex <= zeroRange.endIndex);
  console.log('  -> PASSED: Resilient against negative scroll, massive scroll, and 0 height');
}

// Adversarial Test 3: Mathematical Invariant Exhaustive Verification (1,000 Turns)
console.log('\n[Adv Test 3] Invariant Verification across Scroll Spectrum...');
{
  const count = 1000;
  const turns = Array.from({ length: count }, (_, i) => makeTurn(i, `User ${i}`, `Assistant ${i}`));
  const cache = new Map<string, number>();

  // Assign diverse custom heights: from 100px to 1200px
  for (let i = 0; i < count; i++) {
    cache.set(turns[i].id, 100 + ((i * 37) % 1100));
  }

  // Pre-calculate exact turn intervals [top_i, bottom_i]
  const intervals: { top: number; bottom: number }[] = [];
  let currentTop = 0;
  for (let i = 0; i < count; i++) {
    const h = cache.get(turns[i].id)!;
    intervals.push({ top: currentTop, bottom: currentTop + h });
    currentTop += h;
  }
  const totalHeight = currentTop;

  // Test across 100 diverse scroll positions from 0 to totalHeight
  for (let step = 0; step <= 100; step++) {
    const scrollTop = Math.round((step / 100) * totalHeight);
    const clientHeight = 900;
    const overscanScreens = 2;
    const overscanPx = overscanScreens * clientHeight;
    const targetTop = Math.max(0, scrollTop - overscanPx);
    const targetBottom = scrollTop + clientHeight + overscanPx;

    const mockContainer = { clientHeight, scrollTop } as unknown as HTMLDivElement;
    const range = computeVisibleRange(mockContainer, turns, cache, overscanScreens);

    // Invariant 1: startIndex <= endIndex
    assert.ok(range.startIndex <= range.endIndex, `startIndex (${range.startIndex}) > endIndex (${range.endIndex}) at scroll ${scrollTop}`);
    // Invariant 2: bounds within [0, count - 1]
    assert.ok(range.startIndex >= 0 && range.endIndex < count, `Range [${range.startIndex}, ${range.endIndex}] out of bounds for count ${count}`);

    // Invariant 3: Completeness - Every turn whose vertical span intersects [targetTop, targetBottom] MUST be in [startIndex, endIndex]
    for (let i = 0; i < count; i++) {
      const { top, bottom } = intervals[i];
      const intersects = bottom >= targetTop && top <= targetBottom;
      if (intersects) {
        assert.ok(
          i >= range.startIndex && i <= range.endIndex,
          `Turn ${i} (span [${top}, ${bottom}]) intersects [${targetTop}, ${targetBottom}] but was omitted! (range: [${range.startIndex}, ${range.endIndex}])`
        );
      }
    }
  }
  console.log(`  -> PASSED: Verified 100 scroll checkpoints across 1,000 turns (${totalHeight}px). 0 omissions, 100% boundary accuracy!`);
}

// Adversarial Test 4: Malformed Turn Objects in estimateTurnHeight
console.log('\n[Adv Test 4] Malformed Turn Objects in estimateTurnHeight...');
{
  assert.strictEqual(estimateTurnHeight(null as any), 180);
  assert.strictEqual(estimateTurnHeight(undefined as any), 180);

  const brokenTurn1 = { userMsg: null, aiMsgs: null } as any;
  assert.ok(estimateTurnHeight(brokenTurn1) >= 100);

  const brokenTurn2 = {
    userMsg: { content: undefined },
    aiMsgs: [{ content: undefined, tools: undefined, thoughts: undefined }],
  } as any;
  assert.ok(estimateTurnHeight(brokenTurn2) >= 100);

  const emptyStringsTurn = {
    userMsg: { content: '' },
    aiMsgs: [{ content: '', tools: [], thoughts: ['', ''] }],
  } as any;
  assert.ok(estimateTurnHeight(emptyStringsTurn) >= 100);
  console.log('  -> PASSED: Malformed turn objects safely handled with fallback estimates');
}

// Adversarial Test 5: Performance & Memory Scaling (10,000 Turns)
console.log('\n[Adv Test 5] Scaling Performance on 10,000 Turns...');
{
  const turns = Array.from({ length: 10000 }, (_, i) => makeTurn(i));
  const cache = new Map<string, number>();
  const container = { clientHeight: 800, scrollTop: 500000 } as unknown as HTMLDivElement;

  const t0 = performance.now();
  for (let i = 0; i < 50; i++) {
    computeVisibleRange(container, turns, cache, 2);
  }
  const t1 = performance.now();
  const avgMs = (t1 - t0) / 50;
  console.log(`  -> Average compute time for 10,000 turns: ${avgMs.toFixed(3)}ms`);
  assert.ok(avgMs < 15, `computeVisibleRange took too long: ${avgMs}ms (target < 15ms)`);
}

console.log('\n======================================================================');
console.log('ALL ADVERSARIAL STRESS TESTS PASSED (5/5)');
console.log('======================================================================');
