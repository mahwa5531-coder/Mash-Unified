"use client";

import React from 'react';
import { FolderPlusIcon, QuickStartFolderIcon } from './icons';
import { WorkspaceFolderRow } from './WorkspaceFolderRow';
import { SessionItem } from '@/services/sessions';
import { ProjectItem } from '@/services/projects';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export interface WorkspacesSectionProps {
  workspaceSessions: Record<string, SessionItem[]>;
  registeredProjects: ProjectItem[];
  openFolders: Record<string, boolean>;
  canScrollUp: boolean;
  onToggleFolder: (repoName: string) => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onNewProject: () => void;
  onOpenQuickProjectModal: () => void;
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
  onNewProject,
  onOpenQuickProjectModal,
  onDeleteProject,
  renderSessionItem,
}: WorkspacesSectionProps) {
  const entries = Object.entries(workspaceSessions);

  return (
    <div className="relative pb-2">
      {/* Workspaces Sticky Header (No Filter button) */}
      <div 
        className={`sticky top-0 z-20 bg-zinc-50 dark:bg-[#121214] px-3 pt-2 pb-1.5 flex justify-between items-center select-none text-zinc-500 dark:text-zinc-400 transition-colors relative ${
          canScrollUp ? 'border-b border-zinc-200 dark:border-white/[0.04]' : ''
        }`}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Workspaces
        </span>

        <div className="flex items-center gap-1 text-zinc-400 relative" onClick={(e) => e.stopPropagation()}>
          {/* Add Workspace: Opens Popover Menu (New Project & Quick Start) positioned to the right */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="cursor-pointer transition-colors p-1 rounded-md hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white text-zinc-500 dark:text-zinc-400"
                title="Add workspace project"
                aria-label="Add workspace project"
              >
                <FolderPlusIcon size={14} />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent 
              side="right"
              align="start"
              sideOffset={8}
              className="w-52 rounded-xl bg-white dark:bg-[#1c1c1f] border border-zinc-200 dark:border-white/[0.08] shadow-2xl p-1 z-50 select-none font-sans text-xs"
            >
              <DropdownMenuItem
                onClick={onNewProject}
                className="w-full text-left px-2.5 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 cursor-pointer rounded-lg transition-colors"
              >
                <FolderPlusIcon size={14} className="text-zinc-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-[12.5px]">New Project</span>
                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">Select from computer</span>
                </div>
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={onOpenQuickProjectModal}
                className="w-full text-left px-2.5 py-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-white flex items-center gap-2.5 cursor-pointer rounded-lg transition-colors"
              >
                <QuickStartFolderIcon size={14} className="text-zinc-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-[12.5px]">Quick Start</span>
                  <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">Create in Documents</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
