"use client";

import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuotaBannerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Title of the quota notification */
  title?: string;
  /** Dynamic refresh / renewal date or timestamp (e.g. ISO string or Date) */
  refreshDate?: string | Date;
  /** Custom description override (if not using dynamic refresh text) */
  description?: string;
  /** Action callbacks */
  onSeePlans?: () => void;
  onEnableOverages?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * QuotaBanner Primitive
 * 
 * Faithful 1:1 implementation matching the Antigravity/Mash quota completion banner.
 * Sits directly above the chat composer dock.
 * Displays dynamic baseline quota refresh date/time and provides 'See Plans' & 'Enable Overages' actions.
 */
export function QuotaBanner({
  open = true,
  onOpenChange,
  title = "Baseline model quota reached",
  refreshDate,
  description,
  onSeePlans,
  onEnableOverages,
  onDismiss,
  className,
}: QuotaBannerProps) {
  if (!open) return null;

  const handleDismiss = () => {
    onDismiss?.();
    onOpenChange?.(false);
  };

  // Format dynamic renewal date and time (e.g. "9/17/2026, 2:58:31 PM")
  const formattedRefreshTime = useMemo(() => {
    if (!refreshDate) {
      // Default dynamic fallback: computes upcoming rolling refresh
      const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`;
    }
    if (typeof refreshDate === 'string') {
      const d = new Date(refreshDate);
      if (!isNaN(d.getTime())) {
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`;
      }
      return refreshDate;
    }
    return `${refreshDate.getMonth() + 1}/${refreshDate.getDate()}/${refreshDate.getFullYear()}, ${refreshDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`;
  }, [refreshDate]);

  const bodyText = description || `Your plan's baseline quota will refresh on ${formattedRefreshTime}. To continue using this model now, enable AI Credit overages.`;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "w-full rounded-2xl p-4 sm:p-4.5 select-text font-sans text-left transition-all",
        "bg-[#1c1c1f] dark:bg-[#1a1a1c] border border-zinc-300/80 dark:border-white/[0.08] shadow-lg",
        className
      )}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {/* Subtle amber quota badge icon matching Antigravity screenshot */}
          <svg 
            width="15" 
            height="15" 
            viewBox="0 0 16 16" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="text-amber-400 shrink-0 select-none"
          >
            <rect x="2" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 7h6M5 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>

          <span className="text-[13.5px] font-medium text-zinc-100 tracking-tight truncate">
            {title}
          </span>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          className="text-zinc-400 hover:text-zinc-200 transition-colors p-0.5 cursor-pointer select-none rounded"
          title="Dismiss"
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>

      {/* Description text with dynamic renewal date/time */}
      <p className="text-[13px] text-zinc-400 dark:text-[#a1a1aa] leading-relaxed mt-1.5 mb-3.5">
        {bodyText}
      </p>

      {/* Action Buttons Row (Right Aligned) */}
      <div className="flex items-center justify-end gap-2 select-none">
        <button
          type="button"
          onClick={onSeePlans}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.06] transition-colors cursor-pointer"
        >
          See Plans
        </button>

        <button
          type="button"
          onClick={onEnableOverages}
          className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-white bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#174ea6] transition-colors cursor-pointer shadow-xs"
        >
          Enable Overages
        </button>
      </div>
    </div>
  );
}

export default QuotaBanner;
