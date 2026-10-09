import assert from 'node:assert/strict';

// Test 1: Verify Callout regex matches both [TAG] and [!TAG] with optional trailing title
const REGEX = /^\s*\[!?(EXCEPTION|MATERIAL WEAKNESS|FAIL|WARNING|CAUTION|CONTROL DEFICIENCY|SIGNIFICANT DEFICIENCY|COMPLIANT|PASS|NOTE|TIP|IMPORTANT|RED|GREEN|AMBER|BLUE|NEUTRAL)\](?:\s*([^\n\r]+))?/i;

const testCases = [
  { input: '> [WARNING] MATERIAL DEPRECIATION VARIANCE DETECTED', expectedTag: 'WARNING', expectedTitle: 'MATERIAL DEPRECIATION VARIANCE DETECTED' },
  { input: '> [!WARNING] Material issue', expectedTag: 'WARNING', expectedTitle: 'Material issue' },
  { input: '> [NOTE]', expectedTag: 'NOTE', expectedTitle: undefined },
  { input: '> [!NOTE]', expectedTag: 'NOTE', expectedTitle: undefined },
  { input: '> [!CAUTION] Critical balance mismatch', expectedTag: 'CAUTION', expectedTitle: 'Critical balance mismatch' },
  { input: '> [RED]', expectedTag: 'RED', expectedTitle: undefined },
  { input: '> [AMBER] Threshold exceeded', expectedTag: 'AMBER', expectedTitle: 'Threshold exceeded' },
];

for (const tc of testCases) {
  const m = tc.input.replace(/^>\s*/, '').match(REGEX);
  assert(m !== null, `Failed to match input: ${tc.input}`);
  assert.equal(m[1].toUpperCase(), tc.expectedTag, `Expected tag ${tc.expectedTag}, got ${m[1]}`);
  assert.equal(m[2]?.trim(), tc.expectedTitle, `Expected title ${tc.expectedTitle}, got ${m[2]?.trim()}`);
}

// Test 2: Verify cleaner removes tag and title cleanly
function cleanTagAndTitle(text, tag, title) {
  const tagEscaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titlePattern = title ? `(?:\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?` : '';
  const reg = new RegExp(`^\\s*\\[!?${tagEscaped}\\]${titlePattern}\\s*`, 'i');
  return text.replace(reg, '');
}

const cleaned = cleanTagAndTitle(
  '[WARNING] MATERIAL DEPRECIATION VARIANCE DETECTED\nPlant & Machinery asset FA-PM-1042',
  'WARNING',
  'MATERIAL DEPRECIATION VARIANCE DETECTED'
);
assert.equal(cleaned, 'Plant & Machinery asset FA-PM-1042', 'Cleaner must strip tag and title cleanly');

console.log('All blockquote and badge logic tests PASSED!');
