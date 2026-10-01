"use client";

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
  if (entry.type === 'command_group') {
    return (
      <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-muted-foreground font-sans">
              {entry.data?.isCancelled ? 'Cancelled' : entry.data?.isRunning ? 'Running' : 'Ran'}
            </span>
            <span className="font-medium text-foreground font-sans">
              {entry.data?.count} commands
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
              {entry.data?.count}
            </Badge>
            <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
          </div>
        </button>

        {isGroupExpanded && (
          <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
            {entry.items?.map((child) => renderChildRow(child))}
          </div>
        )}
      </div>
    );
  }

  // edit_group
  return (
    <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
      <button
        type="button"
        onClick={() => toggleGroup(entry.id)}
        className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="text-muted-foreground font-sans">
            {entry.data?.isCancelled ? 'Cancelled' : entry.data?.isRunning ? 'Editing' : 'Edited'}
          </span>
          <span className="font-medium text-foreground font-sans">
            {entry.data?.count} files
          </span>
          {(entry.data?.added > 0 || entry.data?.deleted > 0) && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0 ml-1">
              {entry.data?.added > 0 && (
                <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">+{entry.data.added}</span>
              )}
              {entry.data?.deleted > 0 && (
                <span className="px-1 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">-{entry.data.deleted}</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
            {entry.data?.count}
          </Badge>
          <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
        </div>
      </button>

      {isGroupExpanded && (
        <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
          {entry.items?.map((child) => renderChildRow(child))}
        </div>
      )}
    </div>
  );
}
