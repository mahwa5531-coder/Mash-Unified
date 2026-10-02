"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Download, AlertTriangle, Loader2 } from 'lucide-react';
import { BASE_URL } from '@/services/client';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';
import { ImageViewer } from './renderers/ImageViewer';
import { PdfViewer } from './renderers/PdfViewer';
import { BinaryExcelFallback } from './renderers/BinaryExcelFallback';
import { UnsupportedDocFallback } from './renderers/UnsupportedDocFallback';
import { MarkdownFileViewer } from './renderers/MarkdownFileViewer';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center h-full py-16 text-zinc-500 text-xs gap-2">
      <Loader2 size={18} className="animate-spin text-sky-400" />
      <span>Loading virtualized editor...</span>
    </div>
  ),
});

export interface SafeFileViewerProps {
  filename: string;
  path?: string;
  sessionId?: string;
  content: string;
  isLoading: boolean;
  viewMode?: 'preview' | 'raw';
  onViewModeChange?: (mode: 'preview' | 'raw') => void;
  hideToolbar?: boolean;
}

const MASSIVE_FILE_LIMIT = 1.5 * 1024 * 1024; // 1.5 MB

const EXT_LANG_MAP: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  ps1: 'powershell',
  yaml: 'yaml',
  yml: 'yaml',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  md: 'markdown',
  xml: 'xml',
  svg: 'xml',
};

export default function SafeFileViewer({ 
  filename, 
  path, 
  sessionId,
  content, 
  isLoading,
  viewMode = 'preview',
}: SafeFileViewerProps) {
  const isDark = useIsDarkMode();

  const cleanName = (path || filename || '').toLowerCase();
  const isImage = /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/.test(cleanName);
  const isMarkdown = /\.md$/i.test(cleanName);
  const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(cleanName);
  const isPdf = /\.pdf$/i.test(cleanName);
  const isUnsupported = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i.test(cleanName);

  const monacoLang = useMemo(() => {
    const ext = cleanName.split('.').pop()?.toLowerCase() || '';
    return EXT_LANG_MAP[ext] || 'text';
  }, [cleanName]);

  const isMassiveFile = (content?.length || 0) > MASSIVE_FILE_LIMIT;

  const displayedContent = useMemo(() => {
    if (!content) return '// Empty file';
    if (content.length > 100_000 && !content.includes('\n')) {
      return content.slice(0, 5000) + '... [line truncated for browser safety]';
    }
    return content;
  }, [content]);

  const sessionQuery = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-[var(--text-muted)] gap-3">
        <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
        <span className="text-xs font-medium">Loading file content...</span>
      </div>
    );
  }

  if (isImage) {
    return <ImageViewer filename={filename} path={path} sessionQuery={sessionQuery} />;
  }

  if (isBinaryExcel) {
    return (
      <BinaryExcelFallback
        filename={filename}
        path={path}
        sessionId={sessionId}
        sessionQuery={sessionQuery}
      />
    );
  }

  if (isPdf) {
    return <PdfViewer filename={filename} path={path} sessionId={sessionId} sessionQuery={sessionQuery} />;
  }

  if (isUnsupported) {
    return (
      <UnsupportedDocFallback
        filename={filename}
        cleanName={cleanName}
        path={path}
        sessionQuery={sessionQuery}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-100/60 dark:bg-[#121215] overflow-hidden">
      {/* Massive File Backend Truncation Shield */}
      {isMassiveFile && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 select-none shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={14} className="shrink-0 text-amber-500" />
            <span className="truncate">
              <strong>Massive File</strong>: Displaying initial 1.5MB preview.
            </span>
          </div>
          <a
            href={`${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`}
            download={filename}
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-300 font-medium transition-colors cursor-pointer flex items-center gap-1 shrink-0"
          >
            <Download size={12} />
            <span>Download Full File</span>
          </a>
        </div>
      )}

      {/* Content Body */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {isMarkdown && viewMode === 'preview' ? (
          <MarkdownFileViewer
            content={content}
            displayedContent={displayedContent}
            isMassiveFile={isMassiveFile}
            sessionQuery={sessionQuery}
          />
        ) : (
          <div className="flex-1 w-full h-full min-h-[350px] bg-white dark:bg-[#1c1c20] text-[12.5px] leading-relaxed select-text flex flex-col overflow-hidden">
            {viewMode === 'raw' ? (
              <pre 
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 500px' }}
                className="p-5 font-mono text-[12.5px] leading-relaxed select-text whitespace-pre overflow-x-auto text-zinc-800 dark:text-zinc-200 h-full overflow-auto bg-white dark:bg-[#1c1c20]"
              >
                {displayedContent}
              </pre>
            ) : (
              <MonacoEditor
                height="100%"
                language={monacoLang}
                theme={isDark ? 'vs-dark' : 'light'}
                value={displayedContent}
                options={{
                  readOnly: true,
                  domReadOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'off',
                  renderLineHighlight: 'none',
                  contextmenu: true,
                  folding: true,
                  overviewRulerLanes: 0,
                  stopRenderingLineAfter: 10000,
                  scrollbar: {
                    vertical: 'visible',
                    horizontal: 'auto',
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
