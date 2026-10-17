import assert from 'node:assert';
import { generateCleanSessionTitle } from '../src/utils/sessionTitle';
import { cleanAssistantContent, cleanUserSteeringEnvelope, cleanUserPromptForComposer } from '../src/features/chat/utils/sessionHistoryParser';

console.log('======================================================================');
console.log('STARTING SESSION TITLE & PROTOCOL TAG LEAKAGE AUDIT TESTS');
console.log('======================================================================');

// 1. Session Title Generation Matrix
console.log('\n[Test 1] Session Title Generation Matrix...');

// 1.1 Prompt with attached file
const t1 = generateCleanSessionTitle('Calculate depreciation\n\n[Attached file: C:\\Users\\FAR_2025.xlsx]');
assert.strictEqual(t1, 'Calculate Depreciation', `Expected 'Calculate Depreciation', got ${t1}`);

// 1.2 Mid-flight steering envelope
const t2 = generateCleanSessionTitle('<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Change chart color to navy</USER_STEERING>');
assert.strictEqual(t2, 'Change Chart Color to Navy', `Expected 'Change Chart Color to Navy', got ${t2}`);

// 1.3 Attachment-only prompt (single file)
const t3 = generateCleanSessionTitle('[Attached file: C:\\Users\\doc.pdf]');
assert.strictEqual(t3, 'Doc.pdf', `Expected 'Doc.pdf', got ${t3}`);

// 1.4 Attachment-only prompt (plural files tag)
const t4 = generateCleanSessionTitle('[Attached files: C:\\Users\\audit_bundle.zip]');
assert.strictEqual(t4, 'Audit_bundle.zip', `Expected 'Audit_bundle.zip', got ${t4}`);

// 1.5 Composer default filler + attachment
const t5 = generateCleanSessionTitle('Please inspect and analyze the attached audit documents:\n[Attached file: C:\\Users\\FAR.xlsx]');
assert.strictEqual(t5, 'FAR.xlsx', `Expected 'FAR.xlsx', got ${t5}`);

// 1.6 Standalone filesystem path
const t6 = generateCleanSessionTitle('C:\\Projects\\repo');
assert.strictEqual(t6, 'Repo', `Expected 'Repo', got ${t6}`);

// 1.7 Protocol sentinels return clean fallback
const t7 = generateCleanSessionTitle('[DONE]', 'sess_12345678');
assert.strictEqual(t7, 'New Conversation', `Expected 'New Conversation', got ${t7}`);

const t8 = generateCleanSessionTitle('[VERIFIED]', '');
assert.strictEqual(t8, 'New Conversation', `Expected 'New Conversation', got ${t8}`);

const t9 = generateCleanSessionTitle('[empty]', '');
assert.strictEqual(t9, 'New Conversation', `Expected 'New Conversation', got ${t9}`);

const t10 = generateCleanSessionTitle('<session_mode>Audit fixed assets</session_mode>', '');
assert.strictEqual(t10, 'Audit Fixed Assets', `Expected 'Audit Fixed Assets', got ${t10}`);

const t11 = generateCleanSessionTitle('[sub_agent_id: agent_42] Inspect inventory', '');
assert.strictEqual(t11, 'Inspect Inventory', `Expected 'Inspect Inventory', got ${t11}`);

console.log('  -> PASSED: All 11 session title matrix cases verified without tag or bracket leakage');

// 2. Assistant Content Tag Sanitization
console.log('\n[Test 2] Assistant Content Tag Sanitization...');

assert.strictEqual(cleanAssistantContent('[empty]'), '');
assert.strictEqual(cleanAssistantContent('[DONE]'), '');
assert.strictEqual(cleanAssistantContent('[END]'), '');
assert.strictEqual(cleanAssistantContent('Here is the plan [VERIFIED] ready to proceed'), 'Here is the plan ready to proceed');
assert.strictEqual(cleanAssistantContent('<user_message>hello</user_message>'), 'hello');
assert.strictEqual(cleanAssistantContent('<assistant_message>response</assistant_message>'), 'response');
assert.strictEqual(cleanAssistantContent('<session_mode>audit</session_mode>Report prepared.'), 'auditReport prepared.');
assert.strictEqual(cleanAssistantContent('<skills><SkillDetails>file_inspect</SkillDetails></skills>Done.'), 'file_inspectDone.');
assert.strictEqual(cleanAssistantContent('<tool_use>run</tool_use><tool_result>ok</tool_result>Finished.'), 'runokFinished.');
assert.strictEqual(cleanAssistantContent('[sub_agent_id: ag_1] Subagent completed task.'), 'Subagent completed task.');
assert.strictEqual(cleanAssistantContent('[SYSTEM NOTICE: Tool timed out] Retrying now.'), 'Retrying now.');

console.log('  -> PASSED: All internal protocol tags and section wrappers stripped cleanly from assistant messages');

// 3. User Steering Tag Sanitization
console.log('\n[Test 3] User Steering Tag Sanitization...');

const steerInput = '<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Stop current tool and plot histogram\nAdapt your current plan and respond to this instruction immediately.</USER_STEERING>';
assert.strictEqual(cleanUserSteeringEnvelope(steerInput), 'Stop current tool and plot histogram');

const simpleSteer = '<USER_STEERING>Please switch to dark mode</USER_STEERING>';
assert.strictEqual(cleanUserSteeringEnvelope(simpleSteer), 'Please switch to dark mode');

console.log('  -> PASSED: User mid-flight steering envelope stripped cleanly to authentic user intent');

// 4. Composer Textarea Sanitization (Undo & Edit Queued)
console.log('\n[Test 4] Composer Textarea Sanitization (cleanUserPromptForComposer)...');

assert.strictEqual(
  cleanUserPromptForComposer('Review depreciation schedule\n\n[Attached file: C:\\Users\\FAR_2025.xlsx]'),
  'Review depreciation schedule'
);

assert.strictEqual(
  cleanUserPromptForComposer('Please inspect and analyze the attached audit documents:\n[Attached file: C:\\FAR.xlsx]'),
  ''
);

assert.strictEqual(
  cleanUserPromptForComposer('<USER_STEERING>[USER MID-FLIGHT INSTRUCTION]: Change chart color to navy</USER_STEERING>'),
  'Change chart color to navy'
);

assert.strictEqual(
  cleanUserPromptForComposer('[sub_agent_id: sub_1] Continue execution'),
  'Continue execution'
);

console.log('  -> PASSED: cleanUserPromptForComposer sanitizes undo and queued prompts without leaking attachments or tags');

console.log('\n======================================================================');
console.log('ALL SESSION TITLE & PROTOCOL TAG LEAKAGE TESTS PASSED');
console.log('======================================================================\n');

