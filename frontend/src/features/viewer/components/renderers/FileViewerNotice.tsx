"use client";

import React from 'react';
import { X } from 'lucide-react';

interface FileViewerNoticeProps {
  message: string;
  filename?: string;
  path?: string;
  onRetry?: () => void;
  action?: React.ReactNode;
}

export function FileViewerNotice({ message, filename, path, onRetry, action }: FileViewerNoticeProps) {
  const displayName = filename || (path ? path.split(/[/\\]/).pop() : undefined);
  const ext = displayName?.includes('.') ? displayName.split('.').pop()?.toLowerCase() : undefined;
  const baseName = displayName && ext ? displayName.slice(0, -(ext.length + 1)) : displayName;

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
            {baseName}
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
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 transition-colors cursor-pointer select-none"
        >
          Retry Preview
        </button>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default FileViewerNotice;
