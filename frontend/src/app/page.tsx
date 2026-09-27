"use client";

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import ChatCanvas from '@/components/ChatCanvas';
import RightSidebar from '@/components/RightSidebar';
import ConversationHistory from '@/components/ConversationHistory';
import SettingsModal from '@/components/SettingsModal';
import DesktopSignInView from '@/components/auth/DesktopSignInView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { fetchSessions, deleteSession, SessionItem, fetchAuthMe, AuthUser } from '@/utils/apiClient';
import { TooltipProvider } from '@/components/ui/tooltip';
import { sessionStore } from '@/hooks/useChatStream';
import { 
  PanelLeft, PanelRight, Settings, Sparkles, 
  Minus, Square, X, ArrowLeft, ArrowRight 
} from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

const DEFAULT_LOCAL_USER: AuthUser = {
  authenticated: true,
  email: 'auditor@mash.local',
  name: 'Audit Lead',
  plan: 'enterprise',
  credits_remaining: 999999,
};

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(DEFAULT_LOCAL_USER);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionTitle, setSelectedSessionTitle] = useState<string>('New Conversation');
  const [selectedSessionRepo, setSelectedSessionRepo] = useState<string>('No Repo');
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isRightSidebarMaximized, setIsRightSidebarMaximized] = useState(false);
  const [fileToOpen, setFileToOpen] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [isHistoryActive, setIsHistoryActive] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string>('appearance');
  const [allSessions, setAllSessions] = useState<SessionItem[]>([]);

  useEffect(() => {
    let isMounted = true;
    fetchAuthMe().then((user) => {
      if (isMounted) {
        if (user && user.authenticated) {
          setAuthUser(user);
        } else {
          setAuthUser(DEFAULT_LOCAL_USER);
        }
        setIsAuthLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        setAuthUser(DEFAULT_LOCAL_USER);
        setIsAuthLoading(false);
      }
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
  }, [isDark]);

  // ponytail: stable callbacks to prevent unneeded re-mounts/re-renders of ChatCanvas and Sidebar
  const handleSelectSession = useCallback((sessionId: string, title?: string, repoName?: string) => {
    setSelectedSessionId(sessionId);
    if (title) setSelectedSessionTitle(title);
    if (repoName) setSelectedSessionRepo(repoName);
    setPendingWorkspacePath(null);
    setIsHistoryActive(false);
  }, []);

  const handleNewSession = useCallback((repoName: string = 'No Repo', folderPath?: string) => {
    setSelectedSessionId(null);
    setSelectedSessionTitle('New Conversation');
    setSelectedSessionRepo(repoName);
    setPendingWorkspacePath(folderPath || null);
    setIsHistoryActive(false);
  }, []);

  const handleOpenHistory = useCallback(async () => {
    setIsHistoryActive(true);
    const list = await fetchSessions();
    setAllSessions(list);
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    setAllSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
    sessionStore.delete(sessionId);
    if (selectedSessionId === sessionId) {
      handleNewSession('No Repo');
    }
    deleteSession(sessionId).catch((err) => {
      console.warn("Background deleteSession failed:", err);
    });
  }, [selectedSessionId, handleNewSession]);

  const [archivedSessionIds, setArchivedSessionIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const stored = localStorage.getItem('nexau_archived_session_ids');
      if (stored) {
        setArchivedSessionIds(new Set(JSON.parse(stored)));
      }
    } catch {}
  }, []);

  const handleToggleArchive = useCallback((sessionId: string) => {
    setArchivedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      try {
        localStorage.setItem('nexau_archived_session_ids', JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    setIsRightSidebarOpen(true);
    setFileToOpen(path);
  }, []);

  if (isAuthLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#101010] text-zinc-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-zinc-500 border-t-transparent animate-spin" />
          <span className="text-xs font-mono tracking-wider text-zinc-500 uppercase">MASH</span>
        </div>
      </div>
    );
  }

  if (!authUser || !authUser.authenticated) {
    return <DesktopSignInView onAuthSuccess={(user) => setAuthUser(user)} />;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[var(--bg-app)] overflow-hidden text-[var(--text-primary)] font-sans transition-colors">
      {/* Row 1: Window Frame Title Bar (Matches Desktop Window in Images 1 & 2) */}
      <div className="h-7 bg-[#0d0d0f] flex items-center justify-between px-3 select-none shrink-0 text-xs text-zinc-400 z-50">
        <div className="flex items-center gap-4">
          <span className="font-semibold tracking-wider text-zinc-200 text-xs">MASH</span>
          <span className="hover:text-zinc-200 cursor-pointer transition-colors text-[11.5px]">File</span>
          <span className="hover:text-zinc-200 cursor-pointer transition-colors text-[11.5px]">View</span>
          <span className="hover:text-zinc-200 cursor-pointer transition-colors text-[11.5px]">Window</span>
        </div>
        
        {/* Window Controls (Minimize, Maximize, Close) */}
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <Minus size={11} />
          </button>
          <button 
            type="button"
            onClick={() => {
              if (typeof document !== 'undefined') {
                if (document.fullscreenElement) {
                  document.exitFullscreen().catch(() => {});
                } else {
                  document.documentElement.requestFullscreen().catch(() => {});
                }
              }
            }}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Toggle fullscreen"
            aria-label="Toggle fullscreen"
          >
            <Square size={10} />
          </button>
          <button 
            type="button"
            onClick={() => handleNewSession('No Repo')}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-red-500/80 hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title="Reset / New session"
            aria-label="Reset / New session"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <ErrorBoundary
        scope="workbench-root"
        fallbackRender={(error, reset) => (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--bg-app)]">
            <div className="max-w-md p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-xl">
              <h2 className="text-base font-semibold text-zinc-100 mb-2">MASH Recovered From Error</h2>
              <p className="text-xs text-zinc-400 mb-4 font-mono break-all">{error.message}</p>
              <button
                type="button"
                onClick={reset}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                Restore Workspace
              </button>
            </div>
          </div>
        )}
      >
        <TooltipProvider delayDuration={150}>
          <main className="flex flex-1 overflow-hidden min-h-0">
            {/* Column 1: Left Sidebar (starts with Row 2 header when open) */}
            {isSidebarOpen && (
              <Sidebar
                selectedSessionId={selectedSessionId}
                selectedSessionTitle={selectedSessionTitle}
                selectedSessionRepo={selectedSessionRepo}
                onSelectSession={handleSelectSession}
                onNewSession={handleNewSession}
                onToggle={() => setIsSidebarOpen(false)}
                isHistoryActive={isHistoryActive}
                onOpenHistory={handleOpenHistory}
                onOpenSettings={() => { setSettingsTab('appearance'); setIsSettingsOpen(true); }}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
                archivedSessionIds={archivedSessionIds}
                onToggleArchive={handleToggleArchive}
                onDeleteSession={handleDeleteSession}
              />
            )}

            {/* Column 2: Center Chat Column (Row 2 Header + Chat Body) */}
            <div className={`flex flex-col flex-1 min-w-0 h-full overflow-hidden ${isRightSidebarMaximized && isRightSidebarOpen ? 'hidden' : ''}`}>
              {/* Row 2: Chat Navigation Toolbar (height h-9 = 36px, matches Sidebar & RightSidebar) */}
              <div className="h-9 bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-3 select-none shrink-0 z-40 transition-all">
                <div className="flex items-center h-full min-w-0 flex-1">
                  {/* When Left Sidebar is CLOSED: show Logo, PanelLeft, ArrowLeft, ArrowRight here */}
                  {!isSidebarOpen && (
                    <div className="flex items-center gap-1.5 shrink-0 mr-3">
                      <div className="w-5 h-5 rounded-md bg-zinc-800 text-zinc-100 flex items-center justify-center font-bold text-[11px] shadow-xs select-none mr-1">
                        M
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsSidebarOpen(true)}
                        className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                        title="Expand sidebar"
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
                  )}

                  {/* Breadcrumb: Aligned directly above the chat canvas */}
                  <div className="flex items-center min-w-0 flex-1 pl-1">
                    <Breadcrumb className="min-w-0">
                      <BreadcrumbList className="gap-1.5 sm:gap-2 flex-nowrap overflow-hidden">
                        <BreadcrumbItem className="shrink-0">
                          <span className="text-zinc-400 font-normal text-xs">
                            {selectedSessionRepo && selectedSessionRepo !== 'No Repo' ? selectedSessionRepo : 'Mash'}
                          </span>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="shrink-0 text-zinc-600" />
                        <BreadcrumbItem className="min-w-0">
                          {isHistoryActive ? (
                            <BreadcrumbPage className="font-medium text-xs text-zinc-200 truncate">
                              History
                            </BreadcrumbPage>
                          ) : !selectedSessionId ? (
                            <BreadcrumbPage className="font-medium text-xs text-zinc-200 flex items-center gap-1.5 truncate">
                              <Sparkles size={11} className="text-sky-400 shrink-0" />
                              <span className="truncate">New Conversation</span>
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbPage className="font-medium text-xs text-zinc-200 truncate max-w-[280px] sm:max-w-[450px]">
                              {selectedSessionTitle || `Session ${selectedSessionId.slice(0, 8)}`}
                            </BreadcrumbPage>
                          )}
                        </BreadcrumbItem>
                      </BreadcrumbList>
                    </Breadcrumb>
                  </div>
                </div>

                {/* Right Toggle Button: ONLY visible when right sidebar is closed! */}
                {!isRightSidebarOpen && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsRightSidebarOpen(true)}
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title="Expand right panel"
                    >
                      <PanelRight size={15} />
                    </button>
                  </div>
                )}
              </div>

              {/* Chat Canvas / Conversation History Body */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {isHistoryActive ? (
                  <ConversationHistory
                    sessions={allSessions}
                    onSelectSession={handleSelectSession}
                    onDeleteSession={handleDeleteSession}
                    archivedSessionIds={archivedSessionIds}
                    onToggleArchive={handleToggleArchive}
                  />
                ) : (
                  <ChatCanvas
                    sessionId={selectedSessionId}
                    sessionTitle={selectedSessionTitle}
                    sessionRepo={selectedSessionRepo}
                    pendingWorkspacePath={pendingWorkspacePath}
                    onSessionCreated={(id, title) => {
                      setSelectedSessionId(id);
                      if (title) setSelectedSessionTitle(title);
                      setPendingWorkspacePath(null);
                    }}
                    onToggleRightSidebar={() => setIsRightSidebarOpen(prev => !prev)}
                    isRightSidebarOpen={isRightSidebarOpen}
                    onOpenFile={handleOpenFile}
                    onOpenSettings={(tab?: string) => { setSettingsTab(tab || 'account'); setIsSettingsOpen(true); }}
                  />
                )}
              </div>
            </div>

            {/* Column 3: Right Sidebar (Row 1 Header in Row 2 + Row 2 Subheader + File View) */}
            {isRightSidebarOpen && (
              <RightSidebar
                onToggle={() => {
                  setIsRightSidebarOpen(false);
                  setIsRightSidebarMaximized(false);
                }} 
                fileToOpen={fileToOpen}
                onFileOpened={() => setFileToOpen(null)}
                sessionId={selectedSessionId || undefined}
                isMaximized={isRightSidebarMaximized}
                onToggleMaximize={() => setIsRightSidebarMaximized(prev => !prev)}
              />
            )}
          </main>
        </TooltipProvider>

        <SettingsModal
          isOpen={isSettingsOpen}
          initialTab={settingsTab}
          onClose={() => setIsSettingsOpen(false)}
          onThemeChange={setIsDark}
          onSignOut={() => setAuthUser(null)}
          currentProjectName={selectedSessionRepo && selectedSessionRepo !== 'No Repo' ? selectedSessionRepo : 'Mash'}
          onProjectDeleted={(projectName) => {
            if (selectedSessionRepo === projectName) {
              handleNewSession('No Repo');
            }
          }}
        />
      </ErrorBoundary>
    </div>
  );
}
