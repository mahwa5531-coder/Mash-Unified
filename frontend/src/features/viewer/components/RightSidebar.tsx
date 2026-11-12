"use client";

import React, { useState, useEffect, useCallback, MouseEvent as ReactMouseEvent } from 'react';
import SafeFileViewer from '@/features/viewer/components/SafeFileViewer';
import { TerminalViewer } from '@/features/viewer/components/TerminalViewer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ViewerHeader } from './ViewerHeader';
import { ExplorerPanel } from './ExplorerPanel';
import { ViewerEmptyState } from './ViewerEmptyState';
import { FileBreadcrumbBar } from '@/primitives';
import { ViewerTabMenu } from './ViewerTabMenu';
import { fetchSessionArtifactsData, SessionArtifactsData } from '@/services/artifacts';
import { isFileTruncatedFromCache } from '@/services/files';
import { BASE_URL } from '@/services/client';
import { normalizePath } from '@/utils/normalizePath';
import { useRightSidebarResize } from '../hooks/useRightSidebarResize';
import { useViewerTabs } from '../hooks/useViewerTabs';
import { useTerminalLogStream } from '../hooks/useTerminalLogStream';

export interface RightSidebarProps {
  onToggle: () => void;
  fileToOpen?: string | null;
  onFileOpened?: () => void;
  sessionId?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export interface UseRightSidebarControllerProps extends RightSidebarProps {
  enabled?: boolean;
  shellRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Decouples RightSidebar state & views into Row-2 header (`headerNode`),
 * left-edge resizer (`resizeHandleNode`), and inset body (`bodyNode`) so
 * WorkbenchShell can frame Chat + Viewer inside a single unified rounded box.
 */
export function useRightSidebarController({
  enabled = true,
  shellRef,
  onToggle,
  fileToOpen,
  onFileOpened,
  sessionId,
  isMaximized: controlledIsMaximized,
  onToggleMaximize,
}: UseRightSidebarControllerProps) {
  // Accordion Sections State (Audit Deliverables & Working Papers only)
  const [openSections, setOpenSections] = useState({
    deliverables: true,
    workingPapers: true,
  });

  const toggleSection = (key: 'deliverables' | 'workingPapers') => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const [fileViewMode, setFileViewMode] = useState<'preview' | 'raw'>('preview');

  // Atomised Resizing (syncs `--right-sidebar-w` on shellRef)
  const {
    width,
    isResizing,
    isMaximized,
    startResizing,
    handleToggleMaximize,
  } = useRightSidebarResize({
    controlledIsMaximized,
    onToggleMaximize,
    shellRef,
  });

  // Atomised Tab Management
  const {
    viewMode,
    setViewMode,
    openTabs,
    activeTabId,
    setActiveTabId,
    tabContent,
    setTabContent,
    tabTruncated,
    isLoadingContent,
    openFileTab,
    openTerminalTab,
    handleCloseTab,
    retryTabContent,
    activeTab,
  } = useViewerTabs(sessionId);

  // Live Terminal Log Streamer for Background Process Tabs (idle when panel is closed)
  const { terminalStatuses, terminalPreRef, setTerminalScroller } = useTerminalLogStream({
    activeTab: enabled ? activeTab : undefined,
    viewMode,
    tabContent,
    setTabContent,
  });

  const handleKillTask = useCallback(async (e: ReactMouseEvent, pid: number) => {
    e.stopPropagation();
    try {
      await fetch(`${BASE_URL}/api/tasks/${pid}/kill`, { method: 'POST' });
    } catch {
      // ignore
    }
  }, []);

  // Data States
  const [artifactsData, setArtifactsData] = useState<SessionArtifactsData>({
    isProjectSession: false,
    deliverables: [],
    workingPapers: [],
    items: [],
  });

  // Load Session Artifacts (Deliverables & Working Papers)
  const loadArtifacts = useCallback(async () => {
    if (!enabled || !sessionId) return;
    try {
      const data = await fetchSessionArtifactsData(sessionId);
      setArtifactsData(data);
    } catch {
      setArtifactsData({
        isProjectSession: false,
        deliverables: [],
        workingPapers: [],
        items: [],
      });
    }
  }, [enabled, sessionId]);

  // Initial Load & Visibility Refresh
  useEffect(() => {
    if (!enabled) return;
    loadArtifacts();
  }, [enabled, loadArtifacts]);

  // Listen for instant turn completion to refresh deliverables without waiting for timer
  useEffect(() => {
    if (!enabled) return;
    const handleTurnDone = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (!customEvt.detail?.sessionId || customEvt.detail?.sessionId === sessionId) {
        loadArtifacts();
      }
    };
    window.addEventListener('mash:turn_completed', handleTurnDone);
    return () => window.removeEventListener('mash:turn_completed', handleTurnDone);
  }, [enabled, sessionId, loadArtifacts]);

  useEffect(() => {
    if (!enabled || viewMode !== 'explorer') return;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      loadArtifacts();
    }, 15000);

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden && viewMode === 'explorer') {
        loadArtifacts();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, viewMode, loadArtifacts]);

  // Listen to fileToOpen prop from chat/workspace and open automatically
  useEffect(() => {
    if (enabled && fileToOpen) {
      const pathWithoutAnchor = normalizePath(fileToOpen);
      const basename = pathWithoutAnchor.split(/[/\\]/).pop() || pathWithoutAnchor;
      openFileTab(basename, pathWithoutAnchor);
      onFileOpened?.();
    }
  }, [enabled, fileToOpen, openFileTab, onFileOpened]);

  // Global listener to open background task terminal output in RightSidebar
  useEffect(() => {
    if (!enabled) return;
    const handleOpenTerminal = (e: any) => {
      if (e.detail?.taskId) {
        const taskId = String(e.detail.taskId);
        const title = e.detail.title || `Task #${taskId}`;
        openTerminalTab(taskId, title);
      }
    };
    window.addEventListener('mash:open-terminal', handleOpenTerminal);
    return () => window.removeEventListener('mash:open-terminal', handleOpenTerminal);
  }, [enabled, openTerminalTab]);

  const headerNode = enabled ? (
    <ViewerHeader
      viewMode={viewMode}
      setViewMode={setViewMode}
      openTabs={openTabs}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      openSections={openSections}
      setOpenSections={setOpenSections}
      isMaximized={isMaximized}
      onToggle={onToggle}
      handleToggleMaximize={handleToggleMaximize}
      handleCloseTab={handleCloseTab}
    />
  ) : null;

  const resizeHandleNode = enabled && !isMaximized ? (
    <div
      className="absolute -left-1.5 top-0 w-3 h-full cursor-col-resize z-50 group flex items-center justify-center select-none"
      onMouseDown={startResizing}
      title="Drag to resize sidebar"
    >
      <div className="w-[2px] h-12 rounded-full bg-zinc-300 dark:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
    </div>
  ) : null;

  const bodyNode = !enabled ? null : viewMode === 'explorer' ? (
    <ExplorerPanel
      artifactsData={artifactsData}
      openSections={openSections}
      toggleSection={toggleSection}
      openFileTab={openFileTab}
    />
  ) : !activeTab ? (
    <ViewerEmptyState setViewMode={setViewMode} />
  ) : (
    <div className="flex-1 overflow-hidden flex flex-col bg-[var(--bg-app)] text-[var(--text-primary)]">
      <FileBreadcrumbBar
        path={activeTab.path || activeTab.title || ''}
        type={activeTab.type}
        actions={
          <ViewerTabMenu
            activeTab={activeTab}
            content={tabContent[activeTab.id]}
            onCloseTab={handleCloseTab}
            sessionId={sessionId}
          />
        }
      />

      {activeTab.type === 'terminal' ? (
        <div className="flex-1 overflow-hidden bg-[var(--bg-app)]">
          <ErrorBoundary scope="terminal-viewer">
            <TerminalViewer
              activeTab={activeTab}
              terminalStatuses={terminalStatuses}
              tabContent={tabContent}
              handleKillTask={handleKillTask}
              terminalPreRef={terminalPreRef}
              onScrollerRef={setTerminalScroller}
            />
          </ErrorBoundary>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden bg-[var(--bg-app)]">
          <ErrorBoundary scope="safe-file-viewer">
            <SafeFileViewer
              filename={activeTab?.title || ''}
              path={activeTab?.path}
              sessionId={sessionId}
              content={activeTab ? tabContent[activeTab.id] || '' : ''}
              isTruncated={Boolean(activeTab && (tabTruncated?.[activeTab.id] || (activeTab.path && isFileTruncatedFromCache(activeTab.path, sessionId))))}
              isLoading={isLoadingContent}
              viewMode={fileViewMode}
              onViewModeChange={setFileViewMode}
              hideToolbar={true}
              onRetry={() => retryTabContent(activeTab?.id)}
              onOpenFile={(p) => {
                const [pathWithoutAnchor] = p.split('#');
                const norm = normalizePath(pathWithoutAnchor);
                const base = norm.split(/[/\\]/).pop() || norm;
                openFileTab(base, norm);
              }}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );

  return {
    width,
    isResizing,
    isMaximized,
    headerNode,
    resizeHandleNode,
    bodyNode,
  };
}
