"use client";

import React from 'react';
import { X } from 'lucide-react';
import FileIcon from '@/components/common/FileIcon';
import { cn } from '@/lib/utils';

export interface FilePillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  path: string;
  label?: string;
  line?: number | string;
  onOpenFile?: (path: string) => void;
  /** Optional callback to close / remove the file pill (swaps logo with [X] in same left slot on hover) */
  onClose?: (e: React.MouseEvent) => void;
}

export function FilePill({
  path,
  label,
  line,
  onOpenFile,
  onClose,
  className,
  onClick,
  ...props
}: FilePillProps) {
  let cleanPath = decodeURIComponent(path || '').replace(/^file:\/\/\/?/i, '');
  cleanPath = cleanPath.replace(/^\/([a-zA-Z]:)/, '$1');
  const [filePathOnly, hashAnchor] = cleanPath.split('#');

  const parts = filePathOnly.split(/[/\\]/);
  const basename = parts.pop() || filePathOnly;
  const rawDisplay = label || basename;

  let lineSuffix = '';
  // Only append lineSuffix if rawDisplay does not already contain a line indicator (:12 or :L12 or :12-30)
  const hasLineInDisplay = /:(?:L)?\d+(?:-\d+)?$/i.test(rawDisplay);
  if (!hasLineInDisplay) {
    if (line) {
      const cleanLine = String(line).replace(/^[#L]+/, '');
      if (cleanLine) lineSuffix = `:${cleanLine}`;
    } else if (hashAnchor) {
      const cleanAnchor = hashAnchor.replace(/^[#L]+/, '');
      if (cleanAnchor) lineSuffix = `:${cleanAnchor}`;
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
    onOpenFile?.(cleanPath);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Open ${cleanPath}${lineSuffix}`}
      className={cn(
        "group inline-flex items-center gap-1.5 h-6 px-2 py-0 mx-0.5 rounded-[5px] font-mono text-[11.5px] leading-none select-none cursor-pointer align-baseline my-0.5 outline-none transition-all duration-150 active:scale-[0.98]",
        // Professional ghost styling: calm neutral by default, brightens cleanly on hover
        "bg-zinc-100/80 hover:bg-zinc-200/90 dark:bg-white/[0.05] dark:hover:bg-white/[0.10]",
        "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20]",
        "shadow-2xs",
        className
      )}
      {...props}
    >
      {/* Same space for logo and close button in the left slot */}
      <span className="relative flex items-center justify-center shrink-0 w-3.5 h-3.5">
        <span className={cn(
          "flex items-center justify-center shrink-0 transition-opacity duration-100",
          onClose ? "group-hover:opacity-0 group-hover:pointer-events-none" : ""
        )}>
          <FileIcon filename={filePathOnly} size={13} className="shrink-0 group-hover:scale-105 transition-transform" />
        </span>

        {onClose && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onClose(e);
            }}
            className="absolute inset-0 m-auto w-3.5 h-3.5 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover:opacity-100 transition-all cursor-pointer outline-none shrink-0"
            title={`Remove ${rawDisplay}`}
            aria-label={`Remove ${rawDisplay}`}
          >
            <X size={11} strokeWidth={2.2} />
          </span>
        )}
      </span>

      <span className="truncate max-w-[260px] font-medium leading-none">
        {rawDisplay}
      </span>
      {lineSuffix && (
        <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500 font-normal leading-none shrink-0">
          {lineSuffix}
        </span>
      )}
    </button>
  );
}

export default FilePill;
