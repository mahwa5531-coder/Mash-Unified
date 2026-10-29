import { fastFormatJsonLine } from '../src/features/viewer/utils/fastJsonFormatter.ts';

console.log('======================================================================');
console.log('[*] BENCHMARKING 20 MB MINIFIED JSON ON V8 ENGINE');
console.log('======================================================================\n');

// 1. Generate realistic 20MB minified JSON payload (accounting general ledger)
console.log('[1] Generating 20MB minified JSON dataset (forensic audit records)...');
const recordCount = 130000; // ~130k transactions ~ 20 MB
const records = [];
for (let i = 0; i < recordCount; i++) {
  records.push(`{"id":${i},"tx_ref":"TXN-2026-${100000 + i}","account":"GL-${1000 + (i % 500)}","amount":${(i * 3.14159).toFixed(2)},"currency":"USD","type":"${i % 2 === 0 ? 'DEBIT' : 'CREDIT'}","audited":${i % 3 === 0},"memo":"Statutory audit transaction reconciliation entry #${i}"}`);
}

const rawJson20MB = `{"audit_batch":"BATCH-2026-Q4-FORENSIC","record_count":${recordCount},"transactions":[${records.join(',')}]}`;
const sizeMB = (rawJson20MB.length / (1024 * 1024)).toFixed(2);
console.log(`  -> Generated raw JSON string: ${rawJson20MB.length} chars (~${sizeMB} MB)\n`);

// 2. Measure V8 Heap before
if (global.gc) global.gc();
const memBefore = process.memoryUsage().heapUsed;

// 3. Benchmark fastFormatJsonLine with maxLen = 30_000_000
console.log('[2] Running fastFormatJsonLine on 20 MB payload...');
const t0 = performance.now();
const formatted = fastFormatJsonLine(rawJson20MB, 30_000_000);
const t1 = performance.now();

const memAfter = process.memoryUsage().heapUsed;
const heapDeltaMB = ((memAfter - memBefore) / (1024 * 1024)).toFixed(2);
const elapsed = (t1 - t0).toFixed(2);

console.log(`  -> fastFormatJsonLine Completed in: ${elapsed} ms`);
console.log(`  -> Heap Memory Delta: ~${heapDeltaMB} MB`);
console.log(`  -> Formatted Output Length: ${formatted.length} chars`);
console.log(`  -> Total Lines Generated: ${formatted.split('\n').length}`);
console.log(`  -> Has Newlines: ${formatted.includes('\n')}`);

// 4. Comparison: Native JSON.parse + JSON.stringify (if memory permits)
console.log('\n[3] Benchmarking Native JSON.parse + JSON.stringify comparison...');
try {
  const tParse0 = performance.now();
  const obj = JSON.parse(rawJson20MB);
  const tParse1 = performance.now();
  const str = JSON.stringify(obj, null, 2);
  const tStringify = performance.now();

  console.log(`  -> Native JSON.parse: ${(tParse1 - tParse0).toFixed(2)} ms`);
  console.log(`  -> Native JSON.stringify: ${(tStringify - tParse1).toFixed(2)} ms`);
  console.log(`  -> Total Native Time: ${(tStringify - tParse0).toFixed(2)} ms`);
} catch (err) {
  console.log(`  -> Native JSON.parse failed or crashed:`, err.message);
}

console.log('\n======================================================================');
console.log('[*] BENCHMARK COMPLETE');
console.log('======================================================================');
