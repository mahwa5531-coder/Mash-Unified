"use client";

import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface InvalidMediaBannerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  onDismiss?: () => void;
  className?: string;
}

/**
 * InvalidMediaBanner Primitive
 * 
 * Faithful implementation matching the Antigravity attachment limit error banner.
 * Sits directly above the chat composer dock when more than 5 attachments are attempted.
 */
export function InvalidMediaBanner({
  open = true,
  onOpenChange,
  title = "Invalid Media",
  description = "Maximum number of attachments reached",
  onDismiss,
  className,
}: InvalidMediaBannerProps) {
  if (!open) return null;

  const handleDismiss = () => {
    onDismiss?.();
    onOpenChange?.(false);
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "w-full rounded-2xl px-4 py-3 sm:px-4.5 sm:py-3.5 select-text font-sans text-left transition-all",
        "bg-[#1c1c1f] dark:bg-[#1a1a1c] border border-zinc-300/80 dark:border-white/[0.08] shadow-lg",
        className
      )}
    >
      {/* Top Header Row: Red Warning Icon + Title + Close Button */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Authentic red exclamation mark circle icon matching Antigravity */}
          <svg 
            width="15" 
            height="15" 
            viewBox="0 0 16 16" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="text-[#ef4444] dark:text-[#f87171] shrink-0 select-none"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.75v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11.25" r="0.75" fill="currentColor" />
          </svg>

          <span className="text-[13.5px] font-medium text-zinc-100 dark:text-[#ececed] tracking-tight truncate">
            {title}
          </span>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-0.5 cursor-pointer select-none rounded focus:outline-none"
          title="Dismiss"
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>

      {/* Description row */}
      <p className="text-[13px] text-zinc-400 dark:text-[#9e9ea4] leading-relaxed mt-1">
        {description}
      </p>
    </div>
  );
}

export default InvalidMediaBanner;
