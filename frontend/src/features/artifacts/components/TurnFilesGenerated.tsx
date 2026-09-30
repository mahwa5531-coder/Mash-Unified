"use client";

import React, { useState } from 'react';
import { ChevronDown, FileText } from 'lucide-react';
import { FilePill } from '@/primitives/FilePill';
import { cn } from '@/lib/utils';
import { EditedFileItem } from '@/types/artifacts';

export type { EditedFileItem } from '@/types/artifacts';

interface TurnFilesGeneratedProps {
  files: EditedFileItem[];
  totalAdded?: number;
  totalDeleted?: number;
  onOpenFile?: (path: string) => void;
  sessionId?: string;
}

/**
 * TurnFilesGenerated
 * 
 * Displays files created, generated, or modified in the current assistant turn.
 * Features full-width clickable rows, unified FilePills, and ghost folder paths.
 * Rendered inline right before the turn footer for quick inspection.
 */
export function TurnFilesGenerated({
  files,
  totalAdded = 0,
  totalDeleted = 0,
  onOpenFile,
  sessionId,
}: TurnFilesGeneratedProps) {
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
          <span className="text-zinc-700 dark:text-zinc-300 font-medium">
            {count} file{count > 1 ? 's' : ''} generated in this turn
          </span>
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
          title="Open first generated file"
        >
          <FileText size={12.5} className="text-zinc-500 dark:text-zinc-400" />
          <span>Open</span>
        </button>
      </div>

      {/* Expanded File List - Entire Row is Clickable */}
      {isOpen && (
        <div className="flex flex-col gap-1 mt-2.5 pt-0.5">
          {files.map((file, idx) => {
            const rawDir = file.dir || '';
            const cleanDir = rawDir
              ? (rawDir.replace(/\\/g, '/').startsWith('/') ? rawDir.replace(/\\/g, '/') : `/${rawDir.replace(/\\/g, '/')}`)
              : '';

            return (
              <div
                key={file.path || idx}
                role="button"
                tabIndex={0}
                onClick={() => onOpenFile?.(file.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenFile?.(file.path);
                  }
                }}
                className="w-full text-left flex items-center justify-between py-1 px-1.5 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-white/[0.04] cursor-pointer group select-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                title={`Click anywhere to open ${file.path}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Canonical FilePill */}
                  <FilePill 
                    path={file.path} 
                    label={file.filename} 
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFile?.(file.path);
                    }} 
                  />
                  {/* Ghost Folder Directory Path - Decreased Size & Calm Tone */}
                  {cleanDir && (
                    <span className="text-[10.5px] font-mono text-zinc-400/80 dark:text-zinc-500/70 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors truncate">
                      {cleanDir}
                    </span>
                  )}
                </div>

                {file.addedLines !== undefined && file.addedLines > 0 && (
                  <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 shrink-0 ml-2">
                    +{file.addedLines}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TurnFilesGenerated;
