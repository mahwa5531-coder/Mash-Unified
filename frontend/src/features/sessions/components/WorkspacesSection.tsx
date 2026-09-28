"use client";

import React, { useState } from 'react';
import { FilterBarsIcon, FolderPlusIcon } from './icons';
import { WorkspaceFolderRow } from './WorkspaceFolderRow';
import { SessionItem } from '@/services/sessions';
import { ProjectItem } from '@/services/projects';

export interface WorkspacesSectionProps {
  workspaceSessions: Record<string, SessionItem[]>;
  registeredProjects: ProjectItem[];
  openFolders: Record<string, boolean>;
  canScrollUp: boolean;
  onToggleFolder: (repoName: string) => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onAddWorkspace: () => void;
  onDeleteProject: (e: React.MouseEvent, projectId?: string, projectName?: string) => void;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function WorkspacesSection({
  workspaceSessions,
  registeredProjects,
  openFolders,
  canScrollUp,
  onToggleFolder,
  onNewSession,
  onAddWorkspace,
  onDeleteProject,
  renderSessionItem,
}: WorkspacesSectionProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [workspaceFilter, setWorkspaceFilter] = useState('');

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
            aria-label="Filter workspaces"
          >
            <FilterBarsIcon size={14} />
          </button>

          {/* Add Workspace: Directly triggers real native Windows File Explorer */}
          <button
            type="button"
            onClick={onAddWorkspace}
            className="cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white text-zinc-500 dark:text-zinc-400"
            title="Add workspace from File Explorer"
            aria-label="Add workspace from File Explorer"
          >
            <FolderPlusIcon size={14} />
          </button>
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
          const folderOpen = Boolean(openFolders[repoName]);

          return (
            <WorkspaceFolderRow
              key={repoName}
              repoName={repoName}
              repoSessions={repoSessions}
              projectMatch={match}
              isOpen={folderOpen}
              onToggle={() => onToggleFolder(repoName)}
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
