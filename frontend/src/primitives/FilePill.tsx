"use client";

import React from 'react';
import { X } from 'lucide-react';
import FileIcon from '@/primitives/FileIcon';
import { cn } from '@/lib/utils';
import { normalizePath } from '@/utils/normalizePath';

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
  const cleanPath = normalizePath(path);
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

  // A full file path must contain a directory separator (/ or \) and not contain wildcards (* or ?)
  const hasSlash = cleanPath.includes('/') || cleanPath.includes('\\');
  const hasWildcard = cleanPath.includes('*') || cleanPath.includes('?');
  const isFullPath = hasSlash && !hasWildcard;
  const isClickable = Boolean(!hasWildcard && (onOpenFile || onClick));

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
      title={isClickable ? `Open ${cleanPath}${lineSuffix}` : rawDisplay}
      className={cn(
        "group inline-flex items-center gap-1.5 h-[21px] px-1.5 py-0 mx-0.5 rounded-[4px] font-mono text-[11px] leading-none select-none align-baseline my-0 outline-none transition-all duration-150",
        isClickable ? "cursor-pointer active:scale-[0.98]" : "cursor-default",
        // Calm ghost styling: clean neutral surface, authentic file logo, subtle hover highlight
        "bg-zinc-100/90 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
        "text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20]",
        "shadow-2xs",
        className
      )}
      {...props}
    >
      {/* File logo (only for full file paths) and/or close button in the left slot */}
      {(isFullPath || onClose) && (
        <span className="relative flex items-center justify-center shrink-0 w-3 h-3">
          {isFullPath && (
            <span className={cn(
              "flex items-center justify-center shrink-0 transition-opacity duration-100",
              onClose ? "group-hover:opacity-0 group-hover:pointer-events-none" : ""
            )}>
              <FileIcon filename={filePathOnly} size={12} className="shrink-0 group-hover:scale-105 transition-transform" />
            </span>
          )}

          {onClose && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onClose(e);
              }}
              className="absolute inset-0 m-auto w-3 h-3 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover:opacity-100 transition-all cursor-pointer outline-none shrink-0"
              title={`Remove ${rawDisplay}`}
              aria-label={`Remove ${rawDisplay}`}
            >
              <X size={10} strokeWidth={2.2} />
            </span>
          )}
        </span>
      )}

      <span className="truncate max-w-[240px] font-medium leading-none">
        {rawDisplay}
      </span>
      {lineSuffix && (
        <span className="font-mono text-[9.5px] text-zinc-400 dark:text-zinc-500 font-normal leading-none shrink-0">
          {lineSuffix}
        </span>
      )}
    </button>
  );
}

export default FilePill;
