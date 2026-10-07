"use client";

import React from 'react';
import { Settings, User } from 'lucide-react';
import type { AuthUser } from '@/services/auth';

export interface SidebarFooterProps {
  onOpenSettings?: (tab?: string) => void;
  authUser?: AuthUser | null;
}

export function SidebarFooter({ onOpenSettings, authUser }: SidebarFooterProps) {
  const initial = ((authUser?.name || authUser?.email || 'U').charAt(0) || 'U').toUpperCase();
  const displayName = authUser?.name || authUser?.email?.split('@')[0] || 'Account';
  const planName = (authUser?.plan || 'pro').toUpperCase();

  return (
    <div className="mt-auto p-2 bg-zinc-100/80 dark:bg-[#121214] shrink-0 border-t border-zinc-200/50 dark:border-white/[0.04] flex items-center justify-between gap-1.5">
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
              {((authUser?.quota?.windows?.[0]?.percent ?? authUser?.quota?.windows?.[0]?.used_percent) !== undefined) && (
                <span className="text-[9.5px] text-zinc-400 dark:text-zinc-500">
                  · {authUser?.quota?.windows?.[0]?.percent ?? authUser?.quota?.windows?.[0]?.used_percent}%
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
          title="Sign in to your MASh account"
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
