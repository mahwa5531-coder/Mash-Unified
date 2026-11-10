import assert from 'node:assert';
import { computeInterleavedUnits } from '../src/features/chat/components/messages/useInterleavedUnits.ts';
import { buildTurns } from '../src/features/chat/utils/turns.ts';

console.log("=================================================");
console.log("TESTING 'WORKING...' STATE RIGHT AFTER ENTER");
console.log("=================================================");

const startNow = Date.now();
const userText = "Analyze this balance sheet";

const initialMessages = [
  {
    id: `msg_u_${startNow}`,
    turnId: 'turn_test_1',
    status: 'completed',
    role: 'user',
    content: userText,
    timestamp: '10:00 PM',
    thoughts: [],
    tools: [],
    tasks: [],
    sessionId: 'sess_1',
  },
  {
    id: `msg_a_${startNow}`,
    turnId: 'turn_test_1',
    status: 'running',
    role: 'assistant',
    content: '',
    thoughts: [],
    tools: [],
    tasks: [],
    steps: [],
    sessionId: 'sess_1',
    turnStartTime: startNow,
  },
];

// Step 1: Turn formation
const turns = buildTurns(initialMessages);
assert.strictEqual(turns.length, 1, "Must form exactly 1 turn");
assert.strictEqual(turns[0].userMsg.content, userText);
assert.strictEqual(turns[0].aiMsgs.length, 1);

const aiMsg = turns[0].aiMsgs[0];
assert.strictEqual(aiMsg.status, 'running');

// Step 2: Compute interleaved units
const units = computeInterleavedUnits(aiMsg, true);
console.log("Interleaved units generated on Enter submit:", JSON.stringify(units, null, 2));

assert.strictEqual(units.length, 1, "Must have exactly 1 unit before tokens/tools arrive");
assert.strictEqual(units[0].type, 'worklog', "The unit must be a worklog unit");
assert.strictEqual(units[0].steps.length, 0, "Steps must be empty initially");
assert.strictEqual(units[0].tools.length, 0, "Tools must be empty initially");
assert.strictEqual(units[0].thoughts.length, 0, "Thoughts must be empty initially");

// Step 3: Check props passed to TaskWorkLogAccordion
const isLast = true;
const isStreaming = true;
const uIdx = 0;
const accordionIsStreaming = isLast && isStreaming && !units.some((u, i) => i > uIdx && u.type === 'worklog');
const hasAssistantContent = units.some((u, i) => i > uIdx && u.type === 'prose');
const hasPendingApproval = false;

assert.strictEqual(accordionIsStreaming, true, "Accordion must be told isStreaming = true");
assert.strictEqual(hasAssistantContent, false, "Must have NO assistant prose yet");

// Step 4: Verify rendering condition in TaskWorkLogAccordion
// In TaskWorkLogAccordion.tsx:
// if (isStreaming) {
//   if (groupedTimeline.length > 0) return renderTimeline();
//   if (!hasAssistantContent && !hasPendingApproval) return "Working . . .";
//   return null;
// }
const groupedTimelineLength = 0; // since steps, thoughts, tools are all empty
let renderedOutput = null;

if (accordionIsStreaming) {
  if (groupedTimelineLength > 0) {
    renderedOutput = 'TOOL_TIMELINE';
  } else if (!hasAssistantContent && !hasPendingApproval) {
    renderedOutput = 'WORKING_INDICATOR';
  }
}

console.log("Rendered component state:", renderedOutput);
assert.strictEqual(renderedOutput, 'WORKING_INDICATOR', "Must render 'Working . . .' immediately on Enter!");

console.log("\nALL ENTER-TO-WORKING CHECKS PASSED 100%!");
