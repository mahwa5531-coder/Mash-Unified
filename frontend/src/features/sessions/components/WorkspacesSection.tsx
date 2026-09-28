"use client";

import React, { useState, useRef, useEffect } from 'react';
import { FilterBarsIcon, FolderPlusIcon, QuickStartFolderIcon } from './icons';
import { WorkspaceFolderRow } from './WorkspaceFolderRow';
import { SessionItem } from '@/services/sessions';
import { ProjectItem } from '@/services/projects';

export interface WorkspacesSectionProps {
  workspaceSessions: Record<string, SessionItem[]>;
  registeredProjects: ProjectItem[];
  selectedSessionRepo?: string;
  openFolders: Record<string, boolean>;
  canScrollUp: boolean;
  onToggleFolder: (repoName: string) => void;
  onSelectWorkspace: (repoName: string) => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onNewProject: () => void;
  onOpenQuickProjectModal: () => void;
  onDeleteProject: (e: React.MouseEvent, projectId?: string, projectName?: string) => void;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function WorkspacesSection({
  workspaceSessions,
  registeredProjects,
  selectedSessionRepo,
  openFolders,
  canScrollUp,
  onToggleFolder,
  onSelectWorkspace,
  onNewSession,
  onNewProject,
  onOpenQuickProjectModal,
  onDeleteProject,
  renderSessionItem,
}: WorkspacesSectionProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // Close workspace popover menu on click outside
  useEffect(() => {
    if (!isWorkspaceMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isWorkspaceMenuOpen]);

  const filteredEntries = Object.entries(workspaceSessions).filter(([repoName]) =>
    !workspaceFilter.trim() || repoName.toLowerCase().includes(workspaceFilter.trim().toLowerCase())
  );

  return (
    <div className="relative pb-2">
      {/* Workspaces Sticky Header */}
      <div 
        className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center select-none text-zinc-500 dark:text-zinc-400 transition-colors relative ${
          canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Workspaces
        </span>

        <div className="flex items-center gap-1 text-zinc-400 relative" onClick={(e) => e.stopPropagation()}>
          {/* Filter button */}
          <button
            type="button"
            onClick={() => setIsFilterOpen(prev => !prev)}
            className={`cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white ${
              isFilterOpen ? 'text-zinc-900 dark:text-white bg-black/[0.05] dark:bg-white/[0.06]' : 'text-zinc-500 dark:text-zinc-400'
            }`}
            title="Filter workspaces"
          >
            <FilterBarsIcon size={14} />
          </button>

          {/* Folder Plus button */}
          <button
            type="button"
            onClick={() => setIsWorkspaceMenuOpen(prev => !prev)}
            className={`cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white ${
              isWorkspaceMenuOpen ? 'text-zinc-900 dark:text-white bg-black/[0.05] dark:bg-white/[0.06]' : 'text-zinc-500 dark:text-zinc-400'
            }`}
            title="Add workspace project"
          >
            <FolderPlusIcon size={14} />
          </button>

          {/* Floating Popover Menu (New Project & Quick Start) */}
          {isWorkspaceMenuOpen && (
            <div 
              ref={workspaceMenuRef}
              className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white dark:bg-[#1c1c1f] border border-zinc-200 dark:border-white/[0.08] shadow-2xl p-1 z-50 select-none font-sans text-xs animate-in fade-in zoom-in-95"
            >
              <button
                type="button"
                onClick={() => {
                  setIsWorkspaceMenuOpen(false);
                  onNewProject();
                }}
                className="w-full text-left px-2.5 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 cursor-pointer rounded-lg transition-colors"
              >
                <FolderPlusIcon size={14} className="text-zinc-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-[12.5px]">New Project</span>
                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">Select from computer</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsWorkspaceMenuOpen(false);
                  onOpenQuickProjectModal();
                }}
                className="w-full text-left px-2.5 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 cursor-pointer rounded-lg transition-colors"
              >
                <QuickStartFolderIcon size={14} className="text-zinc-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-[12.5px]">Quick Start</span>
                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">Create in Documents</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline Filter Input */}
      {isFilterOpen && (
        <div className="px-3 pt-1 pb-1.5">
          <input
            type="text"
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            placeholder="Filter workspaces..."
            autoFocus
            className="w-full text-[12px] bg-zinc-200/50 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/[0.08] rounded-md px-2 py-1 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
      )}

      {/* Workspaces List */}
      <div className="flex flex-col space-y-0.5">
        {filteredEntries.map(([repoName, repoSessions]) => {
          const match = registeredProjects.find((p) => p.name === repoName);
          const isWorkspaceActive = selectedSessionRepo === repoName;
          const folderOpen = Boolean(openFolders[repoName]);

          return (
            <WorkspaceFolderRow
              key={repoName}
              repoName={repoName}
              repoSessions={repoSessions}
              projectMatch={match}
              isActive={isWorkspaceActive}
              isOpen={folderOpen}
              onToggle={() => onToggleFolder(repoName)}
              onSelectWorkspace={() => onSelectWorkspace(repoName)}
              onNewSession={onNewSession}
              onDeleteProject={onDeleteProject}
              renderSessionItem={renderSessionItem}
            />
          );
        })}
      </div>
    </div>
  );
}

export default WorkspacesSection;
