"use client";

import React, { useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { BASE_URL } from '@/services/client';
import { openSystemFile } from '@/services/files';

interface PdfViewerProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery: string;
}

export function PdfViewer({ filename, path, sessionId, sessionQuery }: PdfViewerProps) {
  const [isOpening, setIsOpening] = useState(false);
  const pdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}${sessionQuery}#toolbar=1&navpanes=0`;

  const handleOpenSystem = async () => {
    setIsOpening(true);
    await openSystemFile(path || filename, sessionId);
    setTimeout(() => setIsOpening(false), 1200);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] overflow-hidden select-none relative">
      <object
        data={pdfUrl}
        type="application/pdf"
        className="w-full h-full border-0 bg-white dark:bg-[#1a1a1d]"
      >
        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-[var(--text-muted)] gap-3 bg-[var(--bg-app)]">
          <FileText size={36} className="text-rose-500" />
          <p className="text-xs text-[var(--text-secondary)] max-w-xs">
            Embedded PDF preview is not supported by your current browser environment.
          </p>
          <button
            type="button"
            onClick={handleOpenSystem}
            disabled={isOpening}
            className="mt-2 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {isOpening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            <span>Open in System PDF Viewer</span>
          </button>
        </div>
      </object>
    </div>
  );
}
