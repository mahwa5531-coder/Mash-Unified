import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { 
  deletedSessionIds, 
  markSessionDeleted, 
  unmarkSessionDeleted, 
  cleanupSessionStorage,
  deleteSession 
} from '../src/services/sessions';
import { deleteProject } from '../src/services/projects';
import { evictRightSidebarMemory } from '../src/features/viewer/hooks/useViewerTabs';
import { invalidateFileCache } from '../src/services/files';

async function runTests() {
  console.log('======================================================================');
  console.log('STARTING SESSION & WORKSPACE DELETION HARDENING TESTS');
  console.log('======================================================================');

  // -----------------------------------------------------------------------------
  // [Test 1] markSessionDeleted and unmarkSessionDeleted lifecycle
  // -----------------------------------------------------------------------------
  console.log('\n[Test 1] markSessionDeleted and unmarkSessionDeleted...');
  const testId = 'test_sess_del_123';
  assert.strictEqual(deletedSessionIds.has(testId), false);
  markSessionDeleted(testId);
  assert.strictEqual(deletedSessionIds.has(testId), true, 'markSessionDeleted must add id to Set');
  unmarkSessionDeleted(testId);
  assert.strictEqual(deletedSessionIds.has(testId), false, 'unmarkSessionDeleted must remove id from Set on failure rollback');
  console.log('  -> PASSED: Session ID added and rolled back cleanly from deletedSessionIds');

  // -----------------------------------------------------------------------------
  // [Test 2] cleanupSessionStorage localStorage eviction
  // -----------------------------------------------------------------------------
  console.log('\n[Test 2] cleanupSessionStorage localStorage eviction...');
  const storageStore: Record<string, string> = {
    'nexau_pinned_sessions': JSON.stringify(['other_sess', testId, 'another_sess']),
    'nexau_archived_session_ids': JSON.stringify([testId, 'keep_me']),
    'nexau_cached_sessions': JSON.stringify([
      { session_id: testId, title: 'To Delete' },
      { session_id: 'other_sess', title: 'To Keep' }
    ]),
    [`draft_${testId}`]: 'unsent draft text',
    'unrelated_key': 'unrelated_val',
  };

  const mockStorage = {
    getItem: (key: string) => storageStore[key] ?? null,
    setItem: (key: string, val: string) => { storageStore[key] = val; },
    removeItem: (key: string) => { delete storageStore[key]; },
    get length() { return Object.keys(storageStore).length; },
    key: (i: number) => Object.keys(storageStore)[i] ?? null,
  };
  (globalThis as any).window = { localStorage: mockStorage };
  (globalThis as any).localStorage = mockStorage;

  cleanupSessionStorage(testId);

  const pinnedAfter = JSON.parse(storageStore['nexau_pinned_sessions']);
  assert.deepStrictEqual(pinnedAfter, ['other_sess', 'another_sess'], 'Pinned sessions must not contain deleted sessionId');

  const archivedAfter = JSON.parse(storageStore['nexau_archived_session_ids']);
  assert.deepStrictEqual(archivedAfter, ['keep_me'], 'Archived sessions must not contain deleted sessionId');

  const cachedAfter = JSON.parse(storageStore['nexau_cached_sessions']);
  assert.strictEqual(cachedAfter.length, 1);
  assert.strictEqual(cachedAfter[0].session_id, 'other_sess');

  assert.strictEqual(storageStore[`draft_${testId}`], undefined, 'Session-specific draft key must be removed');
  assert.strictEqual(storageStore['unrelated_key'], 'unrelated_val', 'Unrelated keys must remain untouched');
  console.log('  -> PASSED: cleanupSessionStorage purges pinned, archived, cached, and draft keys');

  // -----------------------------------------------------------------------------
  // [Test 3] evictRightSidebarMemory and invalidateFileCache
  // -----------------------------------------------------------------------------
  console.log('\n[Test 3] evictRightSidebarMemory and invalidateFileCache...');
  let dispatchedEvt: any = null;
  const mockWindow = {
    localStorage: mockStorage,
    dispatchEvent: (evt: any) => { dispatchedEvt = evt; },
  };
  (globalThis as any).window = mockWindow;

  evictRightSidebarMemory(testId);
  assert.strictEqual(dispatchedEvt?.detail?.sessionId, testId, 'evictRightSidebarMemory must dispatch mash:evict_sidebar_memory event');
  assert.doesNotThrow(() => evictRightSidebarMemory());
  assert.doesNotThrow(() => invalidateFileCache());
  console.log('  -> PASSED: In-memory right sidebar memory and file cache eviction execute cleanly');

  // -----------------------------------------------------------------------------
  // [Test 4] Structured deleteSession error handling and rollback
  // -----------------------------------------------------------------------------
  console.log('\n[Test 4] Structured deleteSession handling on failure...');
  const originalFetch = globalThis.fetch;

  // 4.1 Simulate 500 error from backend
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Database error deleting session' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const failResult = await deleteSession(testId);
  assert.strictEqual(failResult.success, false, 'deleteSession must return success=false on HTTP failure');
  assert.strictEqual(failResult.message, 'Database error deleting session');
  assert.strictEqual(deletedSessionIds.has(testId), false, 'deletedSessionIds must roll back on failure');
  console.log('  -> PASSED: deleteSession returns structured failure result and rolls back deletedSessionIds');

  // 4.2 Simulate 200 OK from backend
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ status: 'success', session_id: testId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const okResult = await deleteSession(testId);
  assert.strictEqual(okResult.success, true, 'deleteSession must return success=true on HTTP 200');
  assert.strictEqual(deletedSessionIds.has(testId), true, 'deletedSessionIds must keep session marked on success');
  console.log('  -> PASSED: deleteSession returns structured success result');

  // -----------------------------------------------------------------------------
  // [Test 5] Structured deleteProject error handling
  // -----------------------------------------------------------------------------
  console.log('\n[Test 5] Structured deleteProject handling...');
  // 5.1 Simulate 404 error
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ detail: 'Project not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const projFail = await deleteProject('non_existent_proj');
  assert.strictEqual(projFail.success, false);
  assert.strictEqual(projFail.message, 'Project not found');
  console.log('  -> PASSED: deleteProject returns structured failure on HTTP error');

  // 5.2 Simulate 200 OK
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ status: 'success', deleted_project_id: 'proj_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const projOk = await deleteProject('proj_123');
  assert.strictEqual(projOk.success, true);
  console.log('  -> PASSED: deleteProject returns structured success on HTTP 200');

  // Restore fetch
  globalThis.fetch = originalFetch;

  // -----------------------------------------------------------------------------
  // [Test 6] FailedToDeleteCard design system integrity
  // -----------------------------------------------------------------------------
  console.log('\n[Test 6] FailedToDeleteCard styling and authentic color grading...');
  const cardCode = fs.readFileSync(path.join(__dirname, '../src/features/sessions/components/FailedToDeleteCard.tsx'), 'utf-8');
  assert.ok(cardCode.includes('border-zinc-200/80'), 'FailedToDeleteCard must use border-zinc-200/80');
  assert.ok(cardCode.includes('dark:border-white/[0.08]'), 'FailedToDeleteCard must use dark:border-white/[0.08]');
  assert.ok(cardCode.includes('bg-white'), 'FailedToDeleteCard must use bg-white');
  assert.ok(cardCode.includes('dark:bg-[#18181b]'), 'FailedToDeleteCard must use dark:bg-[#18181b]');
  assert.ok(cardCode.includes('shadow-lg'), 'FailedToDeleteCard must use shadow-lg');
  assert.ok(cardCode.includes('text-rose-500') || cardCode.includes('bg-rose-500'), 'FailedToDeleteCard must have rose accent icon');
  assert.ok(cardCode.includes('role="alert"'), 'FailedToDeleteCard must have role="alert" for accessibility');

  const primCode = fs.readFileSync(path.join(__dirname, '../src/primitives/index.ts'), 'utf-8');
  assert.ok(primCode.includes('FailedToDeleteCard'), 'FailedToDeleteCard must be re-exported from primitives');
  console.log('  -> PASSED: FailedToDeleteCard matches calm ghost card styling with authentic color grading');

  console.log('\n======================================================================');
  console.log('ALL SESSION & WORKSPACE DELETION HARDENING TESTS PASSED!');
  console.log('======================================================================');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
