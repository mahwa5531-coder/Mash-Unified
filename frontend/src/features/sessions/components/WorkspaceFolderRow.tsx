"use client";

import React from 'react';
import { ChevronDown, Folder, FolderOpen, MoreVertical, Plus, ExternalLink, Trash2 } from 'lucide-react';
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
  isOpen: boolean;
  onToggle: () => void;
  onNewSession: (repoName?: string, folderPath?: string) => void;
  onDeleteProject: (e: React.MouseEvent, projectId?: string, projectName?: string) => void;
  renderSessionItem: (session: SessionItem) => React.ReactNode;
}

export function WorkspaceFolderRow({
  repoName,
  repoSessions,
  projectMatch,
  isOpen,
  onToggle,
  onNewSession,
  onDeleteProject,
  renderSessionItem,
}: WorkspaceFolderRowProps) {
  return (
    <div className="flex flex-col select-none">
      {/* Ghost Project Folder Row: Clean neutral text, outlined folder, right-aligned hover actions */}
      <div 
        onClick={onToggle}
        className="group/folder h-[30px] mx-1 px-2 rounded-md cursor-pointer flex items-center justify-between text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
      >
        {/* Left: Dropdown chevron + Folder Icon + Project Name */}
        <div className="flex items-center min-w-0 flex-1 overflow-hidden">
          <ChevronDown
            size={11}
            className={`mr-1 text-zinc-500 shrink-0 transition-transform duration-150 ${isOpen ? '' : '-rotate-90'}`}
          />
          {isOpen ? (
            <FolderOpen size={13} className="mr-1.5 text-zinc-400 shrink-0 transition-colors" />
          ) : (
            <Folder size={13} className="mr-1.5 text-zinc-400 shrink-0 transition-colors" />
          )}
          <span className="text-[13px] truncate font-normal tracking-wide text-zinc-400 group-hover/folder:text-zinc-200 transition-colors">
            {repoName}
          </span>
          {repoSessions.length > 0 && (
            <span className="text-[10px] font-mono text-zinc-500 ml-1.5 opacity-70">
              {repoSessions.length}
            </span>
          )}
        </div>
        
        {/* Right: Dynamic Hover Actions (+ New Conversation, Vertical 3-dots Menu) */}
        <div 
          className="flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity shrink-0 ml-1" 
          onClick={(e) => e.stopPropagation()}
        >
          {/* Quick + button to create new session in this workspace */}
          <button
            type="button"
            onClick={() => onNewSession(repoName, projectMatch?.local_folder_path)}
            className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/[0.08] transition-colors cursor-pointer outline-none"
            title="New conversation in project"
            aria-label="New conversation in project"
          >
            <Plus size={13} />
          </button>

          {/* Vertical 3-dots Dropdown Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/[0.08] transition-colors cursor-pointer outline-none"
                title="Project options"
                aria-label="Project options"
              >
                <MoreVertical size={13} />
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
      
      {/* Nested Sessions under this Workspace Project */}
      {isOpen && (
        <div className="flex flex-col pl-3 space-y-0.5 mt-0.5">
          {repoSessions.length === 0 ? (
            <button
              type="button"
              onClick={() => onNewSession(repoName, projectMatch?.local_folder_path)}
              className="flex items-center gap-1.5 pl-6 py-1.5 text-[11.5px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer text-left w-full rounded hover:bg-white/[0.04]"
            >
              <Plus size={11} className="text-zinc-500 shrink-0" />
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
