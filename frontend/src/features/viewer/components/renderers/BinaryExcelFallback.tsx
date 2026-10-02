"use client";

import React from 'react';

interface BinaryExcelFallbackProps {
  filename?: string;
  path?: string;
  sessionId?: string;
  sessionQuery?: string;
}

export function BinaryExcelFallback({
  filename,
}: BinaryExcelFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50/60 dark:bg-[#121215] text-zinc-500 dark:text-zinc-400 select-none">
      <p className="text-xs font-sans text-muted-foreground">
        This file format is not supported for preview.
      </p>
    </div>
  );
}
