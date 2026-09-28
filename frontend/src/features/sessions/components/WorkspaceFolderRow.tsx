"use client";

import React from 'react';
import { ChevronDown, MoreHorizontal, Plus, ExternalLink, Trash2 } from 'lucide-react';
import { ProjectFolderIcon } from './icons';
import { SessionItem } from '@/services/sessions';
import { ProjectItem } from '@/services/projects';
import { openSystemFile } from '@/services/files';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export interface WorkspaceFolderRowProps {
  repoName: string;
  repoSessions: SessionItem[];
  projectMatch?: ProjectItem;
  isActive: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onSelectWorkspace: () => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onDeleteProject: (e: React.MouseEvent, projectId?: string, projectName?: string) => void;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function WorkspaceFolderRow({
  repoName,
  repoSessions,
  projectMatch,
  isActive,
  isOpen,
  onToggle,
  onSelectWorkspace,
  onNewSession,
  onDeleteProject,
  renderSessionItem,
}: WorkspaceFolderRowProps) {
  return (
    <div className="flex flex-col">
      {/* Folder Row */}
      <div 
        onClick={onSelectWorkspace}
        className={`flex items-center justify-between px-2.5 py-1.5 rounded-md mx-1 cursor-pointer transition-colors group/folder select-none ${
          isActive 
            ? 'bg-zinc-200/90 dark:bg-white/[0.08] text-zinc-950 dark:text-white font-medium shadow-2xs' 
            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/50 dark:hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-center overflow-hidden min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="p-0.5 -ml-1 mr-0.5 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-pointer"
            title={isOpen ? "Collapse folder" : "Expand folder"}
          >
            <ChevronDown 
              size={11} 
              className={`transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`} 
            />
          </button>
          <ProjectFolderIcon size={14} className="mr-2 text-zinc-500 dark:text-zinc-400 group-hover/folder:text-zinc-700 dark:group-hover/folder:text-zinc-200 transition-colors shrink-0" />
          <span className="text-[13px] truncate transition-colors font-medium">{repoName}</span>
        </div>
        
        <div className="flex items-center opacity-0 group-hover/folder:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded hover:bg-zinc-300/50 dark:hover:bg-white/[0.1] transition-all cursor-pointer outline-none"
                title="Project options"
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              side="bottom" 
              sideOffset={4}
              className="w-48 rounded-xl bg-white dark:bg-[#1c1c1f] border border-zinc-200 dark:border-white/[0.08] shadow-2xl p-1 z-50 select-none font-sans text-xs"
            >
              <DropdownMenuItem
                onClick={() => onNewSession(repoName, projectMatch?.local_folder_path)}
                className="px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2 cursor-pointer rounded-lg"
              >
                <Plus size={13} className="text-zinc-400 shrink-0" />
                <span>New Conversation</span>
              </DropdownMenuItem>

              {projectMatch?.local_folder_path && (
                <DropdownMenuItem
                  onClick={() => openSystemFile(projectMatch.local_folder_path)}
                  className="px-2.5 py-1.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/[0.06] hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-2 cursor-pointer rounded-lg"
                >
                  <ExternalLink size={13} className="text-zinc-400 shrink-0" />
                  <span>Open in File Explorer</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="my-1 bg-zinc-200 dark:bg-white/[0.06]" />

              <DropdownMenuItem
                onClick={(e) => onDeleteProject(e, projectMatch?.id, repoName)}
                className="px-2.5 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-2 cursor-pointer rounded-lg"
              >
                <Trash2 size={13} className="shrink-0" />
                <span>Delete Project</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {isOpen && (
        <div className="flex flex-col pl-3">
          {repoSessions.length === 0 ? (
            <button
              type="button"
              onClick={() => onNewSession(repoName, projectMatch?.local_folder_path)}
              className="flex items-center gap-1.5 pl-6 py-1.5 text-[11.5px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer text-left w-full rounded hover:bg-zinc-200/40 dark:hover:bg-white/[0.04]"
            >
              <Plus size={11} className="text-zinc-400 shrink-0" />
              <span>Start conversation</span>
            </button>
          ) : (
            repoSessions.map((s) => renderSessionItem(s))
          )}
        </div>
      )}
    </div>
  );
}

export default WorkspaceFolderRow;
