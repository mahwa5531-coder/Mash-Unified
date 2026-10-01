"use client";

import React from 'react';
import { Download, FileText } from 'lucide-react';
import { BASE_URL } from '@/services/client';

interface UnsupportedDocFallbackProps {
  filename: string;
  cleanName: string;
  path?: string;
  sessionQuery: string;
}

export function UnsupportedDocFallback({
  filename,
  cleanName,
  path,
  sessionQuery,
}: UnsupportedDocFallbackProps) {
  const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;
  const extMatch = cleanName.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? `.${extMatch[1]}` : '';

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400 select-none">
      <div className="w-14 h-14 rounded-2xl bg-zinc-200 dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700/60 flex items-center justify-center mb-4 text-zinc-600 dark:text-zinc-400 shadow-md">
        <FileText size={28} className="text-zinc-600 dark:text-zinc-400" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 mb-1.5 font-mono break-all max-w-md">
        {filename}
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5 leading-relaxed">
        Preview is not supported for <span className="font-semibold text-zinc-700 dark:text-zinc-300">{ext}</span> files. MASH natively renders PDF, images, text, and JSON files.
      </p>
      <a
        href={downloadUrl}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2 border border-zinc-300 dark:border-zinc-700"
      >
        <Download size={14} />
        <span>Download File</span>
      </a>
    </div>
  );
}
