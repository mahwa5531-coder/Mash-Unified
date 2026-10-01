"use client";

import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

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
      <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-20 select-none mt-12">
        <div className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center justify-center mb-3 text-red-500 shadow-xs">
          <AlertCircle size={20} />
        </div>
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">Failed to load conversation</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">Could not retrieve history from backend server.</p>
        <button
          type="button"
          onClick={retryLoadHistory}
          className="px-3.5 py-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors cursor-pointer shadow-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        >
          Retry Loading
        </button>
      </div>
    );
  }

  if (!isHistoryLoaded) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center my-auto py-24 select-none mt-16 animate-pulse">
        <div className="w-10 h-10 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center mb-4 text-[var(--accent)] shadow-md">
          <Loader2 size={20} className="animate-spin text-zinc-400" />
        </div>
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">Loading conversation</h3>
        <p className="text-xs text-[var(--text-muted)]">Fetching transcript and workspace state...</p>
      </div>
    );
  }

  return null;
}
