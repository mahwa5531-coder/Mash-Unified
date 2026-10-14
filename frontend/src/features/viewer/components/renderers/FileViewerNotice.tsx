"use client";

import React from 'react';
import { X } from 'lucide-react';

interface FileViewerNoticeProps {
  message: string;
  filename?: string;
  path?: string;
}

export function FileViewerNotice({ message, filename, path }: FileViewerNoticeProps) {
  const displayName = filename || (path ? path.split(/[/\\]/).pop() : undefined);
  const ext = displayName?.includes('.') ? displayName.split('.').pop()?.toLowerCase() : undefined;

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center bg-[var(--bg-app)] dark:bg-black select-none">
      <div className="w-12 h-12 rounded-full border-[2.2px] border-red-500/90 flex items-center justify-center text-red-500 mb-4 shadow-sm">
        <X size={24} strokeWidth={2.2} />
      </div>
      {displayName && (
        <div className="flex items-center gap-1.5 mb-1.5 max-w-sm px-2 truncate">
          <span
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
            title={displayName}
          >
            {displayName}
          </span>
          {ext && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-medium bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-700 dark:text-zinc-300 shrink-0">
              .{ext}
            </span>
          )}
        </div>
      )}
      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal tracking-wide">
        {message}
      </span>
    </div>
  );
}

export default FileViewerNotice;
