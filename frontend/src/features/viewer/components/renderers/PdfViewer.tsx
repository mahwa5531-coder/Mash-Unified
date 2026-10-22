"use client";

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { BASE_URL } from '@/services/client';
import { FileViewerNotice } from './FileViewerNotice';

interface PdfViewerProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery?: string;
}

export function PdfViewer({ filename, path, sessionQuery = '' }: PdfViewerProps) {
  const [retryKey, setRetryKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const rawTarget = path || filename;
  const pdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(rawTarget)}${sessionQuery}#toolbar=1&navpanes=0`;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMessage(null);

    // Pre-flight check to verify PDF endpoint is reachable and authorized
    const checkUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(rawTarget)}${sessionQuery}`;
    fetch(checkUrl, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 403) {
            setErrorMessage('Access denied: Path is outside authorized workspace directories.');
          } else if (res.status === 404) {
            setErrorMessage('File not found on local disk.');
          } else {
            setErrorMessage(`Unable to load PDF document (HTTP ${res.status}).`);
          }
          setIsLoading(false);
        } else {
          const contentLength = res.headers.get('content-length');
          if (contentLength === '0') {
            setErrorMessage('PDF document is empty (0 bytes).');
            setIsLoading(false);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(err?.message || 'Failed to connect to local server to load PDF.');
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rawTarget, sessionQuery, retryKey]);

  if (errorMessage) {
    return (
      <FileViewerNotice
        message={errorMessage}
        filename={filename}
        path={path}
        onRetry={() => {
          setIsLoading(true);
          setErrorMessage(null);
          setRetryKey((prev) => prev + 1);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] overflow-hidden select-none relative">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-app)] z-10 gap-2 text-zinc-500">
          <Loader2 size={20} className="animate-spin text-sky-500" />
          <span className="text-xs">Preparing PDF document...</span>
        </div>
      )}
      <iframe
        key={retryKey}
        src={pdfUrl}
        className="w-full h-full border-0 bg-white dark:bg-[#1a1a1d]"
        title={filename}
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
        onLoad={() => setIsLoading(false)}
      />
    </div>
  );
}
