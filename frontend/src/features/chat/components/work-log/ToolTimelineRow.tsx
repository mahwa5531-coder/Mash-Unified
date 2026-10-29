"use client";

import React from 'react';
import { Globe, ExternalLink, Search, CheckCircle2, Bot } from 'lucide-react';
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
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const filePath = entry.data?.filePath || entry.data?.filename || entry.data?.folderPath || entry.data?.foldername || 'file';
    const baseName = (entry.data?.filename || entry.data?.foldername || filePath.split(/[/\\]/).pop() || '').trim();
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Analysed';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      if (toolAction && baseName && baseName !== 'file' && toolAction.toLowerCase().includes(baseName.toLowerCase())) {
        label = 'Analysing';
      } else {
        label = toolAction || 'Analysing';
      }
    } else {
      if (toolSummary && baseName && baseName !== 'file' && toolSummary.toLowerCase().includes(baseName.toLowerCase())) {
        label = 'Analysed';
      } else {
        label = toolSummary || 'Analysed';
      }
    }

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5",
          isDenied && "opacity-75"
        )}
      >
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        <div className={cn(isDenied && "opacity-60")}>
          <FilePill path={filePath} onOpenFile={onOpenFile} />
        </div>
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 2. Edited File -> Edited <FilePill>
  if (entry.type === 'edit') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const filePath = entry.data?.filePath || entry.data?.filename || 'file';
    const baseName = (entry.data?.filename || filePath.split(/[/\\]/).pop() || '').trim();
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Edited';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      if (toolAction && baseName && baseName !== 'file' && toolAction.toLowerCase().includes(baseName.toLowerCase())) {
        label = 'Editing';
      } else {
        label = toolAction || 'Editing';
      }
    } else {
      if (toolSummary && baseName && baseName !== 'file' && toolSummary.toLowerCase().includes(baseName.toLowerCase())) {
        label = 'Edited';
      } else {
        label = toolSummary || 'Edited';
      }
    }

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5",
          isDenied && "opacity-75"
        )}
      >
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        <div className={cn(isDenied && "opacity-60")}>
          <FilePill path={filePath} onOpenFile={onOpenFile} />
        </div>
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 3. Web Search -> Globe icon + toolSummary or "Searched web" "query"
  if (entry.type === 'web_search') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const query = entry.data?.query || 'query';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Searched web';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Searching web';
    } else {
      label = toolSummary || 'Searched web';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5",
          isDenied && "opacity-75"
        )}
      >
        <Globe size={11} className={cn("text-sky-500/80 shrink-0", isDenied && "opacity-60")} />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
          <span className={cn("font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm", isDenied && "opacity-60 line-through")}>
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
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const url = entry.data?.url || 'url';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Fetched';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Fetching web';
    } else {
      label = toolSummary || 'Fetched';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5",
          isDenied && "opacity-75"
        )}
      >
        <ExternalLink size={11} className={cn("text-emerald-500/80 shrink-0", isDenied && "opacity-60")} />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
          <span className={cn("font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm", isDenied && "opacity-60 line-through")}>
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
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const pattern = entry.data?.pattern || 'query';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Searched';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Searching';
    } else {
      label = toolSummary || 'Searched';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5",
          isDenied && "opacity-75"
        )}
      >
        <Search size={11} className={cn("text-amber-500/80 shrink-0", isDenied && "opacity-60")} />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
          <span className={cn("font-mono text-[11px] text-zinc-700 dark:text-zinc-300 truncate max-w-sm", isDenied && "opacity-60 line-through")}>
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
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;
    const taskName = entry.data?.taskName || 'Task';

    let label = 'Checked';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Running';
    } else {
      label = toolSummary || 'Checked';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5", isDenied && "opacity-75")}>
        <CheckCircle2 size={11} className={cn("text-indigo-400 shrink-0", isDenied && "opacity-60")} />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && taskName && (
          <span className={cn("font-sans font-medium text-foreground text-[12px] truncate max-w-md", isDenied && "opacity-60 line-through")}>{taskName}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 7. Subagent Row
  if (entry.type === 'subagent') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;
    const role = entry.data?.roleLabel || 'Subagent';

    let label = 'Subagent';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Running subagent';
    } else {
      label = toolSummary || 'Subagent';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5", isDenied && "opacity-75")}>
        <Bot size={11} className={cn("text-purple-400 shrink-0", isDenied && "opacity-60")} />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && role && (
          <span className={cn("font-sans font-medium text-foreground text-[12px]", isDenied && "opacity-60 line-through")}>{role}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 8. Generic Other Action
  if (entry.type === 'other') {
    const t = entry.data?.tool;
    const displayName = t?.name && t?.name !== 'action'
      ? t.name.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
      : 'Action';
    const isRunning = isToolRunning(t, isStreaming);
    const isCancelled = t?.status === 'cancelled';
    const isDenied = t?.status === 'denied' || t?.decision === 'deny';
    const toolAction = entry.data?.toolAction || t?.toolAction;
    const toolSummary = entry.data?.toolSummary || t?.toolSummary;

    let label = 'Executed';
    if (isDenied) {
      label = 'Cancelled by user';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Executing';
    } else {
      label = toolSummary || 'Executed';
    }
    const hasCustomText = !isDenied && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5", isDenied && "opacity-75")}>
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && displayName && (
          <span className={cn("font-mono font-medium text-foreground text-[12px]", isDenied && "opacity-60 line-through")}>{displayName}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  return null;
}
