"use client";

import React from 'react';
import { Play } from 'lucide-react';
import { classifyError } from '@/lib/errorClassification';

export interface ExecutionStatusDisclosureProps {
  status?: string;
  error?: string | null;
  errorId?: string | null;
  totalDurationSeconds?: number;
  retryAttempt?: number;
  isLast?: boolean;
  isStreaming?: boolean;
  onRetry?: () => void;
  onContinue?: () => void;
}

export function ExecutionStatusDisclosure({
  status,
  error,
  errorId,
  retryAttempt,
  isLast,
  isStreaming,
  onContinue,
}: ExecutionStatusDisclosureProps) {
  // 1. User Cancellation (`status === 'aborted'`): calm static ghost text with zero buttons and zero chevrons
  if (status === 'aborted') {
    return (
      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-sans my-1 select-text">
        <span>User cancelled the agent.</span>
      </div>
    );
  }

  // 2. Network Drop & Reconnection Lifecycle: While retrying (attempts 1 to 3)
  if (retryAttempt && retryAttempt >= 1 && retryAttempt <= 3) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-sans my-1 select-none">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
        <span className="animate-silver-shine">Model retrying ({retryAttempt}/3)...</span>
      </div>
    );
  }

  // 3. Error Handling
  const effectiveError = error || (status === 'error' ? 'Agent execution was interrupted or encountered an unexpected error.' : null);

  if (effectiveError) {
    const classified = classifyError(effectiveError, errorId);

    // Suppress auth error card completely - auth expiration is an app-level state, not an in-turn execution error
    if (classified?.category === 'auth') {
      return null;
    }

    // Quota Error: Suppress intrusive crash box because QuotaBanner handles it docked above composer
    if (classified?.category === 'quota') {
      return (
        <div className="w-full text-xs text-zinc-500 dark:text-zinc-400 py-1.5 flex items-center gap-2 select-text font-sans">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>Baseline token quota reached. See quota banner below for refresh details.</span>
        </div>
      );
    }

    const isInternet =
      classified?.category === 'offline' ||
      classified?.category === 'network_lost' ||
      /internet|network|fetch|connection/i.test(effectiveError);

    if (isInternet) {
      return (
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-sans my-1 select-text">
          <span>Agent got interrupted due to internet error</span>
          {isLast && !isStreaming && onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="group inline-flex items-center gap-1.5 h-[21px] px-2.5 py-0 rounded-full font-sans text-[11px] font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-zinc-100/90 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20] shadow-2xs backdrop-blur-sm"
              title="Continue execution from where it was interrupted"
            >
              <Play size={8} className="fill-current text-sky-500 dark:text-sky-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span>Continue</span>
            </button>
          )}
        </div>
      );
    }

    // General / other errors: calm static ghost text with zero heavy card box, zero accordions, zero copy button
    const description = classified?.description || effectiveError;
    return (
      <div className="text-xs text-zinc-500 dark:text-zinc-400 font-sans my-1 select-text">
        <span>{description}</span>
      </div>
    );
  }

  return null;
}
