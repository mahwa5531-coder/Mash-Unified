"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Palette, Activity, User } from 'lucide-react';
import { fetchAuthMe, getCachedSiteUrls, getSiteUrls, logoutUser, syncAuthUsage, AuthUser } from '@/services/auth';
import { ThemeMode } from '../types';
import { SignOutConfirmDialog } from './SignOutConfirmDialog';
import { SettingsAppearanceTab } from './SettingsAppearanceTab';
import { SettingsUsageTab } from './SettingsUsageTab';
import { SettingsAccountTab } from './SettingsAccountTab';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onThemeChange?: (isDark: boolean) => void;
  initialTab?: string;
  currentProjectName?: string;
  onProjectDeleted?: (projectName: string) => void;
  onSignOut?: () => void;
}

type SettingsTab = 'appearance' | 'usage' | 'account';

const TABS: Array<{ id: SettingsTab; label: string; Icon: typeof Palette }> = [
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'usage', label: 'Usage', Icon: Activity },
  { id: 'account', label: 'Account', Icon: User },
];

export default function SettingsModal({
  isOpen,
  onClose,
  onThemeChange,
  initialTab,
  onSignOut,
}: SettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [siteUrls, setSiteUrls] = useState(getCachedSiteUrls);
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
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab === 'usage' ? 'usage' : initialTab === 'appearance' ? 'appearance' : 'account'
  );

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab === 'usage' ? 'usage' : initialTab === 'appearance' ? 'appearance' : 'account');
    }
  }, [isOpen, initialTab]);

  const loadAuth = async (fresh = false) => {
    if (fresh) setIsRefreshing(true);
    try {
      const info = fresh ? await syncAuthUsage() : await fetchAuthMe(false);
      if (info) setAuthInfo(info);
    } catch (err) {
      console.warn("Failed to load auth:", err);
    } finally {
      if (fresh) {
        setTimeout(() => setIsRefreshing(false), 500);
      }
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    getSiteUrls().then(setSiteUrls).catch(() => {});
    const onAuthUpdated = (e: Event) => {
      const detail = (e as CustomEvent<AuthUser>).detail;
      if (detail) setAuthInfo(detail);
    };
    window.addEventListener('mash:auth_updated', onAuthUpdated);
    return () => window.removeEventListener('mash:auth_updated', onAuthUpdated);
  }, [isOpen]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadAuth(activeTab === 'usage');
    }
  }, [isOpen, activeTab]);

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
    }
    applyTheme(themeMode === 'dark');
  }, [themeMode, mounted, onThemeChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
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
        className="bg-white dark:bg-[#141416] border border-zinc-200 dark:border-[#28282b] rounded-2xl shadow-2xl w-[760px] max-w-[95vw] h-[460px] flex overflow-hidden text-zinc-800 dark:text-zinc-200 select-none relative animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-50 text-zinc-400 hover:text-zinc-900 dark:text-zinc-500 dark:hover:text-white p-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Close Settings"
        >
          <X size={16} />
        </button>

        {/* Left Sidebar Navigation */}
        <div className="w-48 bg-zinc-50 dark:bg-[#0f0f11] border-r border-zinc-200 dark:border-[#242426] p-3 flex flex-col justify-between shrink-0">
          <div>
            <div className="px-3 pt-2 pb-4">
              <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">Settings</h2>
            </div>

            <nav className="space-y-1">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    activeTab === id
                      ? 'bg-white dark:bg-[#202023] text-zinc-900 dark:text-white shadow-xs border border-zinc-200/80 dark:border-white/[0.06]'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 border-t border-zinc-200/60 dark:border-white/[0.04] truncate font-mono">
            {authInfo?.email || 'Guest User'}
          </div>
        </div>

        {/* Right Tab Panel */}
        <div className="flex-1 p-6 pr-12 overflow-y-auto flex flex-col justify-between">
          {activeTab === 'appearance' && (
            <SettingsAppearanceTab themeMode={themeMode} onSelectTheme={setThemeMode} />
          )}
          {activeTab === 'usage' && (
            <SettingsUsageTab authInfo={authInfo} isRefreshing={isRefreshing} onRefresh={() => loadAuth(true)} />
          )}
          {activeTab === 'account' && (
            <SettingsAccountTab
              authInfo={authInfo}
              siteUrls={siteUrls}
              onRequestSignOut={() => setShowSignOutConfirm(true)}
            />
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
