"use client";

import { useState, useEffect, useCallback } from 'react';
import Sidebar from '@/features/sessions/components/Sidebar';
import ChatCanvas from '@/features/chat/components/ChatCanvas';
import RightSidebar from '@/features/viewer/components/RightSidebar';
import ConversationHistory from '@/features/sessions/components/ConversationHistory';
import SettingsModal from '@/features/settings/components/SettingsModal';
import DesktopSignInView from '@/features/auth/components/DesktopSignInView';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { fetchSessions, deleteSession, SessionItem } from '@/services/sessions';
import { fetchAuthMe, AuthUser } from '@/services/auth';
import { TooltipProvider } from '@/components/ui/tooltip';
import { sessionStore } from '@/features/chat';
import { WindowTitleBar } from '@/components/layout/WindowTitleBar';
import { ChatToolbar } from '@/components/layout/ChatToolbar';

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionTitle, setSelectedSessionTitle] = useState<string>('New Conversation');
  const [selectedSessionRepo, setSelectedSessionRepo] = useState<string>('No Repo');
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [isRightSidebarMaximized, setIsRightSidebarMaximized] = useState(false);
  const [fileToOpen, setFileToOpen] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      const saved = localStorage.getItem('mash_theme_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.mode === 'light') return false;
        if (parsed.mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch {}
    return true;
  });
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
          setAuthUser(null);
        }
        setIsAuthLoading(false);
      }
    }).catch(() => {
      if (isMounted) {
        setAuthUser(null);
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

  // Support ?file=... and ?session=... query parameters on load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const sessionParam = params.get('session') || params.get('sessionId');
      if (sessionParam) {
        setSelectedSessionId(sessionParam);
      }
      const fileParam = params.get('file');
      if (fileParam) {
        setIsRightSidebarOpen(true);
        setFileToOpen(fileParam);
        if (params.get('maximized') === 'true') {
          setIsRightSidebarMaximized(true);
        }
      }
    }
  }, []);

  // ponytail: stable callbacks to prevent unneeded re-mounts/re-renders of ChatCanvas and Sidebar
  const handleSelectSession = useCallback((sessionId: string, title?: string, repoName?: string) => {
    setSelectedSessionId(sessionId);
    if (title) setSelectedSessionTitle(title);
    setSelectedSessionRepo(repoName || 'No Repo');
    setPendingWorkspacePath(null);
    setIsHistoryActive(false);
  }, []);

  const handleNewSession = useCallback((repoName: string = 'No Repo', folderPath?: string) => {
    setSelectedSessionId(null);
    setSelectedSessionTitle('New Conversation');
    setSelectedSessionRepo(repoName || 'No Repo');
    setPendingWorkspacePath(folderPath || null);
    setIsHistoryActive(false);
  }, []);

  const handleOpenHistory = useCallback(async () => {
    setIsHistoryActive(true);
    const list = await fetchSessions();
    setAllSessions(list);
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    const state = sessionStore.get(sessionId);
    if (state?.abortController) {
      try {
        state.abortController.abort();
      } catch (_) {}
    }
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
      <WindowTitleBar
        onToggleFullscreen={() => {
          if (typeof document !== 'undefined') {
            if (document.fullscreenElement) {
              document.exitFullscreen().catch(() => {});
            } else {
              document.documentElement.requestFullscreen().catch(() => {});
            }
          }
        }}
      />

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
                onOpenSettings={(tab?: string) => { setSettingsTab(tab || 'appearance'); setIsSettingsOpen(true); }}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
                archivedSessionIds={archivedSessionIds}
                onToggleArchive={handleToggleArchive}
                onDeleteSession={handleDeleteSession}
                authUser={authUser}
              />
            )}

            {/* Column 2: Center Chat Column (Row 2 Header + Chat Body) */}
            <div className={`flex flex-col flex-1 min-w-0 h-full overflow-hidden ${isRightSidebarMaximized && isRightSidebarOpen ? 'hidden' : ''}`}>
              {/* Row 2: Chat Navigation Toolbar (height h-9 = 36px, matches Sidebar & RightSidebar) */}
              <ChatToolbar
                isSidebarOpen={isSidebarOpen}
                onOpenSidebar={() => setIsSidebarOpen(true)}
                isRightSidebarOpen={isRightSidebarOpen}
                onOpenRightSidebar={() => setIsRightSidebarOpen(true)}
                isHistoryActive={isHistoryActive}
                sessionRepo={selectedSessionRepo}
                sessionTitle={selectedSessionTitle}
                selectedSessionId={selectedSessionId}
              />

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
                    onSessionCreated={(id, title, repo) => {
                      setSelectedSessionId(id);
                      if (title) setSelectedSessionTitle(title);
                      if (repo) setSelectedSessionRepo(repo);
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
