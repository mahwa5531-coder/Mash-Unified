"use client";

import React from 'react';
import { Settings } from 'lucide-react';

export interface SidebarFooterProps {
  onOpenSettings?: () => void;
}

export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
  return (
    <div className="mt-auto p-2 bg-zinc-100/80 dark:bg-[#121214] shrink-0 border-t border-zinc-200/50 dark:border-white/[0.04]">
      <button
        type="button"
        onClick={() => onOpenSettings?.()}
        className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer select-none text-[13px]"
        title="Settings"
      >
        <Settings size={15} className="text-zinc-500 dark:text-zinc-400 shrink-0" />
        <span>Settings</span>
      </button>
    </div>
  );
}

export default SidebarFooter;
