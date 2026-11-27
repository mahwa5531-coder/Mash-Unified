"use client";

import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { ThemeMode } from '../types';

interface SettingsAppearanceTabProps {
  themeMode: ThemeMode;
  onSelectTheme: (mode: ThemeMode) => void;
}

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; title: string; Icon: typeof Monitor }> = [
  { mode: 'system', label: 'System', title: 'System Theme', Icon: Monitor },
  { mode: 'light', label: 'Light', title: 'Light Theme', Icon: Sun },
  { mode: 'dark', label: 'Dark', title: 'Dark Theme', Icon: Moon },
];

export function SettingsAppearanceTab({ themeMode, onSelectTheme }: SettingsAppearanceTabProps) {
  return (
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
          {THEME_OPTIONS.map(({ mode, label, title, Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSelectTheme(mode)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                themeMode === mode
                  ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
              title={title}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
