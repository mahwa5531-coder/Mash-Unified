"use client";

import React, { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import FileIcon from '@/components/renderers/FileIcon';
import { cn } from '@/lib/utils';
import { EditedFileItem } from '@/types/artifacts';

export type { EditedFileItem } from '@/types/artifacts';

interface FilesChangedDrawerProps {
  files: EditedFileItem[];
  totalAdded?: number;
  totalDeleted?: number;
  onOpenFile?: (path: string) => void;
  sessionId?: string;
}

export default function FilesChangedDrawer({
  files,
  totalAdded = 0,
  totalDeleted = 0,
  onOpenFile,
  sessionId,
}: FilesChangedDrawerProps) {
  // Starts open by default and stays open across session shifts
  const [isOpen, setIsOpen] = useState(true);

  if (!files || files.length === 0) return null;

  const count = files.length;

  return (
    <div className={cn(
      "w-full bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-white/[0.08] rounded-2xl shadow-sm select-text transition-all",
      isOpen ? "p-3.5 my-2.5" : "py-[7px] px-3.5 my-1.5"
    )}>
      {/* Header Bar */}
      <div className="flex items-center justify-between select-none">
        <div 
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 cursor-pointer text-[13px]"
        >
          <span className="text-zinc-600 dark:text-zinc-400 font-normal">
            {count} file{count > 1 ? 's' : ''} changed
          </span>
          {totalAdded > 0 && (
            <span className="text-[#34d399] font-normal ml-0.5">+{totalAdded}</span>
          )}
          {totalDeleted > 0 && (
            <span className="text-[#f87171] font-normal ml-0.5">-{totalDeleted}</span>
          )}
          <ChevronDown 
            size={13} 
            className={cn("text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-transform duration-200 ml-0.5", !isOpen && "-rotate-90")} 
          />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (files.length > 0 && onOpenFile) {
              onOpenFile(files[0].path);
            }
          }}
          className="flex items-center gap-1.5 px-2.5 py-[3.5px] bg-white hover:bg-zinc-100 dark:bg-[#1a1a1c] dark:hover:bg-[#242428] border border-zinc-200 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.16] rounded-lg text-[12px] font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white transition-all cursor-pointer shadow-xs"
          title="Review changed files"
        >
          <FileText size={12.5} className="text-zinc-500 dark:text-zinc-400" />
          <span>Review</span>
        </button>
      </div>

      {/* Expanded File List */}
      {isOpen && (
        <div className="flex flex-col gap-1.5 mt-3 pt-0.5">
          {files.map((file, idx) => {
            const rawDir = file.dir || '';
            const cleanDir = rawDir
              ? (rawDir.replace(/\\/g, '/').startsWith('/') ? rawDir.replace(/\\/g, '/') : `/${rawDir.replace(/\\/g, '/')}`)
              : '';

            return (
              <div
                key={file.path || idx}
                onClick={() => onOpenFile?.(file.path)}
                className="flex items-center py-0.5 cursor-pointer group select-none transition-colors"
                title={`Open ${file.path}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileIcon 
                    filename={file.filename} 
                    size={15} 
                    className="opacity-70 group-hover:opacity-100 transition-opacity duration-150" 
                  />
                  <span className="text-[13px] font-normal text-zinc-700 group-hover:text-zinc-950 dark:text-zinc-400 dark:group-hover:text-white transition-colors duration-150 truncate">
                    {file.filename}
                  </span>
                  {cleanDir && (
                    <span className="text-[12.5px] text-zinc-400 dark:text-zinc-600 font-sans transition-colors duration-150 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 truncate ml-1">
                      {cleanDir}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
