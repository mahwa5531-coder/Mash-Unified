"use client";

import React from 'react';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';

interface ChatHistoryLoadStateProps {
  sessionId: string | null;
  isHistoryLoaded: boolean;
  historyLoadError: boolean;
  retryLoadHistory: () => void;
}

export function ChatHistoryLoadState({
  sessionId,
  isHistoryLoaded,
  historyLoadError,
  retryLoadHistory,
}: ChatHistoryLoadStateProps) {
  if (!sessionId) return null;

  if (historyLoadError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-20 select-none mt-12 font-sans">
        <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200/80 dark:border-white/[0.08] flex items-center justify-center mb-3 text-zinc-400 dark:text-zinc-500 shadow-2xs">
          <AlertCircle size={16} />
        </div>
        <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Unable to load conversation</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3.5 max-w-xs">Could not retrieve message history from local server.</p>
        <button
          type="button"
          onClick={retryLoadHistory}
          className="group inline-flex items-center gap-1.5 h-[24px] px-3 py-0 rounded-full font-sans text-[11px] font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-zinc-100/90 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20] shadow-2xs backdrop-blur-sm"
        >
          <RotateCcw size={11} className="text-zinc-400 dark:text-zinc-400 group-hover:rotate-45 transition-transform" />
          <span>Retry loading</span>
        </button>
      </div>
    );
  }

  if (!isHistoryLoaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-24 select-none mt-16 animate-pulse font-sans">
        <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200/80 dark:border-white/[0.08] flex items-center justify-center mb-3 shadow-2xs">
          <Loader2 size={16} className="animate-spin text-zinc-400" />
        </div>
        <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">Loading conversation</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Fetching transcript and workspace state...</p>
      </div>
    );
  }

  return null;
}
