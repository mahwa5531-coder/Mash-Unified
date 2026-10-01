"use client";

import React from 'react';
import { ChevronRight, Loader2, Check, Copy, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderOutputWithLinks } from './fileLinkRenderer';
import { isToolRunning } from './toolTimeline';
import type { TimelineEntry } from './types';

interface CommandTimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  isCmdExpanded: boolean;
  copiedId: string | null;
  onOpenFile?: (path: string) => void;
  handleCopy: (text: string, id: string) => void;
  setExpandedCmdIndex: React.Dispatch<React.SetStateAction<string | null>>;
}

export function CommandTimelineRow({
  entry,
  isChild,
  isStreaming,
  isCmdExpanded,
  copiedId,
  onOpenFile,
  handleCopy,
  setExpandedCmdIndex,
}: CommandTimelineRowProps) {
  const isRunning = isToolRunning(entry.data?.tool, isStreaming);
  const isCancelled = entry.data?.tool?.status === 'cancelled';
  const toolId = String(entry.data?.tool?.id || entry.id);
  const rawOutput = entry.data?.tool?.output || '';
  const outputText = rawOutput.trim();
  const hasOutput = outputText.length > 0 && outputText !== 'Done.';
  const isFailed = entry.data?.tool?.status === 'failed' || /error|failed|command not found/i.test(outputText);

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
          <span className="font-mono text-foreground font-medium truncate max-w-xl">{entry.data?.cmd}</span>
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
                <span className="text-foreground/90 font-medium truncate text-[10.5px]">{entry.data?.fullCmd}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(outputText || entry.data?.fullCmd, toolId);
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
