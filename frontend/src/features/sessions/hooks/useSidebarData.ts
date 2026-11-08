"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchSessionsDetailed, deletedSessionIds, SessionItem } from '@/services/sessions';
import { fetchProjectsDetailed, ProjectItem } from '@/services/projects';
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
    localStorage.setItem(key, JSON.stringify(val));
    if (legacyKey) localStorage.removeItem(legacyKey);
  } catch {}
}

export interface SidebarSectionsState {
  pinned: boolean;
  workspaces: boolean;
  conversations: boolean;
}

export function groupSidebarSessions(
  sessions: SessionItem[],
  pinnedSessionIds: Set<string>,
  archivedIds: Set<string>,
  registeredProjects: ProjectItem[]
) {
  const projectById = new Map<string, ProjectItem>();
  const projectPathMap = new Map<string, ProjectItem>();
  const projectNameMap = new Map<string, ProjectItem>();
  const workspaceMap: Record<string, SessionItem[]> = {};

  for (const p of registeredProjects) {
    workspaceMap[p.name] = [];
    if (p.id) projectById.set(p.id, p);
    if (p.name) projectNameMap.set(p.name.toLowerCase(), p);
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

    // Direct project_id lookup takes highest priority to avoid name collisions
    let matched: ProjectItem | undefined;
    if (s.project_id && projectById.has(s.project_id)) {
      matched = projectById.get(s.project_id);
    }

    // Path or name lookup fallback for legacy sessions
    if (!matched) {
      const normUri = uri.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
      matched = projectPathMap.get(normUri) || projectNameMap.get(normUri);
      if (!matched) {
        for (const p of registeredProjects) {
          const normPath = p.local_folder_path ? p.local_folder_path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : '';
          if (normPath && (normPath.endsWith('/' + normUri) || normUri.endsWith('/' + p.name.toLowerCase()))) {
            matched = p;
            break;
          }
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
  // Synchronous lazy initializers eliminate cold boot empty-to-loaded layout jump
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

  // Section accordion state persisted across sidebar collapse/remounts
  const [sectionsState, setSectionsState] = useState<SidebarSectionsState>(() => {
    return loadCache<SidebarSectionsState>('mash_sidebar_sections_state', {
      pinned: true,
      workspaces: true,
      conversations: true,
    });
  });

  const toggleSection = (sectionKey: keyof SidebarSectionsState) => {
    setSectionsState(prev => {
      const next = { ...prev, [sectionKey]: !prev[sectionKey] };
      setCache('mash_sidebar_sections_state', next);
      return next;
    });
  };

  // Folders expansion state: persisted to localStorage to prevent unwanted decomposition on reload
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    return loadCache<Record<string, boolean>>('mash_sidebar_open_folders', {});
  });

  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => {
      const current = prev[folderName] ?? false;
      const next = { ...prev, [folderName]: !current };
      setCache('mash_sidebar_open_folders', next);
      return next;
    });
  };

  // Auto-expand the active session workspace if it hasn't been explicitly collapsed
  useEffect(() => {
    if (selectedSessionRepo && selectedSessionRepo !== 'No Repo') {
      setOpenFolders(prev => {
        if (prev[selectedSessionRepo] === undefined) {
          const next = { ...prev, [selectedSessionRepo]: true };
          setCache('mash_sidebar_open_folders', next);
          return next;
        }
        return prev;
      });
    }
  }, [selectedSessionRepo]);

  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);

  // Reconcile localStorage cached state with SQLite response without re-sorting jitter
  const isRefreshingRef = useRef(false);
  const errorCountRef = useRef(0);

  const refreshData = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    try {
      const [sessionsRes, projectsRes] = await Promise.all([
        fetchSessionsDetailed(),
        fetchProjectsDetailed(),
      ]);

      // If session listing failed (e.g. connector restarting or offline), preserve existing state and do NOT overwrite cache!
      if (!sessionsRes.ok) {
        setIsReconnecting(true);
        return;
      }
      setIsReconnecting(false);

      const fetchedSessions = sessionsRes.data;
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
              title: (curId === old.session_id && curTitle && !/^(new conversation|new chat)$/i.test(curTitle.trim())) ? curTitle : (fresh.custom_title || fresh.title || old.title),
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
              title: (curId === s.session_id && curTitle && !/^(new conversation|new chat)$/i.test(curTitle.trim())) ? curTitle : (s.custom_title || s.title),
              has_unread: curId === s.session_id ? false : s.has_unread,
            });
          }
        }

        setCache('mash_cached_sessions', reconciled, 'nexau_cached_sessions');
        return reconciled;
      });

      if (projectsRes.ok) {
        const safeProjects = Array.isArray(projectsRes.data) ? projectsRes.data : [];
        setRegisteredProjects(safeProjects);
        setCache('mash_cached_projects', safeProjects, 'nexau_cached_projects');
      }
      errorCountRef.current = 0;
    } catch (err) {
      errorCountRef.current += 1;
      console.error('Failed to load sidebar data:', err);
      setIsReconnecting(true);
    } finally {
      isRefreshingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    let isCancelled = false;

    const poll = async () => {
      if (!isCancelled && !(typeof document !== 'undefined' && document.hidden)) {
        await refreshData();
      }
      if (!isCancelled) {
        const delay = errorCountRef.current > 0
          ? Math.min(60000, 10000 * Math.pow(1.5, Math.min(errorCountRef.current, 5)))
          : 10000;
        timerId = setTimeout(poll, delay);
      }
    };

    poll();
    const onProjectsUpdated = () => refreshData();
    window.addEventListener('nexau:projects-updated', onProjectsUpdated);
    return () => {
      isCancelled = true;
      clearTimeout(timerId);
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
    sessions, setSessions, registeredProjects, loading, refreshData, isReconnecting,
    pinnedSessionIds, togglePin, archivedIds, handleArchive,
    openFolders, setOpenFolders, toggleFolder,
    sectionsState, toggleSection,
    pinnedSessions, workspaceSessions, directConversations,
  };
}
