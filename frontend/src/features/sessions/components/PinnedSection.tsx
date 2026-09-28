"use client";

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SessionItem } from '@/services/sessions';

export interface PinnedSectionProps {
  pinnedSessions: SessionItem[];
  canScrollUp: boolean;
  renderSessionItem: (session: SessionItem, isPinned?: boolean) => React.ReactNode;
}

export function PinnedSection({
  pinnedSessions,
  canScrollUp,
  renderSessionItem,
}: PinnedSectionProps) {
  const [isPinnedOpen, setIsPinnedOpen] = useState(true);

  if (pinnedSessions.length === 0) return null;

  return (
    <div className="relative pb-2">
      <div 
        onClick={() => setIsPinnedOpen(prev => !prev)}
        className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center group cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors ${
          canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
        }`}
      >
        <div className="flex items-center gap-1.5">
          <ChevronDown 
            size={12} 
            className={`text-zinc-400 transition-transform duration-150 ${isPinnedOpen ? '' : '-rotate-90'}`} 
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Pinned
          </span>
        </div>
        <span className="text-[10px] font-mono text-zinc-500">
          {pinnedSessions.length}
        </span>
      </div>

      {isPinnedOpen && (
        <div className="flex flex-col space-y-0.5">
          {pinnedSessions.map((s) => renderSessionItem(s, true))}
        </div>
      )}
    </div>
  );
}

export default PinnedSection;
