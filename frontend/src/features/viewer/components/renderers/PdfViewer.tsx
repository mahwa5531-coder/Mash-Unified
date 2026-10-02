"use client";

import React from 'react';
import { BASE_URL } from '@/services/client';

interface PdfViewerProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery: string;
}

export function PdfViewer({ filename, path, sessionQuery }: PdfViewerProps) {
  const pdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}${sessionQuery}#toolbar=1&navpanes=0`;

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] overflow-hidden select-none relative">
      <iframe
        src={pdfUrl}
        className="w-full h-full border-0 bg-white dark:bg-[#1a1a1d]"
        title={filename}
      />
    </div>
  );
}
