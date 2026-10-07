"use client";

import React, { useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { MashBrandIcon } from '@/primitives/MashBrandIcon';

interface WindowTitleBarProps {
  onToggleFullscreen?: () => void;
  title?: string;
}

/**
 * Native-style Desktop Window Titlebar for Mash.
 *
 * Implements Microsoft Visual Studio Code & Windows custom titlebar specifications:
 * - Height: 30px (h-[30px]) - sleek, space-efficient desktop IDE height.
 * - Click targets: 46px x 30px per control button (VS Code workbench standard).
 * - Icon sizes: 11px-14px with strokeWidth 1.5 for crisp, elegant rendering.
 * - Draggable region: data-tauri-drag-region and WebkitAppRegion: 'drag' for native window movement.
 * - Wired to Tauri, Electron, and PyWebView native window APIs with graceful browser fallback.
 */
export function WindowTitleBar({
  onToggleFullscreen,
  title = "Mash — Autonomous Financial Forensic Auditor",
}: WindowTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => {
    if (typeof window !== 'undefined') {
      const w = window as any;
      // 1. Tauri Native IPC
      if (w.__TAURI__?.window?.appWindow) {
        w.__TAURI__.window.appWindow.minimize();
        return;
      }
      // 2. Electron Native IPC
      if (w.electronAPI?.minimize) {
        w.electronAPI.minimize();
        return;
      }
      // 3. PyWebView Native API
      if (w.pywebview?.api?.minimize) {
        w.pywebview.api.minimize();
        return;
      }
    }
    // In browser mode, window minimization cannot be forced by script without desktop IPC.
    // Safe no-op without disruptive side-effects.
  };

  const handleMaximize = () => {
    if (typeof window !== 'undefined') {
      const w = window as any;
      // 1. Tauri Native IPC
      if (w.__TAURI__?.window?.appWindow) {
        w.__TAURI__.window.appWindow.toggleMaximize().then(() => {
          setIsMaximized((v) => !v);
        }).catch(() => {});
        return;
      }
      // 2. Electron Native IPC
      if (w.electronAPI?.maximize) {
        w.electronAPI.maximize();
        setIsMaximized((v) => !v);
        return;
      }
      // 3. PyWebView Native API
      if (w.pywebview?.api?.toggle_maximize) {
        w.pywebview.api.toggle_maximize();
        setIsMaximized((v) => !v);
        return;
      }
    }
    // Browser fullscreen fallback
    setIsMaximized((v) => !v);
    if (onToggleFullscreen) onToggleFullscreen();
  };

  const handleClose = () => {
    if (typeof window !== 'undefined') {
      const w = window as any;
      // 1. Tauri Native IPC
      if (w.__TAURI__?.window?.appWindow) {
        w.__TAURI__.window.appWindow.close();
        return;
      }
      // 2. Electron Native IPC
      if (w.electronAPI?.close) {
        w.electronAPI.close();
        return;
      }
      // 3. PyWebView Native API
      if (w.pywebview?.api?.close) {
        w.pywebview.api.close();
        return;
      }
      // Browser fallback: gracefully attempt script window close without wiping conversation context
      try {
        window.close();
      } catch {
        // Ignored in browsers that block script window closure
      }
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="h-[30px] bg-zinc-100 dark:bg-[#0d0d0f] border-b border-zinc-200/80 dark:border-white/[0.06] flex items-center justify-between select-none shrink-0 text-xs text-zinc-600 dark:text-zinc-400 z-50 transition-colors"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Branding & App Identity */}
      <div className="flex items-center gap-2 px-3 h-full no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100 font-semibold tracking-wider text-[11px]">
          <MashBrandIcon size={14} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
          <span>MASH</span>
        </div>
      </div>

      {/* Center Draggable Spacer */}
      <div className="flex-1 h-full cursor-default" data-tauri-drag-region />

      {/* Right: VS Code Standard Sized Titlebar Controls (46px x 30px click target) */}
      <div
        className="flex items-center h-full no-drag"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-[46px] h-[30px] flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/80 dark:hover:bg-white/[0.08] active:bg-zinc-300 dark:active:bg-white/[0.12] transition-colors cursor-pointer"
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>

        {/* Maximize / Restore Button */}
        <button
          type="button"
          onClick={handleMaximize}
          className="w-[46px] h-[30px] flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/80 dark:hover:bg-white/[0.08] active:bg-zinc-300 dark:active:bg-white/[0.12] transition-colors cursor-pointer"
          title={isMaximized ? "Restore Down" : "Maximize"}
          aria-label={isMaximized ? "Restore Down" : "Maximize"}
        >
          {isMaximized ? (
            <Copy size={11} strokeWidth={1.5} className="rotate-180" />
          ) : (
            <Square size={11} strokeWidth={1.5} />
          )}
        </button>

        {/* Close Button (VS Code Windows Standard Red Hover #c42b1c) */}
        <button
          type="button"
          onClick={handleClose}
          className="w-[46px] h-[30px] flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-white hover:bg-[#c42b1c] active:bg-[#b22619] transition-colors cursor-pointer"
          title="Close"
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

export default WindowTitleBar;
