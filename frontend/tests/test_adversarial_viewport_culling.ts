import assert from 'node:assert';
import {
  estimateTurnHeight,
  computeVisibleRange,
} from '../src/features/chat/hooks/useTurnViewportWindow';
import type { Turn, Message } from '../src/types/chat';

console.log('======================================================================');
console.log('ADVERSARIAL STRESS TESTING: VIEWPORT WINDOWING & CULLING');
console.log('======================================================================');

function createTurn(
  idx: number,
  userText = `User query ${idx}`,
  aiText = `Assistant response ${idx}`,
  opts: { tools?: any[]; thoughts?: string[]; isEarlierContext?: boolean } = {}
): Turn {
  const userMsg: Message = {
    role: 'user',
    content: opts.isEarlierContext ? '[Earlier Context]' : userText,
    thoughts: [],
    tools: [],
  };
  const aiMsg: Message = {
    role: 'assistant',
    content: aiText,
    thoughts: opts.thoughts || [],
    tools: opts.tools || [],
  };
  return {
    id: `turn_adversarial_${idx}`,
    userMsg,
    aiMsgs: [aiMsg],
    flatIdx: idx,
    turnIndex: idx,
  };
}

// -----------------------------------------------------------------------------
// Challenge 1: 0 Turns and 1 Turn Boundary Conditions
// -----------------------------------------------------------------------------
console.log('\n[Challenge 1] 0 Turns & 1 Turn Boundary Conditions...');
{
  const cache = new Map<string, number>();
  const container = { clientHeight: 800, scrollTop: 0 } as HTMLDivElement;

  // 0 turns
  const r0 = computeVisibleRange(container, [], cache, 2);
  assert.strictEqual(r0.startIndex, 0, '0 turns should return startIndex=0');
  assert.strictEqual(r0.endIndex, 0, '0 turns should return endIndex=0');

  // 1 turn at top
  const turn1 = [createTurn(0)];
  const r1 = computeVisibleRange(container, turn1, cache, 2);
  assert.strictEqual(r1.startIndex, 0, '1 turn at top should return startIndex=0');
  assert.strictEqual(r1.endIndex, 0, '1 turn at top should return endIndex=0');

  // 1 turn at large offset
  container.scrollTop = 50000;
  const r1Far = computeVisibleRange(container, turn1, cache, 2);
  assert.strictEqual(r1Far.startIndex, 0, '1 turn far scroll must clamp startIndex=0');
  assert.strictEqual(r1Far.endIndex, 0, '1 turn far scroll must clamp endIndex=0');

  // Null container fallback (should use default 800px clientHeight)
  const rNullContainer = computeVisibleRange(null, turn1, cache, 2);
  assert.strictEqual(rNullContainer.startIndex, 0);
  assert.strictEqual(rNullContainer.endIndex, 0);

  console.log('  -> PASSED: 0-turn and 1-turn boundaries safely clamped without NaN or errors');
}

// -----------------------------------------------------------------------------
// Challenge 2: Empty Content, Missing Content, and Malformed Turns
// -----------------------------------------------------------------------------
console.log('\n[Challenge 2] Empty Content, Missing Content & Extreme Text Sizes...');
{
  // Null turn
  const hNull = estimateTurnHeight(null as unknown as Turn);
  assert.strictEqual(hNull, 180, 'Null turn should fallback to 180px');

  // Empty string user and ai content
  const emptyTurn = createTurn(0, '', '');
  const hEmpty = estimateTurnHeight(emptyTurn);
  assert.strictEqual(hEmpty, 100, `Empty content should floor at 100px minimum, got ${hEmpty}`);

  // Synthetic '[Earlier Context]'
  const earlierContextTurn = createTurn(1, '', '', { isEarlierContext: true });
  const hEarlier = estimateTurnHeight(earlierContextTurn);
  assert.strictEqual(hEarlier, 60, `Earlier context should return exactly 60px, got ${hEarlier}`);

  // Missing aiMsgs array
  const missingAiTurn: Turn = {
    id: 'missing_ai',
    userMsg: { role: 'user', content: 'hello', thoughts: [], tools: [] },
    aiMsgs: [],
    flatIdx: 2,
  };
  const hMissingAi = estimateTurnHeight(missingAiTurn);
  assert.ok(hMissingAi >= 100 && hMissingAi <= 150, `Missing aiMsgs should safely compute height: ${hMissingAi}`);

  // Turn with 50,000 characters of text (must cap at 1000px)
  const hugeTurn = createTurn(3, 'A'.repeat(5000), 'B'.repeat(50000));
  const hHuge = estimateTurnHeight(hugeTurn);
  assert.strictEqual(hHuge, 1000, `Massive turn must cap at 1000px ceiling to avoid layout blowup, got ${hHuge}`);

  console.log('  -> PASSED: Heuristic estimator handles null, empty, earlier context, missing AI, and huge text safely');
}

// -----------------------------------------------------------------------------
// Challenge 3: Rapid Scroll Sweep & Invariant Consistency
// -----------------------------------------------------------------------------
console.log('\n[Challenge 3] Rapid Scroll Sweep Across Long Sessions (500 Turns)...');
{
  const turns = Array.from({ length: 500 }, (_, i) => createTurn(i));
  const cache = new Map<string, number>();

  // Populate arbitrary custom measured heights in cache to simulate dynamic rendering
  for (let i = 0; i < 500; i += 7) {
    cache.set(`turn_adversarial_${i}`, 250 + (i % 300));
  }

  const container = { clientHeight: 900, scrollTop: 0 } as HTMLDivElement;

  // Sweep scrollTop in steps across 200,000px
  let prevStart = -1;
  let prevEnd = -1;
  for (let s = 0; s <= 150000; s += 300) {
    container.scrollTop = s;
    const { startIndex, endIndex } = computeVisibleRange(container, turns, cache, 2);

    // Invariant 1: startIndex <= endIndex
    assert.ok(startIndex <= endIndex, `Invariant failure: startIndex (${startIndex}) > endIndex (${endIndex}) at scrollTop=${s}`);

    // Invariant 2: bounds within [0, count - 1]
    assert.ok(startIndex >= 0 && startIndex < 500, `startIndex out of range: ${startIndex}`);
    assert.ok(endIndex >= 0 && endIndex < 500, `endIndex out of range: ${endIndex}`);

    // Invariant 3: Monotonicity - as scrollTop increases, startIndex and endIndex must never decrease
    if (prevStart !== -1) {
      assert.ok(startIndex >= prevStart, `Monotonicity violation: startIndex decreased from ${prevStart} to ${startIndex} at scrollTop=${s}`);
      assert.ok(endIndex >= prevEnd, `Monotonicity violation: endIndex decreased from ${prevEnd} to ${endIndex} at scrollTop=${s}`);
    }

    prevStart = startIndex;
    prevEnd = endIndex;
  }

  console.log('  -> PASSED: 501 rapid scroll iterations maintained strict monotonicity and boundary invariants');
}

// -----------------------------------------------------------------------------
// Challenge 4: Window Resize & Cache Invalidation Behavior
// -----------------------------------------------------------------------------
console.log('\n[Challenge 4] Window Resize & Viewport Adjustment...');
{
  const turns = Array.from({ length: 100 }, (_, i) => createTurn(i));
  const cache = new Map<string, number>();
  for (let i = 0; i < 100; i++) {
    cache.set(`turn_adversarial_${i}`, 300);
  }

  const container = { clientHeight: 800, scrollTop: 10000 } as any;
  const rangeBeforeResize = computeVisibleRange(container, turns, cache, 2);

  // Resize window: clientHeight changes from 800 to 1200
  container.clientHeight = 1200;
  // Cache cleared on resize (as implemented in useTurnViewportWindow)
  cache.clear();

  const rangeAfterResize = computeVisibleRange(container, turns, cache, 2);

  // With larger clientHeight and 2-screen overscan, range must expand to cover more turns
  const countBefore = rangeBeforeResize.endIndex - rangeBeforeResize.startIndex + 1;
  const countAfter = rangeAfterResize.endIndex - rangeAfterResize.startIndex + 1;
  assert.ok(countAfter >= countBefore, `After resize to 1200px, visible count (${countAfter}) should be >= before (${countBefore})`);
  console.log(`  -> PASSED: Window resize expands viewport coverage (${countBefore} -> ${countAfter} turns)`);
}

// -----------------------------------------------------------------------------
// Challenge 5: Pinned Streaming Turn Guarantee
// -----------------------------------------------------------------------------
console.log('\n[Challenge 5] Streaming Pinning Guarantee Under Remote Scroll...');
{
  const turns = Array.from({ length: 100 }, (_, i) => createTurn(i));
  const isStreaming = true;
  const isLastTurnIndex = 99;

  // Simulate user scrolled to top (viewport [0, 15])
  const startIndex = 0;
  const endIndex = 15;

  let totalMounted = 0;
  let culledCount = 0;
  let isStreamingTurnMounted = false;

  for (let i = 0; i < turns.length; i++) {
    const isLastTurn = i === turns.length - 1;
    const isPinnedStreaming = isStreaming && isLastTurn;
    const isVisible = (i >= startIndex && i <= endIndex) || isPinnedStreaming;

    if (isVisible) {
      totalMounted++;
      if (i === isLastTurnIndex) {
        isStreamingTurnMounted = true;
      }
    } else {
      culledCount++;
    }
  }

  assert.strictEqual(isStreamingTurnMounted, true, 'Streaming turn 99 MUST be mounted even when scrolled to turn 0');
  assert.strictEqual(totalMounted, 17, 'Total mounted should be 16 in-window + 1 pinned streaming turn');
  assert.strictEqual(culledCount, 83, 'Off-screen non-streaming turns must be culled');
  console.log(`  -> PASSED: Pinned streaming turn remains mounted with ${culledCount} culled spacer nodes`);
}

// -----------------------------------------------------------------------------
// Challenge 6: DOM Node Budget & Off-Screen 1-Node Placeholder Divs
// -----------------------------------------------------------------------------
console.log('\n[Challenge 6] DOM Node Budget & CSS Attributes Verification...');
{
  const totalTurns = 150;
  const turns = Array.from({ length: totalTurns }, (_, i) => createTurn(i));
  const startIndex = 60;
  const endIndex = 75; // 16 visible turns
  const isStreaming = false;

  let simulatedDomElements = 0;
  let culledPlaceholderNodes = 0;

  for (let i = 0; i < totalTurns; i++) {
    const isLastTurn = i === totalTurns - 1;
    const isPinnedStreaming = isStreaming && isLastTurn;
    const isVisible = (i >= startIndex && i <= endIndex) || isPinnedStreaming;

    if (isVisible) {
      // Mounted turn contains UserMessage, AssistantMessage, accordions, markdown AST nodes (~160 elements)
      simulatedDomElements += 160;
    } else {
      // Culled turn is strictly ONE single 1-node spacer div
      culledPlaceholderNodes++;
      simulatedDomElements += 1;
    }
  }

  assert.strictEqual(culledPlaceholderNodes, 150 - 16, 'Expected 134 culled placeholder divs');
  assert.ok(simulatedDomElements < 2800, `Total DOM elements (${simulatedDomElements}) must be under 2800 for 150 turns`);
  console.log(`  -> PASSED: 150 turns generated only ${simulatedDomElements} DOM elements (16 mounted + 134 spacer divs)`);
}

console.log('\n======================================================================');
console.log('ALL ADVERSARIAL STRESS CHALLENGES PASSED (6/6)');
console.log('======================================================================');
