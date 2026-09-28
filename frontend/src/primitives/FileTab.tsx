"use client";

import React from 'react';
import { X, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcon';

export interface FileTabProps {
  /** Unique tab ID */
  id?: string;
  /** Display title or filename */
  title: string;
  /** Full file path for tooltip and extension detection */
  path?: string;
  /** Tab type */
  type?: 'file' | 'terminal' | 'image';
  /** Whether the tab is currently active */
  isActive?: boolean;
  /** Callback when tab is selected */
  onSelect?: () => void;
  /** Callback when tab close button is clicked */
  onClose?: (e: React.MouseEvent) => void;
  /** Optional custom icon override */
  icon?: React.ReactNode;
  /** Optional container class overrides */
  className?: string;
}

/**
 * FileTab Primitive
 * 
 * Interactive file tab for the RightSidebar / Editor with zero-layout-shift
 * logo ⇄ [X] close button swap in the exact same left slot on cursor hover.
 * Zero right-side clutter, no text jumping.
 */
export function FileTab({
  title,
  path,
  type = 'file',
  isActive = false,
  onSelect,
  onClose,
  icon,
  className,
}: FileTabProps) {
  const rawName = title || path || '';
  const fileName = type === 'terminal'
    ? (title || 'Terminal')
    : (rawName.split(/[/\\]/).pop() || rawName);

  return (
    <div
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      title={path || fileName}
      className={cn(
        "group/tab relative flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-[var(--m-radius-sm)] text-[12px] font-medium select-none cursor-pointer transition-colors max-w-[200px] shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-[var(--m-focus-ring)]",
        isActive
          ? "bg-[var(--m-bg-surface)] text-[var(--m-text-primary)] border border-[var(--m-border)] shadow-xs"
          : "bg-transparent hover:bg-[var(--m-bg-surface-hover)] text-[var(--m-text-secondary)] hover:text-[var(--m-text-primary)] border border-transparent",
        className
      )}
    >
      {/* Same Space Slot for Logo & Close Button:
          Default: Shows File Logo
          Hover: Seamlessly swaps to [X] close button in the exact same spot */}
      <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5">
        {/* Logo: visible by default, hidden on hover if tab can be closed */}
        <span
          className={cn(
            "flex items-center justify-center shrink-0 transition-opacity duration-100",
            onClose ? "group-hover/tab:opacity-0 group-hover/tab:pointer-events-none" : ""
          )}
        >
          {icon ?? (
            type === 'terminal' ? (
              <Terminal size={13} className="shrink-0 text-amber-500 dark:text-amber-400" />
            ) : (
              <FileIcon filename={fileName} size={13} className="shrink-0" />
            )
          )}
        </span>

        {/* Close Button: exactly overlaps the logo in the same space, visible on cursor hover */}
        {onClose && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose(e);
            }}
            className="absolute inset-0 m-auto w-3.5 h-3.5 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover/tab:opacity-100 transition-all cursor-pointer outline-none shrink-0"
            title={`Close ${fileName}`}
            aria-label={`Close ${fileName}`}
          >
            <X size={11} strokeWidth={2.2} />
          </button>
        )}
      </span>

      {/* Filename: right beside the logo slot, zero right-side button clutter */}
      <span className="truncate font-medium flex-1 text-left">
        {fileName}
      </span>
    </div>
  );
}

export default FileTab;
