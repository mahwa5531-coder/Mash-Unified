"use client";

import React, { useState } from 'react';
import { ChevronRight, Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isToolRunning } from './toolTimeline';
import type { TimelineEntry } from './types';

interface CommandTimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  expandedCmds?: Set<string> | Record<string, boolean>;
  isCmdExpanded?: boolean;
  copiedId?: string | null;
  onOpenFile?: (path: string) => void;
  handleCopy?: (text: string, id: string) => void;
  toggleCmd?: (id: string) => void;
}

export function CommandTimelineRow({
  entry,
  isChild = false,
  isStreaming,
  expandedCmds,
  isCmdExpanded: directIsCmdExpanded,
  copiedId: externalCopiedId,
  handleCopy: externalHandleCopy,
  toggleCmd,
}: CommandTimelineRowProps) {
  const [internalCopiedId, setInternalCopiedId] = useState<string | null>(null);

  const activeCopiedId = externalCopiedId !== undefined ? externalCopiedId : internalCopiedId;
  const activeHandleCopy = (text: string, id: string) => {
    if (externalHandleCopy) {
      externalHandleCopy(text, id);
    } else {
      navigator.clipboard.writeText(text);
      setInternalCopiedId(id);
      setTimeout(() => setInternalCopiedId(null), 2000);
    }
  };

  const isRunning = isToolRunning(entry.data?.tool, isStreaming);
  const isCancelled = entry.data?.tool?.status === 'cancelled';
  const isDenied = entry.data?.tool?.status === 'denied' || entry.data?.tool?.decision === 'deny';
  const isQueued = entry.data?.status === 'queued' || entry.data?.tool?.status === 'queued_approval';
  const toolId = String(entry.data?.tool?.id || entry.id);
  const rawOutput = entry.data?.tool?.output || '';
  const outputText = rawOutput.trim();


  const isCmdExpanded = directIsCmdExpanded !== undefined
    ? directIsCmdExpanded
    : expandedCmds instanceof Set
      ? expandedCmds.has(toolId)
      : Boolean(expandedCmds?.[toolId]);

  // ponytail: Defer JSON parsing of command output until user expands the terminal drawer
  let displayOutput = outputText;
  if (isCmdExpanded && outputText.startsWith('{') && outputText.endsWith('}')) {
    try {
      const parsed = JSON.parse(outputText);
      if (parsed && typeof parsed === 'object') {
        const val = parsed.returnDisplay || parsed.content || parsed.output || parsed.stdout || parsed.stderr;
        if (val !== undefined && val !== null) {
          displayOutput = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
        }
      }
    } catch {}
  }

  const toolAction = entry.data?.toolAction || entry.data?.tool?.toolAction;
  const toolSummary = entry.data?.toolSummary || entry.data?.tool?.toolSummary;

  let displayLabel: string;
  let showCmd = false;

  if (isDenied) {
    displayLabel = 'Cancelled by user';
    showCmd = true;
  } else if (isCancelled) {
    displayLabel = 'Cancelled';
    showCmd = true;
  } else if (isQueued) {
    displayLabel = 'Queued (awaiting prior approval)';
    showCmd = true;
  } else if (isRunning) {
    if (toolAction) {
      displayLabel = toolAction;
      showCmd = false;
    } else {
      displayLabel = 'Running';
      showCmd = true;
    }
  } else {
    if (toolSummary) {
      displayLabel = toolSummary;
      showCmd = false;
    } else {
      displayLabel = 'Ran';
      showCmd = true;
    }
  }


  return (
    <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "pl-2 py-0.5" : "my-0.5", isDenied && "opacity-75")}>
      <button
        type="button"
        onClick={() => toggleCmd?.(toolId)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-normal py-0.5 cursor-pointer select-none transition-colors group text-left w-fit"
      >
        <span
          className={cn(
            "font-sans text-[12px] shrink-0",
            isRunning
              ? "animate-silver-shine"
              : "text-zinc-500 group-hover:text-zinc-800 dark:text-zinc-400 dark:group-hover:text-zinc-200 transition-colors"
          )}
        >
          {displayLabel}
        </span>
        {showCmd && (
          <span
            className={cn(
              "font-mono text-[12px] truncate max-w-md",
              isDenied
                ? "opacity-60 line-through text-zinc-500"
                : isQueued
                ? "opacity-60 text-zinc-500 dark:text-zinc-400"
                : "text-zinc-700 dark:text-zinc-300 font-normal"
            )}
          >
            {entry.data?.cmd}
          </span>
        )}
        {isRunning && <span className="font-sans text-[12px] text-zinc-400 dark:text-zinc-500 shrink-0">...</span>}
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
                <span className="text-zinc-500 font-mono text-[10.5px] select-none shrink-0">&gt;</span>
                <span className="text-zinc-200 font-medium truncate text-[10.5px]">{entry.data?.fullCmd || entry.data?.cmd}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    activeHandleCopy(displayOutput || entry.data?.fullCmd || entry.data?.cmd || '', toolId);
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Copy command/output"
                >
                  {activeCopiedId === toolId ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                </button>
              </div>
            </div>
            <pre className="text-zinc-300 whitespace-pre-wrap leading-tight max-h-36 overflow-y-auto custom-scrollbar font-mono text-[10.5px] select-text">
              {displayOutput || (
                <span className="text-zinc-500">
                  {isRunning ? 'Running command...' : 'Done (no output)'}
                </span>
              )}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
