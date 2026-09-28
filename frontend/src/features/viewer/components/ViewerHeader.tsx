"use client";

// Row-1 header: mode buttons, open-tab pills, maximize/collapse.
// Container/view split: props mirror RightSidebar identifiers.
import React, { MouseEvent as ReactMouseEvent } from 'react';
import { Maximize2, Minimize2, PanelRight } from 'lucide-react';
import { FileTab, AuditWorkspacesLogo } from '@/primitives';
import type { TabItem } from '../types';

interface ViewerHeaderProps {
  viewMode: 'explorer' | 'editor';
  setViewMode: React.Dispatch<React.SetStateAction<'explorer' | 'editor'>>;
  openTabs: TabItem[];
  activeTabId: string | null;
  setActiveTabId: React.Dispatch<React.SetStateAction<string | null>>;
  openSections: { artifacts: boolean; backgroundTasks: boolean };
  setOpenSections: React.Dispatch<React.SetStateAction<{ artifacts: boolean; backgroundTasks: boolean }>>;
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
  return (
    <div className="h-9 bg-zinc-50/80 dark:bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-2 shrink-0 w-full overflow-hidden select-none">
      {/* Left: Audit Workspaces Button Only (Custom Executive Logo) */}
      <div className="flex items-center shrink-0 mr-1.5">
        <button
          type="button"
          onClick={() => {
            if (viewMode === 'explorer') {
              if (openTabs.length > 0) {
                setViewMode('editor');
              }
            } else {
              setViewMode('explorer');
              setOpenSections(prev => ({ ...prev, artifacts: true }));
            }
          }}
          className={`p-1.5 rounded-md transition-colors cursor-pointer bg-transparent hover:bg-transparent outline-none ${
            viewMode === 'explorer' 
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold' 
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
          }`}
          title="Audit Workspaces"
          aria-label="Audit Workspaces"
        >
          <AuditWorkspacesLogo size={14} />
        </button>
      </div>

      {/* Center: Open File Tabs (with sideways mousewheel scrolling) */}
      <div 
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        className="flex-1 flex items-center gap-1.5 overflow-x-auto overflow-y-hidden no-scrollbar h-full shrink min-w-0 py-1"
      >
        {openTabs.map(tab => (
          <FileTab
            key={tab.id}
            id={tab.id}
            title={tab.title}
            path={tab.path}
            type={tab.type}
            isActive={activeTabId === tab.id && viewMode === 'editor'}
            onSelect={() => { setActiveTabId(tab.id); setViewMode('editor'); }}
            onClose={(e) => handleCloseTab(e, tab.id)}
          />
        ))}
        {openTabs.length === 0 && (
          <span className="text-[11px] text-[var(--m-text-muted)] italic truncate select-none">No file open</span>
        )}
      </div>

      {/* Right: Maximize Button & Toggle Button Only */}
      <div className="flex items-center gap-1 shrink-0 ml-1.5">
        {/* Maximize Button */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className={`p-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors cursor-pointer outline-none ${
            isMaximized ? 'text-zinc-900 dark:text-zinc-100' : ''
          }`}
          title={isMaximized ? 'Restore sidebar width' : 'Maximize'}
          aria-label={isMaximized ? 'Restore sidebar width' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        {/* Right Sidebar Toggle Button */}
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors cursor-pointer outline-none"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelRight size={15} />
        </button>
      </div>
    </div>
  );
}
