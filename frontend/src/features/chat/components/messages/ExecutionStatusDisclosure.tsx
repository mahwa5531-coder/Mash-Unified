"use client";

import React, { useState } from 'react';
import { ChevronRight, AlertCircle, WifiOff, Play, RotateCcw, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ExecutionStatusDisclosureProps {
  status?: string;
  error?: string | null;
  errorId?: string | null;
  totalDurationSeconds?: number;
  onRetry?: () => void;
  onContinue?: () => void;
}

export function ExecutionStatusDisclosure({
  status,
  error,
  errorId,
  totalDurationSeconds,
  onRetry,
  onContinue,
}: ExecutionStatusDisclosureProps) {
  const [errorOpen, setErrorOpen] = useState(true);
  const [abortedOpen, setAbortedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const effectiveError = error || (status === 'error' ? 'Agent execution was interrupted or encountered an unexpected error.' : null);

  if (effectiveError) {
    const lower = effectiveError.toLowerCase();
    const isNetworkError = lower.includes('network') || lower.includes('wifi') || lower.includes('failed to fetch') || lower.includes('offline') || lower.includes('timed out');

    return (
      <div className="w-full min-w-0 text-[13px] font-sans my-1.5 select-text">
        <button
          type="button"
          aria-expanded={errorOpen}
          onClick={() => setErrorOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-[#8a8a8e] hover:text-zinc-900 dark:hover:text-zinc-200 font-normal py-0.5 px-1 -mx-1 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-all cursor-pointer select-none my-0.5 w-fit group"
        >
          {isNetworkError ? (
            <span className="text-amber-500 dark:text-amber-400 group-hover:text-amber-600 dark:group-hover:text-amber-300 font-sans flex items-center gap-1 font-medium">
              <WifiOff size={11} className="shrink-0" />
              <span>Disconnected</span>
            </span>
          ) : (
            <span className="text-rose-500 dark:text-rose-400 group-hover:text-rose-600 dark:group-hover:text-rose-300 font-sans flex items-center gap-1 font-medium">
              <AlertCircle size={11} className="shrink-0" />
              <span>Terminated</span>
            </span>
          )}
          <span className="text-zinc-800 dark:text-zinc-200 font-medium font-sans">
            {isNetworkError 
              ? 'Agent execution terminated: Network connection lost.' 
              : 'Agent execution terminated due to error.'}
          </span>
          <ChevronRight size={11} className={cn("text-zinc-400 dark:text-zinc-500 transition-transform ml-0.5", errorOpen && "rotate-90")} />
        </button>

        {errorOpen && (
          <div className="w-full rounded-lg border border-rose-500/20 dark:border-rose-500/25 bg-rose-500/[0.03] dark:bg-rose-950/[0.15] p-2.5 font-mono text-[11px] my-1 shadow-none transition-colors">
            <div className="text-muted-foreground mb-1.5 flex items-center justify-between border-b border-zinc-200/60 dark:border-white/[0.05] pb-1.5 text-[10.5px]">
              <div className="flex items-center gap-1.5 truncate">
                {isNetworkError ? (
                  <WifiOff size={12} className="text-amber-500 shrink-0" />
                ) : (
                  <AlertCircle size={12} className="text-rose-500 shrink-0" />
                )}
                <span className="text-foreground/90 font-medium truncate text-[10.5px]">
                  {isNetworkError ? 'Network Disconnection' : 'Execution Error'}
                </span>
                {errorId && (
                  <span className="text-muted-foreground/60 truncate text-[10px]">
                    (ID: {errorId})
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(effectiveError);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="p-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="Copy error details"
                >
                  {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                </button>

                {onContinue && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onContinue();
                    }}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-600 dark:text-sky-300 font-sans font-medium transition-colors cursor-pointer text-[10.5px] border border-sky-500/25 shadow-2xs"
                    title="Continue execution from where it was interrupted"
                  >
                    <Play size={10} className="fill-current" />
                    <span>Continue</span>
                  </button>
                )}

                {onRetry && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRetry();
                    }}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-200/80 hover:bg-zinc-300/80 dark:bg-white/10 dark:hover:bg-white/15 text-zinc-700 dark:text-zinc-200 font-sans font-medium transition-colors cursor-pointer text-[10.5px] border border-zinc-300 dark:border-white/10 shadow-2xs"
                    title="Retry the prompt from the beginning"
                  >
                    <RotateCcw size={10} />
                    <span>Retry</span>
                  </button>
                )}
              </div>
            </div>

            <pre className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto custom-scrollbar font-mono text-[10.5px]">
              {effectiveError}
            </pre>
          </div>
        )}
      </div>
    );
  }

  if (status === 'aborted') {
    return (
      <div className="w-full min-w-0 text-[13px] font-sans my-1 select-text">
        <button
          type="button"
          aria-expanded={abortedOpen}
          onClick={() => setAbortedOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-[#8a8a8e] hover:text-zinc-900 dark:hover:text-zinc-200 font-normal py-0.5 px-1 -mx-1 rounded-[6px] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-all cursor-pointer select-none my-0.5 w-fit group"
        >
          <span className="text-zinc-500 dark:text-[#8a8a8e] group-hover:text-zinc-700 dark:group-hover:text-zinc-300 font-sans">Stopped</span>
          <span className="text-zinc-800 dark:text-zinc-200 font-medium font-sans">Agent execution stopped.</span>
          <ChevronRight size={11} className={cn("text-zinc-400 dark:text-zinc-500 transition-transform ml-0.5", abortedOpen && "rotate-90")} />
        </button>
        {abortedOpen && (
          <div className="py-1 text-xs text-zinc-500 dark:text-[#8a8a8e] font-sans pl-1">
            Execution was stopped by user{totalDurationSeconds ? ` after ${totalDurationSeconds}s` : ''}.
          </div>
        )}
      </div>
    );
  }

  return null;
}
