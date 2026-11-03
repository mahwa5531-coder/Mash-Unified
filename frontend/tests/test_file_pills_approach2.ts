import assert from 'node:assert';
import { isFullFilePath, prunePathPunctuation, processTextNodes } from '../src/features/chat/components/messages/proseHelpers';
import React from 'react';
import { FilePill } from '../src/primitives';

console.log('--- STARTING FILE PILLS APPROACH 2 & PRUNING VERIFICATION TESTS ---');

// Test 1: Structural Path Classification (Approach 2)
console.log('\n[Suite 1: Structural Path Classification]');
{
  // 1. Explicit relative paths (any dynamic user folder)
  assert.ok(isFullFilePath('./FY26_Vouchers/invoice_102.pdf'), 'Explicit relative with ./ must pass');
  assert.ok(isFullFilePath('./Client_Ledgers/tata.xlsx'), 'Dynamic client folder with ./ must pass');
  assert.ok(isFullFilePath('../audit_evidence/SBI_Confirmation.pdf'), 'Parent relative with ../ must pass');
  assert.ok(isFullFilePath('./data/sampling.csv'), './data/*.csv must pass');

  // 2. System Audit Roots (no ./ required)
  assert.ok(isFullFilePath('Audit_Deliverables/CARO_2020.docx'), 'Audit_Deliverables must pass');
  assert.ok(isFullFilePath('working_papers/lead_schedule.xlsx'), 'working_papers must pass');
  assert.ok(isFullFilePath('workpapers/reconciliation.csv'), 'workpapers must pass');
  assert.ok(isFullFilePath('scratch/debug.log'), 'scratch must pass');

  // 3. Absolute paths
  assert.ok(isFullFilePath('C:/Audits/FY26/report.pdf'), 'Windows absolute path must pass');
  assert.ok(isFullFilePath('file:///C:/Users/rama/Downloads/Mash/workpapers/test.xlsx'), 'file:// URI must pass');

  // 4. Strict Non-Files (Must be rejected to prevent false positives)
  assert.strictEqual(isFullFilePath('npm run build'), false, 'Shell command must be rejected');
  assert.strictEqual(isFullFilePath('total_revenue'), false, 'Code identifier must be rejected');
  assert.strictEqual(isFullFilePath('version 2.0.1'), false, 'Version number must be rejected');
  assert.strictEqual(isFullFilePath('some_variable_name'), false, 'Variable name must be rejected');
  assert.strictEqual(isFullFilePath('just a regular sentence.txt'), false, 'Sentence with spaces must be rejected');
  assert.strictEqual(isFullFilePath('example.com'), false, 'Web domain must be rejected');
  assert.strictEqual(isFullFilePath('node_modules/pkg/index.js'), false, 'node_modules must be rejected');

  console.log('  ✓ PASSED: All structural categories verified with zero false positives on commands/variables.');
}

// Test 2: Punctuation Pruning
console.log('\n[Suite 2: Boundary & Punctuation Pruning]');
{
  // Trailing period
  const r1 = prunePathPunctuation("'./vouchers/invoice_102.pdf'.");
  assert.strictEqual(r1.cleanPath, './vouchers/invoice_102.pdf');
  assert.strictEqual(r1.trailingPunctuation, "'.");

  // Trailing comma
  const r2 = prunePathPunctuation('Audit_Deliverables/CARO_2020.docx,');
  assert.strictEqual(r2.cleanPath, 'Audit_Deliverables/CARO_2020.docx');
  assert.strictEqual(r2.trailingPunctuation, ',');

  // Enclosed in parentheses
  const r3 = prunePathPunctuation('(working_papers/lead_schedule.xlsx)');
  assert.strictEqual(r3.cleanPath, 'working_papers/lead_schedule.xlsx');
  assert.strictEqual(r3.trailingPunctuation, ')');

  // Trailing colon
  const r4 = prunePathPunctuation('"./data/sampling.csv":');
  assert.strictEqual(r4.cleanPath, './data/sampling.csv');
  assert.strictEqual(r4.trailingPunctuation, '":');

  console.log('  ✓ PASSED: Quotes, sentence periods, commas, colons, and parens pruned with 100% precision.');
}

// Test 3: Prose Splitting & React Element Generation
console.log('\n[Suite 3: Prose Splitting & AST Children]');
{
  const prose = "Please review './FY26_Vouchers/invoice_102.pdf'. Then inspect Audit_Deliverables/CARO_2020.docx, thanks.";
  const nodes = processTextNodes(prose) as any[];

  assert.ok(Array.isArray(nodes), 'Must return array of nodes');
  assert.strictEqual(nodes.length, 5, `Expected 5 node segments, got ${nodes.length}`);
  
  assert.strictEqual(nodes[0], "Please review '");
  assert.ok(React.isValidElement(nodes[1]), 'Node 1 must be a React Element');
  assert.strictEqual(nodes[1].type, FilePill);
  assert.strictEqual((nodes[1] as any).props.path, './FY26_Vouchers/invoice_102.pdf');
  assert.strictEqual((nodes[1] as any).props.label, 'invoice_102.pdf');

  assert.strictEqual(nodes[2], "'. Then inspect ");
  assert.ok(React.isValidElement(nodes[3]), 'Node 3 must be a React Element');
  assert.strictEqual(nodes[3].type, FilePill);
  assert.strictEqual((nodes[3] as any).props.path, 'Audit_Deliverables/CARO_2020.docx');
  assert.strictEqual((nodes[3] as any).props.label, 'CARO_2020.docx');

  assert.strictEqual(nodes[4], ", thanks.");

  console.log('  ✓ PASSED: Prose correctly transformed into interactive FilePills with trailing punctuation preserved in grammar.');
}

console.log('\n======================================================================');
console.log('ALL FILE PILLS APPROACH 2 & PRUNING TESTS PASSED (3/3 SUITES)');
console.log('======================================================================\n');
