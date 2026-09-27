"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Loader2, FileSpreadsheet, Download } from "lucide-react";
import { BASE_URL, safeFetch } from "../../utils/apiClient";

const UniverExcelViewerInner = dynamic(
  () => import("./UniverExcelViewerInner"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full py-20 text-zinc-500 dark:text-zinc-400 gap-3">
        <Loader2 size={24} className="animate-spin text-emerald-500" />
        <span className="text-xs font-medium">Loading spreadsheet engine...</span>
      </div>
    ),
  }
);

interface UniverExcelViewerProps {
  data?: any;
  filename: string;
  path?: string;
  sessionId?: string;
}

export default function UniverExcelViewer({
  data,
  filename,
  path,
  sessionId,
}: UniverExcelViewerProps) {
  const [workbookData, setWorkbookData] = useState<any>(() => {
    if (data?.workbook) return data.workbook;
    if (data?.sheetOrder && data?.sheets) return data;
    return null;
  });
  const [isLoading, setIsLoading] = useState<boolean>(!workbookData && !!path);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.workbook) {
      setWorkbookData(data.workbook);
      setLoadError(null);
      setIsLoading(false);
      return;
    }
    if (data?.sheetOrder && data?.sheets) {
      setWorkbookData(data);
      setLoadError(null);
      setIsLoading(false);
      return;
    }

    if (path) {
      setIsLoading(true);
      setLoadError(null);
      const qs = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';
      const url = `${BASE_URL}/files/univer?path=${encodeURIComponent(path)}${qs}`;
      safeFetch(url)
        .then((res: Response) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to load file.`);
          return res.json();
        })
        .then((json: any) => {
          if (json?.workbook) {
            setWorkbookData(json.workbook);
          } else if (json?.sheetOrder && json?.sheets) {
            setWorkbookData(json);
          } else {
            throw new Error("Invalid spreadsheet format received from server.");
          }
        })
        .catch((err: any) => {
          console.warn("Failed to fetch Univer data:", err);
          setLoadError(err?.message || "Failed to load workbook.");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [data, path, sessionId]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-zinc-500 dark:text-zinc-400 gap-3 bg-zinc-50/50 dark:bg-[#121212]/50">
        <Loader2 size={24} className="animate-spin text-emerald-500" />
        <span className="text-xs font-medium">Parsing spreadsheet with Rust engine...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400">
        <FileSpreadsheet size={36} className="text-red-400 mb-3" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 mb-1">{filename}</h3>
        <p className="text-xs text-red-500 mb-4">{loadError}</p>
        {path && (
          <a
            href={`${BASE_URL}/files/content?path=${encodeURIComponent(path)}&raw=true`}
            target="_blank"
            rel="noreferrer"
            download={filename}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity"
          >
            Download File
          </a>
        )}
      </div>
    );
  }

  const sheetCount = workbookData?.sheetOrder?.length || Object.keys(workbookData?.sheets || {}).length || 0;
  const downloadUrl = path ? `${BASE_URL}/files/content?path=${encodeURIComponent(path)}&raw=true` : null;

  return (
    <div className="w-full h-full min-h-[400px] flex flex-col bg-white dark:bg-[#121212] overflow-hidden">
      {/* Audit Spreadsheet Toolbar */}
      <div className="h-8 px-3 border-b border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#18181b] flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 truncate max-w-[240px]">
            <FileSpreadsheet size={13.5} className="text-emerald-500 shrink-0" />
            <span className="truncate">{filename}</span>
          </span>
          {sheetCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-mono bg-zinc-200/80 dark:bg-white/[0.08] text-zinc-600 dark:text-zinc-300">
              {sheetCount} {sheetCount === 1 ? 'sheet' : 'sheets'}
            </span>
          )}
          <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
            Read-Only Audit View
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={filename}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-white dark:bg-white/[0.06] hover:bg-zinc-100 dark:hover:bg-white/[0.1] text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-white/[0.08] transition-colors cursor-pointer shadow-2xs"
              title="Download original file"
            >
              <Download size={11} />
              <span>Download</span>
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 w-full min-h-0 relative overflow-hidden">
        <UniverExcelViewerInner
          workbookData={workbookData}
          filename={filename}
          path={path}
        />
      </div>
    </div>
  );
}
