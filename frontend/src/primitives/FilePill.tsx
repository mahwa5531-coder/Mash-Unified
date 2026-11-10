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
  isClickable?: boolean;
  onOpenFile?: (path: string) => void;
  /** Optional callback to close / remove the file pill (swaps logo with [X] in same left slot on hover) */
  onClose?: (e: React.MouseEvent) => void;
}

export function FilePill({
  path,
  label,
  line,
  isClickable: propIsClickable,
  onOpenFile,
  onClose,
  className,
  onClick,
  ...props
}: FilePillProps) {
  const cleanPath = normalizePath(path, false);
  const [filePathOnly, hashAnchor] = cleanPath.split('#');

  const parts = filePathOnly.split(/[/\\]/);
  const basename = parts.pop() || filePathOnly;
  const parent = parts.length > 0 ? parts[parts.length - 1] : '';
  const isInternalStaging = parent.startsWith('.') || parent === 'tmp' || parent === 'cache';
  const halfPath = parent && !isInternalStaging && !/^[a-zA-Z]:$/.test(parent) ? `${parent}/${basename}` : basename;
  const rawDisplay = label || halfPath;

  const slashIdx = rawDisplay.lastIndexOf('/');
  const hasDir = slashIdx >= 0;
  const dirPrefix = hasDir ? rawDisplay.slice(0, slashIdx + 1) : '';
  const filePart = hasDir ? rawDisplay.slice(slashIdx + 1) : rawDisplay;

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

  // A file pill displays an authentic logo whenever it has a valid filename/path (and not a pure wildcard query)
  const hasWildcard = cleanPath.includes('*') || cleanPath.includes('?');
  const showIcon = !hasWildcard && Boolean(filePathOnly.trim());
  const isClickable = propIsClickable !== undefined
    ? Boolean(propIsClickable && !hasWildcard)
    : Boolean(!hasWildcard && (onOpenFile || onClick));

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isClickable) return;
    onClick?.(e);
    onOpenFile?.(cleanPath);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isClickable ? `Open ${cleanPath}${lineSuffix}` : rawDisplay}
      className={cn(
        "group inline-flex items-center gap-1.5 h-[25px] px-2.5 py-0.5 mx-0.5 rounded-[6px] font-sans text-[12px] leading-tight select-none align-middle relative -top-[0.5px] outline-none transition-all duration-150",
        isClickable ? "cursor-pointer active:scale-[0.98]" : "cursor-default",
        // Calm ghost styling: clean neutral surface, authentic file logo, subtle hover highlight
        "bg-zinc-100/90 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20]",
        "shadow-2xs",
        className
      )}
      {...props}
    >
      {/* File logo and/or close button in the left slot */}
      {(showIcon || onClose) && (
        <span className="relative flex items-center justify-center shrink-0 w-4 h-4">
          {showIcon && (
            <span className={cn(
              "flex items-center justify-center shrink-0 transition-opacity duration-100",
              onClose ? "group-hover:opacity-0 group-hover:pointer-events-none" : ""
            )}>
              <FileIcon filename={filePathOnly} size={13.5} className="shrink-0 group-hover:scale-105 transition-transform" />
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
              className="absolute inset-0 m-auto w-3.5 h-3.5 p-0 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-200/80 dark:hover:bg-white/[0.15] opacity-0 group-hover:opacity-100 transition-all cursor-pointer outline-none shrink-0"
              title={`Remove ${rawDisplay}`}
              aria-label={`Remove ${rawDisplay}`}
            >
              <X size={10} strokeWidth={2.2} />
            </span>
          )}
        </span>
      )}

      <span className="truncate max-w-[340px] sm:max-w-[380px] leading-tight">
        {dirPrefix && (
          <span className="text-zinc-400 dark:text-zinc-500 font-normal">
            {dirPrefix}
          </span>
        )}
        <span className="font-medium text-zinc-700 group-hover:text-zinc-950 dark:text-zinc-200 dark:group-hover:text-white">
          {filePart}
        </span>
      </span>
      {lineSuffix && (
        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-400 font-normal leading-tight shrink-0">
          {lineSuffix}
        </span>
      )}
    </button>
  );
}

export default FilePill;
