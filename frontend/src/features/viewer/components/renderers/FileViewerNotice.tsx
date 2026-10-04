"use client";

import React from 'react';
import { X } from 'lucide-react';

interface FileViewerNoticeProps {
  message: string;
}

export function FileViewerNotice({ message }: FileViewerNoticeProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center bg-zinc-950 dark:bg-black select-none">
      <div className="w-12 h-12 rounded-full border-[2.2px] border-red-500/90 flex items-center justify-center text-red-500 mb-4 shadow-sm">
        <X size={24} strokeWidth={2.2} />
      </div>
      <span className="text-sm text-zinc-400 font-normal tracking-wide">
        {message}
      </span>
    </div>
  );
}

export default FileViewerNotice;
