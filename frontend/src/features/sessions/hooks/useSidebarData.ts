"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSessions, SessionItem } from '@/services/sessions';
import { fetchProjects, ProjectItem } from '@/services/projects';
import { subscribeToSessionStore } from '@/features/chat';

interface UseSidebarDataProps {
  selectedSessionId: string | null;
  selectedSessionTitle?: string;
  selectedSessionRepo?: string;
  externalArchivedSessionIds?: Set<string>;
  externalOnToggleArchive?: (sessionId: string) => void;
}

export function useSidebarData({
  selectedSessionId,
  selectedSessionTitle,
  selectedSessionRepo,
  externalArchivedSessionIds,
  externalOnToggleArchive,
}: UseSidebarDataProps) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [registeredProjects, setRegisteredProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [, setStoreTick] = useState(0);

  // Restore client-side cache after hydration completes
  useEffect(() => {
    try {
      const s = localStorage.getItem('nexau_cached_sessions');
      if (s) setSessions(JSON.parse(s));
      const p = localStorage.getItem('nexau_cached_projects');
      if (p) setRegisteredProjects(JSON.parse(p));
    } catch {}
  }, []);

  // Pinned Sessions State
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = localStorage.getItem('nexau_pinned_sessions');
      if (saved) {
        setPinnedSessionIds(new Set(JSON.parse(saved)));
      }
    } catch {}
  }, []);

  const togglePin = (sessionId: string) => {
    setPinnedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      try {
        localStorage.setItem('nexau_pinned_sessions', JSON.stringify(Array.from(next)));
      } catch {}
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
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
    }
  };

  // Folders expansion state
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => {
      const isCurrentlyOpen = prev[folderName] ?? true;
      return {
        ...prev,
        [folderName]: !isCurrentlyOpen,
      };
    });
  };

  // Data fetching
  const refreshData = useCallback(async () => {
    try {
      const [fetchedSessions, fetchedProjects] = await Promise.all([
        fetchSessions(),
        fetchProjects().catch(() => [] as ProjectItem[])
      ]);

      if (fetchedSessions) {
        setSessions(fetchedSessions);
        try {
          localStorage.setItem('nexau_cached_sessions', JSON.stringify(fetchedSessions));
        } catch {}
      }

      if (fetchedProjects) {
        setRegisteredProjects(fetchedProjects);
        try {
          localStorage.setItem('nexau_cached_projects', JSON.stringify(fetchedProjects));
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000);
    const onProjectsUpdated = () => {
      refreshData();
    };
    window.addEventListener('nexau:projects-updated', onProjectsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('nexau:projects-updated', onProjectsUpdated);
    };
  }, [refreshData]);

  // Subscribe to live sessionStore
  useEffect(() => {
    return subscribeToSessionStore(() => {
      setStoreTick(t => t + 1);
    });
  }, []);

  // Sync selected session locally
  useEffect(() => {
    if (!selectedSessionId) return;
    const timer = setTimeout(() => {
      setSessions(prev => {
        const exists = prev.some(s => s.session_id === selectedSessionId);
        if (exists) {
          return prev.map(s => {
            if (s.session_id === selectedSessionId) {
              return {
                ...s,
                title: selectedSessionTitle || s.title,
              };
            }
            return s;
          });
        }
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
        const combined = [newSession, ...prev];
        const seen = new Set<string>();
        return combined.filter((s) => {
          if (seen.has(s.session_id)) return false;
          seen.add(s.session_id);
          return true;
        });
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedSessionId, selectedSessionTitle, selectedSessionRepo]);

  // Group sessions by workspace and pinned status
  const visibleSessions = sessions.filter(s => !archivedIds.has(s.session_id));
  const pinnedSessions = visibleSessions.filter(s => pinnedSessionIds.has(s.session_id));
  const unpinnedSessions = visibleSessions.filter(s => !pinnedSessionIds.has(s.session_id));

  const workspaceSessions: Record<string, SessionItem[]> = {};
  const directConversations: SessionItem[] = [];

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

  return {
    sessions,
    setSessions,
    registeredProjects,
    loading,
    refreshData,
    pinnedSessionIds,
    togglePin,
    archivedIds,
    handleArchive,
    openFolders,
    setOpenFolders,
    toggleFolder,
    pinnedSessions,
    workspaceSessions,
    directConversations,
  };
}
