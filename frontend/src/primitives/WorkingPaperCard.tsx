"use client";

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizePath } from '@/utils/normalizePath';

export interface WorkingPaperCardProps {
  /** Relative or absolute path of the generated deliverable / .md file */
  filePath: string;
  /** Human-readable working paper title (e.g. "Revenue Recognition Testing Memo") */
  title: string;
  /** Optional secondary subtitle or summary */
  summary?: string;
  /** Deliverable category or audit working paper type */
  type?: 'memo' | 'walkthrough' | 'schedule' | 'plan' | 'doc' | string;
  /** Current review / sign-off status */
  status?: 'ready_for_review' | 'signed_off' | 'in_progress';
  /** Action when clicked to open in right-side File Viewer */
  onOpen?: (filePath: string) => void;
  /** Optional action slot (e.g. Proceed button or badge) */
  action?: React.ReactNode;
  className?: string;
}

/**
 * WorkingPaperCard Primitive
 * 
 * Sleek, executive deliverable card matching the exact specification from audit/CA workflows.
 * Renders `.md` working papers and deliverables at the end of a turn, immediately before the files generated list.
 * Format: `<> {Title}` in a rounded-2xl dark pill container.
 */
export function WorkingPaperCard({
  filePath,
  title,
  summary,
  type,
  status = 'ready_for_review',
  onOpen,
  action,
  className,
}: WorkingPaperCardProps) {
  const cleanPath = normalizePath(filePath, false);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(cleanPath)}
      title={`Open ${title}`}
      className={cn(
        "w-full text-left h-[42px] px-4 my-1.5 rounded-2xl flex items-center justify-between gap-3 cursor-pointer select-none transition-all duration-150 outline-none group",
        "bg-zinc-50 hover:bg-zinc-100/90 dark:bg-[#121214] dark:hover:bg-[#18181b]",
        "border border-zinc-200 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.16]",
        "focus-visible:ring-1 focus-visible:ring-zinc-400 dark:focus-visible:ring-white/20",
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {/* The distinctive <> indicator */}
        <span className="font-mono text-xs font-semibold text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors select-none shrink-0 tracking-tight">
          &lt;&gt;
        </span>

        {/* Clean Title */}
        <span className="text-[13.5px] font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white transition-colors truncate">
          {title}
        </span>

        {summary && (
          <span className="hidden sm:inline text-xs text-zinc-400 dark:text-zinc-500 font-normal truncate ml-1">
            — {summary}
          </span>
        )}
      </div>

      {action ? (
        <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {action}
        </div>
      ) : status === 'signed_off' ? (
        <span className="shrink-0 flex items-center gap-1 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
          <Check size={11} className="shrink-0" />
          <span>Signed Off</span>
        </span>
      ) : null}
    </button>
  );
}

export default WorkingPaperCard;
