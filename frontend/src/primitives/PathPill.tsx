"use client";

import React from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizePath } from '@/utils/normalizePath';

export interface PathPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  path: string;
  onOpenFolder?: (path: string) => void;
}

/**
 * PathPill Primitive
 * 
 * Renders directory paths, workspace folders, and partial paths (e.g. `workpapers/FY26/`)
 * in calm, executive neutral styling with a folder indicator.
 */
export function PathPill({
  path,
  onOpenFolder,
  className,
  onClick,
  ...props
}: PathPillProps) {
  const clean = normalizePath(path.trim(), false);
  const display = clean.replace(/\/+$/, '') || clean;

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onClick?.(e);
    onOpenFolder?.(clean);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Folder: ${clean}`}
      className={cn(
        "group inline-flex items-center gap-1.5 h-[21px] px-1.5 py-0 mx-0.5 rounded-[4px] font-mono text-[11px] leading-none select-none cursor-pointer align-baseline my-0 outline-none transition-all duration-150 active:scale-[0.98]",
        "bg-zinc-100 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
        "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20]",
        "shadow-2xs",
        className
      )}
      {...props}
    >
      <Folder size={11.5} className="shrink-0 text-amber-600/70 dark:text-amber-400/80 group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors" />
      <span className="truncate max-w-[260px] font-medium leading-none">
        {display}/
      </span>
    </button>
  );
}

export default PathPill;
