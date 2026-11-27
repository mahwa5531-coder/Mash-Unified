"use client";

import React from 'react';
import { AuthUser, SiteUrls, markPricingOpened } from '@/services/auth';

interface SettingsAccountTabProps {
  authInfo: AuthUser | null;
  siteUrls: SiteUrls;
  onRequestSignOut: () => void;
}

export function SettingsAccountTab({ authInfo, siteUrls, onRequestSignOut }: SettingsAccountTabProps) {
  const isPro = authInfo?.plan?.toLowerCase() === 'pro';
  const appVersion =
    typeof window !== 'undefined' && window.__MASH_DESKTOP__?.version ? window.__MASH_DESKTOP__.version : '0.1.0';

  return (
    <div className="space-y-4">
      <div className="border-b border-zinc-200 dark:border-[#242426] pb-3">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Account</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Manage your plan and credentials.</p>
      </div>

      <div>
        <span className="text-xs font-semibold text-zinc-900 dark:text-white">Account</span>
      </div>

      <div className="border border-zinc-200 dark:border-[#28282b] bg-zinc-50/50 dark:bg-[#121214] rounded-xl overflow-hidden divide-y divide-zinc-200 dark:divide-[#242427]">
        {/* Row 1: Plan Row */}
        <div className="p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-[13px] font-medium text-zinc-900 dark:text-white flex items-center gap-1.5">
              <span>Your Plan:</span>
              <span className="font-semibold text-zinc-900 dark:text-white">
                {isPro ? 'Pro' : 'Free'}
              </span>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {isPro
                ? 'Active monthly subscription via Razorpay.'
                : 'You can upgrade to a Pro plan to receive higher rate limits.'}
            </div>
          </div>

          <div className="shrink-0">
            <a
              href={siteUrls.pricingUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={markPricingOpened}
              className={
                isPro
                  ? 'h-7 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer inline-flex items-center'
                  : 'h-7 px-3 py-1 rounded-md text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-all cursor-pointer inline-flex items-center shadow-xs'
              }
            >
              {isPro ? 'Manage' : 'Upgrade'}
            </a>
          </div>
        </div>

        {/* Row 2: Email Row */}
        <div className="p-3.5 flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <div className="text-[13px] font-medium text-zinc-900 dark:text-white">Email</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
              {authInfo?.email || 'No email attached'}
            </div>
          </div>

          <div className="shrink-0">
            {authInfo?.authenticated && (
              <button
                type="button"
                onClick={onRequestSignOut}
                className="h-7 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer inline-flex items-center"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Legal & Version Footnote */}
      <div className="pt-3 text-[11.5px] text-zinc-500 dark:text-zinc-400">
        <span>By using this app, you agree to its </span>
        <a
          href={`${siteUrls.websiteUrl}/terms`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline underline-offset-2"
        >
          Terms of Service
        </a>
        <span> and </span>
        <a
          href={`${siteUrls.websiteUrl}/privacy`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline underline-offset-2"
        >
          Privacy Policy
        </a>
        <span className="text-zinc-400 dark:text-zinc-600"> · </span>
        <span className="font-mono text-zinc-500">v{appVersion}</span>
      </div>
    </div>
  );
}
