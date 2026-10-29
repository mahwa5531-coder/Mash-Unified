"use client";

import React, { useState, useEffect } from 'react';
import { Folder, ChevronDown, Ban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { fetchProjects, ProjectItem } from '@/services/projects';
import { cn } from '@/lib/utils';

export interface ChatHeroViewProps {
  selectedRepo: string;
  pendingWorkspacePath?: string | null;
  onSelectProject: (repoName: string, folderPath?: string) => void;
  className?: string;
}

/**
 * ChatHeroView (Project Scope Selector)
 *
 * Left-aligned context anchor sitting directly above the chat composer in empty state.
 * Vanishes the moment chatMessages.length > 0.
 *
 * Behavior:
 * - Left-aligned with the composer's left border.
 * - Dynamic positioning: opens UPWARD (side="top") to avoid bottom-screen clipping, with avoidCollisions={true}.
 * - Clean cursor hover highlight, NO tick marks. Clicking selects immediately.
 * - Capped project list height with native smooth scrolling (no extra pagination buttons).
 * - Keyboard shortcut: Ctrl+; toggles the selector.
 */
export function ChatHeroView({
  selectedRepo = 'No Repo',
  pendingWorkspacePath: _pendingWorkspacePath,
  onSelectProject,
  className,
}: ChatHeroViewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);

  // Fetch registered projects on mount and when projects change
  useEffect(() => {
    let isMounted = true;
    const loadProjects = () => {
      fetchProjects()
        .then((list) => {
          if (isMounted) setProjects(list || []);
        })
        .catch(() => {
          if (isMounted) setProjects([]);
        });
    };

    loadProjects();
    const handleProjectsUpdated = () => loadProjects();
    window.addEventListener('nexau:projects-updated', handleProjectsUpdated);

    return () => {
      isMounted = false;
      window.removeEventListener('nexau:projects-updated', handleProjectsUpdated);
    };
  }, []);

  // Global Hotkey: Ctrl+; (or Cmd+;) to toggle project selector
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ';') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isDirect = !selectedRepo || selectedRepo === 'No Repo';
  const activeProject = !isDirect ? projects.find((p) => p.name === selectedRepo) : null;
  const displayName = isDirect ? 'No Project' : activeProject?.name || selectedRepo;

  return (
    <div className={cn("flex items-center justify-start select-none", className)}>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "group inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-normal transition-colors cursor-pointer outline-none",
                  "text-zinc-400 dark:text-zinc-400 hover:text-zinc-200 dark:hover:text-zinc-100",
                  "hover:bg-zinc-800/60 dark:hover:bg-white/[0.08]",
                  isOpen && "text-zinc-200 dark:text-zinc-100 bg-zinc-800/70 dark:bg-white/[0.08]"
                )}
                aria-label={`Current project: ${displayName}. Click to change scope.`}
              >
                <span className="truncate max-w-[220px]">{displayName}</span>
                <ChevronDown
                  size={11.5}
                  className={cn(
                    "text-zinc-500 group-hover:text-zinc-300 transition-transform duration-150 shrink-0",
                    isOpen && "rotate-180"
                  )}
                />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={5} className="text-[11px]">
            Select Project <kbd className="font-mono text-[9.5px] opacity-70 ml-1">Ctrl+;</kbd>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          avoidCollisions={true}
          collisionPadding={12}
          className="w-64 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-white/[0.08] text-zinc-800 dark:text-zinc-200 shadow-xl dark:shadow-2xl rounded-xl p-1 z-50 animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {/* Projects Section */}
          <div className="px-2 pt-1 pb-1 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider select-none">
            Projects
          </div>

          {/* Scrollable list (smooth scroll, no buttons, no tick marks) */}
          <div className="max-h-[190px] overflow-y-auto custom-scrollbar flex flex-col gap-0.5 pr-0.5">
            {projects.length === 0 ? (
              <div className="px-2 py-2 text-xs text-zinc-400 dark:text-zinc-500 italic text-center">
                No registered projects
              </div>
            ) : (
              projects.map((proj) => {
                const isSelected = !isDirect && proj.name === selectedRepo;
                return (
                  <DropdownMenuItem
                    key={proj.id || proj.name}
                    onClick={() => {
                      onSelectProject(proj.name, proj.local_folder_path);
                      setIsOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors outline-none",
                      isSelected
                        ? "bg-zinc-100 dark:bg-white/[0.08] text-zinc-950 dark:text-white font-medium"
                        : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-white/[0.04] hover:text-zinc-950 dark:hover:text-white"
                    )}
                  >
                    <Folder size={13.5} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
                    <span className="truncate flex-1">{proj.name}</span>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>

          <DropdownMenuSeparator className="bg-zinc-100 dark:bg-white/[0.06] my-1" />

          {/* Conversations Section */}
          <div className="px-2 pt-0.5 pb-1 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider select-none">
            Conversations
          </div>

          <DropdownMenuItem
            onClick={() => {
              onSelectProject('No Repo', undefined);
              setIsOpen(false);
            }}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors outline-none",
              isDirect
                ? "bg-zinc-100 dark:bg-white/[0.08] text-zinc-950 dark:text-white font-medium"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/70 dark:hover:bg-white/[0.04] hover:text-zinc-950 dark:hover:text-white"
            )}
          >
            <Ban size={13.5} className="text-zinc-400 dark:text-zinc-500 shrink-0" />
            <span className="truncate flex-1">No Project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default ChatHeroView;
