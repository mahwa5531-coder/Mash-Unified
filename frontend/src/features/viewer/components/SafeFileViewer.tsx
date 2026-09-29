"use client";

import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { 
  Download, AlertTriangle, 
  Loader2, FileSpreadsheet, FileText, ExternalLink
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BASE_URL } from '@/services/client';
import { openSystemFile } from '@/services/files';
import TableContainer from '@/components/renderers/TableContainer';
import CalloutBlockquote from '@/components/renderers/CalloutBlockquote';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';
import { normalizePath } from '@/utils/normalizePath';

const MermaidRenderer = dynamic(() => import('@/components/renderers/MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="my-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs font-mono text-[var(--text-muted)] animate-pulse flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
      <span>Loading diagram engine...</span>
    </div>
  ),
});

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
  const [isOpeningSystem, setIsOpeningSystem] = useState(false);
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

  // Image Viewer
  if (isImage) {
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

  // Excel Viewer Fallback Card
  if (isBinaryExcel) {
    const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400 select-none">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 shadow-md">
          <FileSpreadsheet size={28} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1 font-mono break-all max-w-md">
          {filename}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5 leading-relaxed">
          Excel Workbook
        </p>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={async () => {
              setIsOpeningSystem(true);
              await openSystemFile(path || filename, sessionId);
              setTimeout(() => setIsOpeningSystem(false), 1200);
            }}
            disabled={isOpeningSystem}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2"
          >
            {isOpeningSystem ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            <span>{isOpeningSystem ? "Opening..." : "Open in Excel"}</span>
          </button>

          <a
            href={downloadUrl}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2 border border-zinc-300 dark:border-zinc-700"
          >
            <Download size={13} />
            <span>Download</span>
          </a>
        </div>
      </div>
    );
  }

  // Native High-Performance PDFium Viewer
  if (isPdf) {
    const rawPdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;
    const embedPdfUrl = `${rawPdfUrl}#view=FitH&toolbar=1&navpanes=0`;
    return (
      <div className="flex flex-col h-full w-full bg-zinc-100 dark:bg-[#141414] overflow-hidden select-none">
        <div className="h-9 px-4 border-b border-zinc-200 dark:border-[#222] bg-white dark:bg-[#1a1a1d] flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span className="font-mono text-zinc-800 dark:text-zinc-300 truncate text-[11.5px] font-medium">{filename}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <a
              href={rawPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-500 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300 hover:underline flex items-center gap-1 cursor-pointer text-[11.5px]"
            >
              Open in new tab
            </a>
            <a
              href={rawPdfUrl}
              download={filename}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
              title="Download PDF"
            >
              <Download size={13} />
            </a>
          </div>
        </div>
        <div className="flex-1 w-full h-full min-h-0 bg-zinc-200 dark:bg-[#2b2b2b] relative">
          <embed
            type="application/pdf"
            src={embedPdfUrl}
            className="w-full h-full border-0 absolute inset-0"
            title={filename}
          />
        </div>
      </div>
    );
  }

  // Fallback card for unsupported complex office documents and binary archives
  if (isUnsupported) {
    const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true${sessionQuery}`;
    const extMatch = cleanName.match(/\.([a-z0-9]+)$/i);
    const ext = extMatch ? `.${extMatch[1]}` : '';
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400 select-none">
        <div className="w-14 h-14 rounded-2xl bg-zinc-200 dark:bg-zinc-800/80 border border-zinc-300 dark:border-zinc-700/60 flex items-center justify-center mb-4 text-zinc-600 dark:text-zinc-400 shadow-md">
          <FileText size={28} className="text-zinc-600 dark:text-zinc-400" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 mb-1.5 font-mono break-all max-w-md">{filename}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5 leading-relaxed">
          Preview is not supported for <span className="font-semibold text-zinc-700 dark:text-zinc-300">{ext}</span> files. MASH natively renders PDF, images, text, and JSON files.
        </p>
        <a
          href={downloadUrl}
          download={filename}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 rounded-lg text-xs font-medium transition-colors shadow-sm cursor-pointer inline-flex items-center gap-2 border border-zinc-300 dark:border-zinc-700"
        >
          <Download size={14} />
          <span>Download File</span>
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--bg-app)] overflow-hidden">
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
          <div className="markdown-body p-5 leading-relaxed text-[13px] bg-[var(--bg-surface)]">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                code({inline, className, children, ...props}: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const lang = match ? match[1].toLowerCase() : '';
                  if (!inline && lang === 'mermaid') {
                    return <MermaidRenderer chart={String(children).replace(/\n$/, '')} />;
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                img({src, alt, ...props}: any) {
                  let resolvedSrc = src;
                  if (resolvedSrc && (resolvedSrc.startsWith('file:///') || resolvedSrc.startsWith('file://') || resolvedSrc.startsWith('/'))) {
                    const clean = normalizePath(resolvedSrc);
                    resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(clean)}${sessionQuery}`;
                  }
                  return (
                    <div className="my-3 rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)]/50 p-2 shadow-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolvedSrc} alt={alt || 'Image'} className="max-w-full rounded object-contain max-h-[500px] mx-auto" {...props} />
                      {alt && <div className="text-center text-xs text-[var(--text-muted)] mt-1.5 font-mono">{alt}</div>}
                    </div>
                  );
                },
                table({children}: any) {
                  return <TableContainer>{children}</TableContainer>;
                },
                blockquote({children}: any) {
                  return <CalloutBlockquote>{children}</CalloutBlockquote>;
                },
                td({children, ...props}: any) {
                  const text = String(children || '').trim();
                  const isNumeric = /^[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?%?$/.test(text) || /^\([\d,]+(\.\d+)?\)/.test(text);
                  return (
                    <td className={`py-2 px-3 text-zinc-800 dark:text-zinc-200 ${isNumeric ? 'text-right font-mono text-[12px]' : 'text-left text-[12.5px]'}`} {...props}>
                      {children}
                    </td>
                  );
                },
                th({children, ...props}: any) {
                  const text = String(children || '').trim();
                  const isNumeric = /^[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?%?$/.test(text);
                  return (
                    <th className={`py-2 px-3 font-semibold text-zinc-700 dark:text-zinc-300 text-[11.5px] uppercase tracking-wider ${isNumeric ? 'text-right' : 'text-left'}`} {...props}>
                      {children}
                    </th>
                  );
                }
              }}
            >
              {isMassiveFile ? displayedContent : (content || '// Empty markdown file')}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex-1 w-full h-full min-h-[350px] bg-white dark:bg-[#161616] text-[12.5px] leading-relaxed select-text flex flex-col overflow-hidden">
            {viewMode === 'raw' ? (
              <pre 
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 500px' }}
                className="p-4 font-mono text-[12.5px] leading-relaxed select-text whitespace-pre overflow-x-auto text-zinc-800 dark:text-zinc-200 h-full overflow-auto"
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
