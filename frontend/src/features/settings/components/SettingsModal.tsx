"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Moon, Monitor, Palette, Activity, User, RotateCw } from 'lucide-react';
import { fetchAuthMe, logoutUser, AuthUser } from '@/services/auth';
import { ThemeMode } from '../types';
import { SignOutConfirmDialog } from './SignOutConfirmDialog';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onThemeChange?: (isDark: boolean) => void;
  initialTab?: string;
  currentProjectName?: string;
  onProjectDeleted?: (projectName: string) => void;
  onSignOut?: () => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  onThemeChange,
  initialTab,
  onSignOut,
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const savedTheme = localStorage.getItem('mash_theme_settings');
      if (savedTheme) {
        const parsed = JSON.parse(savedTheme);
        if (parsed.mode) return parsed.mode;
      }
    } catch {}
    return 'dark';
  });
  const [authInfo, setAuthInfo] = useState<AuthUser | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'appearance' | 'usage' | 'account'>(
    initialTab === 'usage' ? 'usage' : initialTab === 'appearance' ? 'appearance' : 'account'
  );

  // Load auth state with optional fresh sync from cloud
  const loadAuth = async (fresh = false) => {
    if (fresh) setIsRefreshing(true);
    try {
      const info = await fetchAuthMe(fresh);
      if (info) setAuthInfo(info);
    } catch (err) {
      console.warn("Failed to load auth:", err);
    } finally {
      if (fresh) {
        setTimeout(() => setIsRefreshing(false), 500);
      }
    }
  };

  // Initial local state load
  useEffect(() => {
    setMounted(true);
    try {
      const savedTheme = localStorage.getItem('mash_theme_settings');
      if (savedTheme) {
        try {
          const parsed = JSON.parse(savedTheme);
          if (parsed.mode) setThemeMode(parsed.mode);
        } catch {}
      }
    } catch {}
  }, []);

  // When modal opens or tab changes, refresh auth live
  useEffect(() => {
    if (isOpen) {
      loadAuth(activeTab === 'usage');
    }
  }, [isOpen, activeTab]);

  // Apply theme dynamically to document root
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }
      onThemeChange?.(isDark);
    };

    try {
      localStorage.setItem('mash_theme_settings', JSON.stringify({ mode: themeMode }));
    } catch {}

    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mql.matches);
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    } else {
      applyTheme(themeMode === 'dark');
    }
  }, [themeMode, mounted, onThemeChange]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSignOut = async () => {
    setShowSignOutConfirm(false);
    await logoutUser();
    setAuthInfo(null);
    onClose();
    onSignOut?.();
  };

  if (!isOpen || !mounted) return null;

  const isPro = authInfo?.plan?.toLowerCase() === 'pro';

  const modalContent = (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#28282b] rounded-2xl shadow-2xl w-[760px] max-w-[95vw] h-[460px] flex overflow-hidden text-zinc-800 dark:text-zinc-200 select-none relative animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Stationary Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-50 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Close Settings"
        >
          <X size={16} />
        </button>

        {/* LEFT SIDEBAR NAVIGATION: 3 TABS (Appearance, Usage, Account) */}
        <div className="w-48 bg-zinc-50 dark:bg-[#0f0f11] border-r border-zinc-200 dark:border-[#242426] p-3 flex flex-col justify-between shrink-0">
          <div>
            <div className="px-3 pt-2 pb-4">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Settings</h2>
            </div>

            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab('appearance')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'appearance'
                    ? 'bg-white dark:bg-[#202023] text-zinc-900 dark:text-white shadow-xs border border-zinc-200/80 dark:border-white/[0.06]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
                }`}
              >
                <Palette size={14} />
                <span>Appearance</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('usage')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'usage'
                    ? 'bg-white dark:bg-[#202023] text-zinc-900 dark:text-white shadow-xs border border-zinc-200/80 dark:border-white/[0.06]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
                }`}
              >
                <Activity size={14} />
                <span>Usage</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('account')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'account'
                    ? 'bg-white dark:bg-[#202023] text-zinc-900 dark:text-white shadow-xs border border-zinc-200/80 dark:border-white/[0.06]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
                }`}
              >
                <User size={14} />
                <span>Account</span>
              </button>
            </nav>
          </div>

          {/* User Email Indicator at Sidebar Bottom */}
          <div className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-200/60 dark:border-white/[0.04] truncate font-mono">
            {authInfo?.email || 'Guest User'}
          </div>
        </div>

        {/* RIGHT CONTENT PANEL (pr-12 clearance for stationary close button) */}
        <div className="flex-1 p-6 pr-12 overflow-y-auto flex flex-col justify-between">

          {/* TAB 1: APPEARANCE (Clean V2 Segmented Switcher) */}
          {activeTab === 'appearance' && (
            <div className="space-y-4">
              <div className="border-b border-zinc-200 dark:border-[#242426] pb-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Appearance</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Select interface appearance mode</p>
              </div>

              <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl px-4 py-3.5 flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">Theme</span>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">Interface color scheme</p>
                </div>
                <div className="bg-zinc-200/70 dark:bg-[#0d0d0f] border border-zinc-300/60 dark:border-[#242426] p-1 rounded-lg flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setThemeMode('system')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      themeMode === 'system'
                        ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                    title="System Theme"
                  >
                    <Monitor size={13} />
                    <span>System</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeMode('light')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      themeMode === 'light'
                        ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                    title="Light Theme"
                  >
                    <Sun size={13} />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThemeMode('dark')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                      themeMode === 'dark'
                        ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                    }`}
                    title="Dark Theme"
                  >
                    <Moon size={13} />
                    <span>Dark</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: USAGE (Clean Gemini Circular Gauges Pattern) */}
          {activeTab === 'usage' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-1 border-b border-zinc-200 dark:border-[#242426]">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Usage Limits</h3>
                <button
                  type="button"
                  onClick={() => loadAuth(true)}
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
                                You have used some of your {isFiveHour ? '5-hour' : 'weekly'} limit, it will fully refresh at {new Date(win.resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                              </span>
                            ) : (
                              <span>
                                Continuous {isFiveHour ? '5-hour sliding burst limit' : '7-day rolling allocation'}.
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Percentage & Circular Gauge */}
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
          )}

          {/* TAB 3: ACCOUNT (Google Reference Pattern: Grouped Card + Manage Button + Legal) */}
          {activeTab === 'account' && (
            <div className="space-y-4">
              <div className="border-b border-zinc-200 dark:border-[#242426] pb-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">Account</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Manage your plan and credentials.</p>
              </div>

              <div>
                <span className="text-xs font-semibold text-zinc-900 dark:text-white">Account</span>
              </div>

              {/* Grouped Divided Card matching the Reference Image */}
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

                  {/* Plan Button (Manage for Pro, Upgrade for Free) */}
                  <div className="shrink-0">
                    {isPro ? (
                      <a
                        href="https://mahwa5531-coder.github.io/mash-website/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer inline-flex items-center"
                      >
                        Manage
                      </a>
                    ) : (
                      <a
                        href="https://mahwa5531-coder.github.io/mash-website/pricing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 px-3 py-1 rounded-md text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 transition-all cursor-pointer inline-flex items-center shadow-xs"
                      >
                        Upgrade
                      </a>
                    )}
                  </div>
                </div>

                {/* Row 2: Email Row */}
                <div className="p-3.5 flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[13px] font-medium text-zinc-900 dark:text-white">
                      Email
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate">
                      {authInfo?.email || 'No email attached'}
                    </div>
                  </div>

                  {/* Sign Out Button */}
                  <div className="shrink-0">
                    {authInfo?.authenticated && (
                      <button
                        type="button"
                        onClick={() => setShowSignOutConfirm(true)}
                        className="h-7 px-2.5 py-1 rounded-md text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer inline-flex items-center"
                      >
                        Sign Out
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Legal & Version Footnote matching Google Reference */}
              <div className="pt-3 text-[11.5px] text-zinc-500 dark:text-zinc-400">
                <span>By using this app, you agree to its </span>
                <a
                  href="https://mahwa5531-coder.github.io/mash-website/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline underline-offset-2"
                >
                  Terms of Service
                </a>
                <span> and </span>
                <a
                  href="https://mahwa5531-coder.github.io/mash-website/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white underline underline-offset-2"
                >
                  Privacy Policy
                </a>
                <span className="text-zinc-400 dark:text-zinc-600"> · </span>
                <span className="font-mono text-zinc-500">
                  v{typeof window !== 'undefined' && window.__MASH_DESKTOP__?.version ? window.__MASH_DESKTOP__.version : '0.1.0'}
                </span>
              </div>

            </div>
          )}

        </div>
      </div>

      <SignOutConfirmDialog
        isOpen={showSignOutConfirm}
        onConfirm={handleSignOut}
        onCancel={() => setShowSignOutConfirm(false)}
      />
    </div>
  );

  return createPortal(modalContent, document.body);
}
