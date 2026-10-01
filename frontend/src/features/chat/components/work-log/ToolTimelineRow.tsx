"use client";

import React from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FilePill } from '@/primitives';
import { renderOutputWithLinks } from './fileLinkRenderer';
import { isToolRunning } from './toolTimeline';
import type { TimelineEntry } from './types';

interface ToolTimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  isExpanded?: boolean;
  onOpenFile?: (path: string) => void;
  toggleGroup: (id: string) => void;
}

export function ToolTimelineRow({
  entry,
  isChild = false,
  isStreaming,
  isExpanded = false,
  onOpenFile,
  toggleGroup,
}: ToolTimelineRowProps) {
  // File Read Row
  if (entry.type === 'file_read') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
            {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
            {isCancelled ? 'Canceled' : isRunning ? 'Analyzing' : 'Analyzed'}
          </span>
          <FilePill
            path={entry.data.filePath}
            label={entry.data.filename}
            line={entry.data.lineRange}
            onOpenFile={onOpenFile}
          />
        </div>
      </div>
    );
  }

  // Edited File Row
  if (entry.type === 'edit') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
            {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
            {isCancelled ? 'Canceled' : isRunning ? 'Editing' : 'Edited'}
          </span>
          <FilePill
            path={entry.data.filePath}
            label={entry.data.filename}
            onOpenFile={onOpenFile}
          />
          <span className="inline-flex items-center gap-1 text-[11.5px] font-mono shrink-0 ml-1.5 font-medium select-none">
            {entry.data.added > 0 && (
              <span className="text-emerald-500 dark:text-emerald-400">+{entry.data.added}</span>
            )}
            {entry.data.deleted > 0 && (
              <span className="text-rose-500 dark:text-rose-400">-{entry.data.deleted}</span>
            )}
            {entry.data.added === 0 && entry.data.deleted === 0 && (
              <span className="text-zinc-500 dark:text-zinc-400">+0 -0</span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Folder View Row
  if (entry.type === 'folder_view') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
            {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
            {isCancelled ? 'Canceled' : isRunning ? 'Analyzing' : 'Analyzed'}
          </span>
          <span className="font-medium text-foreground truncate max-w-sm">
            {entry.data.foldername}
          </span>
        </div>
      </div>
    );
  }

  // Search Row
  if (entry.type === 'search') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
            {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
            {isCancelled ? 'Canceled' : isRunning ? 'Searching' : 'Searched'}
          </span>
          <span className="font-mono text-foreground font-medium truncate max-w-sm">
            {entry.data.pattern}
          </span>
          {entry.data.countStr && (
            <span className="text-muted-foreground text-[10.5px] font-mono px-1 py-0.2 rounded bg-muted border border-border/40 shrink-0">
              {entry.data.countStr}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Timer Row
  if (entry.type === 'timer') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    const durLabel = entry.data.durationSeconds ? `${entry.data.durationSeconds} seconds` : 'timer';
    return (
      <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          className="flex items-center justify-between min-w-0 w-full text-left cursor-pointer group"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Canceled' : isRunning ? 'Timing' : 'Timed'}
            </span>
            <span className="font-medium text-foreground truncate">{durLabel}</span>
            <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform ml-0.5", isExpanded && "rotate-90")} />
          </div>
        </button>
        {isExpanded && entry.data.prompt && (
          <div className="mt-1 pl-4 text-[11.5px] text-muted-foreground font-sans">
            {entry.data.prompt}
          </div>
        )}
      </div>
    );
  }

  // Task Action Row
  if (entry.type === 'task') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const hasOutput = !!(entry.data.tool?.output && entry.data.tool.output.trim().length > 0);
    const isTimerNotification = entry.data.taskName.includes('Timer has expired') || entry.data.taskName.includes('Timer:');

    return (
      <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <button
          type="button"
          onClick={() => hasOutput && toggleGroup(entry.id)}
          className={cn("flex items-center justify-between min-w-0 w-full text-left group", hasOutput && "cursor-pointer")}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 font-medium text-foreground truncate max-w-md">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {entry.data.isStatusCheck
                ? `Checked task ${entry.data.taskName}`
                : `${entry.data.taskName}${!isRunning && !isTimerNotification && !entry.data.taskName.endsWith('finished') ? ' finished' : ''}`}
            </span>
            {hasOutput && (
              <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform ml-0.5 shrink-0", isExpanded && "rotate-90")} />
            )}
          </div>
        </button>
        {isExpanded && hasOutput && (
          <div className="mt-1 rounded-md bg-muted/40 border border-border/40 p-2 font-mono text-[11px] text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
            {renderOutputWithLinks(entry.data.tool.output, onOpenFile)}
          </div>
        )}
      </div>
    );
  }

  // Subagent Invocation Row
  if (entry.type === 'subagent') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs py-0.5 select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "")}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-muted-foreground font-sans shrink-0">{isRunning ? 'Running subagent' : 'Subagent task'}</span>
          <Badge variant="outline" className="text-foreground border-border/60 text-[11px] truncate max-w-sm">
            {entry.data.roleLabel}
          </Badge>
        </div>
      </div>
    );
  }

  // Other Action Row
  if (entry.type === 'other') {
    const t = entry.data.tool;
    const displayName = t?.name && t?.name !== 'action' ? t.name : 'Action';
    const isRunning = isToolRunning(t, isStreaming);
    return (
      <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="shrink-0 text-muted-foreground font-sans">{isRunning ? 'Executing' : 'Executed'}</span>
          <span className="font-mono text-foreground truncate max-w-sm">{displayName}</span>
        </div>
      </div>
    );
  }

  return null;
}
