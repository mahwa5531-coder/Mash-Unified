"use client";

import React, { useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { MashBrandIcon } from '@/primitives/MashBrandIcon';

interface WindowTitleBarProps {
  onToggleSidebar?: () => void;
  onToggleFullscreen?: () => void;
  onResetSession?: () => void;
  title?: string;
}

/**
 * Native-style Desktop Window Titlebar for Mash.
 *
 * Implements Microsoft Windows 11 Human Interface Guidelines (HIG):
 * - Height: 36px (h-9) with 44px x 36px click targets.
 * - Icon sizes: 14px-16px for comfortable visibility and clicking on High-DPI screens.
 * - Draggable region: data-tauri-drag-region for native window movement.
 * - Wired to Tauri, Electron, and PyWebView native window APIs with graceful browser fallback.
 */
export function WindowTitleBar({
  onToggleSidebar,
  onToggleFullscreen,
  onResetSession,
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
    // Browser fallback
    if (onToggleSidebar) onToggleSidebar();
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
    }
    // Browser reset session fallback
    if (onResetSession) onResetSession();
  };

  return (
    <div
      data-tauri-drag-region
      className="h-9 bg-zinc-100 dark:bg-[#0d0d0f] border-b border-zinc-200/80 dark:border-white/[0.06] flex items-center justify-between select-none shrink-0 text-xs text-zinc-600 dark:text-zinc-400 z-50 transition-colors"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Branding & App Identity */}
      <div className="flex items-center gap-2.5 px-3 h-full no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1.5 text-zinc-900 dark:text-zinc-100 font-semibold tracking-wider text-xs">
          <MashBrandIcon size={16} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
          <span>MASH</span>
        </div>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-normal hidden sm:inline-block">
          |
        </span>
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[280px] font-medium hidden sm:inline-block">
          {title}
        </span>
      </div>

      {/* Center Draggable Spacer */}
      <div className="flex-1 h-full cursor-default" data-tauri-drag-region />

      {/* Right: Windows 11 Standard Sized Titlebar Controls (44px x 36px click target) */}
      <div
        className="flex items-center h-full no-drag"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className="w-11 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus size={15} strokeWidth={1.75} />
        </button>

        {/* Maximize / Restore Button */}
        <button
          type="button"
          onClick={handleMaximize}
          className="w-11 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
          title={isMaximized ? "Restore Down" : "Maximize"}
          aria-label={isMaximized ? "Restore Down" : "Maximize"}
        >
          {isMaximized ? (
            <Copy size={13} strokeWidth={1.75} className="rotate-180" />
          ) : (
            <Square size={13} strokeWidth={1.75} />
          )}
        </button>

        {/* Close Button (Windows Standard Red Hover) */}
        <button
          type="button"
          onClick={handleClose}
          className="w-11 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-white hover:bg-[#e81123] transition-colors cursor-pointer"
          title="Close"
          aria-label="Close"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

export default WindowTitleBar;
