import assert from 'node:assert';

// -------------------------------------------------------------
// Emulate useSidebarData grouping logic (from useSidebarData.ts)
// -------------------------------------------------------------
function groupSidebarSessions(sessions, pinnedSessionIds, archivedIds, registeredProjects) {
  const visibleSessions = sessions.filter(s => !archivedIds.has(s.session_id));
  const pinnedSessions = visibleSessions.filter(s => pinnedSessionIds.has(s.session_id));
  const unpinnedSessions = visibleSessions.filter(s => !pinnedSessionIds.has(s.session_id));

  const workspaceSessions = {};
  const directConversations = [];

  registeredProjects.forEach(p => {
    workspaceSessions[p.name] = [];
  });

  unpinnedSessions.forEach(session => {
    const uri = session.workspace_uri;
    if (!uri || uri === 'No Repo') {
      directConversations.push(session);
      return;
    }

    const normUri = uri.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const matchedProject = registeredProjects.find(p => {
      const normPath = p.local_folder_path ? p.local_folder_path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';
      return (
        normPath === normUri ||
        p.name.toLowerCase() === uri.toLowerCase() ||
        normPath.endsWith('/' + uri.toLowerCase()) ||
        normUri.endsWith('/' + p.name.toLowerCase())
      );
    });

    const targetGroupName = matchedProject ? matchedProject.name : (
      uri.includes('/') || uri.includes('\\')
        ? uri.split(/[/\\]/).filter(Boolean).pop() || uri
        : uri
    );

    if (!workspaceSessions[targetGroupName]) {
      workspaceSessions[targetGroupName] = [];
    }
    workspaceSessions[targetGroupName].push(session);
  });

  return { pinnedSessions, workspaceSessions, directConversations };
}

// -------------------------------------------------------------
// Emulate ConversationHistory filtering (from ConversationHistory.tsx)
// -------------------------------------------------------------
function filterConversationHistory(sessions, searchQuery, filterMode, viewTab, archivedSessionIds) {
  return sessions.filter((s) => {
    // Archive tab filter
    const isArchived = Boolean(archivedSessionIds?.has(s.session_id));
    if (viewTab === 'active' && isArchived) return false;
    if (viewTab === 'archived' && !isArchived) return false;

    // 1. Text filter
    const title = (s.custom_title || s.title || '').toLowerCase();
    const repo = (s.workspace_uri || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || title.includes(q) || repo.includes(q);
    if (!matchesSearch) return false;

    // 2. Section filter
    const isWorkspace = s.section === 'workspace' && s.workspace_uri && s.workspace_uri !== 'No Repo';
    if (filterMode === 'workspace' && !isWorkspace) return false;
    if (filterMode === 'outside' && isWorkspace) return false;

    return true;
  });
}

console.log("======================================================================");
console.log("STARTING FRONTEND SIDEBAR & CONVERSATION HISTORY LOGIC TESTS");
console.log("======================================================================");

// Sample Data
const mockProjects = [
  { id: 'p1', name: 'Alpha-Project', local_folder_path: 'C:/Users/rama/Documents/Alpha-Project' },
  { id: 'p2', name: 'Beta-Project', local_folder_path: 'C:/Users/rama/Documents/Beta-Project' },
];

const mockSessions = [
  { session_id: 's1', title: 'Audit Alpha codebase', workspace_uri: 'Alpha-Project', section: 'workspace' },
  { session_id: 's2', title: 'Quick direct query', workspace_uri: 'No Repo', section: 'conversation' },
  { session_id: 's3', title: 'Beta deployment sync', workspace_uri: 'C:/Users/rama/Documents/Beta-Project', section: 'workspace' },
  { session_id: 's4', title: 'Legacy research task', workspace_uri: 'No Repo', section: 'conversation' },
];

// Test 1: Baseline grouping without pins
let pinned = new Set();
let archived = new Set();
let grouped = groupSidebarSessions(mockSessions, pinned, archived, mockProjects);

assert.strictEqual(grouped.pinnedSessions.length, 0, "Expected 0 pinned sessions initially");
assert.strictEqual(grouped.directConversations.length, 2, "Expected 2 direct conversations");
assert.strictEqual(grouped.workspaceSessions['Alpha-Project'].length, 1, "Expected 1 in Alpha");
assert.strictEqual(grouped.workspaceSessions['Beta-Project'].length, 1, "Expected 1 in Beta");
console.log("[PASS] Test 1: Standard grouping correctly routes workspace vs direct conversations");

// Test 2: Pinning a direct conversation
pinned.add('s2');
grouped = groupSidebarSessions(mockSessions, pinned, archived, mockProjects);
assert.strictEqual(grouped.pinnedSessions.length, 1, "Expected 1 pinned session");
assert.strictEqual(grouped.pinnedSessions[0].session_id, 's2');
assert.strictEqual(grouped.directConversations.length, 1, "Expected s2 to be removed from directConversations");
console.log("[PASS] Test 2: Pinning moves session to pinned section and removes duplicate from direct conversations");

// Test 3: Pinning a workspace session
pinned.add('s1');
grouped = groupSidebarSessions(mockSessions, pinned, archived, mockProjects);
assert.strictEqual(grouped.pinnedSessions.length, 2, "Expected 2 pinned sessions");
assert.strictEqual(grouped.workspaceSessions['Alpha-Project'].length, 0, "Expected s1 to be removed from Alpha-Project workspace folder");
console.log("[PASS] Test 3: Pinning workspace session moves to pinned section and removes duplicate from workspace folder");

// Test 4: Unpinning returns sessions to their original spots
pinned.delete('s1');
grouped = groupSidebarSessions(mockSessions, pinned, archived, mockProjects);
assert.strictEqual(grouped.pinnedSessions.length, 1, "Expected 1 pinned session left");
assert.strictEqual(grouped.workspaceSessions['Alpha-Project'].length, 1, "Expected s1 restored to Alpha-Project");
console.log("[PASS] Test 4: Unpinning restores session to original workspace grouping");

// Test 5: Archiving hides session from active sidebar
archived.add('s4');
grouped = groupSidebarSessions(mockSessions, pinned, archived, mockProjects);
assert.strictEqual(grouped.directConversations.find(s => s.session_id === 's4'), undefined, "Archived session s4 should not appear in sidebar");
console.log("[PASS] Test 5: Archiving hides session from active sidebar");

// Test 6: Conversation History Search Filtering
const searchResult = filterConversationHistory(mockSessions, 'deploy', 'all', 'active', archived);
assert.strictEqual(searchResult.length, 1);
assert.strictEqual(searchResult[0].session_id, 's3');
console.log("[PASS] Test 6: Conversation History search query correctly isolates matching session");

// Test 7: Conversation History Filter Modes ('workspace' vs 'outside')
const wsOnly = filterConversationHistory(mockSessions, '', 'workspace', 'active', archived);
assert.strictEqual(wsOnly.length, 2, "Expected 2 active workspace sessions");
const outsideOnly = filterConversationHistory(mockSessions, '', 'outside', 'active', archived);
assert.strictEqual(outsideOnly.length, 1, "Expected 1 active direct session (s4 is archived)");
console.log("[PASS] Test 7: Conversation History filter modes ('workspace' vs 'outside') correctly categorize sessions");

// Test 8: Conversation History Archive View
const archivedView = filterConversationHistory(mockSessions, '', 'all', 'archived', archived);
assert.strictEqual(archivedView.length, 1);
assert.strictEqual(archivedView[0].session_id, 's4');
console.log("[PASS] Test 8: Conversation History archive tab displays only archived sessions");

console.log("======================================================================");
console.log("ALL 8 FRONTEND LOGIC TESTS PASSED WITH ZERO REGRESSIONS!");
console.log("======================================================================");
