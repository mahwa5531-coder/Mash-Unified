"use client";

import { useEffect, useState, MouseEvent as ReactMouseEvent, useCallback, useRef } from 'react';
import { Settings, PanelLeft, ArrowLeft, ArrowRight, Plus, Clock, ChevronDown, ExternalLink, MoreHorizontal, Trash2, FolderOpen } from 'lucide-react';
import { fetchSessions, markSessionViewed, renameSession, deleteSession, SessionItem } from '@/services/sessions';
import { fetchProjects, ProjectItem, selectFolder, getQuickstartFolder, resolveFolder, createProject, deleteProject } from '@/services/projects';
import { openSystemFile } from '@/services/files';
import { formatRelativeTime } from '@/utils/formatting';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { isSessionStreaming, subscribeToSessionStore, sessionStore } from '@/features/chat';
import { SessionItemRow } from './SessionItemRow';
import { SessionContextMenu } from './SessionContextMenu';
import {
  QuickStartFolderIcon,
  FilterBarsIcon,
  FolderPlusIcon,
  ProjectFolderIcon,
} from './icons';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

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

/** Quick-start folder icon with action arrow */
// ponytail: Module-level cache eliminates empty flashes and provides 0ms initial render for sidebar
let cachedSidebarSessions: SessionItem[] = [];
let cachedSidebarProjects: ProjectItem[] = [];

if (typeof window !== 'undefined') {
  try {
    const s = localStorage.getItem('nexau_cached_sessions');
    if (s) cachedSidebarSessions = JSON.parse(s);
    const p = localStorage.getItem('nexau_cached_projects');
    if (p) cachedSidebarProjects = JSON.parse(p);
  } catch {}
}

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
  const [sessions, setSessions] = useState<SessionItem[]>(() => cachedSidebarSessions);
  const [registeredProjects, setRegisteredProjects] = useState<ProjectItem[]>(() => cachedSidebarProjects);
  const [loading, setLoading] = useState<boolean>(true);
  const [, setStoreTick] = useState(0);

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

  // Pinned Sessions State (Hydrated in useEffect to prevent SSR mismatch)
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set());
  const [isPinnedOpen, setIsPinnedOpen] = useState<boolean>(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('nexau_pinned_session_ids');
      if (stored) {
        setPinnedSessionIds(new Set(JSON.parse(stored)));
      }
    } catch {}
  }, []);

  const togglePin = (sessionId: string) => {
    setPinnedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      try {
        localStorage.setItem('nexau_pinned_session_ids', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // Archived Sessions State (Synced with parent or persisted in localStorage)
  const [localArchivedSessionIds, setLocalArchivedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!externalArchivedSessionIds) {
      try {
        const stored = localStorage.getItem('nexau_archived_session_ids');
        if (stored) {
          setLocalArchivedSessionIds(new Set(JSON.parse(stored)));
        }
      } catch {}
    }
  }, [externalArchivedSessionIds]);

  const effectiveArchivedSessionIds = externalArchivedSessionIds || localArchivedSessionIds;

  const handleArchive = (sessionId: string) => {
    if (externalOnToggleArchive) {
      externalOnToggleArchive(sessionId);
      return;
    }
    setLocalArchivedSessionIds((prev) => {
      const next = new Set(prev);
      next.add(sessionId);
      try {
        localStorage.setItem('nexau_archived_session_ids', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };


  // Live reactive wakeup whenever any session starts streaming or background tasks finish
  useEffect(() => {
    return subscribeToSessionStore(() => {
      setStoreTick((t) => t + 1);
    });
  }, []);

  // When active session changes, immediately clear unread dot if present and sync dynamically
  useEffect(() => {
    if (!selectedSessionId) return;
    markSessionViewed(selectedSessionId).catch(() => {});
    const s = sessionStore.get(selectedSessionId);
    if (s) s.hasUnread = false;
    setSessions((prev) => {
      const exists = prev.some((item) => item.session_id === selectedSessionId);
      if (exists) {
        return prev.map((item) => (item.session_id === selectedSessionId ? { ...item, has_unread: false } : item));
      }
      const newItem: SessionItem = {
        session_id: selectedSessionId,
        title: selectedSessionTitle || 'New Conversation',
        custom_title: selectedSessionTitle || '',
        workspace_uri: selectedSessionRepo && selectedSessionRepo !== 'No Repo' ? selectedSessionRepo : 'No Repo',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        message_count: 0,
        total_tokens: 0,
        last_user_view_time: new Date().toISOString(),
        has_unread: false,
      };
      return [newItem, ...prev];
    });
    loadSessionsList();
  }, [selectedSessionId, selectedSessionTitle, selectedSessionRepo]);

  const addProjectOptimistic = (name: string, folderPath: string) => {
    setRegisteredProjects((prev) => {
      const existing = prev.find((p) => p.name === name);
      const updated = existing
        ? prev.map((p) => (p.name === name ? { ...p, local_folder_path: folderPath } : p))
        : [...prev, { id: Date.now().toString(), name, local_folder_path: folderPath }];
      cachedSidebarProjects = updated;
      try {
        localStorage.setItem('nexau_cached_projects', JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setIsWorkspacesOpen(true);
    setOpenFolders((prev) => ({ ...prev, [name]: true }));
  };

  const handleNewProject = async () => {
    // 1. Electron Native OS Dialog (When running in desktop Electron)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
      try {
        const res = await (window as any).electronAPI.selectFolder();
        if (res && res.folder_path) {
          const folderName = res.folder_name || res.folder_path.split(/[/\\]/).pop() || 'Project';
          addProjectOptimistic(folderName, res.folder_path);
          const created = await createProject(folderName, res.folder_path);
          if (created) addProjectOptimistic(created.name, created.local_folder_path);
          loadSessionsList();
          onNewSession(folderName, res.folder_path);
          return;
        }
      } catch (err) {
        console.warn('Electron selectFolder error:', err);
      }
    }

    // 2. Native Laptop Explorer Dialog via File System Access API
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({
          id: 'open-workspace',
          mode: 'read',
        });
        if (!dirHandle || !dirHandle.name) return;

        // Resolve absolute path via backend using folder name (no file inspection, zero browser security warnings)
        const resolved = await resolveFolder(dirHandle.name);
        if (resolved && resolved.status === 'success' && resolved.folder_path) {
          addProjectOptimistic(resolved.folder_name, resolved.folder_path);
          const created = await createProject(resolved.folder_name, resolved.folder_path);
          if (created) addProjectOptimistic(created.name, created.local_folder_path);
          loadSessionsList();
          onNewSession(resolved.folder_name, resolved.folder_path);
        }
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          return;
        }
        console.warn('showDirectoryPicker error, falling back:', err);
      }
    }

    // 3. Fallback: Backend native explorer dialog
    const res = await selectFolder();
    if (res && res.status === 'success' && res.folder_path && res.folder_name) {
      addProjectOptimistic(res.folder_name, res.folder_path);
      const created = await createProject(res.folder_name, res.folder_path);
      if (created) addProjectOptimistic(created.name, created.local_folder_path);
      loadSessionsList();
      onNewSession(res.folder_name, res.folder_path);
    }
  };

  const handleQuickStart = async () => {
    const res = await getQuickstartFolder();
    if (res && res.folder_path) {
      const name = res.folder_name || 'Quickstart';
      addProjectOptimistic(name, res.folder_path);
      const created = await createProject(name, res.folder_path);
      if (created) addProjectOptimistic(created.name, created.local_folder_path);
      loadSessionsList();
      onNewSession(name, res.folder_path);
    }
  };

  const deletedSessionIds = useRef<Set<string>>(new Set());

  // Resizable Sidebar State
  const [width, setWidth] = useState(controlledWidth || 260);
  const effectiveWidth = controlledWidth !== undefined ? controlledWidth : width;
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        let newWidth = e.clientX;
        if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
        if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
        setWidth(newWidth);
        onWidthChange?.(newWidth);
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Context Menu State
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');

  // Folder state (true = open)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(true);
  const [isConversationsOpen, setIsConversationsOpen] = useState(true);

  // Live observer for scroll shading (dynamically hides bottom shadow when reaching bottom/setting frame)
  useEffect(() => {
    updateScrollShading();
    const el = scrollContainerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      updateScrollShading();
    });
    ro.observe(el);

    return () => ro.disconnect();
  }, [updateScrollShading, sessions, isWorkspacesOpen, isConversationsOpen, isPinnedOpen, openFolders]);

  const loadSessionsList = async () => {
    const [list, projectList] = await Promise.all([
      fetchSessions(),
      fetchProjects(),
    ]);
    if (projectList && Array.isArray(projectList)) {
      cachedSidebarProjects = projectList;
      setRegisteredProjects(projectList);
      try {
        localStorage.setItem('nexau_cached_projects', JSON.stringify(projectList));
      } catch {}
    }
    const valid = list
      .map((s: SessionItem) => (s.session_id === selectedSessionId ? { ...s, has_unread: false } : s))
      .filter((s: SessionItem) => !deletedSessionIds.current.has(s.session_id));
    // Deduplicate by session_id
    const seen = new Set<string>();
    const unique = valid.filter((s: SessionItem) => {
      if (seen.has(s.session_id)) return false;
      seen.add(s.session_id);
      return true;
    });
    cachedSidebarSessions = unique;
    try {
      localStorage.setItem('nexau_cached_sessions', JSON.stringify(unique));
    } catch {}
    // ponytail: preserve currently active session if backend poll has not synced it yet
    setSessions((prev) => {
      if (selectedSessionId && !unique.some((s) => s.session_id === selectedSessionId)) {
        const activeItem = prev.find((s) => s.session_id === selectedSessionId);
        if (activeItem) {
          cachedSidebarSessions = [activeItem, ...unique];
          return [activeItem, ...unique];
        }
      }
      return unique;
    });
    setLoading(false);
  };

  useEffect(() => {
    loadSessionsList();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadSessionsList();
    }, 5000);
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadSessionsList();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // ponytail: optimistically insert/update session with deduplication
  useEffect(() => {
    if (!selectedSessionId) return;
    const timer = setTimeout(() => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.session_id === selectedSessionId);
        if (exists) {
          if (selectedSessionTitle) {
            return prev.map((s) =>
              s.session_id === selectedSessionId
                ? { ...s, custom_title: selectedSessionTitle, title: selectedSessionTitle }
                : s
            );
          }
          return prev;
        }
        const newSession: SessionItem = {
          session_id: selectedSessionId,
          title: selectedSessionTitle || `Session ${selectedSessionId.slice(0, 8)}`,
          custom_title: selectedSessionTitle || '',
          workspace_uri: selectedSessionRepo || 'No Repo',
          section: (selectedSessionRepo && selectedSessionRepo !== 'No Repo') ? 'workspace' : 'conversation',
          created_at: Date.now(),
          updated_at: Date.now(),
          message_count: 1,
          total_tokens: 0,
          last_user_view_time: Date.now(),
          has_unread: false,
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
    const title = session.custom_title || session.title || `Session ${session.session_id.slice(0, 8)}`;
    
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
    // Instantly vanish unread blue dot locally and notify backend
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

    // Dynamic viewport boundary clamping: prevent overflow on bottom/right edges
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

  // Measured auto-realign when context menu mounts
  useEffect(() => {
    if (activeMenuSessionId && menuRef.current && typeof window !== 'undefined') {
      const rect = menuRef.current.getBoundingClientRect();
      const pad = 10;
      let newX = menuPos.x;
      let newY = menuPos.y;
      let adjusted = false;

      if (rect.bottom > window.innerHeight - pad) {
        newY = Math.max(pad, window.innerHeight - rect.height - pad);
        adjusted = true;
      }
      if (rect.right > window.innerWidth - pad) {
        newX = Math.max(pad, window.innerWidth - rect.width - pad);
        adjusted = true;
      }
      if (rect.top < pad) {
        newY = pad;
        adjusted = true;
      }
      if (adjusted) {
        setMenuPos({ x: newX, y: newY });
      }
    }
  }, [activeMenuSessionId]);

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
    // 1. Instantly close context menu (0ms)
    setActiveMenuSessionId(null);

    // 2. Instantly prevent polling from re-inserting it
    deletedSessionIds.current.add(sessionId);

    // 3. Instantly remove from local sessions state (0ms optimistic UI update)
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));

    // 4. Instantly purge from in-memory session store
    sessionStore.delete(sessionId);

    // 5. If deleted session was active, switch immediately to fresh session
    if (selectedSessionId === sessionId) {
      onNewSession();
    }

    // 6. Delete on backend asynchronously in background (fire-and-forget, non-blocking)
    deleteSession(sessionId).catch(err => {
      console.warn("Failed to delete session on backend:", err);
    });

    // 7. Notify parent component to keep state synchronized
    onDeleteSession?.(sessionId);
  };

  const handleCopyId = (sessionId: string) => {
    navigator.clipboard.writeText(sessionId);
    setActiveMenuSessionId(null);
  };

  const toggleFolder = (folderName: string) => {
    setOpenFolders(prev => ({
      ...prev,
      [folderName]: prev[folderName] === undefined ? false : !prev[folderName]
    }));
  };

  const handleCreateNewInFolder = (e: ReactMouseEvent, folderName: string) => {
    e.stopPropagation();
    const match = registeredProjects.find((p) => p.name === folderName);
    onNewSession(folderName, match?.local_folder_path);
  };

  const handleDeleteProjectClick = async (e: ReactMouseEvent, projectId?: string, projectName?: string) => {
    e.stopPropagation();
    if (!projectId && !projectName) return;
    const confirmDelete = window.confirm(`Delete workspace "${projectName}"? This removes its associated sessions from MASH.`);
    if (!confirmDelete) return;
    const targetId = projectId || projectName!;
    setRegisteredProjects((prev) => prev.filter((p) => p.name !== projectName && p.id !== targetId));
    await deleteProject(targetId);
    loadSessionsList();
    if (selectedSessionRepo === projectName) {
      onNewSession('No Repo');
    }
  };

  // 1. Pinned & Active sessions (excluding archived)
  const activeSessions = sessions.filter((s) => !effectiveArchivedSessionIds.has(s.session_id));
  const pinnedSessions = activeSessions.filter((s) => pinnedSessionIds.has(s.session_id));
  const unpinnedSessions = activeSessions.filter((s) => !pinnedSessionIds.has(s.session_id));

  // 2. Partition unpinned sessions into Workspaces vs Conversations
  const workspaceSessions: Record<string, SessionItem[]> = {};
  const directConversations: SessionItem[] = [];

  unpinnedSessions.forEach((session) => {
    let repo = session.workspace_uri || 'No Repo';
    if (repo !== 'No Repo' && repo.includes('/')) {
      repo = repo.split('/').filter(Boolean).pop() || repo;
    } else if (repo !== 'No Repo' && repo.includes('\\')) {
      repo = repo.split('\\').filter(Boolean).pop() || repo;
    }

    if (repo === 'No Repo' || session.section === 'conversation') {
      directConversations.push(session);
    } else {
      if (!workspaceSessions[repo]) {
        workspaceSessions[repo] = [];
      }
      workspaceSessions[repo].push(session);
    }
  });

  // Ensure registered projects appear in workspaces even if empty
  registeredProjects.forEach((p) => {
    if (!workspaceSessions[p.name]) {
      workspaceSessions[p.name] = [];
    }
  });

  const isFolderOpen = (folderName: string) => openFolders[folderName] !== false;

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

      {/* Row 2: Top Header Bar (height h-9 = 36px, matching Row 2 of window) */}
      <div className="h-9 bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center gap-1.5 px-3 select-none shrink-0">
        <div className="w-5 h-5 rounded-md bg-zinc-800 text-zinc-100 flex items-center justify-center font-bold text-[11px] shadow-xs select-none mr-1">
          M
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Collapse sidebar"
        >
          <PanelLeft size={15} />
        </button>
        <button 
          type="button" 
          onClick={() => window.history.back()}
          className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer" 
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={13} />
        </button>
        <button 
          type="button" 
          onClick={() => window.history.forward()}
          className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer" 
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={13} />
        </button>
      </div>

      {/* Top Quick Actions (+ New Conversation, Conversation History) */}
      <div className="px-2.5 pt-3 pb-2 flex flex-col space-y-1 shrink-0">
        {/* + New Conversation (rounded bordered pill) */}
        <button
          type="button"
          onClick={() => onNewSession('No Repo')}
          className="w-full flex items-center justify-start py-1.5 px-3 rounded-lg border border-zinc-200/80 dark:border-white/[0.08] bg-zinc-200/40 dark:bg-white/[0.04] hover:bg-zinc-200/80 dark:hover:bg-white/[0.08] cursor-pointer transition-colors text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white text-[13px] font-medium shadow-2xs"
        >
          <Plus size={14} className="mr-2 text-zinc-600 dark:text-zinc-400" />
          <span>New Conversation</span>
        </button>
        
        {/* Conversation History */}
        <button
          type="button"
          onClick={onOpenHistory}
          className={`w-full flex items-center text-[13px] py-1.5 px-3 rounded-lg cursor-pointer transition-colors select-none ${
            isHistoryActive
              ? 'bg-zinc-200/80 dark:bg-white/[0.1] text-zinc-950 dark:text-white font-medium'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/50 dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Clock size={14} className="mr-2.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span className="truncate">Conversation History</span>
        </button>
      </div>

      {/* Zone 3 & 4: Scrollable Content Area with Sliding Sticky Headers & Ambient Shading */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div 
          ref={scrollContainerRef}
          onScroll={updateScrollShading}
          className="flex-1 overflow-y-auto custom-scrollbar flex flex-col pb-1"
        >
          {/* PINNED SECTION (Zero DOM footprint when no pinned sessions) */}
          {pinnedSessions.length > 0 && (
            <div className="relative pb-2">
              <div 
                onClick={() => setIsPinnedOpen((prev) => !prev)}
                className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center group cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors ${
                  canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors">Pinned</span>
                  <ChevronDown 
                    size={11} 
                    className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isPinnedOpen ? '' : '-rotate-90'}`} 
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  {pinnedSessions.length}
                </span>
              </div>

              {isPinnedOpen && (
                <div className="flex flex-col space-y-0.5">
                  {pinnedSessions.map((s) => renderSessionItem(s, true))}
                </div>
              )}
            </div>
          )}

          {/* 1. WORKSPACES SECTION */}
          <div className="relative pb-2">
            <div 
              onClick={() => setIsWorkspacesOpen((prev) => !prev)}
              className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center group cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors relative ${
                canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors">Workspaces</span>
                <ChevronDown 
                  size={11} 
                  className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isWorkspacesOpen ? '' : '-rotate-90'}`} 
                />
              </div>
              <div className="flex items-center text-zinc-400" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handleNewProject}
                  className="cursor-pointer transition-colors p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white"
                  title="Open Workspace Folder from Computer"
                >
                  <FolderPlusIcon size={14} />
                </button>
              </div>
            </div>

            {isWorkspacesOpen && (
              <div className="flex flex-col space-y-0.5">
                {Object.entries(workspaceSessions).map(([repoName, repoSessions]) => {
                  const match = registeredProjects.find((p) => p.name === repoName);
                  const isWorkspaceActive = selectedSessionRepo === repoName;
                  const folderOpen = isFolderOpen(repoName);

                  const handleSelectWorkspace = () => {
                    setOpenFolders((prev) => ({ ...prev, [repoName]: true }));
                    if (repoSessions.length > 0) {
                      onSelectSession(repoSessions[0].session_id, repoSessions[0].title, repoName);
                    } else {
                      onNewSession(repoName, match?.local_folder_path);
                    }
                  };

                  return (
                    <div key={repoName} className="flex flex-col">
                      {/* Folder Row */}
                      <div 
                        onClick={handleSelectWorkspace}
                        className={`flex items-center justify-between px-2.5 py-1 rounded-md mx-1 cursor-pointer transition-colors group/folder select-none ${
                          isWorkspaceActive 
                            ? 'bg-zinc-200/90 dark:bg-white/[0.08] text-zinc-950 dark:text-white font-medium shadow-2xs' 
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center overflow-hidden min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFolder(repoName);
                            }}
                            className="p-0.5 -ml-1 mr-0.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
                            title={folderOpen ? "Collapse folder" : "Expand folder"}
                          >
                            <ChevronDown 
                              size={11} 
                              className={`transition-transform duration-150 ${folderOpen ? '' : '-rotate-90'}`} 
                            />
                          </button>
                          <ProjectFolderIcon size={14} className="mr-2 text-zinc-500 dark:text-zinc-400 group-hover/folder:text-zinc-700 dark:group-hover/folder:text-zinc-200 transition-colors shrink-0" />
                          <span className="text-[13px] truncate transition-colors">{repoName}</span>
                        </div>
                        
                        <div className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={(e) => handleCreateNewInFolder(e, repoName)}
                            className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded hover:bg-zinc-300/50 dark:hover:bg-white/[0.1] transition-all cursor-pointer"
                            title={`New conversation in ${repoName}`}
                          >
                            <Plus size={13} />
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded hover:bg-zinc-300/50 dark:hover:bg-white/[0.1] transition-all cursor-pointer outline-none"
                                title="Project options"
                              >
                                <MoreHorizontal size={13} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent 
                              align="end" 
                              side="bottom" 
                              sideOffset={4}
                              className="w-48 rounded-xl bg-white dark:bg-[#1c1c1f] border border-zinc-200 dark:border-white/[0.08] shadow-2xl p-1 z-50 select-none font-sans text-xs"
                            >
                              <DropdownMenuItem
                                onClick={() => onNewSession(repoName, match?.local_folder_path)}
                                className="px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2 cursor-pointer rounded-lg"
                              >
                                <Plus size={13} className="text-zinc-400 shrink-0" />
                                <span>New Conversation</span>
                              </DropdownMenuItem>

                              {match?.local_folder_path && (
                                <DropdownMenuItem
                                  onClick={() => openSystemFile(match.local_folder_path)}
                                  className="px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2 cursor-pointer rounded-lg"
                                >
                                  <ExternalLink size={13} className="text-zinc-400 shrink-0" />
                                  <span>Open in File Explorer</span>
                                </DropdownMenuItem>
                              )}

                              <DropdownMenuSeparator className="my-1 bg-zinc-200 dark:bg-white/[0.06]" />

                              <DropdownMenuItem
                                onClick={(e) => handleDeleteProjectClick(e, match?.id, repoName)}
                                className="px-2.5 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-2 cursor-pointer rounded-lg"
                              >
                                <Trash2 size={13} className="shrink-0" />
                                <span>Delete Project</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      
                      {folderOpen && (
                        <div className="flex flex-col pl-3">
                          {repoSessions.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => onNewSession(repoName, match?.local_folder_path)}
                              className="flex items-center gap-1.5 pl-6 py-1.5 text-[11.5px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer text-left w-full rounded hover:bg-zinc-200/40 dark:hover:bg-white/[0.04]"
                            >
                              <Plus size={11} className="text-zinc-400 shrink-0" />
                              <span>Start conversation</span>
                            </button>
                          ) : (
                            repoSessions.map((s) => renderSessionItem(s))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {Object.keys(workspaceSessions).length === 0 && !loading && (
                  <div className="px-4 py-1 text-[12px] text-zinc-400 dark:text-zinc-500 italic">No workspaces active</div>
                )}
              </div>
            )}
          </div>

          {/* 2. CONVERSATIONS SECTION */}
          <div className="relative pb-2">
            <div 
              onClick={() => setIsConversationsOpen((prev) => !prev)}
              className={`sticky top-0 z-20 bg-zinc-100/90 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center group cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors ${
                canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors">Conversations</span>
                <ChevronDown 
                  size={11} 
                  className={`text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${isConversationsOpen ? '' : '-rotate-90'}`} 
                />
              </div>
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onNewSession('No Repo');
                }}
                className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                title="New Conversation"
              >
                <Plus size={14} />
              </button>
            </div>

            {isConversationsOpen && (
              <div className="flex flex-col space-y-0.5">
                {directConversations.length === 0 && !loading ? (
                  <div className="px-4 py-1 text-[12px] text-zinc-400 dark:text-zinc-500 italic">No conversations</div>
                ) : (
                  directConversations.map((s) => renderSessionItem(s))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Shading Fade above Settings Frame */}
        <div 
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-zinc-50 via-zinc-50/80 dark:from-[#121214] dark:via-[#121214]/80 to-transparent transition-opacity duration-300 z-10 ${
            canScrollDown ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
      
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

      {/* Zone 5: Fixed Footer - Settings (Image 1) */}
      <div className="mt-auto p-2 bg-zinc-100/80 dark:bg-[#121214] shrink-0">
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer select-none text-[13px]"
          title="Settings"
        >
          <Settings size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
