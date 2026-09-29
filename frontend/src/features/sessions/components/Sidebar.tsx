"use client";

import { useEffect, useState, MouseEvent as ReactMouseEvent, useCallback, useRef } from 'react';
import { fetchSessions, markSessionViewed, renameSession, deleteSession, SessionItem } from '@/services/sessions';
import { fetchProjects, ProjectItem, selectFolder, resolveFolder, createProject, deleteProject } from '@/services/projects';
import { isSessionStreaming, subscribeToSessionStore, sessionStore } from '@/features/chat';
import { SessionItemRow } from './SessionItemRow';
import { SessionContextMenu } from './SessionContextMenu';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from './SidebarFooter';
import { PinnedSection } from './PinnedSection';
import { WorkspacesSection } from './WorkspacesSection';
import { DirectConversationsSection } from './DirectConversationsSection';
import { QuickProjectModal } from './QuickProjectModal';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';

interface SidebarProps {
  selectedSessionId: string | null;
  selectedSessionTitle?: string;
  selectedSessionRepo?: string;
  onSelectSession: (sessionId: string, title?: string, repoName?: string) => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onToggle: () => void;
  onOpenSettings?: () => void;
  isHistoryActive?: boolean;
  onOpenHistory?: () => void;
  width?: number;
  onWidthChange?: (width: number) => void;
  archivedSessionIds?: Set<string>;
  onToggleArchive?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}

const MIN_WIDTH = 220;
const MAX_WIDTH = 450;

export default function Sidebar({ 
  selectedSessionId, 
  selectedSessionTitle, 
  selectedSessionRepo, 
  onSelectSession, 
  onNewSession, 
  onToggle,
  onOpenSettings,
  isHistoryActive = false,
  onOpenHistory,
  width: controlledWidth,
  onWidthChange,
  archivedSessionIds: externalArchivedSessionIds,
  onToggleArchive: externalOnToggleArchive,
  onDeleteSession,
}: SidebarProps) {
  // ponytail: initialize with empty arrays to guarantee identical SSR & client hydration DOM
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

  // Scroll shading & sticky section awareness
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const updateScrollShading = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const hasUp = el.scrollTop > 4;
    const hasDown = el.scrollHeight - el.scrollTop - el.clientHeight > 12;
    setCanScrollUp(prev => (prev !== hasUp ? hasUp : prev));
    setCanScrollDown(prev => (prev !== hasDown ? hasDown : prev));
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
    setActiveMenuSessionId(null);
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
    setActiveMenuSessionId(null);
  };

  // Folders expansion state
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  // Context Menu State
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  // In-line Renaming State
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');

  // Quick Project Modal State
  const [isQuickProjectModalOpen, setIsQuickProjectModalOpen] = useState(false);

  // Resizing state
  const [internalWidth, setInternalWidth] = useState<number>(260);
  const effectiveWidth = controlledWidth !== undefined ? controlledWidth : internalWidth;
  const isResizingRef = useRef<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(260);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = effectiveWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = ev.clientX - startXRef.current;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      if (onWidthChange) {
        onWidthChange(newWidth);
      } else {
        setInternalWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [effectiveWidth, onWidthChange]);

  const deletedSessionIds = useRef<Set<string>>(new Set());

  // Data fetching
  const refreshData = useCallback(async () => {
    try {
      const [fetchedSessions, fetchedProjects] = await Promise.all([
        fetchSessions(),
        fetchProjects().catch(() => [] as ProjectItem[])
      ]);

      if (fetchedSessions) {
        const validSessions = fetchedSessions.filter(s => !deletedSessionIds.current.has(s.session_id));
        setSessions(validSessions);
        try {
          localStorage.setItem('nexau_cached_sessions', JSON.stringify(validSessions));
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
    return () => clearInterval(interval);
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
                workspace_uri: selectedSessionRepo !== undefined ? selectedSessionRepo : s.workspace_uri
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

  const handleSessionClick = async (session: SessionItem) => {
    const title = generateCleanSessionTitle(session.custom_title || session.title || '', session.session_id);
    
    let repo = session.workspace_uri || 'No Repo';
    if (repo !== 'No Repo' && repo.includes('/')) {
        repo = repo.split('/').filter(Boolean).pop() || repo;
    } else if (repo !== 'No Repo' && repo.includes('\\')) {
        repo = repo.split('\\').filter(Boolean).pop() || repo;
    }

    if (selectedSessionId && selectedSessionId !== session.session_id) {
      markSessionViewed(selectedSessionId).catch(() => {});
    }

    onSelectSession(session.session_id, title, repo);
    const sState = sessionStore.get(session.session_id);
    if (sState) sState.hasUnread = false;
    setSessions(prev =>
      prev.map(s => s.session_id === session.session_id ? { ...s, has_unread: false } : s)
    );
    await markSessionViewed(session.session_id);
  };

  const handleOpenMenu = (e: ReactMouseEvent, sessionId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveMenuSessionId(sessionId);

    const menuWidth = 192;
    const menuHeight = 210;
    const pad = 12;

    let x = e.clientX;
    let y = e.clientY;

    if (typeof window !== 'undefined') {
      if (y + menuHeight > window.innerHeight - pad) {
        y = Math.max(pad, e.clientY - menuHeight);
      }
      if (x + menuWidth > window.innerWidth - pad) {
        x = Math.max(pad, window.innerWidth - menuWidth - pad);
      }
    }

    setMenuPos({ x, y });
  };

  const handleRenameSubmit = async (sessionId: string) => {
    if (renameInput.trim()) {
      await renameSession(sessionId, renameInput.trim());
      setSessions(prev =>
        prev.map(s => s.session_id === sessionId ? { ...s, custom_title: renameInput.trim() } : s)
      );
    }
    setEditingSessionId(null);
    setActiveMenuSessionId(null);
  };

  const handleDelete = (sessionId: string) => {
    setActiveMenuSessionId(null);
    deletedSessionIds.current.add(sessionId);
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    sessionStore.delete(sessionId);

    if (selectedSessionId === sessionId) {
      onNewSession();
    }

    deleteSession(sessionId).catch(err => {
      console.warn("Failed to delete session on backend:", err);
    });

    onDeleteSession?.(sessionId);
  };

  const handleCopyId = (sessionId: string) => {
    navigator.clipboard.writeText(sessionId);
    setActiveMenuSessionId(null);
  };

  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => {
      const isCurrentlyOpen = prev[folderName] ?? true;
      return {
        ...prev,
        [folderName]: !isCurrentlyOpen,
      };
    });
  };

  const handleDeleteProjectClick = async (e: React.MouseEvent, projectId?: string, projectName?: string) => {
    e.stopPropagation();
    if (!projectId && !projectName) return;
    const confirmDelete = window.confirm(`Delete workspace "${projectName}"? This removes its associated sessions from MASH.`);
    if (!confirmDelete) return;
    const targetId = projectId || projectName!;
    try {
      await deleteProject(targetId);
      refreshData();
    } catch (err) {
      console.warn("Failed to delete project:", err);
    }
  };

  const handleAddWorkspace = async () => {
    // 1. In-browser native Directory Picker: Opens the exact "Open workspace / Select folder" native dialog
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
        if (dirHandle && dirHandle.name) {
          const folderName = dirHandle.name;
          const sampleChildren: string[] = [];
          try {
            for await (const entry of (dirHandle as any).values()) {
              sampleChildren.push(entry.name);
              if (sampleChildren.length >= 10) break;
            }
          } catch {}

          const resolved = await resolveFolder(folderName, sampleChildren);
          const folderPath = resolved.folder_path || folderName;
          const project = await createProject(folderName, folderPath);
          if (project) {
            refreshData();
            setOpenFolders(prev => ({ ...prev, [project.name]: true }));
            onNewSession(project.name, project.local_folder_path);
            return;
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // User canceled dialog
          return;
        }
        console.warn("Browser showDirectoryPicker fallback:", err);
      }
    }

    // 2. Fallback to native backend selectFolder
    try {
      const selected = await selectFolder();
      if (selected && selected.folder_path) {
        const folderPath = selected.folder_path;
        const folderName = selected.folder_name || folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;
        const project = await createProject(folderName, folderPath);
        if (project) {
          refreshData();
          setOpenFolders(prev => ({ ...prev, [project.name]: true }));
          onNewSession(project.name, project.local_folder_path);
        }
      }
    } catch (err) {
      console.warn("Native folder selection failed:", err);
    }
  };

  const handleNewProject = handleAddWorkspace;

  const handleQuickProjectCreated = (project: ProjectItem) => {
    refreshData();
    setOpenFolders(prev => ({ ...prev, [project.name]: true }));
    onNewSession(project.name, project.local_folder_path);
  };

  // Group sessions by workspace and pinned status
  const visibleSessions = sessions.filter(s => !archivedIds.has(s.session_id));
  const pinnedSessions = visibleSessions.filter(s => pinnedSessionIds.has(s.session_id));
  const unpinnedSessions = visibleSessions.filter(s => !pinnedSessionIds.has(s.session_id));

  const workspaceSessions: Record<string, SessionItem[]> = {};
  const directConversations: SessionItem[] = [];

  // Pre-populate all registered projects so they appear in Workspaces section
  registeredProjects.forEach(p => {
    workspaceSessions[p.name] = [];
  });

  unpinnedSessions.forEach(session => {
    const uri = session.workspace_uri;
    if (!uri || uri === 'No Repo') {
      directConversations.push(session);
      return;
    }

    // Match session to a registered project by path or name
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

  const renderSessionItem = (s: SessionItem, isPinnedContext: boolean = false) => {
    const isSelected = !isHistoryActive && selectedSessionId === s.session_id;
    const isEditing = editingSessionId === s.session_id;
    return (
      <SessionItemRow
        key={`${isPinnedContext ? 'pin_' : ''}${s.session_id}`}
        s={s}
        isPinnedContext={isPinnedContext}
        isSelected={isSelected}
        isEditing={isEditing}
        renameInput={renameInput}
        setRenameInput={setRenameInput}
        onSessionClick={handleSessionClick}
        onOpenMenu={handleOpenMenu}
        onRenameSubmit={handleRenameSubmit}
      />
    );
  };

  return (
    <div 
      className="bg-zinc-100/80 dark:bg-[#121214] h-full flex flex-col text-zinc-700 dark:text-zinc-300 font-sans shrink-0 select-none relative transition-colors"
      style={{ width: `${effectiveWidth}px` }}
      onClick={() => setActiveMenuSessionId(null)}
    >
      {/* Resizer Handle */}
      <div 
        className="absolute right-0 top-0 w-1 h-full cursor-col-resize z-50 hover:bg-sky-500/60 transition-colors"
        onMouseDown={startResizing}
      />

      {/* Top Header Bar & Quick Actions (without Scheduled Tasks!) */}
      <SidebarHeader
        onNewSession={onNewSession}
        onToggle={onToggle}
        isHistoryActive={isHistoryActive}
        onOpenHistory={onOpenHistory}
      />

      {/* Scrollable Content Area */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div 
          ref={scrollContainerRef}
          onScroll={updateScrollShading}
          className="flex-1 overflow-y-auto custom-scrollbar flex flex-col pb-1"
        >
          {/* Pinned Section */}
          <PinnedSection
            pinnedSessions={pinnedSessions}
            canScrollUp={canScrollUp}
            renderSessionItem={renderSessionItem}
          />

          {/* Workspaces Section */}
          <WorkspacesSection
            workspaceSessions={workspaceSessions}
            registeredProjects={registeredProjects}
            openFolders={openFolders}
            canScrollUp={canScrollUp}
            onToggleFolder={toggleFolder}
            onNewSession={onNewSession}
            onNewProject={handleNewProject}
            onOpenQuickProjectModal={() => setIsQuickProjectModalOpen(true)}
            onDeleteProject={handleDeleteProjectClick}
            renderSessionItem={renderSessionItem}
          />

          {/* Direct Conversations Section (NO Scheduled Tasks!) */}
          <DirectConversationsSection
            directConversations={directConversations}
            loading={loading}
            canScrollUp={canScrollUp}
            onNewSession={onNewSession}
            renderSessionItem={renderSessionItem}
          />
        </div>

        {/* Ambient Bottom Scroll Fade */}
        <div 
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-zinc-50 via-zinc-50/80 dark:from-[#121214] dark:via-[#121214]/80 to-transparent transition-opacity duration-300 z-10 ${
            canScrollDown ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      {/* Context Menu */}
      {activeMenuSessionId && (
        <SessionContextMenu
          activeMenuSessionId={activeMenuSessionId}
          menuPos={menuPos}
          menuRef={menuRef}
          sessions={sessions}
          pinnedSessionIds={pinnedSessionIds}
          setActiveMenuSessionId={setActiveMenuSessionId}
          setEditingSessionId={setEditingSessionId}
          setRenameInput={setRenameInput}
          togglePin={togglePin}
          handleCopyId={handleCopyId}
          handleArchive={handleArchive}
          handleDelete={handleDelete}
        />
      )}

      {/* Fixed Footer - Settings */}
      <SidebarFooter onOpenSettings={onOpenSettings} />

      {/* Quick Project Creation Modal */}
      <QuickProjectModal
        isOpen={isQuickProjectModalOpen}
        onClose={() => setIsQuickProjectModalOpen(false)}
        onProjectCreated={handleQuickProjectCreated}
      />
    </div>
  );
}
