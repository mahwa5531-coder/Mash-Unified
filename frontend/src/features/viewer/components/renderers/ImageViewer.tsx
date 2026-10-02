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
    <div className="flex items-center justify-center h-full w-full p-6 bg-[var(--bg-app)] overflow-auto select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img 
        src={imgUrl} 
        alt={filename}
        className="max-w-full max-h-full object-contain rounded-md shadow-sm select-none"
      />
    </div>
  );
}
