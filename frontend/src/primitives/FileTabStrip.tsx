"use client";

import React, { MouseEvent as ReactMouseEvent } from 'react';
import { Maximize2, Minimize2, PanelRight } from 'lucide-react';
import { FileTab } from './FileTab';
import { AuditWorkspacesLogo } from './FileLogos';
import { cn } from '@/lib/utils';

export interface FileTabStripItem {
  id: string;
  title: string;
  path?: string;
  type?: 'file' | 'terminal' | 'image';
  icon?: React.ReactNode;
}

export interface FileTabStripProps {
  /** Array of tabs to render */
  tabs: FileTabStripItem[];
  /** Currently active tab ID */
  activeTabId?: string | null;
  /** Whether the view is in explorer/overview mode */
  isExplorerMode?: boolean;
  /** Callback when Audit Workspaces (Explorer) icon is clicked */
  onToggleExplorer?: () => void;
  /** Callback when a tab is clicked */
  onSelectTab: (tabId: string) => void;
  /** Callback when a tab close button is clicked */
  onCloseTab?: (e: ReactMouseEvent, tabId: string) => void;
  /** Whether the container is maximized */
  isMaximized?: boolean;
  /** Callback to toggle maximize/restore */
  onToggleMaximize?: () => void;
  /** Callback to collapse the sidebar */
  onToggleCollapse?: () => void;
  /** Custom left action slot (defaults to AuditWorkspacesLogo button) */
  leftAction?: React.ReactNode;
  /** Custom right action slot (defaults to Maximize & Collapse buttons) */
  rightAction?: React.ReactNode;
  className?: string;
}

/**
 * FileTabStrip Primitive (RightSidebar Row 1)
 *
 * Exactly 3 sections:
 * - Left: Audit Workspaces Button Only (<AuditWorkspacesLogo />)
 * - Center: Open File Tabs (<FileTab /> with sideways mousewheel scroll)
 * - Right: Maximize (<Maximize2 />) and Collapse (<PanelRight />) buttons only.
 */
export function FileTabStrip({
  tabs,
  activeTabId,
  isExplorerMode = false,
  onToggleExplorer,
  onSelectTab,
  onCloseTab,
  isMaximized = false,
  onToggleMaximize,
  onToggleCollapse,
  leftAction,
  rightAction,
  className,
}: FileTabStripProps) {
  return (
    <div
      className={cn(
        "h-9 bg-zinc-50/80 dark:bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center justify-between px-2 shrink-0 w-full overflow-hidden select-none",
        className
      )}
    >
      {/* Left: Audit Workspaces Button Only (Custom Executive Logo) */}
      <div className="flex items-center shrink-0 mr-1.5">
        {leftAction !== undefined ? leftAction : (
          onToggleExplorer && (
            <button
              type="button"
              onClick={onToggleExplorer}
              className={cn(
                "p-1.5 rounded-md transition-colors cursor-pointer bg-transparent hover:bg-transparent outline-none",
                isExplorerMode
                  ? "text-zinc-900 dark:text-zinc-100 font-semibold"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
              )}
              title="Audit Workspaces"
              aria-label="Audit Workspaces"
            >
              <AuditWorkspacesLogo size={14} />
            </button>
          )
        )}
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
        {tabs.map((tab) => (
          <FileTab
            key={tab.id}
            id={tab.id}
            title={tab.title}
            path={tab.path}
            type={tab.type}
            icon={tab.icon}
            isActive={activeTabId === tab.id && !isExplorerMode}
            onSelect={() => onSelectTab(tab.id)}
            onClose={onCloseTab ? (e) => onCloseTab(e, tab.id) : undefined}
          />
        ))}
        {tabs.length === 0 && (
          <span className="text-[11px] text-[var(--m-text-muted)] italic truncate select-none">
            No file open
          </span>
        )}
      </div>

      {/* Right: Maximize Button & Toggle Button Only */}
      <div className="flex items-center gap-1 shrink-0 ml-1.5">
        {rightAction !== undefined ? rightAction : (
          <>
            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                className={cn(
                  "p-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors cursor-pointer outline-none",
                  isMaximized ? "text-zinc-900 dark:text-zinc-100" : ""
                )}
                title={isMaximized ? "Restore sidebar width" : "Maximize"}
                aria-label={isMaximized ? "Restore sidebar width" : "Maximize"}
              >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}

            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-1.5 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors cursor-pointer outline-none"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelRight size={15} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default FileTabStrip;
