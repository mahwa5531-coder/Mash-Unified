"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { Search, MoreVertical, Archive, ArchiveRestore, Trash2, FileText } from 'lucide-react';
import { SessionItem, formatRelativeTime, generateCleanSessionTitle } from '../utils/apiClient';

interface ConversationHistoryProps {
  sessions: SessionItem[];
  onSelectSession: (sessionId: string, title?: string, repoName?: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  archivedSessionIds?: Set<string>;
  onToggleArchive?: (sessionId: string) => void;
}

/** Descending filter bars icon */
function FilterBarsIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="17" x2="14" y2="17" />
    </svg>
  );
}

/** Project folder outline icon */
function ProjectFolderOutlineIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2a2 2 0 0 0-1.66-.9H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z" />
    </svg>
  );
}

export default function ConversationHistory({
  sessions,
  onSelectSession,
  onDeleteSession,
  archivedSessionIds,
  onToggleArchive,
}: ConversationHistoryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'workspace' | 'outside'>('all');
  const [viewTab, setViewTab] = useState<'active' | 'archived'>('active');
  const [visibleCount, setVisibleCount] = useState(50);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const archivedCount = useMemo(() => {
    return sessions.filter((s) => archivedSessionIds?.has(s.session_id)).length;
  }, [sessions, archivedSessionIds]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      // Archive tab filter
      const isArchived = Boolean(archivedSessionIds?.has(s.session_id));
      if (viewTab === 'active' && isArchived) return false;
      if (viewTab === 'archived' && !isArchived) return false;

      // 1. Text filter
      const title = (s.custom_title || s.title || '').toLowerCase();
      const repo = (s.workspace_uri || '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || title.includes(q) || repo.includes(q);
      if (!matchesSearch) return false;

      // 2. Section filter
      const isWorkspace = s.section === 'workspace' && s.workspace_uri && s.workspace_uri !== 'No Repo';
      if (filterMode === 'workspace' && !isWorkspace) return false;
      if (filterMode === 'outside' && isWorkspace) return false;

      return true;
    });
  }, [sessions, searchQuery, filterMode, viewTab, archivedSessionIds]);

  // Reset pagination when filters change
  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, filterMode, viewTab, sessions]);

  const toggleFilter = () => {
    setFilterMode((prev) => (prev === 'all' ? 'workspace' : prev === 'workspace' ? 'outside' : 'all'));
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop < clientHeight + 400) {
      if (visibleCount < filteredSessions.length) {
        setVisibleCount((prev) => Math.min(prev + 50, filteredSessions.length));
      }
    }
  };

  const displayedSessions = filteredSessions.slice(0, visibleCount);

  return (
    <div 
      className="flex-1 h-full bg-[var(--bg-app)] overflow-y-auto custom-scrollbar select-none font-sans"
      onScroll={handleScroll}
    >
      <div className="max-w-3xl mx-auto px-8 py-10 flex flex-col min-h-full">
        {/* Top Header */}
        <h1 className="text-xl font-medium text-zinc-900 dark:text-zinc-100 mb-6 tracking-tight">
          Conversation History
        </h1>

        {/* View Tabs: Active vs Archived */}
        <div className="flex items-center gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-800/80 pb-2.5">
          <button
            type="button"
            onClick={() => setViewTab('active')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              viewTab === 'active'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            Active Conversations
          </button>
          <button
            type="button"
            onClick={() => setViewTab('archived')}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              viewTab === 'archived'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-xs'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
          >
            <Archive size={12} />
            Archived ({archivedCount})
          </button>
        </div>

        {/* Search & Actions Toolbar */}
        <div className="flex items-center gap-2 mb-6">
          <div className="flex-1 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#181818] border border-zinc-200 dark:border-zinc-800/80 focus-within:border-zinc-400 dark:focus-within:border-zinc-600 transition-colors shadow-2xs">
            <Search size={14} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={viewTab === 'active' ? "Search conversations..." : "Search archived conversations..."}
              className="bg-transparent text-[13px] text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 outline-none w-full tracking-tight"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-xs px-1 cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={toggleFilter}
            className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
              filterMode !== 'all'
                ? 'bg-zinc-200 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100'
                : 'bg-white dark:bg-[#181818] hover:bg-zinc-100 dark:hover:bg-[#202020] border-zinc-200 dark:border-zinc-800/80 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 shadow-2xs'
            }`}
            title={`Filter: ${filterMode === 'all' ? 'All' : filterMode === 'workspace' ? 'Projects Only' : 'Outside of Project'}`}
          >
            <FilterBarsIcon size={14} />
          </button>
        </div>

        {/* Filter Tag Pill (if active) */}
        {filterMode !== 'all' && (
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Filtering:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
              {filterMode === 'workspace' ? 'Projects Only' : 'Outside of Project'}
              <button type="button" onClick={() => setFilterMode('all')} className="hover:text-black dark:hover:text-white cursor-pointer">✕</button>
            </span>
          </div>
        )}

        {/* Conversation Sessions List */}
        <div className="flex flex-col space-y-1">
          {displayedSessions.length === 0 ? (
            <div className="py-16 text-center text-zinc-400 dark:text-zinc-500 text-xs">
              {viewTab === 'active' ? 'No conversations found.' : 'No archived conversations.'}
            </div>
          ) : (
            displayedSessions.map((session) => {
              const isWorkspace = session.section === 'workspace' && session.workspace_uri && session.workspace_uri !== 'No Repo';
              let repoName = session.workspace_uri || 'No Repo';
              if (repoName.includes('/') || repoName.includes('\\')) {
                repoName = repoName.split(/[\\/]/).filter(Boolean).pop() || repoName;
              }

              const cleanTitle = generateCleanSessionTitle(
                session.custom_title || session.title || '',
                session.session_id
              );

              return (
                <div
                  key={session.session_id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open conversation: ${cleanTitle}`}
                  onClick={() => onSelectSession(session.session_id, session.custom_title || session.title, repoName)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectSession(session.session_id, session.custom_title || session.title, repoName);
                    }
                  }}
                  className="group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-[#202020] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] transition-all duration-150 cursor-pointer select-none"
                >
                  {/* Left: Title & Subtitle */}
                  <div className="flex flex-col min-w-0 flex-1 mr-4">
                    <span className="text-[13.5px] font-normal text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white transition-colors truncate">
                      {cleanTitle}
                    </span>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-400 transition-colors mt-0.5">
                      {isWorkspace ? (
                        <>
                          <ProjectFolderOutlineIcon size={12} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                          <span className="truncate">{repoName}</span>
                        </>
                      ) : (
                        <>
                          <FileText size={12} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                          <span>Outside of Project</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: Timestamp & Hover Action Buttons */}
                  <div className="flex items-center shrink-0">
                    <span className="text-[12px] font-mono text-zinc-400 dark:text-zinc-500 group-hover:hidden transition-opacity">
                      {formatRelativeTime(session.updated_at)}
                    </span>

                    <div className="hidden group-hover:flex items-center gap-1">
                      {confirmDeleteId === session.session_id ? (
                        <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md border border-red-300 dark:border-red-900/50">
                          <span className="text-[11px] text-red-600 dark:text-red-400 font-medium">Delete?</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSession?.(session.session_id);
                              setConfirmDeleteId(null);
                            }}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-red-600 text-white font-medium hover:bg-red-700 cursor-pointer"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          {onToggleArchive && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleArchive(session.session_id);
                              }}
                              className="w-7 h-7 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                              title={archivedSessionIds?.has(session.session_id) ? "Unarchive conversation" : "Archive conversation"}
                              aria-label={archivedSessionIds?.has(session.session_id) ? "Unarchive conversation" : "Archive conversation"}
                            >
                              {archivedSessionIds?.has(session.session_id) ? (
                                <ArchiveRestore size={13} strokeWidth={1.75} />
                              ) : (
                                <Archive size={13} strokeWidth={1.75} />
                              )}
                            </button>
                          )}

                          {onDeleteSession && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(session.session_id);
                              }}
                              className="w-7 h-7 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700/60 flex items-center justify-center text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
                              title="Delete conversation"
                              aria-label="Delete conversation"
                            >
                              <Trash2 size={13} strokeWidth={1.75} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
