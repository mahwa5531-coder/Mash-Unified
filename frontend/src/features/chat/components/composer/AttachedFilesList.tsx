"use client";

import React from 'react';
import { Paperclip, X } from 'lucide-react';
import type { AttachedFile } from '@/features/chat/hooks/useChatAttachments';

interface AttachedFilesListProps {
  attachedFiles: AttachedFile[];
  onRemove: (index: number) => void;
}

export function AttachedFilesList({ attachedFiles, onRemove }: AttachedFilesListProps) {
  if (attachedFiles.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-0.5">
      {attachedFiles.map((f, i) => (
        <div
          key={f.path || `${f.name}_${i}`}
          className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--m-radius-sm)] bg-zinc-100/70 hover:bg-zinc-200/90 dark:bg-white/[0.04] dark:hover:bg-white/[0.09] border border-zinc-200/90 dark:border-white/[0.08] text-[11.5px] text-zinc-700 dark:text-zinc-300 font-mono select-none transition-all duration-150"
        >
          {/* Left slot: swaps icon for [X] on hover in the exact same spot */}
          <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5">
            <span className="flex items-center justify-center shrink-0 transition-opacity duration-100 group-hover:opacity-0 group-hover:pointer-events-none">
              {f.previewUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={f.previewUrl} alt={f.name} className="w-3.5 h-3.5 rounded object-cover" />
              ) : (
                <Paperclip size={11} className="text-zinc-400 dark:text-zinc-500" />
              )}
            </span>
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute inset-0 m-auto w-3.5 h-3.5 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover:opacity-100 transition-all cursor-pointer outline-none shrink-0"
              title={`Remove ${f.name}`}
              aria-label={`Remove ${f.name}`}
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          </span>
          <span className="truncate max-w-[180px] font-medium">{f.name}</span>
        </div>
      ))}
    </div>
  );
}
