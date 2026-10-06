"use client";

import React, { useState } from 'react';
import { 
  ChevronRight, 
  WifiOff, 
  Clock, 
  AlertCircle, 
  AlertTriangle, 
  Lock, 
  Wrench, 
  Play, 
  RotateCcw, 
  Copy, 
  Check 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { classifyError } from '@/lib/errorClassification';

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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [abortedOpen, setAbortedOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const effectiveError = error || (status === 'error' ? 'Agent execution was interrupted or encountered an unexpected error.' : null);

  if (effectiveError) {
    const classified = classifyError(effectiveError, errorId);

    // 1. Quota Error: Suppress intrusive crash box because QuotaBanner handles it docked above composer
    if (classified?.category === 'quota') {
      return (
        <div className="w-full text-xs text-zinc-500 dark:text-zinc-400 py-1.5 flex items-center gap-2 select-text font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>Baseline token quota reached. See quota banner below for refresh details.</span>
        </div>
      );
    }

    const title = classified?.title || "Agent Execution Interrupted";
    const description = classified?.description || "An unexpected error occurred during execution.";
    const category = classified?.category || "general";

    // Icon & Color styling based on classified category
    const renderIcon = () => {
      switch (category) {
        case 'offline':
          return <WifiOff size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />;
        case 'network_lost':
          return <WifiOff size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />;
        case 'timeout':
          return <Clock size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />;
        case 'auth':
          return <Lock size={14} className="text-zinc-500 dark:text-zinc-400 shrink-0" />;
        case 'tool_failure':
          return <Wrench size={14} className="text-amber-500 dark:text-amber-400 shrink-0" />;
        default:
          return <AlertCircle size={14} className="text-rose-500 dark:text-rose-400 shrink-0" />;
      }
    };

    return (
      <div className="w-full min-w-0 font-sans my-2 select-text">
        <div className="w-full rounded-xl border border-zinc-200/90 dark:border-white/[0.08] bg-zinc-50/80 dark:bg-[#18181b] p-3 text-xs shadow-xs transition-all">
          {/* Header Row: Icon, Title, and Action Buttons */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="mt-0.5">{renderIcon()}</div>
              <div className="min-w-0">
                <div className="font-medium text-zinc-900 dark:text-zinc-100 text-[13px] leading-tight">
                  {title}
                </div>
                <div className="text-[11.5px] text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                  {description}
                </div>
              </div>
            </div>

            {/* Quick Actions (Continue / Retry) */}
            <div className="flex items-center gap-1.5 shrink-0 select-none">
              {onContinue && category === 'network_lost' && (
                <button
                  type="button"
                  onClick={onContinue}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/30 text-sky-600 dark:text-sky-300 font-medium transition-colors cursor-pointer text-[11px] border border-sky-500/20"
                  title="Continue execution from where it was interrupted"
                >
                  <Play size={10} className="fill-current" />
                  <span>Continue</span>
                </button>
              )}

              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-200/80 hover:bg-zinc-300/80 dark:bg-white/[0.08] dark:hover:bg-white/[0.12] active:bg-zinc-400/80 dark:active:bg-white/[0.16] text-zinc-800 dark:text-zinc-200 font-medium transition-colors cursor-pointer text-[11px] border border-zinc-300/80 dark:border-white/[0.08]"
                  title="Retry this prompt"
                >
                  <RotateCcw size={11} />
                  <span>Retry</span>
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Technical Details (Clean accordion, collapsed by default) */}
          <div className="mt-2.5 pt-2 border-t border-zinc-200/60 dark:border-white/[0.06]">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer select-none"
            >
              <ChevronRight size={12} className={cn("transition-transform duration-150", detailsOpen && "rotate-90")} />
              <span>{detailsOpen ? "Hide technical details" : "Show technical details"}</span>
              {errorId && <span className="font-mono text-zinc-400 dark:text-zinc-500 ml-1">({errorId})</span>}
            </button>

            {detailsOpen && (
              <div className="mt-2 p-2.5 rounded-lg bg-zinc-100/90 dark:bg-[#121214] border border-zinc-200/80 dark:border-white/[0.06] font-mono text-[10.5px]">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-200/60 dark:border-white/[0.05] text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>Raw diagnostic output</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(effectiveError);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
                    title="Copy details to clipboard"
                  >
                    {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>

                <pre className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto custom-scrollbar">
                  {effectiveError}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Aborted Turn
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
