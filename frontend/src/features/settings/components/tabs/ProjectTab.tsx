"use client";

import React from 'react';
import { Pencil, Folder } from 'lucide-react';
import type { ProjectItem } from '@/services/projects';

interface ProjectTabProps {
  activeProject: ProjectItem | { id: string; name: string; local_folder_path: string; session_count: number };
  isDeletingProject: boolean;
  onDeleteActiveProject: () => void;
}

export function ProjectTab({
  activeProject,
  isDeletingProject,
  onDeleteActiveProject,
}: ProjectTabProps) {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">{activeProject.name}</h2>
          <Pencil size={13} className="text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-white" />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">Manage project folders, agent settings, and permissions.</p>
      </div>

      {/* Project Folder */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Project Folder</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-3">
          <div className="flex items-center gap-2.5 px-3 py-2 bg-white dark:bg-[#202023] rounded-lg border border-zinc-300 dark:border-[#2e2e32] text-xs">
            <Folder size={15} className="text-zinc-400 shrink-0" />
            <span className="truncate text-zinc-700 dark:text-zinc-200 font-mono text-[11.5px]">
              {activeProject.local_folder_path || `${activeProject.name}/`}
            </span>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="pt-2">
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 mb-2">Danger Zone</h3>
        <div className="bg-zinc-50 dark:bg-[#18181b] border border-zinc-200 dark:border-[#27272a] rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-zinc-900 dark:text-white">Delete Project</div>
            <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-0.5 leading-normal">
              Permanently delete <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{activeProject.name}</strong> including{' '}
              <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                {activeProject.session_count || 0} active conversation{(activeProject.session_count || 0) !== 1 ? 's' : ''}
              </strong>.
            </div>
          </div>
          <button
            type="button"
            disabled={isDeletingProject}
            onClick={onDeleteActiveProject}
            className="px-4 py-2 bg-[#dc3545] hover:bg-[#c82333] active:bg-[#bd2130] text-white text-xs font-medium rounded-lg shadow-sm transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {isDeletingProject ? 'Deleting...' : 'Delete Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
