"use client";

import React from 'react';
import { Loader2, AlertCircle, Globe, ExternalLink, Search, CheckCircle2, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FilePill } from '@/primitives/FilePill';
import { isToolRunning } from './toolTimeline';
import type { TimelineEntry } from './types';

interface ToolTimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  isExpanded?: boolean;
  onOpenFile?: (path: string) => void;
  toggleGroup?: (id: string) => void;
}

export function ToolTimelineRow({
  entry,
  isChild = false,
  isStreaming,
  onOpenFile,
}: ToolTimelineRowProps) {
  // 1. File Read & Folder View -> Analysed <FilePill>
  if (entry.type === 'file_read' || entry.type === 'folder_view') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const filePath = entry.data?.filePath || entry.data?.filename || entry.data?.folderPath || entry.data?.foldername || 'file';

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <span className={cn("font-sans text-[12px] shrink-0", isFailed ? "text-rose-500 font-medium" : "text-zinc-500 dark:text-zinc-400")}>
          {isFailed ? 'Failed' : isCancelled ? 'Cancelled' : isRunning ? 'Analysing' : 'Analysed'}
        </span>
        <FilePill path={filePath} onOpenFile={onOpenFile} />
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 2. Edited File -> Edited <FilePill> (no decomposition, no "created", opens right sidebar)
  if (entry.type === 'edit') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const filePath = entry.data?.filePath || entry.data?.filename || 'file';

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <span className={cn("font-sans text-[12px] shrink-0", isFailed ? "text-rose-500 font-medium" : "text-zinc-500 dark:text-zinc-400")}>
          {isFailed ? 'Failed' : isCancelled ? 'Cancelled' : isRunning ? 'Editing' : 'Edited'}
        </span>
        <FilePill path={filePath} onOpenFile={onOpenFile} />
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 3. Web Search -> Globe icon + toolSummary or "Searched web" "query"
  if (entry.type === 'web_search') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const query = entry.data?.query || 'query';
    const toolSummary = entry.data?.toolSummary;

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <Globe size={11} className="text-sky-500/80 shrink-0" />
        <span className={cn("font-sans text-[12px] shrink-0", isFailed ? "text-rose-500 font-medium" : "text-zinc-500 dark:text-zinc-400")}>
          {toolSummary ? toolSummary : (isFailed ? 'Failed' : isCancelled ? 'Cancelled' : isRunning ? 'Searching web' : 'Searched web')}
        </span>
        {!toolSummary && (
          <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm">
            "{query}"
          </span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 4. Web Fetch -> ExternalLink icon + toolSummary or "Fetched" url
  if (entry.type === 'web_fetch') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const url = entry.data?.url || 'url';
    const toolSummary = entry.data?.toolSummary;

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <ExternalLink size={11} className="text-emerald-500/80 shrink-0" />
        <span className={cn("font-sans text-[12px] shrink-0", isFailed ? "text-rose-500 font-medium" : "text-zinc-500 dark:text-zinc-400")}>
          {toolSummary ? toolSummary : (isFailed ? 'Failed' : isCancelled ? 'Cancelled' : isRunning ? 'Fetching web' : 'Fetched')}
        </span>
        {!toolSummary && (
          <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm">
            {url}
          </span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 5. Code Search / Grep / Glob -> Search icon + pattern
  if (entry.type === 'code_search' || entry.type === 'search') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const pattern = entry.data?.pattern || 'query';
    const toolSummary = entry.data?.toolSummary;

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <Search size={11} className="text-amber-500/80 shrink-0" />
        <span className={cn("font-sans text-[12px] shrink-0", isFailed ? "text-rose-500 font-medium" : "text-zinc-500 dark:text-zinc-400")}>
          {toolSummary ? toolSummary : (isFailed ? 'Failed' : isCancelled ? 'Cancelled' : isRunning ? 'Searching' : 'Searched')}
        </span>
        {!toolSummary && (
          <span className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm">
            "{pattern}"
          </span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 6. Task Row
  if (entry.type === 'task') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const taskName = entry.data?.taskName || 'Task';
    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        <CheckCircle2 size={11} className="text-indigo-400 shrink-0" />
        <span className="font-sans text-[12px] text-zinc-500 dark:text-zinc-400">
          {isRunning ? 'Running' : 'Checked'}
        </span>
        <span className="font-sans font-medium text-foreground text-[12px] truncate max-w-md">{taskName}</span>
      </div>
    );
  }

  // 8. Subagent Row
  if (entry.type === 'subagent') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const role = entry.data?.roleLabel || 'Subagent';
    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        <Bot size={11} className="text-purple-400 shrink-0" />
        <span className="font-sans text-[12px] text-zinc-500 dark:text-zinc-400">
          {isRunning ? 'Running subagent' : 'Subagent'}
        </span>
        <span className="font-sans font-medium text-foreground text-[12px]">{role}</span>
      </div>
    );
  }

  // 7. Generic Other Action
  if (entry.type === 'other') {
    const t = entry.data?.tool;
    const displayName = t?.name && t?.name !== 'action' ? t.name : 'Action';
    const isRunning = isToolRunning(t, isStreaming);
    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        <span className="font-sans text-[12px] text-zinc-500 dark:text-zinc-400">
          {isRunning ? 'Executing' : 'Executed'}
        </span>
        <span className="font-mono font-medium text-foreground text-[12px]">{displayName}</span>
      </div>
    );
  }

  return null;
}
