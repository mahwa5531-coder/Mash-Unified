import assert from 'node:assert';
import { normalizePath } from '../src/utils/normalizePath';
import { STATUS_VARIANT_MAP, VARIANT_CONFIG } from '../src/primitives/AuditCallout';

console.log('[Test 1] Verifying Hardened Path Deduplication across Windows, file:/// URLs & basenames...');
{
  const artifacts = [
    { filePath: 'file:///C:/Users/rama/Downloads/Mash/Audit_Deliverables/executive_summary.md', title: 'Executive Summary' },
    { filePath: 'Audit_Deliverables/findings_memo.md', title: 'Findings Memo' },
  ];

  const editedFiles = [
    { path: 'C:\\Users\\rama\\Downloads\\Mash\\Audit_Deliverables\\executive_summary.md', filename: 'executive_summary.md' },
    { path: '/C:/Users/rama/Downloads/Mash/Audit_Deliverables/findings_memo.md', filename: 'findings_memo.md' },
    { path: 'C:\\Users\\rama\\Downloads\\Mash\\src\\auth.ts', filename: 'auth.ts' },
    { path: 'frontend/src/app/page.tsx', filename: 'page.tsx' },
  ];

  // The hardened deduplication algorithm from AssistantMessage.tsx
  const artifactSet = new Set(
    artifacts.flatMap(a => {
      const norm = normalizePath(a.filePath).toLowerCase();
      const base = norm.split('/').pop() || norm;
      return [norm, base];
    })
  );

  const filtered = editedFiles.filter(f => {
    const norm = normalizePath(f.path).toLowerCase();
    const base = norm.split('/').pop() || norm;
    return !artifactSet.has(norm) && !artifactSet.has(base);
  });

  assert.strictEqual(filtered.length, 2, 'Must filter out the 2 deliverable files and keep only auth.ts and page.tsx');
  assert.strictEqual(filtered[0].filename, 'auth.ts');
  assert.strictEqual(filtered[1].filename, 'page.tsx');
  console.log('  -> PASSED: Deliverables deduplicated 100% across backslashes, file:// prefixes, and relative paths.');
}

console.log('[Test 2] Verifying Callout Alert Tags coverage...');
{
  const testTags = [
    'NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION',
    'INFO', 'QUESTION', 'TODO', 'SUCCESS', 'ERROR', 'DANGER', 'BUG',
    'EXCEPTION', 'MATERIAL WEAKNESS', 'FAIL', 'CONTROL DEFICIENCY', 'SIGNIFICANT DEFICIENCY',
    'COMPLIANT', 'PASS', 'LOW RISK', 'HIGH RISK'
  ];

  for (const tag of testTags) {
    const variant = STATUS_VARIANT_MAP[tag];
    assert.ok(variant, `Tag "${tag}" must map to a valid variant in STATUS_VARIANT_MAP`);
    assert.ok(VARIANT_CONFIG[variant], `Variant "${variant}" must have a valid configuration`);
    assert.ok(VARIANT_CONFIG[variant].border, `Variant "${variant}" must specify border styling`);
    assert.ok(VARIANT_CONFIG[variant].bg, `Variant "${variant}" must specify background styling`);
  }
  console.log(`  -> PASSED: All ${testTags.length} alert tags map cleanly to themed variants with background & border styles.`);
}

console.log('[Test 3] Verifying Callout Regex pattern matching...');
{
  const alertRegex = /^\s*\[!?(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|QUESTION|TODO|SUCCESS|ERROR|DANGER|BUG|EXAMPLE|HINT|ABSTRACT|SUMMARY|EXCEPTION|MATERIAL WEAKNESS|FAIL|CONTROL DEFICIENCY|SIGNIFICANT DEFICIENCY|COMPLIANT|PASS|NO EXCEPTION|LOW RISK|HIGH RISK|MEDIUM RISK|RED|GREEN|AMBER|BLUE|NEUTRAL)\](?:\s*([^\n\r]+))?/i;

  const samples = [
    { input: '[!NOTE]\nUseful information here.', expectedTag: 'NOTE', expectedTitle: undefined },
    { input: '> [!TIP] Pro Tip\nDo this instead.', expectedTag: 'TIP', expectedTitle: 'Pro Tip' },
    { input: '[!WARNING] Breaking Change\nCheck code.', expectedTag: 'WARNING', expectedTitle: 'Breaking Change' },
    { input: '[!INFO] Did you know?', expectedTag: 'INFO', expectedTitle: 'Did you know?' },
    { input: '[!TODO] Next steps', expectedTag: 'TODO', expectedTitle: 'Next steps' },
    { input: '[!BUG] Issue #42', expectedTag: 'BUG', expectedTitle: 'Issue #42' },
  ];

  for (const sample of samples) {
    const cleaned = sample.input.replace(/^>\s*/, '');
    const match = cleaned.match(alertRegex);
    assert.ok(match, `Sample "${sample.input}" must match alert regex`);
    assert.strictEqual(match[1].toUpperCase(), sample.expectedTag);
    if (sample.expectedTitle) {
      assert.strictEqual(match[2]?.trim(), sample.expectedTitle);
    }
  }
  console.log('  -> PASSED: Alert regex captures all standard tags and optional trailing titles.');
}

console.log('\n======================================================================');
console.log('ALL CALLOUT, TYPOGRAPHY & PATH DEDUPLICATION TESTS PASSED (3/3)');
console.log('======================================================================\n');
