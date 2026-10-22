"use client";

import React, { useState, useRef } from 'react';
import { Download, Loader2, ExternalLink, AlertCircle, Check } from 'lucide-react';
import { BASE_URL, safeFetch } from '@/services/client';
import { FluentExcelLogo } from '@/primitives/FileLogos';
import { cn } from '@/lib/utils';

export interface ExcelViewerCardProps {
  filename: string;
  path?: string;
  sessionId?: string;
  sessionQuery?: string;
}

export function ExcelViewerCard({
  filename,
  path,
  sessionId,
  sessionQuery = '',
}: ExcelViewerCardProps) {
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

  const handleOpenInExcel = async () => {
    setIsOpening(true);
    setStatusFeedback(null);

    const targetPath = path || filename;

    try {
      // 1. If running inside Electron shell with native API
      if (typeof window !== 'undefined' && (window as any).electronAPI?.openPath) {
        const errorMsg = await (window as any).electronAPI.openPath(targetPath);
        if (errorMsg) {
          setStatusFeedback({
            type: 'error',
            message: errorMsg.includes('1155') || errorMsg.toLowerCase().includes('no application')
              ? 'No spreadsheet app found. Click Download to open in Google Sheets or Excel.'
              : errorMsg,
          });
        } else {
          setStatusFeedback({
            type: 'success',
            message: 'Workbook launched in Microsoft Excel',
          });
        }
        return;
      }

      // 2. Loopback to Desktop Connector system router
      const res = await safeFetch(`${BASE_URL}/api/system/open-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_path: targetPath, session_id: sessionId }),
      });

      const data = await res.json().catch(() => ({}));

      if (data.status === 'success') {
        setStatusFeedback({
          type: 'success',
          message: 'Workbook launched in Microsoft Excel',
        });
      } else {
        const rawMsg = data.message || '';
        const isNoApp = rawMsg.includes('1155') || rawMsg.toLowerCase().includes('no application');
        setStatusFeedback({
          type: 'error',
          message: isNoApp
            ? 'No spreadsheet app found. Click Download to open in Google Sheets or Excel.'
            : (rawMsg || 'Unable to launch spreadsheet application.'),
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

  const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-8 text-center bg-[var(--bg-app)] dark:bg-black select-none">
      {/* Fluent Excel Logo */}
      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-3 shadow-2xs">
        <FluentExcelLogo size={28} />
      </div>

      {/* File Name Header + Extension Badge */}
      <div className="flex items-center gap-1.5 mb-1 max-w-sm px-2 truncate justify-center">
        <span
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate"
          title={displayName}
        >
          {baseName}
        </span>
        {ext && (
          <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono font-medium bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-700 dark:text-zinc-300 shrink-0">
            .{ext}
          </span>
        )}
      </div>

      {/* Clean Single Subtitle */}
      <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal mb-5">
        Microsoft Excel Spreadsheet
      </span>

      {/* Twin Pill Action Buttons */}
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={handleOpenInExcel}
          disabled={isOpening}
          id="btn-open-in-excel"
          className="inline-flex items-center gap-1.5 h-[30px] px-3.5 rounded-full font-sans text-xs font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-[#107C41] hover:bg-[#0E6B38] text-white shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
          title="Open this file in Microsoft Excel or your default spreadsheet application"
        >
          {isOpening ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              <span>Launching...</span>
            </>
          ) : (
            <>
              <span>Open in Excel</span>
              <ExternalLink size={12} className="opacity-80" />
            </>
          )}
        </button>

        <a
          href={downloadUrl}
          download={filename}
          id="link-download-excel"
          onClick={handleDownloadClick}
          className="inline-flex items-center gap-1.5 h-[30px] px-3.5 rounded-full font-sans text-xs font-medium leading-none select-none outline-none transition-all duration-150 cursor-pointer active:scale-[0.97] bg-zinc-100 hover:bg-zinc-200 dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white border border-zinc-200 dark:border-white/[0.08] shadow-xs"
          title="Download file to your local computer"
        >
          {downloaded ? (
            <>
              <Check size={13} className="text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">Downloaded</span>
            </>
          ) : (
            <>
              <Download size={12} />
              <span>Download</span>
            </>
          )}
        </a>
      </div>

      {/* Confirmation of Download Destination */}
      {downloaded && (
        <div className="text-[11.5px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1 mt-1 animate-in fade-in duration-150 select-text">
          <Check size={12} className="text-emerald-500 shrink-0" />
          <span>Saved to your Downloads folder</span>
        </div>
      )}

      {/* Calm Ghost Error / Success Feedback */}
      {statusFeedback && (
        <div
          className={cn(
            "text-xs flex items-center gap-1.5 mt-2 max-w-sm px-2 text-center",
            statusFeedback.type === 'success'
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-zinc-500 dark:text-zinc-400"
          )}
        >
          {statusFeedback.type === 'success' ? (
            <Check size={13} className="shrink-0 text-emerald-500" />
          ) : (
            <AlertCircle size={13} className="shrink-0 text-amber-500" />
          )}
          <span className="leading-tight">{statusFeedback.message}</span>
        </div>
      )}
    </div>
  );
}

export default ExcelViewerCard;
