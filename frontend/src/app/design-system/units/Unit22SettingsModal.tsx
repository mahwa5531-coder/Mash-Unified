"use client";

import React, { useState } from 'react';
import SettingsModal from '@/features/settings/components/SettingsModal';
import { Settings } from 'lucide-react';

export function Unit22SettingsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [themeStatus, setThemeStatus] = useState<string>('Default (Dark)');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">22</span>
          <span>Unified Settings Modal (&lt;SettingsModal /&gt;)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/features/settings/components/SettingsModal.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1">
          <div>
            <strong className="text-[var(--m-text-primary)]">Consolidated Single-Dialog Architecture:</strong> Replaced the 5 bloated sub-tab files (`AppearanceTab`, `ProjectTab`, `AccountTab`, `GeneralTab`, `ColorField`) with one unified modal.
          </div>
          <div className="text-[11.5px] font-mono text-zinc-400">
            • <strong>Appearance Section</strong>: Fast 3-segment switcher [ System | Light | Dark ] without custom HEX clutter.
            <br />
            • <strong>Account & Session</strong>: User Profile, Active Plan badge, credits balance, and prominent Sign Out confirmation button.
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--m-accent)] hover:bg-[var(--m-accent-hover)] text-white text-xs font-medium cursor-pointer shadow-sm transition-all"
          >
            <Settings size={14} />
            <span>Open Unified Settings Modal</span>
          </button>
          <span className="text-xs text-[var(--m-text-muted)] font-mono">
            Theme state: {themeStatus}
          </span>
        </div>

        <SettingsModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onThemeChange={(isDark) => setThemeStatus(isDark ? 'Dark Mode' : 'Light Mode')}
          onSignOut={() => alert('Sign out clicked — would redirect to /sign-in in production')}
        />
      </div>
    </section>
  );
}
