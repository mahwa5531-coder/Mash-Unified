"use client";

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineEntry } from './types';

interface GroupTimelineRowProps {
  entry: TimelineEntry;
  isGroupExpanded: boolean;
  toggleGroup: (id: string) => void;
  renderChildRow: (child: TimelineEntry) => React.ReactNode;
}

export function GroupTimelineRow({
  entry,
  isGroupExpanded,
  toggleGroup,
  renderChildRow,
}: GroupTimelineRowProps) {
  const isRunning = Boolean(entry.data?.isRunning);
  const isCancelled = Boolean(entry.data?.isCancelled);
  const expanded = isGroupExpanded;

  let label = '';
  if (entry.type === 'command_group') {
    const verb = isCancelled ? 'Cancelled' : isRunning ? 'Running' : 'Ran';
    label = `${verb} ${entry.data?.count || entry.items?.length || 0} commands`;
  } else if (entry.type === 'edit_group') {
    const verb = isCancelled ? 'Cancelled' : isRunning ? 'Editing' : 'Edited';
    label = `${verb} ${entry.data?.count || entry.items?.length || 0} files`;
  } else {
    const rawLabel = entry.data?.label || `${entry.data?.count || entry.items?.length || 0} files`;
    if (/^(Ran|Searched|Explored|Exploring|Running|Cancelled)\b/i.test(rawLabel)) {
      label = rawLabel;
    } else {
      const isSearch = rawLabel.includes('search');
      let verb = '';
      if (isCancelled) {
        verb = 'Cancelled';
      } else if (isRunning) {
        verb = isSearch ? 'Running' : 'Exploring';
      } else {
        verb = isSearch ? 'Ran' : 'Explored';
      }
      label = `${verb} ${rawLabel}`;
    }
  }

  return (
    <div key={entry.id} className="my-0.5 select-none font-sans">
      <button
        type="button"
        onClick={() => toggleGroup(entry.id)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-normal py-0.5 cursor-pointer select-none transition-colors group text-left w-fit"
      >
        <span className={cn("font-sans text-[12px]", isRunning && "animate-silver-shine")}>
          {label}
        </span>
        <ChevronRight
          size={11}
          className={cn(
            "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-transform duration-200 shrink-0",
            expanded && "rotate-90"
          )}
        />
      </button>

      {/* Decomposed child rows: clean indentation without vertical border line */}
      {expanded && (
        <div className="mt-1 mb-1.5 pl-4 flex flex-col gap-1">
          {entry.items?.map((child) => renderChildRow(child))}
        </div>
      )}
    </div>
  );
}
