import assert from 'node:assert/strict';
import { formatFilePill } from '../src/features/chat/components/messages/proseHelpers.js';
import { repairMermaidSyntax } from '../src/components/renderers/MermaidRenderer.js';
import { highlightCodeSnippet } from '../src/components/renderers/CodeBlock.js';

console.log('Running test_streamdown_units_topology...');

// 1. Check formatFilePill preserves relative folder paths
const pill1 = formatFilePill('working_papers/lead_schedule.md', 'working_papers/lead_schedule.md');
assert.equal(pill1.display, 'working_papers/lead_schedule.md', 'Must preserve relative folder path');
assert.equal(pill1.filePath, 'working_papers/lead_schedule.md');

const pillWithLine = formatFilePill('audit_deliverables/summary.xlsx#L45', 'audit_deliverables/summary.xlsx#L45');
assert.equal(pillWithLine.display, 'audit_deliverables/summary.xlsx:45', 'Must preserve relative folder and line number');

// 2. Check repairMermaidSyntax heals special characters and missing declaration
const rawMermaid = `A[Audit Risk (SA 315)] --> B[Substantive Testing & 100% Confirmation]`;
const repaired = repairMermaidSyntax(rawMermaid);
assert.match(repaired, /flowchart TD/, 'Must auto-inject missing declaration');
assert.match(repaired, /\["Audit Risk \(SA 315\)"\]/, 'Must quote label with parentheses');

// 3. Check highlightCodeSnippet runs fast without errors
const tsCode = `const x: number = 42; // test comment\nconsole.log(x);`;
const html = highlightCodeSnippet(tsCode, 'ts', true);
assert.match(html, /text-purple-400/, 'Must highlight keywords in dark mode');
assert.match(html, /text-zinc-500 italic/, 'Must highlight comments');

console.log('ALL TOPOLOGY TESTS PASSED!');
