"use client";

import React from 'react';

interface UnsupportedDocFallbackProps {
  filename?: string;
  cleanName?: string;
  path?: string;
  sessionQuery?: string;
}

export function UnsupportedDocFallback({}: UnsupportedDocFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50/60 dark:bg-[#121215] text-zinc-500 dark:text-zinc-400 select-none">
      <p className="text-xs font-sans text-muted-foreground">
        This file format is not supported for preview.
      </p>
    </div>
  );
}
