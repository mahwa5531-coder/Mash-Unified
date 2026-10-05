"use client";

import { useState, MouseEvent as ReactMouseEvent, useCallback, useRef } from 'react';
import { markSessionViewed, renameSession, deleteSession, markSessionDeleted, SessionItem } from '@/services/sessions';
import { ProjectItem, selectFolder, resolveFolder, createProject, deleteProject } from '@/services/projects';
import { sessionStore } from '@/features/chat';
import { SessionItemRow } from './SessionItemRow';
import { SessionContextMenu } from './SessionContextMenu';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from './SidebarFooter';
import { PinnedSection } from './PinnedSection';
import { WorkspacesSection } from './WorkspacesSection';
import { DirectConversationsSection } from './DirectConversationsSection';
import { QuickProjectModal } from './QuickProjectModal';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { useSidebarResize } from '../hooks/useSidebarResize';
import { useSidebarData } from '../hooks/useSidebarData';

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
  // Atomised Resizing
  const { width: effectiveWidth, startResizing } = useSidebarResize({
    controlledWidth,
    onWidthChange,
  });

  // Atomised Data & State Management
  const {
    sessions,
    setSessions,
    registeredProjects,
    loading,
    refreshData,
    pinnedSessionIds,
    togglePin,
    handleArchive,
    openFolders,
    setOpenFolders,
    toggleFolder,
    pinnedSessions,
    workspaceSessions,
    directConversations,
  } = useSidebarData({
    selectedSessionId,
    selectedSessionTitle,
    selectedSessionRepo,
    externalArchivedSessionIds,
    externalOnToggleArchive,
  });

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

  // Context Menu State
  const [activeMenuSessionId, setActiveMenuSessionId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  // In-line Renaming State
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState<string>('');

  // Quick Project Modal State
  const [isQuickProjectModalOpen, setIsQuickProjectModalOpen] = useState(false);

  const handleSessionClick = async (session: SessionItem) => {
    const title = generateCleanSessionTitle(session.custom_title || session.title || '', session.session_id);
    
    const isDirectConversation = session.section === 'conversation' || !session.workspace_uri || session.workspace_uri === 'No Repo';
    let repo = 'No Repo';
    if (!isDirectConversation) {
      const uri = session.workspace_uri;
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
      repo = matchedProject ? matchedProject.name : (
        uri.includes('/') || uri.includes('\\')
          ? uri.split(/[/\\]/).filter(Boolean).pop() || uri
          : uri
      );
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
    const trimmed = renameInput.trim();
    if (trimmed) {
      const target = sessions.find(s => s.session_id === sessionId);
      const original = target?.custom_title || target?.title || '';
      if (trimmed !== original) {
        await renameSession(sessionId, trimmed);
        setSessions(prev =>
          prev.map(s => s.session_id === sessionId ? { ...s, custom_title: trimmed } : s)
        );
      }
    }
    setEditingSessionId(null);
    setActiveMenuSessionId(null);
  };

  const handleRenameCancel = () => {
    setEditingSessionId(null);
    setActiveMenuSessionId(null);
  };

  const handleDelete = (sessionId: string) => {
    setActiveMenuSessionId(null);
    markSessionDeleted(sessionId);
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    sessionStore.delete(sessionId);

    if (selectedSessionId === sessionId) {
      onNewSession();
    }

    if (onDeleteSession) {
      onDeleteSession(sessionId);
    } else {
      deleteSession(sessionId).catch(err => {
        console.warn("Failed to delete session on backend:", err);
      });
    }
  };

  const handleCopyId = (sessionId: string) => {
    navigator.clipboard.writeText(sessionId);
    setActiveMenuSessionId(null);
  };

  const handleDeleteProjectClick = async (e: React.MouseEvent, projectId?: string, projectName?: string) => {
    e.stopPropagation();
    if (!projectId && !projectName) return;
    const confirmDelete = window.confirm(`Delete workspace "${projectName}"? This removes its associated sessions from MASH.`);
    if (!confirmDelete) return;
    const targetId = projectId || projectName!;
    try {
      const ok = await deleteProject(targetId);
      if (ok) {
        refreshData();
        if (selectedSessionRepo && projectName && selectedSessionRepo.toLowerCase() === projectName.toLowerCase()) {
          onNewSession('No Repo');
        }
      }
    } catch (err) {
      console.warn("Failed to delete project:", err);
    }
  };

  const handleAddWorkspace = async () => {
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
        if (err?.name === 'AbortError') return;
        console.warn("Browser showDirectoryPicker fallback:", err);
      }
    }

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

  const handleQuickProjectCreated = (project: ProjectItem) => {
    refreshData();
    setOpenFolders(prev => ({ ...prev, [project.name]: true }));
    onNewSession(project.name, project.local_folder_path);
  };

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
        onCancelRename={handleRenameCancel}
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

      {/* Top Header Bar & Quick Actions */}
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
            onNewProject={handleAddWorkspace}
            onOpenQuickProjectModal={() => setIsQuickProjectModalOpen(true)}
            onDeleteProject={handleDeleteProjectClick}
            renderSessionItem={renderSessionItem}
          />

          {/* Direct Conversations Section */}
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
