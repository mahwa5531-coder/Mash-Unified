"use client";

// Window frame title bar: app menu labels + minimize/maximize/close controls.
// Pure presentation — all behavior arrives via callbacks.
import { Minus, Square, X } from 'lucide-react';

interface WindowTitleBarProps {
  onToggleSidebar: () => void;
  onToggleFullscreen: () => void;
  onResetSession: () => void;
}

export function WindowTitleBar({ onToggleSidebar, onToggleFullscreen, onResetSession }: WindowTitleBarProps) {
  return (
    <div className="h-7 bg-[#0d0d0f] flex items-center justify-between px-3 select-none shrink-0 text-xs text-zinc-400 z-50">
        <div className="flex items-center gap-4">
          <span className="font-semibold tracking-wider text-zinc-200 text-xs">MASH</span>
        </div>
        
        {/* Window Controls (Minimize, Maximize, Close) */}
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={onToggleSidebar}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <Minus size={11} />
          </button>
          <button 
            type="button"
            onClick={onToggleFullscreen}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            title="Toggle fullscreen"
            aria-label="Toggle fullscreen"
          >
            <Square size={10} />
          </button>
          <button 
            type="button"
            onClick={onResetSession}
            className="w-4 h-4 rounded flex items-center justify-center hover:bg-red-500/80 hover:text-white text-zinc-400 transition-colors cursor-pointer"
            title="Reset / New session"
            aria-label="Reset / New session"
          >
            <X size={11} />
          </button>
        </div>
      </div>
  );
}
