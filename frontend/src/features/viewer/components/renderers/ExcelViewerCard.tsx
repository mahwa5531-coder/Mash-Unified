"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Download, Loader2, ExternalLink, AlertCircle, Check, RefreshCw } from 'lucide-react';
import { BASE_URL, safeFetch } from '@/services/client';
import { FluentExcelLogo } from '@/primitives/FileLogos';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';
import { cn } from '@/lib/utils';
import { ExcelViewer } from './ExcelViewer';

export interface ExcelViewerCardProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery?: string;
}

/**
 * Desktop host shell for spreadsheets.
 * Responsible for local binary fetch, Electron/desktop system launch,
 * download actions, and file metadata headers, hosting the unitised <ExcelViewer />.
 */
export function ExcelViewerCard({
  filename,
  path,
  sessionId,
  sessionQuery = '',
}: ExcelViewerCardProps) {
  const isDark = useIsDarkMode();
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const downloadTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const displayName = filename || (path ? path.split(/[/\\]/).pop() : 'Workbook.xlsx') || 'Workbook.xlsx';
  const ext = displayName.includes('.') ? displayName.split('.').pop()?.toLowerCase() : 'xlsx';
  const baseName = ext ? displayName.slice(0, -(ext.length + 1)) : displayName;

  const targetPath = path || filename;
  const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(targetPath)}&raw=true${sessionQuery}`;

  // Cleanup download feedback timer on unmount
  useEffect(() => {
    return () => {
      if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
    };
  }, []);

  // Fetch workbook binary bytes
  const loadWorkbookBytes = useCallback(async () => {
    setIsLoadingFile(true);
    setLoadError(null);

    try {
      // 1. Primary route: backend files content endpoint with &raw=true
      const primaryUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(targetPath)}&raw=true${sessionQuery}`;
      let res = await safeFetch(primaryUrl).catch(() => null);

      // 2. Fallback: if served from public directory directly
      if (!res || !res.ok) {
        const publicFallbackUrl = targetPath.startsWith('/')
          ? targetPath
          : `/${targetPath.replace(/^frontend[/\\]public[/\\]/, '')}`;
        const fallbackRes = await fetch(publicFallbackUrl).catch(() => null);
        if (fallbackRes && fallbackRes.ok) {
          res = fallbackRes;
        }
      }

      if (!res || !res.ok) {
        throw new Error(`Failed to load workbook (${res ? res.status : 'offline'})`);
      }

      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) {
        throw new Error('Workbook data is empty.');
      }

      setArrayBuffer(buf);
    } catch (err: any) {
      console.warn('[ExcelViewerCard] Error loading workbook:', err);
      setLoadError(err?.message || 'Unable to load spreadsheet.');
    } finally {
      setIsLoadingFile(false);
    }
  }, [targetPath, sessionQuery]);

  useEffect(() => {
    loadWorkbookBytes();
  }, [loadWorkbookBytes]);

  const handleOpenInExcel = async () => {
    setIsOpening(true);
    setStatusFeedback(null);

    try {
      // 1. If running inside Electron shell with native API
      if (typeof window !== 'undefined' && (window as any).electronAPI?.openPath) {
        const errorMsg = await (window as any).electronAPI.openPath(targetPath);
        if (!errorMsg) {
          setStatusFeedback({
            type: 'success',
            message: 'Workbook launched in Microsoft Excel',
          });
          return;
        }
      }

      // 2. Loopback to Desktop Connector system router
      const res = await safeFetch(`${BASE_URL}/api/system/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: targetPath, session_id: sessionId }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.status !== 'success') {
        const rawMsg = data.message || '';
        const isNoApp = rawMsg.includes('1155') || rawMsg.toLowerCase().includes('no application');
        setStatusFeedback({
          type: 'error',
          message: isNoApp
            ? 'No spreadsheet app found. Click Download to open in Google Sheets or Excel.'
            : (rawMsg || 'Unable to launch spreadsheet application.'),
        });
      } else {
        setStatusFeedback({
          type: 'success',
          message: 'Launched in Microsoft Excel',
        });
      }
    } catch {
      setStatusFeedback({
        type: 'error',
        message: 'Could not connect to Desktop Connector to launch Excel.',
      });
    } finally {
      setTimeout(() => {
        setIsOpening(false);
      }, 1000);
    }
  };

  const handleDownloadClick = () => {
    setDownloaded(true);
    if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
    downloadTimerRef.current = setTimeout(() => {
      setDownloaded(false);
    }, 4000);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-app)] overflow-hidden select-none">
      {/* Sleek Excel Action Subheader */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200/80 dark:border-white/[0.08] bg-zinc-50/70 dark:bg-zinc-900/40 shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-5 h-5 rounded bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
            <FluentExcelLogo size={14} />
          </div>
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate" title={displayName}>
            {baseName}
          </span>
          {ext && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
              .{ext}
            </span>
          )}
          {arrayBuffer && (
            <span className="hidden sm:inline-block text-[10.5px] text-zinc-400 font-mono">
              ({(arrayBuffer.byteLength / 1024).toFixed(0)} KB)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenInExcel}
            disabled={isOpening}
            id="btn-open-in-excel"
            className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded text-[11px] font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-[#107C41] hover:bg-[#0E6B38] text-white shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
            title="Open file in Microsoft Excel on your desktop"
          >
            {isOpening ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                <span>Launching...</span>
              </>
            ) : (
              <>
                <span>Open in Excel</span>
                <ExternalLink size={10} className="opacity-80" />
              </>
            )}
          </button>

          <a
            href={downloadUrl}
            download={displayName}
            id="link-download-excel"
            onClick={handleDownloadClick}
            className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-zinc-200/60 hover:bg-zinc-200 dark:bg-white/[0.06] dark:hover:bg-white/[0.12] text-zinc-700 dark:text-zinc-200 border border-zinc-300/40 dark:border-white/[0.08]"
            title="Download workbook locally"
          >
            {downloaded ? (
              <>
                <Check size={11} className="text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
              </>
            ) : (
              <>
                <Download size={11} />
                <span>Download</span>
              </>
            )}
          </a>
        </div>
      </div>

      {/* Status banner (if any) */}
      {statusFeedback && (
        <div
          className={cn(
            "text-[11.5px] px-3 py-1 flex items-center gap-1.5 border-b animate-in fade-in duration-150",
            statusFeedback.type === 'success'
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
          )}
        >
          {statusFeedback.type === 'success' ? (
            <Check size={12} className="shrink-0 text-emerald-500" />
          ) : (
            <AlertCircle size={12} className="shrink-0 text-amber-500" />
          )}
          <span>{statusFeedback.message}</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 w-full h-full min-h-0 overflow-hidden relative">
        {isLoadingFile ? (
          <div className="flex flex-col items-center justify-center h-full w-full py-16 text-zinc-500 dark:text-zinc-400 gap-3">
            <Loader2 size={24} className="animate-spin text-emerald-500" />
            <span className="text-xs font-medium">Loading workbook data...</span>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center text-zinc-500 gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 mb-1">
              <AlertCircle size={22} />
            </div>
            <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Unable to load spreadsheet</h4>
            <p className="text-xs text-zinc-500 max-w-sm">{loadError}</p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={loadWorkbookBytes}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
              <a
                href={downloadUrl}
                download={displayName}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Download size={12} />
                <span>Download File</span>
              </a>
            </div>
          </div>
        ) : arrayBuffer ? (
          <ExcelViewer
            file={arrayBuffer}
            fileName={displayName}
            isDark={isDark}
            readOnly={true}
            allowResizeInReadOnly={true}
            downloadUrl={downloadUrl}
          />
        ) : null}
      </div>
    </div>
  );
}

export default ExcelViewerCard;
