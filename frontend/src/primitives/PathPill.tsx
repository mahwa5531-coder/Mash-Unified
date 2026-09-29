"use client";

import React from 'react';
import { Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizePath } from '@/utils/normalizePath';

export interface PathPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  path: string;
}

/**
 * PathPill Primitive
 * 
 * Non-clickable static pill for directory paths and workspace folders (e.g. `workpapers/FY26/`).
 * Calm, neutral ghost styling without hover glowing or pointer interaction.
 */
export function PathPill({
  path,
  className,
  ...props
}: PathPillProps) {
  const clean = normalizePath(path.trim(), false);
  const display = clean.replace(/\/+$/, '') || clean;

  return (
    <span
      title={`Folder: ${clean}/`}
      className={cn(
        "inline-flex items-center gap-1.5 h-[21px] px-1.5 py-0 mx-0.5 rounded-[4px] font-mono text-[11px] leading-none select-text align-baseline my-0",
        "bg-zinc-100 dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 border border-zinc-200/90 dark:border-white/[0.08]",
        className
      )}
      {...props}
    >
      <Folder size={11.5} className="shrink-0 text-amber-600/70 dark:text-amber-400/80" />
      <span className="truncate max-w-[260px] font-medium leading-none">
        {display}/
      </span>
    </span>
  );
}

export default PathPill;
