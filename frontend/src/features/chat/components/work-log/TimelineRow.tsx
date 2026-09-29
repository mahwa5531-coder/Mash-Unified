"use client";

// One timeline row (thought card / tool row / command console / group card).
// Prop names mirror TaskWorkLogAccordion identifiers (container/view split).
import React, { useState } from 'react';
import { ChevronRight, Loader2, Check, Copy, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FilePill } from '@/primitives';
import { renderOutputWithLinks } from './fileLinkRenderer';
import { formatDurationDisplay, isToolRunning } from './toolTimeline';
import type { TimelineEntry } from './types';

interface TimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  onOpenFile?: (path: string) => void;
  liveThinkingSeconds: number;
  latchedThinkingSeconds: number | null;
  expandedThoughts: Record<string, boolean>;
  expandedCmdIndex: string | null;
  expandedGroups: Record<string, boolean>;
  copiedId: string | null;
  toggleThought: (id: string) => void;
  toggleGroup: (id: string) => void;
  handleCopy: (text: string, id: string) => void;
  setExpandedCmdIndex: React.Dispatch<React.SetStateAction<string | null>>;
  setCopiedId: React.Dispatch<React.SetStateAction<string | null>>;
  thoughtScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TimelineRow({
  entry,
  isChild = false,
  isStreaming,
  thinkingDurationSeconds,
  onOpenFile,
  liveThinkingSeconds,
  latchedThinkingSeconds,
  expandedThoughts,
  expandedCmdIndex,
  expandedGroups,
  copiedId,
  toggleThought,
  toggleGroup,
  handleCopy,
  setExpandedCmdIndex,
  setCopiedId,
  thoughtScrollRef,
}: TimelineRowProps) {
  // Recursive rendering for child rows inside group cards.
  const renderTimelineRow = (childEntry: TimelineEntry, isChild = false) => (
    <TimelineRow
      entry={childEntry}
      isChild={isChild}
      isStreaming={isStreaming}
      thinkingDurationSeconds={thinkingDurationSeconds}
      onOpenFile={onOpenFile}
      liveThinkingSeconds={liveThinkingSeconds}
      latchedThinkingSeconds={latchedThinkingSeconds}
      expandedThoughts={expandedThoughts}
      expandedCmdIndex={expandedCmdIndex}
      expandedGroups={expandedGroups}
      copiedId={copiedId}
      toggleThought={toggleThought}
      toggleGroup={toggleGroup}
      handleCopy={handleCopy}
      setExpandedCmdIndex={setExpandedCmdIndex}
      setCopiedId={setCopiedId}
      thoughtScrollRef={thoughtScrollRef}
    />
  );

  // 1. Thought Row: Naked text link + Dedicated Thought Card with distinct reasoning typography
  if (entry.type === 'thought') {
    const isThoughtActive = Boolean(isStreaming && entry.data.status === 'running');
    const isExpanded = !!expandedThoughts[entry.id] || isThoughtActive;
    const displaySecs = isThoughtActive 
      ? liveThinkingSeconds 
      : (entry.data.durationSecs || thinkingDurationSeconds || latchedThinkingSeconds || 1);

    return (
      <div key={entry.id} className="my-1">
        <button
          type="button"
          onClick={() => toggleThought(entry.id)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-normal py-0.5 cursor-pointer select-none transition-colors group"
        >
          <span className="font-sans">
            {isThoughtActive 
              ? `Thinking for ${formatDurationDisplay(liveThinkingSeconds)}...` 
              : `Thought for ${formatDurationDisplay(displaySecs)}`}
          </span>
          <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
        </button>

        {isExpanded && (
          <div 
            ref={isThoughtActive ? thoughtScrollRef : undefined}
            className="mt-1.5 rounded-xl border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015] p-2.5 text-[12px] leading-relaxed text-muted-foreground select-text max-h-60 overflow-y-auto custom-scrollbar font-sans transition-all duration-200 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_strong]:text-foreground [&_strong]:font-medium [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-zinc-200/50 dark:[&_code]:bg-white/[0.06] [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:my-1.5 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:bg-zinc-100/50 dark:[&_pre]:bg-white/[0.03] [&_pre]:border [&_pre]:border-zinc-200/60 dark:[&_pre]:border-white/[0.05]"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {entry.data.text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  // 2. Clean Unified Exploration Card: ONLY for 2+ parallel exploratory items
  if (entry.type === 'exploration_group') {
    const isGroupExpanded = !!expandedGroups[entry.id];
    return (
      <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-muted-foreground font-sans">
              {entry.data.isCancelled
                ? 'Cancelled'
                : !entry.data.summaryText.includes('file') && !entry.data.summaryText.includes('search') && !entry.data.summaryText.includes('folder')
                ? (entry.data.isRunning ? 'Running' : 'Ran')
                : (entry.data.isRunning ? 'Exploring' : 'Explored')}
            </span>
            <span className="font-medium text-foreground truncate">
              {entry.data.summaryText}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
              {entry.data.totalCount}
            </Badge>
            <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
          </div>
        </button>

        {isGroupExpanded && (
          <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
            {entry.items?.map((child) => renderTimelineRow(child, true))}
          </div>
        )}
      </div>
    );
  }

  // 3. Command Group: Clean Unified Card for 2+ parallel commands
  if (entry.type === 'command_group') {
    const isGroupExpanded = !!expandedGroups[entry.id];
    return (
      <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-muted-foreground font-sans">
              {entry.data.isCancelled ? 'Cancelled' : entry.data.isRunning ? 'Running' : 'Ran'}
            </span>
            <span className="font-medium text-foreground font-sans">
              {entry.data.count} commands
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
              {entry.data.count}
            </Badge>
            <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
          </div>
        </button>

        {isGroupExpanded && (
          <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
            {entry.items?.map((child) => renderTimelineRow(child, true))}
          </div>
        )}
      </div>
    );
  }

  // 3b. Edit Group: Clean Unified Card for 2+ parallel edits
  if (entry.type === 'edit_group') {
    const isGroupExpanded = !!expandedGroups[entry.id];
    return (
      <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
        <button
          type="button"
          onClick={() => toggleGroup(entry.id)}
          className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-muted-foreground font-sans">
              {entry.data.isCancelled ? 'Cancelled' : entry.data.isRunning ? 'Editing' : 'Edited'}
            </span>
            <span className="font-medium text-foreground font-sans">
              {entry.data.count} files
            </span>
            {(entry.data.added > 0 || entry.data.deleted > 0) && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0 ml-1">
                {entry.data.added > 0 && (
                  <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">+{entry.data.added}</span>
                )}
                {entry.data.deleted > 0 && (
                  <span className="px-1 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">-{entry.data.deleted}</span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
              {entry.data.count}
            </Badge>
            <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
          </div>
        </button>

        {isGroupExpanded && (
          <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
            {entry.items?.map((child) => renderTimelineRow(child, true))}
          </div>
        )}
      </div>
    );
  }

  // 4. Single Command Row: Naked text dropdown with expandable console
  if (entry.type === 'command') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    const toolId = String(entry.data.tool?.id || entry.id);
    const isCmdExpanded = expandedCmdIndex === toolId;
    const rawOutput = entry.data.tool?.output || '';
    const outputText = rawOutput.trim();
    const hasOutput = outputText.length > 0 && outputText !== 'Done.';
    const isFailed = entry.data.tool?.status === 'failed' || /error|failed|command not found/i.test(outputText);

    return (
      <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-0.5", isChild ? "px-3 py-1 hover:bg-muted/40 transition-colors" : "")}>
        <div
          onClick={() => hasOutput && setExpandedCmdIndex(isCmdExpanded ? null : toolId)}
          className={cn(
            "flex items-center justify-between text-xs py-0.5 group select-none transition-colors w-full",
            hasOutput ? "cursor-pointer" : "cursor-default"
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Cancelled' : isRunning ? 'Running' : 'Ran'}
            </span>
            <span className="font-mono text-foreground font-medium truncate max-w-xl">{entry.data.cmd}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasOutput && (
              <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isCmdExpanded && "rotate-90")} />
            )}
          </div>
        </div>

        {hasOutput && isCmdExpanded && (
          <div className="py-1 overflow-hidden transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
            <div className="w-full rounded-lg border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-100/40 dark:bg-white/[0.02] p-2 font-mono text-[11px] transition-colors duration-200 shadow-none">
              <div className="text-muted-foreground mb-1 flex items-center justify-between border-b border-zinc-200/60 dark:border-white/[0.05] pb-1 text-[10.5px]">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-muted-foreground/60 truncate text-[10px]">...\Mash &gt;</span>
                  <span className="text-foreground/90 font-medium truncate text-[10.5px]">{entry.data.fullCmd}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy(outputText || entry.data.fullCmd, toolId);
                    }}
                    className="p-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                    title="Copy command/output"
                  >
                    {copiedId === toolId ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  </button>
                  {isFailed ? (
                    <AlertCircle size={12} className="text-rose-500" />
                  ) : (
                    <Check size={12} className="text-emerald-500/80" />
                  )}
                </div>
              </div>
              <pre className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-tight max-h-24 overflow-y-auto custom-scrollbar font-mono text-[10.5px]">
                {renderOutputWithLinks(outputText, onOpenFile)}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 5. File Read Row: Clean naked text row with ghost FilePill (No tool duration)
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

  // 6. Edited File Row: Clean naked text row with diff counts (No tool duration, non-clickable diff)
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

  // 7. Folder View Row: Naked text row
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

  // 8. Search Row: Naked text row
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

  // 8b. Timer Row (schedule/timer tool)
  if (entry.type === 'timer') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isCancelled = entry.data.tool?.status === 'cancelled';
    const isExpanded = !!expandedGroups[entry.id];
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

  // 9. Task Action Row (Standalone process action - manage_task / background task)
  if (entry.type === 'task') {
    const isRunning = isToolRunning(entry.data.tool, isStreaming);
    const isExpanded = !!expandedGroups[entry.id];
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

  // 10. Subagent Invocation Row
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

  // 11. Other Action Row
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

  // 12. Intermediate In-Flow Text Step Row
  if (entry.type === 'text') {
    const cleanText = (entry.data.text || '').replace(/\[VERIFIED\]\s*/gi, '').trim();
    if (!cleanText) return null;
    return (
      <div key={entry.id} className="text-zinc-600 dark:text-zinc-400 text-xs py-1 px-1 font-sans leading-relaxed select-text whitespace-pre-wrap">
        {cleanText}
      </div>
    );
  }

  return null;
}
