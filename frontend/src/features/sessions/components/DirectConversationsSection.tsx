"use client";

import React, { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { SessionItem } from '@/services/sessions';

export interface DirectConversationsSectionProps {
  directConversations: SessionItem[];
  loading: boolean;
  canScrollUp: boolean;
  onNewSession?: (repoName?: string) => void;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function DirectConversationsSection({
  directConversations,
  loading,
  canScrollUp,
  onNewSession,
  renderSessionItem,
}: DirectConversationsSectionProps) {
  const [isSectionOpen, setIsSectionOpen] = useState(true);

  return (
    <div className="relative pb-2">
      {/* Header: Conversations on left, + button on right */}
      <div 
        className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center select-none text-zinc-500 dark:text-zinc-400 transition-colors ${
          canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
        }`}
      >
        <div 
          onClick={() => setIsSectionOpen(prev => !prev)}
          className="flex items-center gap-1.5 cursor-pointer group hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          <ChevronDown 
            size={12} 
            className={`text-zinc-400 transition-transform duration-150 ${isSectionOpen ? '' : '-rotate-90'}`} 
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Conversations
          </span>
        </div>

        {onNewSession && (
          <button
            type="button"
            onClick={() => onNewSession('No Repo')}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer outline-none"
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Conversations List */}
      {isSectionOpen && (
        <div className="flex flex-col space-y-0.5">
          {directConversations.length === 0 && !loading ? (
            <div className="px-4 py-1 text-[12px] text-zinc-500 italic">No conversations</div>
          ) : (
            directConversations.map((s) => renderSessionItem(s))
          )}
        </div>
      )}
    </div>
  );
}

export default DirectConversationsSection;
