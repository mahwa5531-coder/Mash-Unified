"use client";

// One session row in the sidebar list: title (or rename input), streaming
// spinner / unread dot / relative time, hover 3-dots button.
import React, { MouseEvent as ReactMouseEvent } from 'react';
import { MoreVertical } from 'lucide-react';
import { sessionStore, isSessionStreaming } from '@/features/chat';
import { formatRelativeTime } from '@/utils/formatting';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import type { SessionItem } from '@/services/sessions';

interface SessionItemRowProps {
  s: SessionItem;
  isPinnedContext?: boolean;
  isSelected: boolean;
  isEditing: boolean;
  renameInput: string;
  setRenameInput: React.Dispatch<React.SetStateAction<string>>;
  onSessionClick: (s: SessionItem) => void;
  onOpenMenu: (e: ReactMouseEvent, sessionId: string) => void;
  onRenameSubmit: (sessionId: string) => void;
}

export function SessionItemRow({
  s,
  isPinnedContext = false,
  isSelected,
  isEditing,
  renameInput,
  setRenameInput,
  onSessionClick,
  onOpenMenu,
  onRenameSubmit,
}: SessionItemRowProps) {
  const storeState = sessionStore.get(s.session_id);
  const showUnread = !isSelected && (s.has_unread || Boolean(storeState?.hasUnread));
  const isStreaming = isSessionStreaming(s.session_id);

  return (
            <div
        key={`${isPinnedContext ? 'pin_' : ''}${s.session_id}`}
        onClick={() => onSessionClick(s)}
        onContextMenu={(e) => onOpenMenu(e, s.session_id)}
        className={`group/item relative h-[30px] mx-1 px-2.5 rounded-md cursor-pointer flex justify-between items-center select-none transition-colors ${
          isSelected
            ? 'bg-zinc-200/80 dark:bg-white/[0.1] text-zinc-900 dark:text-white font-medium'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        {isEditing ? (
          <input
            type="text"
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            onBlur={() => onRenameSubmit(s.session_id)}
            onKeyDown={(e) => e.key === 'Enter' && onRenameSubmit(s.session_id)}
            autoFocus
            className="bg-white dark:bg-[#18181b] border border-zinc-300 dark:border-zinc-700 rounded px-1.5 py-0.5 text-[13px] text-zinc-900 dark:text-white outline-none w-full min-w-0"
          />
        ) : (
          <div className="flex items-center min-w-0 flex-1 mr-2 overflow-hidden">
            <span className={`truncate leading-snug transition-colors text-[13px] ${
              isSelected ? 'text-zinc-900 dark:text-white font-medium' : 'text-zinc-600 dark:text-zinc-400 group-hover/item:text-zinc-900 dark:group-hover/item:text-white'
            }`}>
              {generateCleanSessionTitle(s.custom_title || s.title || '', s.session_id)}
            </span>
          </div>
        )}

        {!isEditing && (
          <div className="flex items-center justify-end shrink-0 w-6 ml-1">
            {/* When not hovering: Show Spinner if running, Blue Dot if completed/unread, or Time if seen */}
            <div className="group-hover/item:hidden flex items-center justify-end">
              {isStreaming ? (
                <span 
                  className="w-3 h-3 rounded-full border-[1.5px] border-sky-400/30 border-t-sky-400 animate-spin shrink-0" 
                  title="Running in background..." 
                />
              ) : showUnread ? (
                <div 
                  className="w-4 h-4 rounded-full bg-blue-100 dark:bg-[#182433] flex items-center justify-center shrink-0 select-none" 
                  title="Completed - unread activity" 
                >
                  <span className="w-[6.5px] h-[6.5px] rounded-full bg-[#2f81f7] shrink-0" />
                </div>
              ) : (
                <span className={`text-[11.5px] font-mono shrink-0 ${isSelected ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500'}`}>
                  {formatRelativeTime(s.updated_at)}
                </span>
              )}
            </div>

            {/* When hovering: Show ONLY 3-dots button. Zero expanding, zero shifting! */}
            <div className="hidden group-hover/item:flex items-center justify-end shrink-0">
              <button
                type="button"
                onClick={(e) => onOpenMenu(e, s.session_id)}
                className="text-zinc-400 hover:text-zinc-800 dark:hover:text-white transition-colors cursor-pointer p-0.5 rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                title="More options"
              >
                <MoreVertical size={13.5} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
}
