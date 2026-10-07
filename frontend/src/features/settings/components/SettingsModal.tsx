"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Moon, Monitor, LogOut, Palette, Activity, User } from 'lucide-react';
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
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [authInfo, setAuthInfo] = useState<AuthUser | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'appearance' | 'usage' | 'account'>(
    initialTab === 'usage' ? 'usage' : initialTab === 'account' ? 'account' : 'appearance'
  );

  // Load auth state
  const loadAuth = async () => {
    try {
      const info = await fetchAuthMe();
      if (info) setAuthInfo(info);
    } catch (err) {
      console.warn("Failed to load auth:", err);
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

  // When modal opens, refresh auth
  useEffect(() => {
    if (isOpen) {
      loadAuth();
    }
  }, [isOpen]);

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

    if (themeMode === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mql.matches);
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    } else {
      applyTheme(themeMode === 'dark');
    }

    try {
      localStorage.setItem('mash_theme_settings', JSON.stringify({ mode: themeMode }));
    } catch {}
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

  const modalContent = (
    <div 
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#28282b] rounded-2xl shadow-2xl w-[500px] max-w-[95vw] flex flex-col overflow-hidden text-zinc-800 dark:text-zinc-200 select-none relative animate-in zoom-in-95 duration-150"
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

        {/* Modal Header */}
        <div className="px-6 pt-5 pb-3 border-b border-zinc-200 dark:border-[#242426] shrink-0">
          <h2 className="text-[17px] font-semibold text-zinc-900 dark:text-white">Settings</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Preferences, rolling usage, and account control
          </p>
        </div>

        {/* Settings Body with Tabs */}
        <div className="p-6 space-y-4 text-xs">
          
          {/* TAB NAVIGATION BAR (Clean, same color grade as main app) */}
          <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'appearance'
                  ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Palette size={13} />
              <span>Appearance</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('usage')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'usage'
                  ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Activity size={13} />
              <span>Usage</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('account')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'account'
                  ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <User size={13} />
              <span>Account</span>
            </button>
          </div>

          {/* TAB 1: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-3">
              <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl px-4 py-3.5 flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">Theme</span>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">Select interface appearance mode</p>
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

          {/* TAB 2: USAGE (Clean, monochrome color grade, percentage ONLY) */}
          {activeTab === 'usage' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-0.5">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-white">
                    Rolling Token Quotas
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    Live enforcement across rolling 5-hour and 7-day accounting windows.
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 border border-zinc-200/80 dark:border-white/[0.08]">
                  {authInfo?.plan?.toUpperCase() || 'PRO'}
                </span>
              </div>

              {authInfo?.quota?.windows && authInfo.quota.windows.length > 0 ? (
                <div className="space-y-2.5">
                  {authInfo.quota.windows.map((win) => {
                    const pct = win.percent ?? win.used_percent ?? 0;
                    return (
                      <div
                        key={win.window}
                        className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl p-3.5 text-xs"
                      >
                        <div className="flex justify-between items-center mb-1.5 text-[11px]">
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">
                            {win.window === '5h' ? '5-Hour Burst Limit' : 'Weekly Allocation'}
                          </span>
                          {/* Percentage ONLY - clean, no raw token counts */}
                          <span className="font-mono text-zinc-700 dark:text-zinc-300 font-semibold">
                            {pct}%
                          </span>
                        </div>

                        {/* Clean unified color grade progress bar (monochrome / subtle dark accent, NO neon circus) */}
                        <div className="w-full bg-zinc-200 dark:bg-white/[0.08] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-zinc-800 dark:bg-zinc-200 transition-all duration-300"
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>

                      <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-zinc-500 dark:text-zinc-400">
                        <span>
                          {win.window === '5h'
                            ? 'Resets continuously every 5 rolling hours'
                            : 'Rolling 7-day budget window'}
                        </span>
                        {win.resets_at && (
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            Unlocks at {new Date(win.resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                </div>
              ) : (
                <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl p-4 text-center text-zinc-500 dark:text-zinc-400 text-xs">
                  {authInfo?.authenticated ? 'No active quota restrictions on this tier.' : 'Sign in to view live rolling token quotas.'}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ACCOUNT & SESSION */}
          {activeTab === 'account' && (
            <div className="space-y-3">
              <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200/80 dark:border-white/[0.06] rounded-xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-zinc-700 dark:bg-zinc-800 border border-zinc-600 dark:border-zinc-700 text-white flex items-center justify-center text-sm font-semibold shrink-0 shadow-xs">
                    {((authInfo?.name || authInfo?.email || 'User').charAt(0) || 'U').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-900 dark:text-white truncate">
                      {authInfo?.name || 'Authenticated User'}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono truncate">
                      {authInfo?.email || 'No email attached'}
                    </div>
                    <div className="text-[10.5px] text-zinc-600 dark:text-zinc-400 font-medium mt-0.5">
                      Plan: MASH {authInfo?.plan?.toUpperCase() || 'PRO'}
                      {authInfo?.subscription_status ? ` (${authInfo.subscription_status})` : ''}
                    </div>
                  </div>
                </div>

                {authInfo?.authenticated && (
                  <button
                    type="button"
                    onClick={() => setShowSignOutConfirm(true)}
                    className="px-3 py-1.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] active:bg-zinc-300 dark:active:bg-white/[0.15] text-zinc-700 dark:text-zinc-300 text-xs font-medium rounded-lg border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                    title="Sign out of MASH"
                  >
                    <LogOut size={13} />
                    <span>Sign Out</span>
                  </button>
                )}
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
