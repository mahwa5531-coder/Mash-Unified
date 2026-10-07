"use client";

import React from 'react';
import { Trash2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

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
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <Card 
        className="w-full max-w-[360px] rounded-[28px] p-7 border border-zinc-200/80 dark:border-white/[0.08] shadow-2xl bg-white dark:bg-[#141416] text-center select-none animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="p-0 mb-4 flex flex-col items-center">
          {/* Warning Icon Badge in Red Accent */}
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mb-3 border border-red-500/20 shadow-xs">
            <Trash2 size={22} />
          </div>

          <CardTitle className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Delete conversation?
          </CardTitle>

          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
            {sessionTitle ? (
              <span>
                Delete <span className="font-medium text-zinc-800 dark:text-zinc-200">"{sessionTitle}"</span>?
              </span>
            ) : (
              <span>Delete this conversation?</span>
            )}
            <span className="block mt-1 text-[11.5px] text-zinc-500 dark:text-zinc-400">
              Its message history, tool reasoning, and scratch drafts will be permanently removed from MASH.
            </span>
          </CardDescription>

          {/* Reassurance banner: Original files untouched */}
          <div className="w-full mt-3 p-2 rounded-xl bg-zinc-100/70 dark:bg-white/[0.03] border border-zinc-200/60 dark:border-white/[0.05] text-[11px] text-zinc-600 dark:text-zinc-400 text-center">
            ✓ Your local files and spreadsheets on disk remain completely safe and untouched.
          </div>
        </CardHeader>

        <CardContent className="p-0 flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            className="w-full h-10 rounded-xl font-medium text-xs bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white shadow-sm transition-all cursor-pointer flex items-center justify-center"
          >
            Delete Conversation
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
