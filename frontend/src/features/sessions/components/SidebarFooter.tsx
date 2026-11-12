"use client";

import React from 'react';
import { Settings, User } from 'lucide-react';
import type { AuthUser } from '@/services/auth';

export interface SidebarFooterProps {
  onOpenSettings?: (tab?: string) => void;
  authUser?: AuthUser | null;
  /** True whenever session list overflows/scrolls so footer differentiates softly instead of colliding. */
  isScrolled?: boolean;
  /** True when more sessions lie below the fold. */
  canScrollDown?: boolean;
}

export function SidebarFooter({
  onOpenSettings,
  authUser,
  isScrolled = false,
  canScrollDown = false,
}: SidebarFooterProps) {
  const initial = ((authUser?.name || authUser?.email || 'U').charAt(0) || 'U').toUpperCase();
  const displayName = authUser?.name || authUser?.email?.split('@')[0] || 'Account';
  const planName = (authUser?.plan || 'Free').toUpperCase();

  const maxQuotaPercent = React.useMemo(() => {
    const windows = authUser?.quota?.windows;
    if (!Array.isArray(windows) || windows.length === 0) return null;
    let max = -1;
    for (const w of windows) {
      const val = w.percent ?? w.used_percent;
      if (typeof val === 'number' && val > max) max = val;
    }
    return max >= 0 ? Math.round(max) : null;
  }, [authUser?.quota?.windows]);

  return (
    <div
      data-testid="sidebar-footer"
      data-scrolled={isScrolled ? 'true' : 'false'}
      className={`mt-auto p-2 bg-[var(--bg-sidebar)] shrink-0 border-t transition-[border-color,box-shadow] duration-150 flex items-center justify-between gap-1.5 relative z-20 ${
        isScrolled
          ? `border-zinc-200/80 dark:border-white/[0.07] ${
              canScrollDown
                ? 'shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.06)] dark:shadow-[0_-6px_16px_-4px_rgba(0,0,0,0.4)]'
                : ''
            }`
          : 'border-transparent'
      }`}
    >
      {authUser?.authenticated ? (
        <button
          type="button"
          onClick={() => onOpenSettings?.('account')}
          className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] text-left transition-colors cursor-pointer group"
          title={`${displayName} (${planName})`}
        >
          <div className="w-6 h-6 rounded-full bg-zinc-800 dark:bg-zinc-700 text-zinc-100 flex items-center justify-center text-[11px] font-semibold shrink-0 border border-zinc-700/60 dark:border-white/10">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate group-hover:text-zinc-900 dark:group-hover:text-white">
              {displayName}
            </div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono flex items-center gap-1">
              <span>{planName}</span>
              {maxQuotaPercent !== null && (
                <span className="text-[9.5px] text-zinc-400 dark:text-zinc-500">
                  · {maxQuotaPercent}%
                </span>
              )}
            </div>
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpenSettings?.('account')}
          className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs font-medium transition-colors cursor-pointer"
          title="Sign in to your MASH account"
        >
          <User size={14} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
          <span className="truncate">Sign In</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => onOpenSettings?.('appearance')}
        className="p-1.5 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer shrink-0"
        title="Settings"
        aria-label="Settings"
      >
        <Settings size={15} />
      </button>
    </div>
  );
}

export default SidebarFooter;
