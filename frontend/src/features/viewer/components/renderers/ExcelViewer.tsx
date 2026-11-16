"use client";

import React from 'react';
import dynamic from 'next/dynamic';
import { Loader2, AlertCircle, Download } from 'lucide-react';

// Dynamically import XlsxViewer with SSR disabled for browser WebAssembly execution
const DynamicXlsxViewer = dynamic(
  () => import('@extend-ai/react-xlsx').then((mod) => {
    // Bootstrap public WebAssembly asset source
    if (typeof window !== 'undefined' && mod.setWasmSource) {
      try {
        mod.setWasmSource('/duke_sheets_wasm_bg.wasm');
      } catch {
        // already initialized
      }
    }
    return mod.XlsxViewer;
  }),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center h-full w-full py-16 text-zinc-500 dark:text-zinc-400 gap-3">
        <Loader2 size={24} className="animate-spin text-emerald-500" />
        <span className="text-xs font-medium">Initializing virtualized spreadsheet engine...</span>
      </div>
    ),
  }
);

export interface ExcelViewerProps {
  /** The binary workbook data to render */
  file: ArrayBuffer;
  /** Display file name for the workbook and sheet tabs */
  fileName?: string;
  /** Whether dark palette should be applied */
  isDark?: boolean;
  /** Whether cell mutations/editing are disabled (default: true) */
  readOnly?: boolean;
  /** Allow resizing rows and columns in read-only mode (default: true) */
  allowResizeInReadOnly?: boolean;
  /** Show the built-in toolbar with zoom and sheet controls (default: true) */
  showDefaultToolbar?: boolean;
  /** Render embedded DrawingML charts, shapes, and images (default: true) */
  showImages?: boolean;
  /** CSS class applied to the container */
  className?: string;
  /** Container height */
  height?: React.CSSProperties['height'];
  /** Optional download URL if the workbook exceeds large-file thresholds */
  downloadUrl?: string;
}

/**
 * Pure, unitised spreadsheet viewer component.
 * Wraps @extend-ai/react-xlsx with WebAssembly bootstrapping,
 * canvas virtualization, sheet tab navigation, and memory guards.
 */
export function ExcelViewer({
  file,
  fileName = 'Workbook.xlsx',
  isDark = false,
  readOnly = true,
  allowResizeInReadOnly = true,
  showDefaultToolbar = true,
  showImages = true,
  className = 'w-full h-full',
  height = '100%',
  downloadUrl,
}: ExcelViewerProps) {
  return (
    <div className={`relative w-full h-full min-h-0 overflow-hidden ${className}`}>
      <DynamicXlsxViewer
        file={file}
        fileName={fileName}
        isDark={isDark}
        readOnly={readOnly}
        allowResizeInReadOnly={allowResizeInReadOnly}
        showDefaultToolbar={showDefaultToolbar}
        showImages={showImages}
        className="w-full h-full"
        height={height}
        fileTooLargeState={(props) => (
          <div className="flex flex-col items-center justify-center p-8 text-center h-full">
            <AlertCircle className="w-8 h-8 text-amber-500 mb-2" />
            <h3 className="text-sm font-semibold mb-1">
              Large Workbook ({(props.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)
            </h3>
            <p className="text-xs text-zinc-500 mb-4 max-w-xs">
              This file exceeds the preview limit of {(props.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB. Download to view locally.
            </p>
            {downloadUrl && (
              <a
                href={downloadUrl}
                download={fileName}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Download size={12} />
                <span>Download File</span>
              </a>
            )}
          </div>
        )}
      />
    </div>
  );
}

export default ExcelViewer;
