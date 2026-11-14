"use client";

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import FileIcon from '@/primitives/FileIcon';
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
 * Formats a file path into filename and display directory
 */
export function formatDisplayPath(filePath: string, explicitDir?: string): { filename: string; displayDir: string } {
  if (!filePath && !explicitDir) return { filename: '', displayDir: '' };

  const normalized = (filePath || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const filename = segments.pop() || normalized;

  let rawDir = explicitDir ? explicitDir.replace(/\\/g, '/') : segments.join('/');

  let cleanDir = rawDir.replace(/\/+$/, '');
  if (cleanDir && !cleanDir.startsWith('/')) {
    cleanDir = `/${cleanDir}`;
  }

  return { filename, displayDir: cleanDir };
}

/**
 * TurnFilesGenerated
 * 
 * Displays files created, generated, or modified in the current assistant turn.
 * Rendered inline right before the turn footer for quick inspection.
 * Clean, calm presentation tailored for auditors (zero developer line-diff noise).
 */
export function TurnFilesGenerated({
  files,
  totalAdded: _totalAdded,
  totalDeleted: _totalDeleted,
  onOpenFile,
  sessionId: _sessionId,
}: TurnFilesGeneratedProps) {
  const [isOpen, setIsOpen] = useState(true);

  if (!files || files.length === 0) return null;

  const count = files.length;
  const headerLabel = `${count} file${count > 1 ? 's' : ''} generated in this turn`;

  return (
    <div className={cn(
      "w-full bg-zinc-50/90 dark:bg-[#121214] border border-zinc-200/90 dark:border-white/[0.08] rounded-xl shadow-2xs select-text transition-all",
      isOpen ? "p-3 my-2" : "py-2 px-3 my-1.5"
    )}>
      {/* Header Bar */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between cursor-pointer select-none group py-0.5"
      >
        <div className="flex items-center gap-2 text-[13px]">
          <span className="text-zinc-800 dark:text-zinc-200 font-medium">
            {headerLabel}
          </span>

          <ChevronDown 
            size={13} 
            className={cn("text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-transform duration-200", !isOpen && "-rotate-90")} 
          />
        </div>
      </div>

      {/* Expanded File List */}
      {isOpen && (
        <div className="flex flex-col gap-0.5 mt-2 pt-1 border-t border-zinc-200/50 dark:border-white/[0.05]">
          {files.map((file, idx) => {
            const { filename, displayDir } = formatDisplayPath(file.path, file.dir);

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
                className="w-full flex items-center justify-between py-1 px-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-white/[0.04] cursor-pointer group transition-colors outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 select-text"
                title={`Click to open ${file.path}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex items-center justify-center shrink-0 w-4 h-4">
                    <FileIcon filename={file.path} size={14} className="shrink-0" />
                  </span>
                  <span className="font-medium text-[13px] text-zinc-800 dark:text-zinc-200 shrink-0">
                    {filename}
                  </span>
                  {displayDir && (
                    <span className="text-[12px] font-sans text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-400 transition-colors truncate">
                      {displayDir}
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

export default TurnFilesGenerated;
