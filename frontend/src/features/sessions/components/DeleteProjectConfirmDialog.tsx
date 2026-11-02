"use client";

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

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
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-100"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl p-6 bg-[#18181b] dark:bg-[#18181b] border border-zinc-800 dark:border-white/[0.08] shadow-2xl text-left select-none animate-in zoom-in-95 duration-100 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Title and Close [X] */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-zinc-100">
            Delete Project
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1 rounded-md cursor-pointer"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body Text */}
        <div className="text-[13px] text-zinc-400 dark:text-zinc-400 leading-relaxed mb-6 space-y-2.5">
          <p>
            Are you sure you want to delete the workspace <span className="font-semibold text-zinc-100">{projectName}</span>?
          </p>
          {projectPath && (
            <p className="text-xs font-mono text-zinc-400 dark:text-zinc-500 bg-black/20 dark:bg-black/30 px-2.5 py-1.5 rounded-lg border border-zinc-800 break-all select-all">
              {projectPath}
            </p>
          )}
          {sessionCount > 0 ? (
            <p>
              This will permanently remove <span className="font-semibold text-zinc-100">{sessionCount} conversation{sessionCount === 1 ? '' : 's'}</span> and workspace metadata.
            </p>
          ) : (
            <p>
              This workspace has no active conversations.
            </p>
          )}
          <p className="text-[11.5px] text-emerald-400/90 dark:text-emerald-400/80">
            Local code and document files in this folder will remain untouched on disk.
          </p>
        </div>

        {/* Actions (Bottom-right aligned) */}
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 bg-[#27272a] hover:bg-[#323236] active:bg-[#3a3a3f] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-[#e05252] hover:bg-[#d44343] active:scale-[0.98] transition-all cursor-pointer shadow-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
