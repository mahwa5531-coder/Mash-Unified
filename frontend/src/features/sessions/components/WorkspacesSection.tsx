"use client";

import React from 'react';
import { FolderPlusIcon } from './icons';
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
  const entries = Object.entries(workspaceSessions);

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
          {/* Add Workspace: Directly triggers native workspace folder picker */}
          <button
            type="button"
            onClick={onAddWorkspace}
            className="cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white text-zinc-500 dark:text-zinc-400"
            title="Add workspace"
            aria-label="Add workspace"
          >
            <FolderPlusIcon size={14} />
          </button>
        </div>
      </div>

      {/* Workspaces List with Dropdown Accordion */}
      <div className="flex flex-col space-y-0.5">
        {entries.map(([repoName, repoSessions]) => {
          const match = registeredProjects.find((p) => p.name === repoName);
          // Default to open (true) unless explicitly collapsed by user
          const folderOpen = openFolders[repoName] ?? true;

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
