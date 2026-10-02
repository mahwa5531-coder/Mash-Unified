"use client";

// Row-1 header: delegates cleanly to canonical FileTabStrip primitive
import React, { MouseEvent as ReactMouseEvent } from 'react';
import { FileTabStrip } from '@/primitives';
import type { TabItem } from '../types';

export interface ViewerHeaderProps {
  viewMode: 'explorer' | 'editor';
  setViewMode: React.Dispatch<React.SetStateAction<'explorer' | 'editor'>>;
  openTabs: TabItem[];
  activeTabId: string | null;
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
  openSections: { deliverables?: boolean; workingPapers?: boolean; artifacts?: boolean; backgroundTasks?: boolean };
  setOpenSections: React.Dispatch<React.SetStateAction<any>>;
  isMaximized: boolean;
  onToggle: () => void;
  handleToggleMaximize: () => void;
  handleCloseTab: (e: ReactMouseEvent, tabId: string) => void;
}

export function ViewerHeader({
  viewMode,
  setViewMode,
  openTabs,
  activeTabId,
  setActiveTabId,
  openSections,
  setOpenSections,
  isMaximized,
  onToggle,
  handleToggleMaximize,
  handleCloseTab,
}: ViewerHeaderProps) {
  const handleToggleExplorer = () => {
    if (viewMode === 'explorer') {
      setViewMode('editor');
    } else {
      setViewMode('explorer');
      setOpenSections((prev: any) => ({ ...prev, deliverables: true, workingPapers: true, artifacts: true }));
    }
  };

  const handleSelectTab = (tabId: string) => {
    setActiveTabId(tabId);
    setViewMode('editor');
  };

  return (
    <FileTabStrip
      tabs={openTabs}
      activeTabId={activeTabId}
      isExplorerMode={viewMode === 'explorer'}
      onToggleExplorer={handleToggleExplorer}
      onSelectTab={handleSelectTab}
      onCloseTab={handleCloseTab}
      isMaximized={isMaximized}
      onToggleMaximize={handleToggleMaximize}
      onToggleCollapse={onToggle}
    />
  );
}

export default ViewerHeader;
