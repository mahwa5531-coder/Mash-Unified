"use client";

import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface DeleteSessionConfirmDialogProps {
  isOpen: boolean;
  sessionTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteSessionConfirmDialog({
  isOpen,
  sessionTitle,
  onConfirm,
  onCancel,
}: DeleteSessionConfirmDialogProps) {
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
        className="w-full max-w-[430px] rounded-2xl p-6 bg-[#18181b] dark:bg-[#18181b] border border-zinc-800 dark:border-white/[0.08] shadow-2xl text-left select-none animate-in zoom-in-95 duration-100 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: Title and Close [X] */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-zinc-100">
            Delete Conversation
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
        <p className="text-[13px] text-zinc-400 dark:text-zinc-400 leading-relaxed mb-6">
          Are you sure you want to delete this conversation? This action cannot be undone.
        </p>

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
            className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-[#1d70e2] hover:bg-[#1a64cb] active:scale-[0.98] transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <span>Delete</span>
            <span className="text-[11px] opacity-80 font-mono">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
