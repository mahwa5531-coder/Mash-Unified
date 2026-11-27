"use client";

import React from 'react';
import { RotateCw } from 'lucide-react';
import { AuthUser } from '@/services/auth';

interface SettingsUsageTabProps {
  authInfo: AuthUser | null;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function SettingsUsageTab({ authInfo, isRefreshing, onRefresh }: SettingsUsageTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-1 border-b border-zinc-200 dark:border-[#242426]">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Usage Limits</h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer disabled:opacity-50"
          title="Sync live usage from cloud"
        >
          <RotateCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {authInfo?.quota?.windows && authInfo.quota.windows.length > 0 ? (
        <div className="border border-zinc-200 dark:border-[#28282b] bg-zinc-50/50 dark:bg-[#121214] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242427]">
          {authInfo.quota.windows.map((win) => {
            const usedPct = win.percent ?? win.used_percent ?? 0;
            const remainingPct = Math.max(0, Math.min(100, 100 - usedPct));
            const isFiveHour = win.window === '5h';
            // Circumference for r=12 is ~75.4
            const strokeDashoffset = 75.4 * (1 - remainingPct / 100);

            return (
              <div key={win.window} className="p-3.5 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-[13px] font-medium text-zinc-900 dark:text-white">
                    {isFiveHour ? 'Five Hour Limit Remaining' : 'Weekly Limit Remaining'}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {win.resets_at ? (
                      <span>
                        You have used some of your {isFiveHour ? '5-hour' : 'weekly'} limit, it will fully refresh at{' '}
                        {new Date(win.resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                      </span>
                    ) : (
                      <span>Continuous {isFiveHour ? '5-hour sliding burst limit' : '7-day rolling allocation'}.</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-xs font-semibold font-mono text-zinc-900 dark:text-white">
                    {remainingPct}%
                  </span>
                  <div className="relative w-5 h-5 flex items-center justify-center">
                    <svg className="w-5 h-5 -rotate-90" viewBox="0 0 32 32">
                      <circle
                        cx="16"
                        cy="16"
                        r="12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-zinc-200 dark:text-[#28282c]"
                      />
                      <circle
                        cx="16"
                        cy="16"
                        r="12"
                        fill="none"
                        stroke="#65a30d"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray="75.4"
                        strokeDashoffset={strokeDashoffset}
                        className="transition-all duration-500"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="border border-zinc-200 dark:border-[#28282b] bg-zinc-50/50 dark:bg-[#121214] rounded-xl p-4 text-center text-zinc-500 dark:text-zinc-400 text-xs">
          {authInfo?.authenticated ? 'No active quota restrictions on this account.' : 'Sign in to view live rolling token quotas.'}
        </div>
      )}
    </div>
  );
}
