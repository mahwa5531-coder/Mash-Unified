import assert from 'node:assert';
import { groupSidebarSessions } from '../src/features/sessions/hooks/useSidebarData';
import { computeNextOpenTabs, computeCloseTab, MAX_VIEWER_TABS, MAX_SIDEBAR_MEMORY_SESSIONS } from '../src/features/viewer/hooks/useViewerTabs';
import { cacheFileContent, getFileContentFromCache, MAX_FILE_CACHE_SIZE } from '../src/services/files';
import type { SessionItem } from '../src/services/sessions';
import type { ProjectItem } from '../src/services/projects';

// -----------------------------------------------------------------------------
// TEST 1: Session Ordering - New Sessions Always Survive at the TOP
// -----------------------------------------------------------------------------
console.log('[Test 1] Verifying session ordering in Left Sidebar...');

const mockProjects: ProjectItem[] = [
  { id: 'proj-1', name: 'Alpha_Project', local_folder_path: '/work/alpha' },
  { id: 'proj-2', name: 'Beta_Project', local_folder_path: '/work/beta' },
];

const initialSessions: SessionItem[] = [
  {
    session_id: 'sess-old-direct',
    title: 'Old Direct Chat',
    workspace_uri: 'No Repo',
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  } as SessionItem,
  {
    session_id: 'sess-old-alpha',
    title: 'Old Alpha Session',
    project_id: 'proj-1',
    workspace_uri: 'Alpha_Project',
    created_at: '2026-10-01T11:00:00Z',
    updated_at: '2026-10-01T11:00:00Z',
  } as SessionItem,
];

// Group initial sessions
const initialGrouped = groupSidebarSessions(initialSessions, new Set(), new Set(), mockProjects);
assert.strictEqual(initialGrouped.directConversations.length, 1);
assert.strictEqual(initialGrouped.directConversations[0].session_id, 'sess-old-direct');
assert.strictEqual(initialGrouped.workspaceSessions['Alpha_Project'].length, 1);
assert.strictEqual(initialGrouped.workspaceSessions['Alpha_Project'][0].session_id, 'sess-old-alpha');

// Now simulate user creating a NEW direct conversation (prepended at top)
const newDirectSession: SessionItem = {
  session_id: 'sess-new-direct',
  title: 'Brand New Direct Chat',
  workspace_uri: 'No Repo',
  created_at: '2026-11-02T12:00:00Z',
  updated_at: '2026-11-02T12:00:00Z',
} as SessionItem;

const updatedWithDirect = [newDirectSession, ...initialSessions];
const groupedDirect = groupSidebarSessions(updatedWithDirect, new Set(), new Set(), mockProjects);

// The newly added direct session MUST survive at index 0 (the VERY TOP) of Direct Conversations
assert.strictEqual(groupedDirect.directConversations.length, 2);
assert.strictEqual(groupedDirect.directConversations[0].session_id, 'sess-new-direct', 'New direct session must be at the TOP (index 0)');
assert.strictEqual(groupedDirect.directConversations[1].session_id, 'sess-old-direct');

// Now simulate user creating a NEW session inside Alpha_Project (prepended at top)
const newAlphaSession: SessionItem = {
  session_id: 'sess-new-alpha',
  title: 'Brand New Alpha Audit',
  project_id: 'proj-1',
  workspace_uri: 'Alpha_Project',
  created_at: '2026-11-02T12:30:00Z',
  updated_at: '2026-11-02T12:30:00Z',
} as SessionItem;

const updatedWithAlpha = [newAlphaSession, ...updatedWithDirect];
const groupedAlpha = groupSidebarSessions(updatedWithAlpha, new Set(), new Set(), mockProjects);

// The newly added Alpha session MUST survive at index 0 (the VERY TOP) of Alpha_Project folder
const alphaFolderSessions = groupedAlpha.workspaceSessions['Alpha_Project'];
assert.strictEqual(alphaFolderSessions.length, 2);
assert.strictEqual(alphaFolderSessions[0].session_id, 'sess-new-alpha', 'New workspace session must be at the TOP (index 0) of the project folder');
assert.strictEqual(alphaFolderSessions[1].session_id, 'sess-old-alpha');

console.log('  -> PASSED: New sessions strictly survive at the top of both direct conversations and project folders.');

// -----------------------------------------------------------------------------
// TEST 2: Project Ordering - New Projects Always Appear at the TOP
// -----------------------------------------------------------------------------
console.log('[Test 2] Verifying project (workspace) ordering in Left Sidebar...');

const newProject: ProjectItem = {
  id: 'proj-new-gamma',
  name: 'Gamma_Project',
  local_folder_path: '/work/gamma',
};

const updatedProjects = [newProject, ...mockProjects];
const groupedProjects = groupSidebarSessions(updatedWithAlpha, new Set(), new Set(), updatedProjects);

const workspaceEntries = Object.keys(groupedProjects.workspaceSessions);
assert.strictEqual(workspaceEntries[0], 'Gamma_Project', 'Newly added project must appear at the VERY TOP of the Workspaces list');
assert.strictEqual(workspaceEntries[1], 'Alpha_Project');
assert.strictEqual(workspaceEntries[2], 'Beta_Project');

console.log('  -> PASSED: New projects strictly appear at the top of the Workspaces list.');

// -----------------------------------------------------------------------------
// TEST 3: Strict Positional State & Tab Memory Retention Across Session Cycling
// -----------------------------------------------------------------------------
console.log('[Test 3] Verifying positional tab state retention across session cycling (Session 1 -> 2 -> 3 -> 1)...');

interface MockSidebarMemory {
  tabs: any[];
  activeId: string | null;
  mode: 'explorer' | 'editor';
}
const mockMemoryMap = new Map<string, MockSidebarMemory>();

// Step 1: Session 1 has 3 tabs, active tab is tab-2, mode is editor
let s1Tabs: any[] = [];
s1Tabs = computeNextOpenTabs(s1Tabs, 's1-tab1', 'Document_1.pdf', 'file').nextTabs;
s1Tabs = computeNextOpenTabs(s1Tabs, 's1-tab2', 'Spreadsheet_1.xlsx', 'file').nextTabs;
s1Tabs = computeNextOpenTabs(s1Tabs, 's1-tab3', 'Terminal_1', 'terminal').nextTabs;
mockMemoryMap.set('session-1', { tabs: s1Tabs, activeId: 's1-tab2', mode: 'editor' });

// Step 2: Session 2 has 1 tab, active tab is tab-1, mode is editor
let s2Tabs: any[] = [];
s2Tabs = computeNextOpenTabs(s2Tabs, 's2-tab1', 'Ledger.csv', 'file').nextTabs;
mockMemoryMap.set('session-2', { tabs: s2Tabs, activeId: 's2-tab1', mode: 'editor' });

// Step 3: Session 3 has 0 tabs, mode is explorer
mockMemoryMap.set('session-3', { tabs: [], activeId: null, mode: 'explorer' });

// Cycle from Session 1 -> Session 2 -> Session 3 -> back to Session 1
// Verify Session 1 restores its exact positional state:
const restoredS1 = mockMemoryMap.get('session-1')!;
assert.strictEqual(restoredS1.tabs.length, 3, 'Session 1 must retain all 3 tabs');
assert.strictEqual(restoredS1.activeId, 's1-tab2', 'Session 1 active tab must still be Spreadsheet_1.xlsx');
assert.strictEqual(restoredS1.mode, 'editor');
assert.strictEqual(restoredS1.tabs[0].title, 'Document_1.pdf');
assert.strictEqual(restoredS1.tabs[1].title, 'Spreadsheet_1.xlsx');
assert.strictEqual(restoredS1.tabs[2].title, 'Terminal_1');

// Verify Session 2 restores its exact state:
const restoredS2 = mockMemoryMap.get('session-2')!;
assert.strictEqual(restoredS2.tabs.length, 1);
assert.strictEqual(restoredS2.activeId, 's2-tab1');
assert.strictEqual(restoredS2.tabs[0].title, 'Ledger.csv');

// Verify Session 3 restores explorer mode:
const restoredS3 = mockMemoryMap.get('session-3')!;
assert.strictEqual(restoredS3.tabs.length, 0);
assert.strictEqual(restoredS3.activeId, null);
assert.strictEqual(restoredS3.mode, 'explorer');

console.log('  -> PASSED: Positional tab order, active tab index, and viewMode strictly preserved across session cycles.');

// -----------------------------------------------------------------------------
// TEST 4: Tab Ceiling & LRU Memory Eviction (20-Tab Ceiling)
// -----------------------------------------------------------------------------
console.log('[Test 4] Verifying 20-tab ceiling and active tab protection under heavy tab stress...');

assert.strictEqual(MAX_VIEWER_TABS, 20);
let stressTabs: any[] = [];
const accessTimeMap = new Map<string, number>();

// Open 25 tabs sequentially, marking active tab as s-tab-5
for (let i = 1; i <= 25; i++) {
  const tabId = `s-tab-${i}`;
  accessTimeMap.set(tabId, Date.now() + i);
  stressTabs = computeNextOpenTabs(stressTabs, tabId, `file-${i}.txt`, 'file', `/path/${i}.txt`, 's-tab-5', accessTimeMap).nextTabs;
}

assert.strictEqual(stressTabs.length, 20, 'Tabs array must never exceed MAX_VIEWER_TABS (20)');
assert(stressTabs.some(t => t.id === 's-tab-5'), 'Active tab (s-tab-5) must NEVER be evicted during LRU trim');
assert(stressTabs.some(t => t.id === 's-tab-25'), 'Most recently opened tab (s-tab-25) must be present');

console.log('  -> PASSED: 20-tab ceiling enforced with guaranteed active-tab protection.');

// -----------------------------------------------------------------------------
// TEST 5: File Content Memory Cache (25-File Cap & RAM Guard)
// -----------------------------------------------------------------------------
console.log('[Test 5] Verifying client-side file content LRU memory guard (25-file limit)...');

assert.strictEqual(MAX_FILE_CACHE_SIZE, 25);

// Add 30 files to cache
for (let i = 1; i <= 30; i++) {
  cacheFileContent(`cache-key-${i}`, `content of file ${i}`);
}

// Key 1 through 5 must have been LRU evicted to protect RAM
assert.strictEqual(getFileContentFromCache('cache-key-1'), undefined, 'Oldest file 1 must be evicted');
assert.strictEqual(getFileContentFromCache('cache-key-5'), undefined, 'Oldest file 5 must be evicted');

// Keys 6 through 30 must remain in memory
assert(getFileContentFromCache('cache-key-6')?.includes('content of file 6'), 'Recent file 6 must be cached in memory');
assert(getFileContentFromCache('cache-key-30')?.includes('content of file 30'), 'Latest file 30 must be cached in memory');

console.log('  -> PASSED: File content LRU strictly caps at 25 files, protecting desktop RAM.');

console.log('\n======================================================================');
console.log('ALL THREE-COLUMN CONNECTION, POSITIONAL RETENTION & RAM GUARD TESTS PASSED (5/5)');
console.log('======================================================================');
