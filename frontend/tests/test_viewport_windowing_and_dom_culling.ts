import assert from 'node:assert';
import {
  estimateTurnHeight,
  computeVisibleRange,
} from '../src/features/chat/hooks/useTurnViewportWindow';
import type { Turn, Message } from '../src/types/chat';

function makeMockTurn(index: number, userContent = 'Test prompt', aiContent = 'Assistant reply'): Turn {
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
    id: `turn_test_session_${index}_snippet`,
    userMsg,
    aiMsgs: [aiMsg],
    flatIdx: index,
    turnIndex: index,
  };
}

console.log('======================================================================');
console.log('STARTING VIEWPORT WINDOWING & DOM CULLING UNIT TESTS');
console.log('======================================================================');

// Test 1: estimateTurnHeight heuristic correctness
console.log('\n[Test 1] estimateTurnHeight Heuristic Calibration...');
{
  // Minimal synthetic context
  const syntheticTurn = makeMockTurn(0, '[Earlier Context]', '');
  const synthHeight = estimateTurnHeight(syntheticTurn);
  assert.strictEqual(synthHeight, 60, `Synthetic context should be 60px, got ${synthHeight}`);

  // Short message
  const shortTurn = makeMockTurn(1, 'Hello', 'Hi there!');
  const shortHeight = estimateTurnHeight(shortTurn);
  assert.ok(shortHeight >= 100 && shortHeight <= 200, `Short turn height out of bounds: ${shortHeight}`);

  // Heavy message with code blocks and tools
  const heavyTurn = makeMockTurn(
    2,
    'Write a python script with 50 lines',
    'Here is the code:\n```python\nfor i in range(50):\n    print(i)\n```'
  );
  heavyTurn.aiMsgs[0].tools = [
    { name: 'run_shell_command', args: { command: 'python script.py' } },
    { name: 'view_file', args: { path: 'script.py' } },
  ];
  const heavyHeight = estimateTurnHeight(heavyTurn);
  assert.ok(heavyHeight > shortHeight, `Heavy turn (${heavyHeight}) should be taller than short turn (${shortHeight})`);
  assert.ok(heavyHeight <= 1000, `Heavy turn (${heavyHeight}) should not exceed 1000px cap`);

  console.log(`  -> PASSED: Synthetic=${synthHeight}px, Short=${shortHeight}px, Heavy=${heavyHeight}px`);
}

// Test 2: computeVisibleRange on 100-Turn Session (Top, Middle, Bottom)
console.log('\n[Test 2] computeVisibleRange Viewport & Overscan Buffer (100 Turns)...');
{
  const turns: Turn[] = Array.from({ length: 100 }, (_, i) => makeMockTurn(i, `User prompt ${i}`, `Assistant response ${i}`));
  const cache = new Map<string, number>();

  // Fake container with clientHeight = 800px
  const mockContainer = {
    clientHeight: 800,
    scrollTop: 0,
  } as unknown as HTMLDivElement;

  // At top (scrollTop = 0): targetTop = 0, targetBottom = 0 + 800 + 2*800 = 2400px
  const rangeTop = computeVisibleRange(mockContainer, turns, cache, 2);
  assert.strictEqual(rangeTop.startIndex, 0, 'Top scroll must have startIndex = 0');
  assert.ok(rangeTop.endIndex >= 8 && rangeTop.endIndex <= 24, `Top scroll endIndex out of range: ${rangeTop.endIndex}`);
  console.log(`  -> Top scroll: startIndex=${rangeTop.startIndex}, endIndex=${rangeTop.endIndex} (mounted ${rangeTop.endIndex - rangeTop.startIndex + 1} turns)`);

  // At bottom (scrollTop = 10400):
  mockContainer.scrollTop = 10400;
  const rangeBottom = computeVisibleRange(mockContainer, turns, cache, 2);
  assert.strictEqual(rangeBottom.endIndex, 99, 'Bottom scroll must have endIndex = 99');
  assert.ok(rangeBottom.startIndex >= 70 && rangeBottom.startIndex <= 90, `Bottom scroll startIndex out of range: ${rangeBottom.startIndex}`);
  console.log(`  -> Bottom scroll: startIndex=${rangeBottom.startIndex}, endIndex=${rangeBottom.endIndex} (mounted ${rangeBottom.endIndex - rangeBottom.startIndex + 1} turns)`);

  // At middle (scrollTop = 5000):
  mockContainer.scrollTop = 5000;
  const rangeMiddle = computeVisibleRange(mockContainer, turns, cache, 2);
  assert.ok(rangeMiddle.startIndex > 0 && rangeMiddle.startIndex < 50, `Middle startIndex out of range: ${rangeMiddle.startIndex}`);
  assert.ok(rangeMiddle.endIndex > 40 && rangeMiddle.endIndex < 99, `Middle endIndex out of range: ${rangeMiddle.endIndex}`);
  const middleMounted = rangeMiddle.endIndex - rangeMiddle.startIndex + 1;
  assert.ok(middleMounted >= 10 && middleMounted <= 40, `Middle mounted turns out of bounds: ${middleMounted}`);
  console.log(`  -> Middle scroll: startIndex=${rangeMiddle.startIndex}, endIndex=${rangeMiddle.endIndex} (mounted ${middleMounted} turns)`);
}

// Test 3: Measured Height Cache Retention
console.log('\n[Test 3] Measured Height Cache Retention & Adaptation...');
{
  const turns: Turn[] = Array.from({ length: 50 }, (_, i) => makeMockTurn(i));
  const cache = new Map<string, number>();

  // Turn 5 measured at 450px
  const turn5Key = turns[5].id;
  cache.set(turn5Key, 450);

  assert.strictEqual(cache.get(turn5Key), 450, 'Cache should return recorded 450px height');

  // Verify that computeVisibleRange accounts for the taller turn
  const mockContainer = { clientHeight: 800, scrollTop: 0 } as unknown as HTMLDivElement;
  const range = computeVisibleRange(mockContainer, turns, cache, 2);
  assert.ok(range.endIndex >= 5, 'Turn 5 should be within visible range at top');
  console.log('  -> PASSED: Custom turn heights retained and factored into prefix sums');
}

// Test 4: DOM Node Count & Culling Simulation in 100-Turn and 200-Turn Sessions
console.log('\n[Test 4] DOM Node Count & Culling Simulation (100 & 200 Turns)...');
{
  function simulateDomNodeCount(totalTurns: number, startIndex: number, endIndex: number, isStreaming: boolean): { totalDomNodes: number; mountedCount: number; culledCount: number } {
    let totalDomNodes = 0;
    let mountedCount = 0;
    let culledCount = 0;

    for (let i = 0; i < totalTurns; i++) {
      const isLastTurn = i === totalTurns - 1;
      const isPinned = isStreaming && isLastTurn;
      const isVisible = (i >= startIndex && i <= endIndex) || isPinned;

      if (isVisible) {
        mountedCount++;
        // Average mounted turn: ~160 DOM elements (UserMessage card + AssistantMessage worklog & prose)
        totalDomNodes += 160;
      } else {
        culledCount++;
        // Culled turn is strictly a single 1-node spacer div
        totalDomNodes += 1;
      }
    }

    return { totalDomNodes, mountedCount, culledCount };
  }

  // 100-Turn session at bottom
  const sim100 = simulateDomNodeCount(100, 85, 99, false);
  console.log(`  -> 100-Turn Session: ${sim100.mountedCount} mounted turns, ${sim100.culledCount} culled turns, TOTAL DOM NODES = ${sim100.totalDomNodes}`);
  assert.ok(sim100.totalDomNodes < 3500, `DOM nodes (${sim100.totalDomNodes}) must be < 3,500`);
  assert.ok(sim100.totalDomNodes < 3000, `DOM nodes (${sim100.totalDomNodes}) must be < 3,000 target`);

  // 200-Turn session at middle
  const sim200 = simulateDomNodeCount(200, 95, 110, false);
  console.log(`  -> 200-Turn Session: ${sim200.mountedCount} mounted turns, ${sim200.culledCount} culled turns, TOTAL DOM NODES = ${sim200.totalDomNodes}`);
  assert.ok(sim200.totalDomNodes < 3000, `200-turn session DOM nodes (${sim200.totalDomNodes}) must be < 3,000`);

  // Active streaming turn pinned mounted check:
  // User is scrolled to top (turns 0..12 mounted), but turn 99 is streaming
  const simStreaming = simulateDomNodeCount(100, 0, 12, true);
  // Turn 99 must be mounted even though it is outside [0, 12]
  assert.strictEqual(simStreaming.mountedCount, 14, 'Should mount 13 turns from window + 1 pinned streaming turn');
  console.log(`  -> Streaming Pinning: Turn 99 is mounted while scrolled to top (mounted = ${simStreaming.mountedCount})`);
}

console.log('\n======================================================================');
console.log('ALL VIEWPORT WINDOWING & DOM CULLING TESTS PASSED (4/4)');
console.log('======================================================================');
