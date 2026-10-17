"use client";

import React from 'react';
import { AlertCircle, Globe, ExternalLink, Search, CheckCircle2, Bot } from 'lucide-react';
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
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Analysed';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Analysing';
    } else {
      label = toolSummary || 'Analysed';
    }

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
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
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Edited';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Editing';
    } else {
      label = toolSummary || 'Edited';
    }

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
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
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Searched web';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Searching web';
    } else {
      label = toolSummary || 'Searched web';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <Globe size={11} className="text-sky-500/80 shrink-0" />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
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
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Fetched';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Fetching web';
    } else {
      label = toolSummary || 'Fetched';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <ExternalLink size={11} className="text-emerald-500/80 shrink-0" />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
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
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

    let label = 'Searched';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Searching';
    } else {
      label = toolSummary || 'Searched';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs select-none transition-colors my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <Search size={11} className="text-amber-500/80 shrink-0" />
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && (
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
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;
    const taskName = entry.data?.taskName || 'Task';

    let label = 'Checked';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Running';
    } else {
      label = toolSummary || 'Checked';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isFailed && !isRunning ? (
          <AlertCircle size={10} className="text-rose-500 shrink-0" />
        ) : (
          <CheckCircle2 size={11} className="text-indigo-400 shrink-0" />
        )}
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && taskName && (
          <span className="font-sans font-medium text-foreground text-[12px] truncate max-w-md">{taskName}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 8. Subagent Row
  if (entry.type === 'subagent') {
    const isRunning = isToolRunning(entry.data?.tool, isStreaming);
    const isCancelled = entry.data?.tool?.status === 'cancelled';
    const isFailed = entry.data?.tool?.status === 'failed';
    const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
    const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;
    const role = entry.data?.roleLabel || 'Subagent';

    let label = 'Subagent';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Running subagent';
    } else {
      label = toolSummary || 'Subagent';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isFailed && !isRunning ? (
          <AlertCircle size={10} className="text-rose-500 shrink-0" />
        ) : (
          <Bot size={11} className="text-purple-400 shrink-0" />
        )}
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && role && (
          <span className="font-sans font-medium text-foreground text-[12px]">{role}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  // 7. Generic Other Action
  if (entry.type === 'other') {
    const t = entry.data?.tool;
    const displayName = t?.name && t?.name !== 'action' ? t.name : 'Action';
    const isRunning = isToolRunning(t, isStreaming);
    const isCancelled = t?.status === 'cancelled';
    const isFailed = t?.status === 'failed';
    const toolAction = entry.data?.toolAction || t?.toolAction;
    const toolSummary = entry.data?.toolSummary || t?.toolSummary;

    let label = 'Executed';
    if (isFailed) {
      label = 'Failed';
    } else if (isCancelled) {
      label = 'Cancelled';
    } else if (isRunning) {
      label = toolAction || 'Executing';
    } else {
      label = toolSummary || 'Executed';
    }
    const hasCustomText = !isFailed && !isCancelled && (isRunning ? Boolean(toolAction) : Boolean(toolSummary));

    return (
      <div key={entry.id} className={cn("flex items-center gap-1.5 text-xs select-none my-0.5", isChild ? "pl-1 py-0.5" : "my-0.5")}>
        {isFailed && !isRunning && <AlertCircle size={10} className="text-rose-500 shrink-0" />}
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isFailed
              ? "text-rose-500 font-medium"
              : isRunning
                ? "animate-silver-shine"
                : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {label}
        </span>
        {!hasCustomText && displayName && (
          <span className="font-mono font-medium text-foreground text-[12px]">{displayName}</span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
      </div>
    );
  }

  return null;
}
