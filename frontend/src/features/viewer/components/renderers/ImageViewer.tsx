"use client";

import React from 'react';
import { BASE_URL } from '@/services/client';

interface ImageViewerProps {
  filename: string;
  path?: string;
  sessionQuery: string;
}

export function ImageViewer({ filename, path, sessionQuery }: ImageViewerProps) {
  const imgUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}${sessionQuery}`;
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
      <div className="max-w-full max-h-[500px] overflow-auto flex items-center justify-center bg-[var(--bg-app)]/50 p-4 rounded-lg border border-[var(--border-subtle)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img 
          src={imgUrl} 
          alt={filename}
          className="max-w-full max-h-[460px] object-contain rounded select-none shadow-sm"
        />
      </div>
      <div className="flex items-center justify-between w-full mt-4 px-2 text-xs text-[var(--text-muted)]">
        <span className="font-mono truncate">{filename}</span>
        <a 
          href={imgUrl} 
          target="_blank" 
          rel="noreferrer"
          className="text-[var(--accent)] hover:underline flex items-center gap-1"
        >
          Open in new tab
        </a>
      </div>
    </div>
  );
}
