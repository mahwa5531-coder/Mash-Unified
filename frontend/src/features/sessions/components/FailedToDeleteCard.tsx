"use client";

import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FailedToDeleteCardProps {
  title?: string;
  message?: string;
  onClose: () => void;
  className?: string;
}

/**
 * FailedToDeleteCard Component
 * 
 * Calm ghost card styling matching Mash's authentic color grading:
 * - border-zinc-200/80 dark:border-white/[0.08]
 * - bg-white dark:bg-[#18181b]
 * - shadow-lg
 * - rose/red accent icon
 * - clear error message
 * - clean close button [X]
 */
export function FailedToDeleteCard({
  title = "Failed to delete",
  message = "Could not delete on the backend. Please try again.",
  onClose,
  className,
}: FailedToDeleteCardProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "w-full rounded-2xl px-4 py-3 select-text font-sans text-left transition-all",
        "bg-white dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.08] shadow-lg",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1 rounded-md bg-rose-500/10 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5">
            <AlertCircle size={15} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 tracking-tight">
              {title}
            </span>
            <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5 break-words">
              {message}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-1 cursor-pointer rounded focus:outline-none shrink-0"
          title="Close"
          aria-label="Close error notice"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default FailedToDeleteCard;
