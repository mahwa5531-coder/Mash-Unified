"use client";

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { SessionItem } from '@/services/sessions';

export interface DirectConversationsSectionProps {
  directConversations: SessionItem[];
  loading: boolean;
  canScrollUp: boolean;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function DirectConversationsSection({
  directConversations,
  loading,
  canScrollUp,
  renderSessionItem,
}: DirectConversationsSectionProps) {
  const [isConversationsOpen, setIsConversationsOpen] = useState(true);

  return (
    <div className="relative pb-2">
      <div 
        onClick={() => setIsConversationsOpen(prev => !prev)}
        className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center group cursor-pointer select-none text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors ${
          canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
        }`}
      >
        <div className="flex items-center gap-1.5">
          <ChevronDown 
            size={12} 
            className={`text-zinc-400 transition-transform duration-150 ${isConversationsOpen ? '' : '-rotate-90'}`} 
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Conversations
          </span>
        </div>
      </div>

      {isConversationsOpen && (
        <div className="flex flex-col space-y-0.5">
          {directConversations.length === 0 && !loading ? (
            <div className="px-4 py-1 text-[12px] text-zinc-400 dark:text-zinc-500 italic">No conversations</div>
          ) : (
            directConversations.map((s) => renderSessionItem(s))
          )}
        </div>
      )}
    </div>
  );
}

export default DirectConversationsSection;
