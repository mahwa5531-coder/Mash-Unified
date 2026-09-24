"use client";

import { useEffect, useState, MouseEvent as ReactMouseEvent, useCallback, useRef } from 'react';
import { 
  Search, Settings, PanelLeftClose, PanelLeft, ArrowLeft, ArrowRight,
  Pin, Archive, Trash2, Edit2, Copy, Plus, MessageSquare, Clock, Bot, Puzzle, MoreVertical, ChevronDown
} from 'lucide-react';
import { 
  fetchSessions, markSessionViewed, renameSession, deleteSession, formatRelativeTime, generateCleanSessionTitle, SessionItem,
  fetchProjects, ProjectItem, selectFolder, getQuickstartFolder, resolveFolder, fetchAuthMe
} from '../utils/apiClient';
import { isSessionStreaming, subscribeToSessionStore, sessionStore } from '@/hooks/useChatStream';

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
function QuickStartFolderIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20h8" />
      <path d="M20 11V7a2 2 0 0 0-2-2h-6l-2-2H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2" />
      <polygon points="16 16 22 19 16 22 16 16" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Filter icon with descending horizontal bars */
function FilterBarsIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="17" x2="14" y2="17" />
    </svg>
  );
}

/** Folder creation icon with plus indicator */
function FolderPlusIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20h9" />
      <path d="M20 11V7a2 2 0 0 0-2-2h-6l-2-2H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2" />
      <line x1="19" y1="16" x2="19" y2="22" />
      <line x1="16" y1="19" x2="22" y2="19" />
    </svg>
  );
}

/** Workspace project folder icon */
function ProjectFolderIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2a2 2 0 0 0-1.66-.9H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
    </svg>
  );
}

// ponytail: Module-level cache eliminates empty flashes and provides 0ms initial render for sidebar
let cachedSidebarSessions: SessionItem[] = [];
let cachedSidebarProjects: ProjectItem[] = [];

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
  const [currentUser, setCurrentUser] = useState<{ name?: string; email?: string } | null>(null);

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

  useEffect(() => {
    fetchAuthMe().then((user) => {
      if (user && user.authenticated) setCurrentUser(user);
      else setCurrentUser(null);
    });
  }, []);

  // Live reactive wakeup whenever any session starts streaming or background tasks finish
  useEffect(() => {
    return subscribeToSessionStore(() => {
      setStoreTick((t) => t + 1);
    });
  }, []);

  // When active session changes, immediately clear unread dot if present
  useEffect(() => {
    if (!selectedSessionId) return;
    markSessionViewed(selectedSessionId).catch(() => {});
    const s = sessionStore.get(selectedSessionId);
    if (s) s.hasUnread = false;
    setSessions((prev) => {
      return prev.map((item) => (item.session_id === selectedSessionId ? { ...item, has_unread: false } : item));
    });
  }, [selectedSessionId]);

  // Workspaces popup menu state
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    if (isWorkspaceMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isWorkspaceMenuOpen]);

  const handleNewProject = async () => {
    setIsWorkspaceMenuOpen(false);

    // 1. Electron Native OS Dialog (When running in desktop Electron)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectFolder) {
      try {
        const res = await (window as any).electronAPI.selectFolder();
        if (res && res.folder_path) {
          onNewSession(res.folder_name || res.folder_path, res.folder_path);
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
          onNewSession(resolved.folder_name, resolved.folder_path);
        }
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User clicked Cancel in Windows explorer dialog
          return;
        }
        console.warn('showDirectoryPicker error, falling back:', err);
      }
    }

    // 3. Fallback: Backend native explorer dialog
    const res = await selectFolder();
    if (res && res.status === 'success' && res.folder_path && res.folder_name) {
      onNewSession(res.folder_name, res.folder_path);
    }
  };

  const handleQuickStart = async () => {
    setIsWorkspaceMenuOpen(false);
    const res = await getQuickstartFolder();
    onNewSession(res.folder_name || 'Quickstart', res.folder_path);
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
    const interval = setInterval(loadSessionsList, 5000);
    return () => clearInterval(interval);
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
    const isPinned = pinnedSessionIds.has(s.session_id);
    const storeState = sessionStore.get(s.session_id);
    const showUnread = !isSelected && (s.has_unread || Boolean(storeState?.hasUnread));
    const isStreaming = isSessionStreaming(s.session_id);

    return (
      <div
        key={`${isPinnedContext ? 'pin_' : ''}${s.session_id}`}
        onClick={() => handleSessionClick(s)}
        onContextMenu={(e) => handleOpenMenu(e, s.session_id)}
        className={`group/item relative h-[30px] mx-1 px-2.5 rounded-md cursor-pointer flex justify-between items-center select-none transition-colors ${
          isSelected
            ? 'bg-zinc-200/80 dark:bg-white/[0.1] text-zinc-900 dark:text-white font-medium'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        {isEditing ? (
          <input
            type="text"
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            onBlur={() => handleRenameSubmit(s.session_id)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit(s.session_id)}
            autoFocus
            className="bg-white dark:bg-[#18181b] border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[13px] text-zinc-900 dark:text-white outline-none w-full min-w-0"
          />
        ) : (
          <div className="flex items-center min-w-0 flex-1 mr-2 overflow-hidden">
            <span className={`truncate leading-snug transition-colors text-[13px] ${
              isSelected ? 'text-zinc-900 dark:text-white font-medium' : 'text-zinc-600 dark:text-zinc-400 group-hover/item:text-zinc-900 dark:group-hover/item:text-white'
            }`}>
              {generateCleanSessionTitle(s.custom_title || s.title || '', s.session_id)}
            </span>
          </div>
        )}

        {!isEditing && (
          <div className="flex items-center justify-end shrink-0 w-6 ml-1">
            {/* When not hovering: Show Spinner if running, Blue Dot if completed/unread, or Time if seen */}
            <div className="group-hover/item:hidden flex items-center justify-end">
              {isStreaming ? (
                <span 
                  className="w-3 h-3 rounded-full border-[1.5px] border-sky-400/30 border-t-sky-400 animate-spin shrink-0" 
                  title="Running in background..." 
                />
              ) : showUnread ? (
                <div 
                  className="w-4 h-4 rounded-full bg-blue-100 dark:bg-[#182433] flex items-center justify-center shrink-0 select-none" 
                  title="Completed - unread activity" 
                >
                  <span className="w-[6.5px] h-[6.5px] rounded-full bg-[#2f81f7] shrink-0" />
                </div>
              ) : (
                <span className={`text-[11.5px] font-mono shrink-0 ${isSelected ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  {formatRelativeTime(s.updated_at)}
                </span>
              )}
            </div>

            {/* When hovering: Show ONLY 3-dots button. Zero expanding, zero shifting! */}
            <div className="hidden group-hover/item:flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={(e) => handleOpenMenu(e, s.session_id)}
                className="text-zinc-400 hover:text-zinc-800 dark:hover:text-white transition-colors cursor-pointer p-0.5 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                title="More options"
              >
                <MoreVertical size={13.5} />
              </button>
            </div>
          </div>
        )}
      </div>
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
        <button type="button" className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Back">
          <ArrowLeft size={13} />
        </button>
        <button type="button" className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Forward">
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsWorkspaceMenuOpen((prev) => !prev);
                  }}
                  className={`cursor-pointer transition-colors p-1 rounded-md ${
                    isWorkspaceMenuOpen
                      ? 'bg-black/[0.08] dark:bg-white/[0.1] text-zinc-900 dark:text-white'
                      : 'text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white'
                  }`}
                  title="Add Project to Workspace"
                >
                  <FolderPlusIcon size={14} />
                </button>
              </div>

              {/* Workspaces Popover Menu */}
              {isWorkspaceMenuOpen && (
                <div 
                  ref={workspaceMenuRef}
                  className="absolute right-3 top-full mt-1 w-44 rounded-xl bg-white dark:bg-[#1c1c1f] border border-zinc-200 dark:border-white/[0.08] shadow-2xl py-1.5 z-50 animate-in fade-in zoom-in-95 select-none font-sans"
                >
                  <button
                    type="button"
                    onClick={handleNewProject}
                    className="w-full text-left px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2.5 cursor-pointer transition-colors text-xs"
                  >
                    <FolderPlusIcon size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <span className="text-[13px]">New Project</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleQuickStart}
                    className="w-full text-left px-3 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2.5 cursor-pointer transition-colors text-xs"
                  >
                    <QuickStartFolderIcon size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
                    <span className="text-[13px]">Quick Start</span>
                  </button>
                </div>
              )}
            </div>

            {isWorkspacesOpen && (
              <div className="flex flex-col space-y-0.5">
                {Object.entries(workspaceSessions).map(([repoName, repoSessions]) => (
                  <div key={repoName} className="flex flex-col">
                    {/* Folder Row */}
                    <div 
                      onClick={() => toggleFolder(repoName)}
                      className="flex items-center justify-between px-3 py-1 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer transition-colors group/folder select-none rounded-md mx-1 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06]"
                    >
                      <div className="flex items-center overflow-hidden min-w-0">
                        <ChevronDown 
                          size={11} 
                          className={`text-zinc-400 dark:text-zinc-500 mr-1 shrink-0 transition-transform duration-150 ${isFolderOpen(repoName) ? '' : '-rotate-90'}`} 
                        />
                        <ProjectFolderIcon size={14} className="mr-2 text-zinc-500 dark:text-zinc-400 group-hover/folder:text-zinc-700 dark:group-hover/folder:text-zinc-200 transition-colors shrink-0" />
                        <span className="text-[13px] font-normal text-zinc-700 dark:text-zinc-300 group-hover/folder:text-zinc-900 dark:group-hover/folder:text-white truncate transition-colors">{repoName}</span>
                      </div>
                      
                      <div 
                        onClick={(e) => handleCreateNewInFolder(e, repoName)}
                        className="opacity-0 group-hover/folder:opacity-100 p-0.5 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded transition-all shrink-0"
                        title="New conversation in workspace"
                      >
                        <Plus size={13} />
                      </div>
                    </div>
                    
                    {isFolderOpen(repoName) && (
                      <div className="flex flex-col pl-3">
                        {repoSessions.length === 0 ? (
                          <div className="pl-6 py-1 text-[12px] text-zinc-400 dark:text-zinc-500 italic truncate">Empty</div>
                        ) : (
                          repoSessions.map((s) => renderSessionItem(s))
                        )}
                      </div>
                    )}
                  </div>
                ))}
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
        <>
          {/* Transparent full-screen overlay to close when clicking outside */}
          <div 
            className="fixed inset-0 z-40 bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuSessionId(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveMenuSessionId(null);
            }}
          />
          <div 
            ref={menuRef}
            style={{ top: `${menuPos.y}px`, left: `${menuPos.x}px` }}
            className="fixed z-50 w-48 bg-white dark:bg-[#18181a] border border-zinc-200 dark:border-white/[0.08] rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/80 p-1 text-[13px] text-zinc-700 dark:text-zinc-300 font-sans select-none backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              onClick={() => {
                togglePin(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none"
            >
              <Pin size={14} className={`text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0 ${pinnedSessionIds.has(activeMenuSessionId) ? 'fill-sky-400 text-sky-400' : ''}`} />
              <span className="truncate">{pinnedSessionIds.has(activeMenuSessionId) ? 'Unpin conversation' : 'Pin to top'}</span>
            </div>

            <div 
              onClick={() => {
                setEditingSessionId(activeMenuSessionId);
                const target = sessions.find(s => s.session_id === activeMenuSessionId);
                setRenameInput(target?.custom_title || target?.title || '');
                setActiveMenuSessionId(null);
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none"
            >
              <Edit2 size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Rename</span>
            </div>

            <div 
              onClick={() => {
                handleCopyId(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none"
            >
              <Copy size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Copy Session ID</span>
            </div>

            <div 
              onClick={() => {
                handleArchive(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none"
            >
              <Archive size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Archive</span>
            </div>

            <div className="my-1 border-t border-zinc-200 dark:border-white/[0.06]" />

            <div 
              onClick={() => handleDelete(activeMenuSessionId)}
              className="h-8 px-2.5 rounded-lg hover:bg-red-500/10 dark:hover:bg-red-500/[0.12] hover:text-red-600 dark:hover:text-red-300 text-zinc-700 dark:text-zinc-300 cursor-pointer flex items-center gap-2.5 transition-colors group select-none"
            >
              <Trash2 size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-red-500 dark:group-hover:text-red-400 shrink-0 transition-colors" />
              <span className="truncate">Delete</span>
            </div>
          </div>
        </>
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
