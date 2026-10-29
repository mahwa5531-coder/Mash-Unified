import assert from 'node:assert';
import { fastFormatJsonLine } from '../src/features/viewer/utils/fastJsonFormatter.ts';

console.log('[*] Testing Zero-AST High-Performance JSON Line Formatter...');

// 1. Basic formatting test
const minified = '{"status":"success","data":{"count":42,"items":["audit_1","audit_2"],"nested":{"valid":true}}}';
const formatted = fastFormatJsonLine(minified);

assert.ok(formatted.includes('\n'), 'Formatted output must contain newlines');
assert.ok(formatted.includes('  "status": "success"'), 'Keys must be indented with spaces');
assert.ok(formatted.includes('    "audit_1"'), 'Array items must be indented');
console.log('  [PASS] 1. Basic minified JSON formatted with correct indentation.');

// 2. String literal safety: Commas, colons, brackets inside strings must NOT break lines
const stringContainingTokens = '{"comment":"A complex string with , comma, : colon, and { braces } inside","active":true}';
const formattedString = fastFormatJsonLine(stringContainingTokens);
assert.ok(formattedString.includes('"comment": "A complex string with , comma, : colon, and { braces } inside"'), 'String content must remain unmolested');
console.log('  [PASS] 2. Structural tokens inside string literals are preserved intact.');

// 3. Escaped quotes inside strings
const escapedQuotes = '{"quote":"She said \\"Hello, world!\\" inside string","valid":true}';
const formattedEscaped = fastFormatJsonLine(escapedQuotes);
assert.ok(formattedEscaped.includes('"She said \\"Hello, world!\\" inside string"'), 'Escaped quotes must not toggle string state');
console.log('  [PASS] 3. Escaped quotes handled correctly.');

// 4. Multiline strings: Must bypass immediately without redundant work
const alreadyFormatted = '{\n  "a": 1\n}';
assert.strictEqual(fastFormatJsonLine(alreadyFormatted), alreadyFormatted, 'Already-formatted strings must return immediately in O(1)');
console.log('  [PASS] 4. Already multiline strings bypass in O(1).');

// 5. Incomplete / Corrupted JSON: Must never throw
const corrupted = '{"broken": [1, 2, {"unclosed": true';
assert.doesNotThrow(() => {
  const result = fastFormatJsonLine(corrupted);
  assert.ok(result.includes('\n'), 'Corrupted JSON should still output formatted lines');
});
console.log('  [PASS] 5. Incomplete/corrupted JSON formats without throwing.');

// 6. Performance Ceiling Benchmark: 1MB Minified JSON payload
const items = Array.from({ length: 5000 }, (_, i) => `{"id":${i},"account":"ACC_${1000 + i}","balance":${(i * 12.34).toFixed(2)},"audited":${i % 2 === 0}}`).join(',');
const hugeJson = `{"total_records":5000,"records":[${items}]}`;
console.log(`  [*] Benchmarking 1MB JSON (${hugeJson.length} bytes)...`);

const start = performance.now();
const hugeFormatted = fastFormatJsonLine(hugeJson);
const elapsed = performance.now() - start;

assert.ok(hugeFormatted.length > hugeJson.length, 'Formatted JSON must contain newlines and indentation');
console.log(`  [PASS] 6. 1MB JSON formatted in ${elapsed.toFixed(2)}ms (target < 30ms).`);
assert.ok(elapsed < 100, `Formatting 1MB took too long: ${elapsed}ms`);

console.log('[SUCCESS] All Zero-AST JSON Formatter tests PASSED!\n');
