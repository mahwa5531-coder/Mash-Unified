"use client";

import React from 'react';
import { PanelLeft, Plus, Clock } from 'lucide-react';

export interface SidebarHeaderProps {
  onNewSession: (repoName?: string) => void;
  onToggle: () => void;
  isHistoryActive?: boolean;
  onOpenHistory?: () => void;
}

export function SidebarHeader({
  onNewSession,
  onToggle,
  isHistoryActive = false,
  onOpenHistory,
}: SidebarHeaderProps) {
  return (
    <>
      {/* Row 2: Top Header Bar (height h-9 = 36px, matching Row 2 of window) */}
      <div className="h-9 bg-zinc-100/90 dark:bg-[#121214] border-b border-zinc-200/70 dark:border-white/[0.06] flex items-center gap-1.5 px-3 select-none shrink-0 transition-colors">
        <div className="w-5 h-5 rounded-md bg-zinc-800 text-zinc-100 flex items-center justify-center font-bold text-[11px] shadow-xs select-none mr-1">
          M
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Collapse sidebar"
        >
          <PanelLeft size={15} />
        </button>
      </div>

      {/* Top Quick Actions (+ New Conversation, Conversation History) */}
      <div className="px-2.5 pt-2.5 pb-2 flex flex-col space-y-1 shrink-0">
        {/* + New Conversation (rounded bordered pill with elevated surface) */}
        <button
          type="button"
          onClick={() => onNewSession('No Repo')}
          className="w-full flex items-center justify-start h-[34px] px-3 rounded-lg border border-zinc-200/90 dark:border-white/[0.08] bg-white hover:bg-zinc-50 dark:bg-white/[0.05] dark:hover:bg-white/[0.08] cursor-pointer transition-colors text-zinc-900 dark:text-zinc-100 text-[13px] font-medium shadow-2xs group"
        >
          <Plus size={14} className="mr-2.5 text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition-colors shrink-0" />
          <span>New Conversation</span>
        </button>
        
        {/* Conversation History */}
        <button
          type="button"
          onClick={onOpenHistory}
          className={`w-full flex items-center h-[32px] text-[13px] px-3 rounded-lg cursor-pointer transition-colors select-none ${
            isHistoryActive
              ? 'bg-zinc-200/90 dark:bg-white/[0.08] text-zinc-950 dark:text-white font-medium border border-zinc-300/40 dark:border-white/[0.06] shadow-2xs'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Clock size={14} className="mr-2.5 text-zinc-500 dark:text-zinc-400 shrink-0" />
          <span className="truncate">Conversation History</span>
        </button>
      </div>
    </>
  );
}

export default SidebarHeader;
