"use client";

// Right-click session menu (viewport-clamped fixed position):
// Pin / Rename / Copy ID / Archive / Delete.
import React from 'react';
import { Pin, Edit2, Copy, Archive, Trash2 } from 'lucide-react';
import type { SessionItem } from '@/services/sessions';

interface SessionContextMenuProps {
  activeMenuSessionId: string;
  menuPos: { x: number; y: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  sessions: SessionItem[];
  pinnedSessionIds: Set<string>;
  setActiveMenuSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setRenameInput: React.Dispatch<React.SetStateAction<string>>;
  togglePin: (sessionId: string) => void;
  handleCopyId: (sessionId: string) => void;
  handleArchive: (sessionId: string) => void;
  handleDelete: (sessionId: string) => void;
}

export function SessionContextMenu({
  activeMenuSessionId,
  menuPos,
  menuRef,
  sessions,
  pinnedSessionIds,
  setActiveMenuSessionId,
  setEditingSessionId,
  setRenameInput,
  togglePin,
  handleCopyId,
  handleArchive,
  handleDelete,
}: SessionContextMenuProps) {
  return (
                <>
          {/* Transparent full-screen overlay to close when clicking outside */}
          <div 
            className="fixed inset-0 z-40 bg-transparent"
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuSessionId(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveMenuSessionId(null);
            }}
          />
          <div 
            ref={menuRef}
            role="menu"
            aria-label="Session options"
            tabIndex={-1}
            style={{ top: `${menuPos.y}px`, left: `${menuPos.x}px` }}
            className="fixed z-50 w-48 bg-white dark:bg-[#18181a] border border-zinc-200 dark:border-white/[0.08] rounded-2xl shadow-2xl shadow-black/10 dark:shadow-black/80 p-1 text-[13px] text-zinc-700 dark:text-zinc-300 font-sans select-none backdrop-blur-md outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setActiveMenuSessionId(null);
              }
            }}
          >
            <div 
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                togglePin(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  togglePin(activeMenuSessionId);
                  setActiveMenuSessionId(null);
                }
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] focus:bg-zinc-100 dark:focus:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white focus:text-zinc-900 dark:focus:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none outline-none"
            >
              <Pin size={14} className={`text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0 ${pinnedSessionIds.has(activeMenuSessionId) ? 'fill-sky-400 text-sky-400' : ''}`} />
              <span className="truncate">{pinnedSessionIds.has(activeMenuSessionId) ? 'Unpin conversation' : 'Pin to top'}</span>
            </div>

            <div 
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                setEditingSessionId(activeMenuSessionId);
                const target = sessions.find(s => s.session_id === activeMenuSessionId);
                setRenameInput(target?.custom_title || target?.title || '');
                setActiveMenuSessionId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingSessionId(activeMenuSessionId);
                  const target = sessions.find(s => s.session_id === activeMenuSessionId);
                  setRenameInput(target?.custom_title || target?.title || '');
                  setActiveMenuSessionId(null);
                }
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] focus:bg-zinc-100 dark:focus:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white focus:text-zinc-900 dark:focus:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none outline-none"
            >
              <Edit2 size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Rename</span>
            </div>

            <div 
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                handleCopyId(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleCopyId(activeMenuSessionId);
                  setActiveMenuSessionId(null);
                }
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] focus:bg-zinc-100 dark:focus:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white focus:text-zinc-900 dark:focus:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none outline-none"
            >
              <Copy size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Copy Session ID</span>
            </div>

            <div 
              role="menuitem"
              tabIndex={0}
              onClick={() => {
                handleArchive(activeMenuSessionId);
                setActiveMenuSessionId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleArchive(activeMenuSessionId);
                  setActiveMenuSessionId(null);
                }
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/[0.08] focus:bg-zinc-100 dark:focus:bg-white/[0.08] hover:text-zinc-900 dark:hover:text-white focus:text-zinc-900 dark:focus:text-white cursor-pointer flex items-center gap-2.5 text-zinc-700 dark:text-zinc-300 transition-colors group select-none outline-none"
            >
              <Archive size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 shrink-0" />
              <span className="truncate">Archive</span>
            </div>

            <div className="my-1 border-t border-zinc-200 dark:border-white/[0.06]" />

            <div 
              role="menuitem"
              tabIndex={0}
              onClick={() => handleDelete(activeMenuSessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleDelete(activeMenuSessionId);
                }
              }}
              className="h-8 px-2.5 rounded-lg hover:bg-red-500/10 dark:hover:bg-red-500/[0.12] focus:bg-red-500/10 dark:focus:bg-red-500/[0.12] hover:text-red-600 dark:hover:text-red-300 focus:text-red-600 dark:focus:text-red-300 text-zinc-700 dark:text-zinc-300 cursor-pointer flex items-center gap-2.5 transition-colors group select-none outline-none"
            >
              <Trash2 size={14} className="text-zinc-500 dark:text-zinc-400 group-hover:text-red-500 dark:group-hover:text-red-400 shrink-0 transition-colors" />
              <span className="truncate">Delete</span>
            </div>
          </div>
        </>
  );
}
