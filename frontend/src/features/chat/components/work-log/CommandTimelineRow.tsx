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

  let displayOutput = outputText;
  let parsedError: string | null = null;
  if (outputText.startsWith('{') && outputText.endsWith('}')) {
    try {
      const parsed = JSON.parse(outputText);
      if (parsed && typeof parsed === 'object') {
        if (parsed.error) {
          parsedError = typeof parsed.error === 'string' ? parsed.error : parsed.error.message || JSON.stringify(parsed.error);
        }
        if (parsed.returnDisplay || parsed.content) {
          displayOutput = parsed.returnDisplay || parsed.content;
        }
      }
    } catch {}
  }

  const isFailed = entry.data?.tool?.status === 'failed' || Boolean(parsedError) || (!parsedError && /error:|command not found|fatal:/i.test(displayOutput));

  return (
    <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "pl-2 py-0.5" : "my-0.5")}>
      <button
        type="button"
        onClick={() => setExpandedCmdIndex(isCmdExpanded ? null : toolId)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-normal py-0.5 cursor-pointer select-none transition-colors group text-left w-fit"
      >
        {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        <span className="font-sans text-[12px]">
          {isCancelled ? 'Cancelled' : isRunning ? 'Running' : 'Ran'}
        </span>
        <span className="font-mono font-medium text-foreground text-[12px] truncate max-w-md">
          {entry.data?.cmd}
        </span>
        <ChevronRight
          size={11}
          className={cn(
            "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-transform duration-200 shrink-0",
            isCmdExpanded && "rotate-90"
          )}
        />
      </button>

      {isCmdExpanded && (
        <div className="mt-1 mb-2 pl-3 transition-all">
          <div className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-200">
            <div className="text-zinc-400 mb-1.5 flex items-center justify-between border-b border-zinc-800 pb-1 text-[10.5px]">
              <div className="flex items-center gap-1.5 truncate">
                <span className="text-zinc-500 truncate text-[10px]">...\Mash &gt;</span>
                <span className="text-zinc-200 font-medium truncate text-[10.5px]">{entry.data?.fullCmd || entry.data?.cmd}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(displayOutput || entry.data?.fullCmd || entry.data?.cmd || '', toolId);
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Copy command/output"
                >
                  {copiedId === toolId ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                </button>
                {isFailed ? (
                  <AlertCircle size={12} className="text-rose-400" />
                ) : (
                  <Check size={12} className="text-emerald-400/90" />
                )}
              </div>
            </div>
            <pre className="text-zinc-300 whitespace-pre-wrap leading-tight max-h-36 overflow-y-auto custom-scrollbar font-mono text-[10.5px] select-text">
              {displayOutput ? renderOutputWithLinks(displayOutput, onOpenFile) : <span className="text-zinc-500">Done (no output)</span>}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
