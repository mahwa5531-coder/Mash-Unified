"use client";

import React from 'react';
import { LogOut } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

interface SignOutConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SignOutConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
}: SignOutConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => { e.stopPropagation(); onCancel(); }}
    >
      <Card 
        className="w-full max-w-sm rounded-[32px] p-8 border border-zinc-200/80 dark:border-white/[0.08] shadow-2xl bg-white dark:bg-[#141416] text-center select-none animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="p-0 mb-4 flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mb-3 border border-red-500/20 shadow-xs">
            <LogOut size={24} />
          </div>
          <CardTitle className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Sign out of MASH?
          </CardTitle>
          <CardDescription className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
            Your working papers, local audit files, and session history will remain safely preserved on your machine.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={onConfirm}
            className="w-full h-10 rounded-2xl font-medium text-xs bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white shadow-sm transition-all cursor-pointer flex items-center justify-center"
          >
            Sign Out
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full h-10 rounded-2xl font-medium text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-all cursor-pointer flex items-center justify-center"
          >
            Cancel
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
