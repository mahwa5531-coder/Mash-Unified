"use client";

import React from 'react';
import { WifiOff, RotateCw, X } from 'lucide-react';

export interface OfflineToastProps {
  visible: boolean;
  isOffline?: boolean;
  syncError?: string;
  isRetrying?: boolean;
  onRetry?: () => void;
  onDismiss: () => void;
}

/** Floating top-right chat-pane notice shown while offline or when cloud sync fails. */
export function OfflineToast({
  visible,
  isOffline = true,
  syncError,
  isRetrying = false,
  onRetry,
  onDismiss,
}: OfflineToastProps) {
  if (!visible) return null;

  const heading = isOffline ? 'No internet connection' : 'Could not reach MASh Cloud';
  const subtitle = isOffline
    ? 'Local files & history remain available.'
    : syncError || 'Connection timed out.';

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-toast"
      className="pointer-events-auto absolute top-3 right-3 z-20 w-[290px] rounded-xl bg-white/95 dark:bg-[#17171a]/95 backdrop-blur-md border border-zinc-200 dark:border-white/[0.1] shadow-lg shadow-black/10 dark:shadow-black/50 p-3 font-sans select-none"
    >
      <div className="flex items-start gap-2.5">
        <WifiOff size={15} className="mt-0.5 shrink-0 text-amber-500 dark:text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100 leading-tight">
            {heading}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
            {subtitle}
          </p>
          {onRetry && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[11px] font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.07] dark:hover:bg-white/[0.12] text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer disabled:opacity-60"
              >
                <RotateCw size={11} className={isRetrying ? 'animate-spin' : ''} />
                <span>{isRetrying ? 'Retrying...' : 'Retry'}</span>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss offline notice"
          className="shrink-0 -mt-0.5 -mr-0.5 p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] cursor-pointer transition-colors"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
