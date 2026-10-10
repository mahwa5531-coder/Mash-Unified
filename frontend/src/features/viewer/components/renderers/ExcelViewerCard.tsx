"use client";

import React, { useState } from 'react';
import { Download, Loader2, ExternalLink, AlertCircle, Check } from 'lucide-react';
import { BASE_URL, safeFetch } from '@/services/client';
import { FluentExcelLogo } from '@/primitives/FileLogos';

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
  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

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
              ? 'No spreadsheet application found. Please download the file or install Excel.'
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
            ? 'No spreadsheet application found. Please download the file to view it in Google Sheets or Excel.'
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
      }, 1200);
    }
  };

  const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;

  return (
    <div className="flex flex-col items-center justify-center h-full w-full p-6 text-center bg-[var(--bg-app)] dark:bg-black select-none">
      <div className="max-w-sm w-full flex flex-col items-center p-8 rounded-2xl border border-zinc-200/80 dark:border-white/[0.08] bg-white dark:bg-zinc-900/80 shadow-xl backdrop-blur-md">
        {/* Fluent Excel Logo */}
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 dark:bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-4 shadow-sm group">
          <FluentExcelLogo size={36} className="transition-transform group-hover:scale-105 duration-200" />
        </div>

        {/* File Name & Type */}
        <h3
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5 max-w-full truncate px-1"
          title={filename}
        >
          {filename}
        </h3>
        <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mb-6 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Microsoft Excel Spreadsheet (.xlsx)
        </p>

        {/* Primary Action Button: Open in Excel */}
        <button
          type="button"
          onClick={handleOpenInExcel}
          disabled={isOpening}
          id="btn-open-in-excel"
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs text-white bg-[#107C41] hover:bg-[#0E6B38] active:scale-[0.98] shadow-md transition-all cursor-pointer mb-2.5 disabled:opacity-70 disabled:cursor-not-allowed"
          title="Open this file in Microsoft Excel or your default spreadsheet application"
        >
          {isOpening ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              <span>Launching Excel...</span>
            </>
          ) : (
            <>
              <FluentExcelLogo size={16} />
              <span>Open in Microsoft Excel</span>
              <ExternalLink size={13} className="opacity-80" />
            </>
          )}
        </button>

        {/* Secondary Action: Download Full File */}
        <a
          href={downloadUrl}
          download={filename}
          id="link-download-excel"
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 hover:bg-zinc-200/70 dark:bg-white/[0.06] dark:hover:bg-white/[0.10] transition-colors cursor-pointer"
        >
          <Download size={12} />
          <span>Download File</span>
        </a>

        {/* Feedback message on launch attempt */}
        {statusFeedback && (
          <div
            className={`mt-4 px-3 py-2 rounded-lg text-xs flex items-center gap-1.5 text-left w-full ${
              statusFeedback.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
            }`}
          >
            {statusFeedback.type === 'success' ? (
              <Check size={14} className="shrink-0 text-emerald-500" />
            ) : (
              <AlertCircle size={14} className="shrink-0 text-amber-500" />
            )}
            <span className="leading-tight">{statusFeedback.message}</span>
          </div>
        )}

        {/* Subtle Explanation Footnote */}
        {!statusFeedback && (
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-4 leading-normal">
            Opens directly in Microsoft Excel on your computer.
          </p>
        )}
      </div>
    </div>
  );
}

export default ExcelViewerCard;
