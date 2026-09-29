"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export interface ExtensionBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  extension: string;
}

/**
 * ExtensionBadge Primitive
 * 
 * Calm, static ghost pill for file extensions (e.g. `.xlsx`, `.pdf`, `.md`).
 * Logo removed, no cursor glow, neutral monochrome styling matching PathPill.
 */
export function ExtensionBadge({
  extension,
  className,
  ...props
}: ExtensionBadgeProps) {
  const clean = extension.replace(/^\.+/, '').toLowerCase().trim();
  const displayLabel = `.${clean}`;

  return (
    <span
      title={`File format: ${displayLabel}`}
      className={cn(
        "inline-flex items-center h-[21px] px-2 mx-0.5 rounded-[4px] font-mono text-[11px] font-medium leading-none select-text align-baseline my-0",
        "bg-zinc-100 dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 border border-zinc-200/90 dark:border-white/[0.08]",
        className
      )}
      {...props}
    >
      {displayLabel}
    </span>
  );
}

export default ExtensionBadge;
