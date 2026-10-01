"use client";

import React from 'react';
import { Monitor, Sun, Moon, ChevronDown } from 'lucide-react';
import { ColorField } from '../ColorField';
import type { ThemeConfig } from '../../types';

interface AppearanceTabProps {
  theme: ThemeConfig;
  setTheme: React.Dispatch<React.SetStateAction<ThemeConfig>>;
  onUpdateDark: (field: 'background' | 'foreground' | 'accent', value: string) => void;
  onUpdateLight: (field: 'background' | 'foreground' | 'accent', value: string) => void;
}

export function AppearanceTab({
  theme,
  setTheme,
  onUpdateDark,
  onUpdateLight,
}: AppearanceTabProps) {
  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">Appearance</h2>

      {/* Theme Selector Row */}
      <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl px-4 py-3.5 flex items-center justify-between">
        <span className="text-[13px] font-normal text-zinc-700 dark:text-zinc-300">Theme</span>
        <div className="bg-zinc-100 dark:bg-[#0d0d0f] border border-zinc-200 dark:border-[#242426] p-1 rounded-lg flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTheme(prev => ({ ...prev, mode: 'system' }))}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              theme.mode === 'system' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            title="System Default"
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            onClick={() => setTheme(prev => ({ ...prev, mode: 'light' }))}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              theme.mode === 'light' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            title="Light Theme"
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            onClick={() => setTheme(prev => ({ ...prev, mode: 'dark' }))}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              theme.mode === 'dark' ? 'bg-white dark:bg-[#28282b] text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
            title="Dark Theme"
          >
            <Moon size={14} />
          </button>
        </div>
      </div>

      {/* Light Theme Card */}
      <div>
        <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Light Theme</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#27272a] overflow-hidden text-xs">
          {/* Preset */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">Preset</span>
            <div className="relative">
              <select
                value={theme.light.preset}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'Default Light') {
                    setTheme(prev => ({
                      ...prev,
                      light: { preset: 'Default Light', background: '#F9F9F9', foreground: '#101010', accent: '#007ACC' }
                    }));
                  } else if (val === 'Pure White') {
                    setTheme(prev => ({
                      ...prev,
                      light: { preset: 'Pure White', background: '#FFFFFF', foreground: '#111111', accent: '#007ACC' }
                    }));
                  }
                }}
                className="appearance-none bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] text-zinc-800 dark:text-zinc-200 rounded-lg pl-3 pr-7 py-1.5 text-xs outline-none cursor-pointer transition-colors"
              >
                <option value="Default Light">Default Light</option>
                <option value="Pure White">Pure White</option>
                {theme.light.preset === 'Custom' && <option value="Custom">Custom</option>}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          <ColorField
            label="Background"
            value={theme.light.background}
            onChange={(val) => onUpdateLight('background', val)}
          />

          <ColorField
            label="Foreground"
            value={theme.light.foreground}
            onChange={(val) => onUpdateLight('foreground', val)}
          />

          <ColorField
            label="Accent"
            value={theme.light.accent}
            onChange={(val) => onUpdateLight('accent', val)}
          />
        </div>
      </div>

      {/* Dark Theme Card */}
      <div>
        <h3 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Dark Theme</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl divide-y divide-zinc-200 dark:divide-[#27272a] overflow-hidden text-xs">
          {/* Preset */}
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-zinc-700 dark:text-zinc-300 font-normal text-[13px]">Preset</span>
            <div className="relative">
              <select
                value={theme.dark.preset}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'Default Dark') {
                    setTheme(prev => ({
                      ...prev,
                      dark: { preset: 'Default Dark', background: '#101010', foreground: '#CCCCCC', accent: '#007ACC' }
                    }));
                  } else if (val === 'OLED Black') {
                    setTheme(prev => ({
                      ...prev,
                      dark: { preset: 'OLED Black', background: '#000000', foreground: '#EDEDED', accent: '#007ACC' }
                    }));
                  } else if (val === 'Antigravity Grey') {
                    setTheme(prev => ({
                      ...prev,
                      dark: { preset: 'Antigravity Grey', background: '#141416', foreground: '#EDEDED', accent: '#007ACC' }
                    }));
                  }
                }}
                className="appearance-none bg-white dark:bg-[#202023] hover:bg-zinc-100 dark:hover:bg-[#252529] border border-zinc-200 dark:border-[#2e2e32] hover:border-zinc-300 dark:hover:border-[#3e3e44] text-zinc-800 dark:text-zinc-200 rounded-lg pl-3 pr-7 py-1.5 text-xs outline-none cursor-pointer transition-colors"
              >
                <option value="Default Dark">Default Dark</option>
                <option value="OLED Black">OLED Black</option>
                <option value="Antigravity Grey">Antigravity Grey</option>
                {theme.dark.preset === 'Custom' && <option value="Custom">Custom</option>}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          <ColorField
            label="Background"
            value={theme.dark.background}
            onChange={(val) => onUpdateDark('background', val)}
          />

          <ColorField
            label="Foreground"
            value={theme.dark.foreground}
            onChange={(val) => onUpdateDark('foreground', val)}
          />

          <ColorField
            label="Accent"
            value={theme.dark.accent}
            onChange={(val) => onUpdateDark('accent', val)}
          />
        </div>
      </div>
    </div>
  );
}
