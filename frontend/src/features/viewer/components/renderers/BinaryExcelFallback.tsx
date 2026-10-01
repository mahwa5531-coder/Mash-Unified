"use client";

import React, { useState } from 'react';
import { Download, Loader2, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { BASE_URL } from '@/services/client';
import { openSystemFile } from '@/services/files';

interface BinaryExcelFallbackProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery: string;
}

export function BinaryExcelFallback({
  filename,
  path,
  sessionId,
  sessionQuery,
}: BinaryExcelFallbackProps) {
  const [isOpeningSystem, setIsOpeningSystem] = useState(false);
  const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400 select-none">
      <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 shadow-md">
        <FileSpreadsheet size={28} />
      </div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1 font-mono break-all max-w-md">
        {filename}
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5 leading-relaxed">
        Excel Workbook
      </p>

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={async () => {
            setIsOpeningSystem(true);
            await openSystemFile(path || filename, sessionId);
            setTimeout(() => setIsOpeningSystem(false), 1200);
          }}
          disabled={isOpeningSystem}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2"
        >
          {isOpeningSystem ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
          <span>{isOpeningSystem ? "Opening..." : "Open in Excel"}</span>
        </button>

        <a
          href={downloadUrl}
          download={filename}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2 border border-zinc-300 dark:border-zinc-700"
        >
          <Download size={13} />
          <span>Download</span>
        </a>
      </div>
    </div>
  );
}
