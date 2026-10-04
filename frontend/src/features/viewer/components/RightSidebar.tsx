"use client";

import React, { useState, useEffect, useCallback } from 'react';
import SafeFileViewer from '@/features/viewer/components/SafeFileViewer';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewerHeader } from './ViewerHeader';
import { ExplorerPanel } from './ExplorerPanel';
import { ViewerEmptyState } from './ViewerEmptyState';
import { FileBreadcrumbBar } from '@/primitives';
import { ViewerTabMenu } from './ViewerTabMenu';
import { fetchSessionArtifactsData, SessionArtifactsData } from '@/services/artifacts';
import { normalizePath } from '@/utils/normalizePath';
import { useRightSidebarResize } from '../hooks/useRightSidebarResize';
import { useViewerTabs } from '../hooks/useViewerTabs';

export interface RightSidebarProps {
  onToggle: () => void;
  fileToOpen?: string | null;
  onFileOpened?: () => void;
  sessionId?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}

export default function RightSidebar({ 
  onToggle, 
  fileToOpen, 
  onFileOpened, 
  sessionId,
  isMaximized: controlledIsMaximized,
  onToggleMaximize
}: RightSidebarProps) {
  // Accordion Sections State (Audit Deliverables & Working Papers only)
  const [openSections, setOpenSections] = useState({
    deliverables: true,
    workingPapers: true,
  });

  const toggleSection = (key: 'deliverables' | 'workingPapers') => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const [fileViewMode, setFileViewMode] = useState<'preview' | 'raw'>('preview');

  // Atomised Resizing
  const {
    width,
    isResizing,
    isMaximized,
    sidebarRef,
    startResizing,
    handleToggleMaximize,
  } = useRightSidebarResize({
    controlledIsMaximized,
    onToggleMaximize,
  });

  // Atomised Tab Management
  const {
    viewMode,
    setViewMode,
    openTabs,
    activeTabId,
    setActiveTabId,
    tabContent,
    isLoadingContent,
    openFileTab,
    handleCloseTab,
    activeTab,
  } = useViewerTabs(sessionId);

  // Data States
  const [artifactsData, setArtifactsData] = useState<SessionArtifactsData>({
    isProjectSession: false,
    deliverables: [],
    workingPapers: [],
    items: [],
  });

  // Load Session Artifacts (Deliverables & Working Papers)
  const loadArtifacts = useCallback(async () => {
    if (!sessionId) return;
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
  }, [sessionId]);

  // Initial Load & Visibility Refresh
  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  // Listen for instant turn completion to refresh deliverables without waiting for timer
  useEffect(() => {
    const handleTurnDone = (e: Event) => {
      const customEvt = e as CustomEvent;
      if (!customEvt.detail?.sessionId || customEvt.detail?.sessionId === sessionId) {
        loadArtifacts();
      }
    };
    window.addEventListener('mash:turn_completed', handleTurnDone);
    return () => window.removeEventListener('mash:turn_completed', handleTurnDone);
  }, [sessionId, loadArtifacts]);

  useEffect(() => {
    if (viewMode !== 'explorer') return;

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
  }, [viewMode, loadArtifacts]);

  // Listen to fileToOpen prop from chat/workspace and open automatically
  useEffect(() => {
    if (fileToOpen) {
      const pathWithoutAnchor = normalizePath(fileToOpen);
      const basename = pathWithoutAnchor.split(/[/\\]/).pop() || pathWithoutAnchor;
      openFileTab(basename, pathWithoutAnchor);
      onFileOpened?.();
    }
  }, [fileToOpen, openFileTab, onFileOpened]);

  return (
    <TooltipProvider delayDuration={150}>
      <div 
        ref={sidebarRef}
        className={`h-full bg-[var(--bg-app)] text-[var(--text-primary)] border-l border-zinc-200/70 dark:border-white/[0.06] flex flex-col font-sans shrink-0 antialiased relative z-30 select-none ${
          isMaximized ? 'flex-1 w-full min-w-0' : (isResizing ? '' : 'transition-all duration-75')
        }`}
        style={isMaximized ? undefined : { width: `${width}px` }}
      >
        {/* Draggable Resizer Handle */}
        {!isMaximized && (
          <div 
            className="absolute -left-1.5 top-0 w-3 h-full cursor-col-resize z-50 group flex items-center justify-center select-none"
            onMouseDown={startResizing}
            title="Drag to resize sidebar"
          >
            <div className="w-[2px] h-12 rounded-full bg-zinc-300 dark:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
          </div>
        )}

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

        {/* Main Content Body */}
        {viewMode === 'explorer' ? (
          <ExplorerPanel
            artifactsData={artifactsData}
            openSections={openSections}
            toggleSection={toggleSection}
            openFileTab={openFileTab}
          />
        ) : !activeTab ? (
          <ViewerEmptyState setViewMode={setViewMode} />
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col bg-[var(--bg-app)] dark:bg-black text-[var(--text-primary)]">
            {/* Canonical FileBreadcrumbBar Primitive */}
            <FileBreadcrumbBar
              path={activeTab.path || activeTab.title || ''}
              type={activeTab.type}
              actions={
                <ViewerTabMenu
                  activeTab={activeTab}
                  content={tabContent[activeTab.id]}
                  onCloseTab={handleCloseTab}
                />
              }
            />

            {/* Safe File Viewer Body */}
            <div className="flex-1 overflow-hidden bg-[var(--bg-app)] dark:bg-black">
              <ErrorBoundary scope="safe-file-viewer">
                <SafeFileViewer
                  filename={activeTab?.title || ''}
                  path={activeTab?.path}
                  sessionId={sessionId}
                  content={activeTab ? tabContent[activeTab.id] || '' : ''}
                  isLoading={isLoadingContent}
                  viewMode={fileViewMode}
                  onViewModeChange={setFileViewMode}
                  hideToolbar={true}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
