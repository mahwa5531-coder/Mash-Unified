"use client";

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { BASE_URL } from '@/services/client';
import { FileViewerNotice } from './FileViewerNotice';

interface ImageViewerProps {
  filename: string;
  path?: string;
  sessionQuery?: string;
}

export function ImageViewer({ filename, path, sessionQuery = '' }: ImageViewerProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  if (hasError) {
    return <FileViewerNotice message="Unable to load image" filename={filename} path={path} />;
  }

  const imgUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}${sessionQuery}`;

  return (
    <div className="relative flex items-center justify-center h-full w-full min-h-0 min-w-0 p-6 bg-[var(--bg-app)] overflow-auto select-none bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)]">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2 text-zinc-500">
          <Loader2 size={20} className="animate-spin text-sky-500" />
          <span className="text-xs">Loading image...</span>
        </div>
      )}
      <img 
        src={imgUrl} 
        alt={filename}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
        }}
        className="rounded-md shadow-sm select-none shrink-0"
      />
    </div>
  );
}
