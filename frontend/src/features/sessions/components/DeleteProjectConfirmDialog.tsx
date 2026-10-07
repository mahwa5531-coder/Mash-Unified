"use client";

import React from 'react';
import { FolderX } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

interface DeleteProjectConfirmDialogProps {
  isOpen: boolean;
  projectName: string;
  projectPath?: string;
  sessionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteProjectConfirmDialog({
  isOpen,
  projectName,
  projectPath,
  sessionCount,
  onConfirm,
  onCancel,
}: DeleteProjectConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <Card 
        className="w-full max-w-[380px] rounded-[28px] p-7 border border-zinc-200/80 dark:border-white/[0.08] shadow-2xl bg-white dark:bg-[#141416] text-center select-none animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="p-0 mb-4 flex flex-col items-center">
          {/* Warning Icon Badge in Red Accent */}
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mb-3 border border-red-500/20 shadow-xs">
            <FolderX size={22} />
          </div>

          <CardTitle className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Delete workspace?
          </CardTitle>

          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
            <span>
              Remove workspace <span className="font-semibold text-zinc-800 dark:text-zinc-200">"{projectName}"</span> from MASH?
            </span>
            <span className="block mt-1.5 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              {sessionCount > 0 ? (
                <>
                  This will permanently delete all <span className="font-semibold text-red-500 dark:text-red-400">{sessionCount} conversation{sessionCount === 1 ? '' : 's'}</span> and their audit histories associated with this workspace.
                </>
              ) : (
                "This workspace has no active conversations."
              )}
            </span>
          </CardDescription>

          {/* Project local folder path if available */}
          {projectPath && (
            <div className="w-full mt-2.5 px-2.5 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/[0.03] border border-zinc-200/50 dark:border-white/[0.04] text-[10.5px] font-mono text-zinc-500 dark:text-zinc-400 truncate text-left" title={projectPath}>
              <span className="text-zinc-400 select-none">Path: </span>{projectPath}
            </div>
          )}

          {/* Crucial reassurance banner: Local directory is NOT deleted */}
          <div className="w-full mt-2.5 p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-600 dark:text-emerald-400 text-center font-medium">
            ✓ Your actual project files on your computer will remain 100% safe and untouched.
          </div>
        </CardHeader>

        <CardContent className="p-0 flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            className="w-full h-10 rounded-xl font-medium text-xs bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white shadow-sm transition-all cursor-pointer flex items-center justify-center"
          >
            {sessionCount > 0 ? `Delete Workspace & ${sessionCount} Session${sessionCount === 1 ? '' : 's'}` : "Delete Workspace"}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full h-10 rounded-xl font-medium text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-all cursor-pointer flex items-center justify-center"
          >
            Cancel
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
