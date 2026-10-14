"use client";

import React from 'react';
import { X } from 'lucide-react';
import { FileIcon } from '@/primitives';
import type { AttachedFile } from '@/features/chat/hooks/useChatAttachments';

interface AttachedFilesListProps {
  attachedFiles: AttachedFile[];
  onRemove: (index: number) => void;
}

export function AttachedFilesList({ attachedFiles, onRemove }: AttachedFilesListProps) {
  if (attachedFiles.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1 pt-0.5 pb-0.5 overflow-x-auto no-scrollbar flex-nowrap shrink-0">
      {attachedFiles.map((f, i) => {
        const isImage = Boolean(f.previewUrl || /\.(png|jpe?g|webp|gif|svg|bmp)$/i.test(f.name));

        if (isImage) {
          return (
            <div
              key={f.path || `${f.name}_${i}`}
              className="group relative w-7 h-7 rounded-md overflow-hidden border border-zinc-200 dark:border-white/10 bg-zinc-100 dark:bg-[#202024] shadow-sm shrink-0 select-none transition-transform hover:scale-105"
              title={f.name}
            >
              {f.previewUrl ? (
                 
                <img src={f.previewUrl} alt={f.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 text-zinc-400">
                  <FileIcon filename={f.name} size={14} />
                </div>
              )}
              {/* Dismiss button overlay on hover */}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute inset-0 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title={`Remove ${f.name}`}
                aria-label={`Remove ${f.name}`}
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
          );
        }

        return (
          <div
            key={f.path || `${f.name}_${i}`}
            className="group relative flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md bg-zinc-100 dark:bg-[#202024] border border-zinc-200 dark:border-white/[0.08] hover:border-zinc-300 dark:hover:border-white/[0.18] shadow-sm select-none transition-all shrink-0 max-w-[150px]"
            title={f.name}
          >
            {/* Authentic Brand / File Type Logo */}
            <div className="shrink-0 flex items-center justify-center">
              <FileIcon filename={f.name} size={15} isFolder={f.isFolder} />
            </div>

            {/* File / Folder Name */}
            <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200 truncate leading-none">
              {f.name}
            </span>

            {/* Inline remove button */}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="ml-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-white/[0.1] transition-colors cursor-pointer shrink-0"
              title={`Remove ${f.name}`}
              aria-label={`Remove ${f.name}`}
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default AttachedFilesList;

