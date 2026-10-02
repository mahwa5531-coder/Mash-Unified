"use client";

import React, { useState, useEffect } from 'react';
import { Pencil, Folder, Check, X } from 'lucide-react';
import { renameProject, type ProjectItem } from '@/services/projects';

interface ProjectTabProps {
  activeProject: ProjectItem | { id: string; name: string; local_folder_path: string; session_count: number };
  isDeletingProject: boolean;
  onDeleteActiveProject: () => void;
  onProjectRenamed?: (newName: string) => void;
}

export function ProjectTab({
  activeProject,
  isDeletingProject,
  onDeleteActiveProject,
  onProjectRenamed,
}: ProjectTabProps) {
  const [currentName, setCurrentName] = useState(activeProject.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(activeProject.name);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCurrentName(activeProject.name);
    setRenameValue(activeProject.name);
  }, [activeProject.name]);

  const handleSaveRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === currentName) {
      setIsRenaming(false);
      return;
    }
    setIsSaving(true);
    try {
      const ok = await renameProject(activeProject.id, trimmed);
      if (ok) {
        setCurrentName(trimmed);
        onProjectRenamed?.(trimmed);
      }
    } finally {
      setIsSaving(false);
      setIsRenaming(false);
    }
  };

  const handleCancelRename = () => {
    setRenameValue(currentName);
    setIsRenaming(false);
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          {isRenaming ? (
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') handleCancelRename();
                }}
                autoFocus
                disabled={isSaving}
                className="text-[17px] font-semibold text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-0.5 outline-none focus:border-emerald-500 w-full max-w-sm"
              />
              <button
                type="button"
                onClick={handleSaveRename}
                disabled={isSaving || !renameValue.trim()}
                title="Save"
                className="p-1 text-emerald-600 hover:text-emerald-500 disabled:opacity-40 cursor-pointer"
              >
                <Check size={16} />
              </button>
              <button
                type="button"
                onClick={handleCancelRename}
                title="Cancel"
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-[18px] font-semibold text-zinc-900 dark:text-white">{currentName}</h2>
              <button
                type="button"
                onClick={() => setIsRenaming(true)}
                title="Rename Project"
                className="p-0.5 text-zinc-400 cursor-pointer hover:text-zinc-700 dark:hover:text-white transition-colors"
              >
                <Pencil size={13} />
              </button>
            </>
          )}
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
