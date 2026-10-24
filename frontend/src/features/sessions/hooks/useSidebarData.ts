"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchSessions, deletedSessionIds, SessionItem } from '@/services/sessions';
import { fetchProjects, ProjectItem } from '@/services/projects';
import { subscribeToSessionStore } from '@/features/chat/state/sessionStore';

interface UseSidebarDataProps {
  selectedSessionId: string | null;
  selectedSessionTitle?: string;
  selectedSessionRepo?: string;
  externalArchivedSessionIds?: Set<string>;
  externalOnToggleArchive?: (sessionId: string) => void;
}

function loadCache<T>(key: string, fallback: T, legacyKey?: string): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function setCache(key: string, val: any, legacyKey?: string): void {
  if (typeof window === 'undefined') return;
  try {
    const str = JSON.stringify(val);
    localStorage.setItem(key, str);
    if (legacyKey) localStorage.setItem(legacyKey, str);
  } catch {}
}

export function groupSidebarSessions(
  sessions: SessionItem[],
  pinnedSessionIds: Set<string>,
  archivedIds: Set<string>,
  registeredProjects: ProjectItem[]
) {
  const projectPathMap = new Map<string, ProjectItem>();
  const projectNameMap = new Map<string, ProjectItem>();
  const workspaceMap: Record<string, SessionItem[]> = {};

  for (const p of registeredProjects) {
    workspaceMap[p.name] = [];
    projectNameMap.set(p.name.toLowerCase(), p);
    if (p.local_folder_path) {
      projectPathMap.set(p.local_folder_path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(), p);
    }
  }

  const pinned: SessionItem[] = [];
  const direct: SessionItem[] = [];

  for (const s of sessions) {
    if (archivedIds.has(s.session_id)) continue;
    if (pinnedSessionIds.has(s.session_id)) { pinned.push(s); continue; }
    const uri = s.workspace_uri;
    if (!uri || uri === 'No Repo') { direct.push(s); continue; }
    const normUri = uri.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    let matched = projectPathMap.get(normUri) || projectNameMap.get(normUri);
    if (!matched) {
      for (const p of registeredProjects) {
        const normPath = p.local_folder_path ? p.local_folder_path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';
        if (normPath && (normPath.endsWith('/' + normUri) || normUri.endsWith('/' + p.name.toLowerCase()))) {
          matched = p;
          break;
        }
      }
    }
    const targetGroupName = matched ? matched.name : (uri.includes('/') || uri.includes('\\') ? uri.split(/[/\\]/).filter(Boolean).pop() || uri : uri);
    if (!workspaceMap[targetGroupName]) workspaceMap[targetGroupName] = [];
    workspaceMap[targetGroupName].push(s);
  }

  return { pinnedSessions: pinned, workspaceSessions: workspaceMap, directConversations: direct };
}

export function useSidebarData({
  selectedSessionId,
  selectedSessionTitle,
  selectedSessionRepo,
  externalArchivedSessionIds,
  externalOnToggleArchive,
}: UseSidebarDataProps) {
  // ponytail: Synchronous lazy initializers eliminate cold boot empty-to-loaded layout jump
  const [sessions, setSessions] = useState<SessionItem[]>(() => {
    return loadCache<SessionItem[]>('mash_cached_sessions', [], 'nexau_cached_sessions');
  });
  const [registeredProjects, setRegisteredProjects] = useState<ProjectItem[]>(() => {
    return loadCache<ProjectItem[]>('mash_cached_projects', [], 'nexau_cached_projects');
  });
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(() => {
    const saved = loadCache<string[]>('mash_pinned_sessions', [], 'nexau_pinned_sessions');
    return new Set(saved);
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [, setStoreTick] = useState(0);

  // Stable references prevent refreshData useCallback from churning polling intervals
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const selectedSessionTitleRef = useRef(selectedSessionTitle);
  selectedSessionTitleRef.current = selectedSessionTitle;

  // Hydration fallback sync
  useEffect(() => {
    try {
      const s = loadCache<SessionItem[]>('mash_cached_sessions', [], 'nexau_cached_sessions');
      if (s.length > 0 && sessions.length === 0) {
        setSessions(s);
      }
      const saved = loadCache<string[]>('mash_pinned_sessions', [], 'nexau_pinned_sessions');
      if (saved.length > 0 && pinnedSessionIds.size === 0) setPinnedSessionIds(new Set(saved));
    } catch {}
  }, []);

  const togglePin = (sessionId: string) => {
    setPinnedSessionIds(prev => {
      const next = new Set(prev);
      if (!next.delete(sessionId)) next.add(sessionId);
      setCache('mash_pinned_sessions', Array.from(next), 'nexau_pinned_sessions');
      return next;
    });
  };

  // Archiving State
  const [internalArchivedIds, setInternalArchivedIds] = useState<Set<string>>(new Set());
  const archivedIds = externalArchivedSessionIds || internalArchivedIds;

  const handleArchive = (sessionId: string) => {
    if (externalOnToggleArchive) {
      externalOnToggleArchive(sessionId);
    } else {
      setInternalArchivedIds(prev => {
        const next = new Set(prev);
        if (!next.delete(sessionId)) next.add(sessionId);
        return next;
      });
    }
  };

  // Folders expansion state
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => ({ ...prev, [folderName]: !(prev[folderName] ?? true) }));
  };

  // ponytail: Reconcile localStorage cached state with SQLite response without re-sorting jitter
  const refreshData = useCallback(async () => {
    try {
      const [fetchedSessions, fetchedProjects] = await Promise.all([
        fetchSessions(),
        fetchProjects().catch(() => [] as ProjectItem[])
      ]);

      if (Array.isArray(fetchedSessions)) {
        setSessions(prev => {
          const curId = selectedSessionIdRef.current;
          const curTitle = selectedSessionTitleRef.current;
          const fetchedMap = new Map<string, SessionItem>(fetchedSessions.map(s => [s.session_id, s]));
          const seen = new Set<string>();
          const reconciled: SessionItem[] = [];

          // 1. Maintain stable order of valid sessions that exist on the server
          for (const old of (prev || [])) {
            if (deletedSessionIds.has(old.session_id)) continue;
            const fresh = fetchedMap.get(old.session_id);
            if (fresh) {
              reconciled.push({
                ...old,
                ...fresh,
                title: (curId === old.session_id && curTitle) ? curTitle : (fresh.custom_title || fresh.title || old.title),
                has_unread: curId === old.session_id ? false : fresh.has_unread,
              });
              seen.add(old.session_id);
            } else if (old.session_id === curId && !deletedSessionIds.has(old.session_id)) {
              reconciled.push(old);
              seen.add(old.session_id);
            }
          }

          // 2. Prepend any new sessions from backend not in cache
          for (const s of fetchedSessions) {
            if (!seen.has(s.session_id) && !deletedSessionIds.has(s.session_id)) {
              reconciled.unshift({
                ...s,
                title: (curId === s.session_id && curTitle) ? curTitle : (s.custom_title || s.title),
                has_unread: curId === s.session_id ? false : s.has_unread,
              });
            }
          }

          setCache('mash_cached_sessions', reconciled, 'nexau_cached_sessions');
          return reconciled;
        });
      }

      // Always sync projects with server response (empty [] removes deleted projects from sidebar)
      const safeProjects = Array.isArray(fetchedProjects) ? fetchedProjects : [];
      setRegisteredProjects(safeProjects);
      setCache('mash_cached_projects', safeProjects, 'nexau_cached_projects');
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000);
    const onProjectsUpdated = () => refreshData();
    window.addEventListener('nexau:projects-updated', onProjectsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('nexau:projects-updated', onProjectsUpdated);
    };
  }, [refreshData]);

  // Subscribe to live sessionStore
  useEffect(() => {
    return subscribeToSessionStore(() => { setStoreTick(t => t + 1); });
  }, []);

  // Sync selected session locally
  useEffect(() => {
    if (!selectedSessionId) return;
    const timer = setTimeout(() => {
      setSessions(prev => {
        const exists = prev.some(s => s.session_id === selectedSessionId);
        let updated: SessionItem[];
        if (exists) {
          updated = prev.map(s => (s.session_id === selectedSessionId ? { ...s, title: selectedSessionTitle || s.title } : s));
        } else {
          const newSession: SessionItem = {
            session_id: selectedSessionId,
            title: selectedSessionTitle || 'New Session',
            custom_title: '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            message_count: 0,
            total_tokens: 0,
            last_user_view_time: new Date().toISOString(),
            has_unread: false,
            workspace_uri: selectedSessionRepo || 'No Repo',
            section: selectedSessionRepo && selectedSessionRepo !== 'No Repo' ? 'workspace' : 'conversation',
          };
          const seen = new Set<string>();
          updated = [newSession, ...prev].filter(s => !seen.has(s.session_id) && seen.add(s.session_id));
        }
        setCache('mash_cached_sessions', updated, 'nexau_cached_sessions');
        return updated;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedSessionId, selectedSessionTitle, selectedSessionRepo]);

  // Memoized O(S + P) workspace grouping with pre-indexed project lookup map
  const { pinnedSessions, workspaceSessions, directConversations } = useMemo(() => {
    return groupSidebarSessions(sessions, pinnedSessionIds, archivedIds, registeredProjects);
  }, [sessions, registeredProjects, pinnedSessionIds, archivedIds]);

  return {
    sessions, setSessions, registeredProjects, loading, refreshData,
    pinnedSessionIds, togglePin, archivedIds, handleArchive,
    openFolders, setOpenFolders, toggleFolder,
    pinnedSessions, workspaceSessions, directConversations,
  };
}
