"use client";

import React from 'react';
import type { AuthUser } from '@/services/auth';

interface AccountTabProps {
  authInfo: AuthUser | null;
  telemetryEnabled: boolean;
  marketingEmailsEnabled: boolean;
  onToggleTelemetry: () => void;
  onToggleMarketing: () => void;
  onShowSignOutConfirm: () => void;
}

export function AccountTab({
  authInfo,
  telemetryEnabled,
  marketingEmailsEnabled,
  onToggleTelemetry,
  onToggleMarketing,
  onShowSignOutConfirm,
}: AccountTabProps) {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">Account</h2>
        <p className="text-xs text-zinc-500 dark:text-[#71717a] mt-0.5">Manage your plan, credentials, and desktop preferences.</p>
      </div>

      {/* General Section */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">General</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242426]">
          {/* Enable Telemetry */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Enable Telemetry</div>
              <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                When toggled on, MASH collects anonymous usage telemetry to improve agent accuracy and latency.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={telemetryEnabled}
              onClick={onToggleTelemetry}
              className={`w-11 h-6 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                telemetryEnabled ? 'bg-[#007acc]' : 'bg-zinc-300 dark:bg-[#28282b]'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                  telemetryEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Marketing Emails */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Product Updates</div>
              <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                Receive product updates, tips, and release notices from MASH via email.
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={marketingEmailsEnabled}
              onClick={onToggleMarketing}
              className={`w-11 h-6 shrink-0 rounded-full transition-colors relative cursor-pointer ${
                marketingEmailsEnabled ? 'bg-[#007acc]' : 'bg-zinc-300 dark:bg-[#28282b]'
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                  marketingEmailsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Account Section */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Account</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242426]">
          {/* Your Plan */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">
                Your Plan: {authInfo?.plan ? `MASH ${authInfo.plan.toUpperCase()}` : 'MASH Pro'}
              </div>
              <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal">
                {authInfo?.credits_remaining !== undefined ? `${authInfo.credits_remaining} credits available for code generation and audit runs.` : 'Pro plan active with full workspace access.'}
              </div>
            </div>
          </div>

          {/* Email & Sign Out */}
          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-zinc-800 dark:text-white">Email</div>
              <div className="text-[11.5px] text-zinc-500 dark:text-[#71717a] mt-0.5 leading-normal font-mono">
                {authInfo?.email || 'malli@mash.ai'}
              </div>
            </div>
            <button
              type="button"
              onClick={onShowSignOutConfirm}
              className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-600 dark:text-red-400 text-xs font-medium rounded-lg border border-red-500/20 transition-colors cursor-pointer shrink-0"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Footer Agreement */}
      <div className="pt-2 text-xs text-[#71717a]">
        By using this app, you agree to its{' '}
        <a
          href="https://policies.google.com/terms"
          target="_blank"
          rel="noreferrer"
          className="text-[#007acc] hover:underline cursor-pointer"
        >
          Terms of Service
        </a>
      </div>
    </div>
  );
}
