"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { SidebarBrandToggle } from '@/features/sessions/components/SidebarHeader';

export interface WorkbenchShellProps {
  /** Top OS / Frameless window title bar (Row 1). */
  titleBar?: React.ReactNode;
  /** Left navigation sidebar (omitted automatically when collapsed). */
  sidebar?: React.ReactNode;
  isSidebarOpen: boolean;
  /** Callback to open/expand the left sidebar when collapsed. */
  onOpenSidebar?: () => void;
  /** Row-2 chat breadcrumb & control strip rendered above the left side of the inset box. */
  chatToolbar: React.ReactNode;
  /** Row-2 right-panel tab strip rendered above the right side of the inset box when open. */
  rightHeader?: React.ReactNode;
  /** Left interior body inside the inset box (ChatCanvas / History). */
  mainContent: React.ReactNode;
  /** Right interior body inside the inset box (FileBreadcrumbBar + Viewer / Explorer). */
  rightContent?: React.ReactNode;
  isRightOpen: boolean;
  isRightMaximized?: boolean;
  /** Initial / persisted right pane width in px; synced dynamically via `--right-sidebar-w`. */
  rightWidth?: number;
  isRightResizing?: boolean;
  /** Left-edge col-resize drag handle rendered inside the right pane when unmaximized. */
  rightResizeHandle?: React.ReactNode;
  /** Shared container ref mutated during rAF drag resize (`--right-sidebar-w`). */
  shellRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

/**
 * WorkbenchShell
 *
 * Unified two-tone desktop workbench chrome:
 * - Outer chrome (`--bg-sidebar`): borderless TitleBar, Left Sidebar (with blended Settings footer),
 *   Row-2 toolbar + file tabs, and a compact outer bezel (`6px` bottom/right; left when sidebar hidden).
 * - Inner canvas (`--bg-app`): ONE rounded bordered inset container holding Chat + Right Viewer,
 *   divided internally by `border-l` strictly bounded inside the box.
 * - Row 2 shows a short disconnected `h-4` vertical tick above the split only while unmaximized & open.
 * - When Right Panel is maximized, it fills the entire inset workbench canvas up to the Left Sidebar's
 *   boundary. If Left Sidebar is toggled closed, Right Panel smoothly expands across the full screen.
 */
export function WorkbenchShell({
  titleBar,
  sidebar,
  isSidebarOpen,
  onOpenSidebar,
  chatToolbar,
  rightHeader,
  mainContent,
  rightContent,
  isRightOpen,
  isRightMaximized = false,
  rightWidth = 360,
  isRightResizing = false,
  rightResizeHandle,
  shellRef,
  className,
}: WorkbenchShellProps) {
  const showLeftSidebar = isSidebarOpen;

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-full bg-[var(--bg-sidebar)] overflow-hidden text-[var(--text-primary)] font-sans transition-colors",
        className
      )}
    >
      {titleBar}

      <main className="flex flex-1 min-h-0 overflow-hidden bg-[var(--bg-sidebar)]">
        {showLeftSidebar && sidebar}

        <div
          ref={shellRef}
          className="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
          style={{ '--right-sidebar-w': `${rightWidth}px` } as React.CSSProperties}
        >
          {/* Row 2: Merged borderless top toolbar + disconnected short right-panel divider + file tab strip */}
          <div
            className={cn(
              "h-9 shrink-0 flex items-center bg-[var(--bg-sidebar)] select-none pr-[7px]",
              isRightOpen && isRightMaximized && !showLeftSidebar && "pl-[7px]"
            )}
          >
            {/* When Left Sidebar is closed AND Right Panel is Maximized: render un-collapse toggle so user is never trapped */}
            {!showLeftSidebar && isRightOpen && isRightMaximized && onOpenSidebar && (
              <div className="pl-1.5 pr-1 shrink-0">
                <SidebarBrandToggle onToggle={onOpenSidebar} title="Expand sidebar" />
              </div>
            )}

            <div className={cn("flex-1 min-w-0 h-full", isRightOpen && isRightMaximized && "hidden")}>
              {chatToolbar}
            </div>

            {isRightOpen && !isRightMaximized && (
              <div
                aria-hidden="true"
                data-testid="workbench-row2-divider"
                className="w-px h-4 bg-zinc-300/90 dark:bg-white/[0.12] shrink-0 self-center"
              />
            )}

            {isRightOpen && (
              <div
                data-testid="workbench-right-header"
                className={cn(
                  "h-full overflow-hidden",
                  isRightMaximized
                    ? "flex-1 min-w-0"
                    : cn(
                        // Matches inset box right padding + 1px box border so `w-px h-4` aligns above `border-l`
                        "shrink-0 w-[calc(var(--right-sidebar-w)-1px)]",
                        !isRightResizing && "transition-[width] duration-75"
                      )
                )}
              >
                {rightHeader}
              </div>
            )}
          </div>

          {/* Row 3+: Tight outer chrome bezel around the unified rounded inset workbench box */}
          <div
            className={cn(
              "flex-1 min-h-0 flex pb-1.5 pr-1.5",
              !showLeftSidebar && "pl-1.5"
            )}
          >
            <div
              data-testid="workbench-inset-box"
              className="flex-1 min-w-0 min-h-0 flex rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-[var(--bg-app)] overflow-hidden shadow-2xs"
            >
              <div
                className={cn(
                  "flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden",
                  isRightOpen && isRightMaximized && "hidden"
                )}
              >
                {mainContent}
              </div>

              {isRightOpen && (
                <div
                  data-testid="workbench-right-body"
                  className={cn(
                    "h-full bg-[var(--bg-app)] text-[var(--text-primary)] flex flex-col shrink-0 antialiased relative z-30 select-none",
                    isRightMaximized
                      ? "flex-1 w-full min-w-0 border-l-0"
                      : cn(
                          "border-l border-zinc-200/80 dark:border-white/[0.08] w-[var(--right-sidebar-w)]",
                          !isRightResizing && "transition-[width] duration-75"
                        )
                  )}
                >
                  {!isRightMaximized && rightResizeHandle}
                  {rightContent}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default WorkbenchShell;
