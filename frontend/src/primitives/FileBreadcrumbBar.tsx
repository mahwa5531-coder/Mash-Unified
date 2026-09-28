"use client";

import React from 'react';
import { MoreVertical, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileIcon } from './FileIcon';

export interface FileBreadcrumbBarProps {
  /** Complete path or filename (e.g. "workpapers/FY26/Trade_Payables.xlsx") */
  path?: string;
  /** Explicit segments override */
  segments?: string[];
  /** File type (file, terminal, image) */
  type?: 'file' | 'terminal' | 'image';
  /** Optional callback when a directory segment is clicked */
  onSegmentClick?: (segment: string, index: number) => void;
  /** Optional custom menu action element or 3-dots callback */
  onMenuClick?: () => void;
  /** Custom action slot (e.g. DropdownMenu trigger or custom 3-dots menu) */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * FileBreadcrumbBar Primitive (RightSidebar Second Row)
 * 
 * Features:
 * - Directory path segments rendered as clean ghost text (muting in idle state)
 * - Individual words transition to crisp white on cursor hover (no shadow/shining, no background box)
 * - Terminal leaf item renders the actual file with its file logo + filename
 * - Far right contains only the vertical 3-dots menu button with pure hover text whitening
 */
export function FileBreadcrumbBar({
  path = '',
  segments: customSegments,
  type = 'file',
  onSegmentClick,
  onMenuClick,
  actions,
  className,
}: FileBreadcrumbBarProps) {
  // Parse complete breadcrumb segments from path
  const segments = customSegments ?? React.useMemo(() => {
    if (!path) return ['Overview'];
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^[a-zA-Z]:\/?/, '');
    const parts = clean.split('/').filter(Boolean);
    return parts.length > 0 ? parts : [path];
  }, [path]);

  const directorySegments = segments.slice(0, -1);
  const lastSegment = segments[segments.length - 1] || 'Overview';

  return (
    <div
      className={cn(
        "h-8 px-3 flex items-center justify-between border-b border-[var(--m-border-subtle)] bg-transparent select-none shrink-0 text-xs gap-2 font-mono",
        className
      )}
    >
      {/* Complete Breadcrumbs */}
      <div 
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
        className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap text-[11.5px] py-1"
      >
        {/* Leading Directory Segments (Words that individually turn white on hover) */}
        {directorySegments.map((segment, idx) => (
          <React.Fragment key={idx}>
            <span
              onClick={onSegmentClick ? () => onSegmentClick(segment, idx) : undefined}
              className={cn(
                "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors duration-100 shrink-0 bg-transparent hover:bg-transparent",
                onSegmentClick ? "cursor-pointer hover:underline" : "cursor-default"
              )}
              title={segment}
            >
              {segment}
            </span>
            <span className="text-zinc-400/50 dark:text-zinc-600 select-none font-normal shrink-0">
              /
            </span>
          </React.Fragment>
        ))}

        {/* Final Active File Segment (Renders file logo + filename) */}
        <span
          className="inline-flex items-center gap-1.5 shrink-0 text-zinc-700 dark:text-zinc-300 hover:text-zinc-950 dark:hover:text-white transition-colors duration-100 font-medium cursor-default bg-transparent hover:bg-transparent"
          title={lastSegment}
        >
          {type === 'terminal' ? (
            <Terminal size={12} className="shrink-0 text-amber-500 dark:text-amber-400" />
          ) : (
            <FileIcon filename={lastSegment} size={12} className="shrink-0" />
          )}
          <span>{lastSegment}</span>
        </span>
      </div>

      {/* Far Right: Vertical 3-dots Button (Ghost text whitening on hover, no background box) */}
      <div className="shrink-0 flex items-center">
        {actions ?? (
          <button
            type="button"
            onClick={onMenuClick}
            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white bg-transparent hover:bg-transparent transition-colors duration-100 cursor-pointer outline-none"
            title="More options"
            aria-label="More options"
          >
            <MoreVertical size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

export default FileBreadcrumbBar;
