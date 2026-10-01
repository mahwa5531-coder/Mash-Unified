"use client";

import React from 'react';
import { Download } from 'lucide-react';
import { BASE_URL } from '@/services/client';

interface PdfViewerProps {
  filename: string;
  path?: string;
  sessionQuery: string;
}

export function PdfViewer({ filename, path, sessionQuery }: PdfViewerProps) {
  const rawPdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;
  const embedPdfUrl = `${rawPdfUrl}#view=FitH&toolbar=1&navpanes=0`;

  return (
    <div className="flex flex-col h-full w-full bg-zinc-100 dark:bg-[#141414] overflow-hidden select-none">
      <div className="h-9 px-4 border-b border-zinc-200 dark:border-[#222] bg-white dark:bg-[#1a1a1d] flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
          <span className="font-mono text-zinc-800 dark:text-zinc-300 truncate text-[11.5px] font-medium">{filename}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={rawPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-500 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300 hover:underline flex items-center gap-1 cursor-pointer text-[11.5px]"
          >
            Open in new tab
          </a>
          <a
            href={rawPdfUrl}
            download={filename}
            className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Download PDF"
          >
            <Download size={13} />
          </a>
        </div>
      </div>
      <div className="flex-1 w-full h-full min-h-0 bg-zinc-200 dark:bg-[#2b2b2b] relative">
        <embed
          type="application/pdf"
          src={embedPdfUrl}
          className="w-full h-full border-0 absolute inset-0"
          title={filename}
        />
      </div>
    </div>
  );
}
