"use client";

import React, { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { 
  Copy, Check, Download, AlertTriangle, 
  FileJson, Eye, Code, Loader2, FileSpreadsheet, FileText
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BASE_URL } from '../utils/apiClient';
import ExcelViewer, { type ExcelWorkbookData } from './common/ExcelViewer';
import UniverExcelViewer from './common/UniverExcelViewer';
import TableContainer from './messages/TableContainer';
import CalloutBlockquote from './messages/CalloutBlockquote';
import SyntaxHighlighter from '@/lib/lightSyntaxHighlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';

const MermaidRenderer = dynamic(() => import('./chat/MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="my-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs font-mono text-[var(--text-muted)] animate-pulse flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
      <span>Loading diagram engine...</span>
    </div>
  ),
});

interface SafeFileViewerProps {
  filename: string;
  path?: string;
  sessionId?: string;
  content: string;
  isLoading: boolean;
  viewMode?: 'preview' | 'raw';
  onViewModeChange?: (mode: 'preview' | 'raw') => void;
  hideToolbar?: boolean;
}

const SAFE_LINE_LIMIT = 1000;
const SAFE_SIZE_LIMIT = 200 * 1024; // 200 KB

export default function SafeFileViewer({ 
  filename, 
  path, 
  sessionId,
  content, 
  isLoading,
  viewMode: controlledViewMode,
  onViewModeChange,
  hideToolbar = false
}: SafeFileViewerProps) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [internalViewMode, setInternalViewMode] = useState<'preview' | 'raw'>('preview');
  const viewMode = controlledViewMode !== undefined ? controlledViewMode : internalViewMode;
  const setViewMode = (mode: 'preview' | 'raw') => {
    setInternalViewMode(mode);
    onViewModeChange?.(mode);
  };
  const [formattedJson, setFormattedJson] = useState<string | null>(null);
  const [wrapLines, setWrapLines] = useState(false);
  const isDark = useIsDarkMode();

  const cleanName = (path || filename || '').toLowerCase();
  const isImage = /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/.test(cleanName);
  const isMarkdown = /\.md$/i.test(cleanName);
  const isJson = /\.json$/i.test(cleanName);
  const isExcel = /\.(xlsx|xls|xlsm|xltx|xltm|csv)$/i.test(cleanName);
  const isPdf = /\.pdf$/i.test(cleanName);
  const isUnsupported = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i.test(cleanName);

  const excelData = useMemo(() => {
    if (!isExcel || !content) return null;
    try {
      const parsed = JSON.parse(content);
      if (parsed?.type === 'univer' || parsed?.type === 'excel' || parsed?.workbook || parsed?.sheetOrder) {
        return parsed;
      }
    } catch {}
    return null;
  }, [isExcel, content]);

  const codeLang = useMemo(() => {
    const ext = cleanName.split('.').pop() || '';
    const map: Record<string, string> = {
      py: 'python',
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
      mjs: 'javascript',
      cjs: 'javascript',
      json: 'json',
      html: 'html',
      css: 'css',
      sql: 'sql',
      sh: 'bash',
      bash: 'bash',
      yaml: 'yaml',
      yml: 'yaml',
      j2: 'django',
      jinja: 'django',
      jinja2: 'django',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      md: 'markdown',
      xml: 'xml',
      svg: 'xml',
    };
    return map[ext] || 'text';
  }, [cleanName]);

  // Calculate lines efficiently
  const lines = useMemo(() => {
    if (!content) return [];
    return content.split('\n');
  }, [content]);

  const totalLines = lines.length;
  const fileSizeKb = useMemo(() => {
    return (new Blob([content || '']).size / 1024).toFixed(1);
  }, [content]);
  const isLargeFile = totalLines > SAFE_LINE_LIMIT || (content?.length || 0) > SAFE_SIZE_LIMIT;

  // Sliced content for preview
  const displayedContent = useMemo(() => {
    if (formattedJson !== null) return formattedJson;
    if (!content) return '// Empty file';
    if (isLargeFile && !showAll) {
      return lines.slice(0, SAFE_LINE_LIMIT).join('\n');
    }
    return content;
  }, [content, formattedJson, isLargeFile, showAll, lines]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'file.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [content, filename]);

  const handleToggleFormatJson = useCallback(() => {
    if (formattedJson !== null) {
      setFormattedJson(null);
      return;
    }
    try {
      // Safe guard: only format if under 1MB to prevent blocking UI
      if (content.length > 1_000_000) {
        alert('File is too large for in-browser JSON reformatting. View as raw.');
        return;
      }
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      setFormattedJson(formatted);
    } catch (err: any) {
      alert(`Invalid JSON format: ${err?.message || err}`);
    }
  }, [content, formattedJson]);

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
    const imgUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}`;
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)]">
        <div className="max-w-full max-h-[500px] overflow-auto flex items-center justify-center bg-[var(--bg-app)]/50 p-4 rounded-lg border border-[var(--border-subtle)]">
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

  if (isExcel) {
    if (excelData?.type === 'univer' || excelData?.workbook || excelData?.sheetOrder) {
      return <UniverExcelViewer data={excelData} filename={filename} path={path} sessionId={sessionId} />;
    }
    if (excelData?.type === 'excel') {
      return <ExcelViewer data={excelData as ExcelWorkbookData} filename={filename} path={path} />;
    }
    if (path && !cleanName.endsWith('.csv')) {
      return <UniverExcelViewer data={null} filename={filename} path={path} sessionId={sessionId} />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400">
        <FileSpreadsheet size={40} className="text-emerald-500 mb-3" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 mb-1">{filename}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-4 leading-relaxed">
          {content && !content.startsWith('PK') ? content : 'Binary Excel spreadsheet. Click below to download and view in Microsoft Excel.'}
        </p>
      </div>
    );
  }

  // Native Embedded PDF Viewer
  if (isPdf) {
    const pdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true`;
    return (
      <div className="flex flex-col h-full w-full bg-zinc-100 dark:bg-[#141414] overflow-hidden select-none">
        <div className="h-9 px-4 border-b border-zinc-200 dark:border-[#222] bg-white dark:bg-[#1a1a1d] flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400 shrink-0">
          <span className="font-mono text-zinc-800 dark:text-zinc-300 truncate">{filename}</span>
          <div className="flex items-center gap-3">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-500 dark:text-sky-400 hover:text-sky-600 dark:hover:text-sky-300 hover:underline flex items-center gap-1 cursor-pointer"
            >
              Open in new tab
            </a>
            <a
              href={pdfUrl}
              download={filename}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
              title="Download PDF"
            >
              <Download size={13} />
            </a>
          </div>
        </div>
        <div className="flex-1 w-full h-full min-h-0 bg-zinc-200 dark:bg-[#2b2b2b]">
          <iframe
            src={pdfUrl}
            className="w-full h-full border-0"
            title={filename}
          />
        </div>
      </div>
    );
  }

  // Fallback card for unsupported complex office documents and binary archives
  // ponytail: clean download card avoids heavy/slow parsers (docx-preview, pptx) while keeping UI snappy & lightweight
  if (isUnsupported) {
    const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true`;
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
      {/* File Action Toolbar (Only when not hidden by host RightSidebar) */}
      {!hideToolbar && (
        <div className="h-9 px-3 border-b border-zinc-200/70 dark:border-white/[0.05] bg-zinc-50/50 dark:bg-[#121214] flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 select-none shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11.5px] text-zinc-600 dark:text-zinc-400 tracking-tight">
              {totalLines.toLocaleString()} lines · {fileSizeKb} KB
            </span>
            <div className="flex items-center bg-zinc-200/80 dark:bg-zinc-800/90 rounded-md p-0.5 border border-zinc-300/80 dark:border-zinc-700/60 shadow-2xs">
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'preview' 
                    ? 'bg-white dark:bg-zinc-700/90 text-zinc-900 dark:text-zinc-100 shadow-xs' 
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Eye size={11} />
                <span>Preview</span>
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                  viewMode === 'raw' 
                    ? 'bg-white dark:bg-zinc-700/90 text-zinc-900 dark:text-zinc-100 shadow-xs' 
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Code size={11} />
                <span>Raw</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isJson && (
              <button
                onClick={handleToggleFormatJson}
                className={`px-2 py-0.5 rounded text-[11px] flex items-center gap-1 transition-colors hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80 cursor-pointer ${formattedJson ? 'text-sky-500 font-medium' : 'text-zinc-500 dark:text-zinc-400'}`}
                title="Prettify JSON with indentation"
              >
                <FileJson size={12} />
                <span>{formattedJson ? 'Original JSON' : 'Format JSON'}</span>
              </button>
            )}

            <button
              onClick={() => setWrapLines(!wrapLines)}
              className={`px-2 py-0.5 rounded text-[11.5px] font-normal transition-colors hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer ${
                wrapLines ? 'text-sky-500 font-medium' : 'text-zinc-500 dark:text-zinc-400'
              }`}
              title="Toggle word wrapping"
            >
              Wrap
            </button>

            <button
              onClick={handleCopy}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer"
              title="Copy full file"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>

            <button
              onClick={handleDownload}
              className="p-1 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/80 transition-colors cursor-pointer"
              title="Download file"
            >
              <Download size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Large File Performance Alert Banner */}
      {isLargeFile && !showAll && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 select-none shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="shrink-0" />
            <span>
              Large file ({totalLines.toLocaleString()} lines, {fileSizeKb} KB). Showing first {SAFE_LINE_LIMIT.toLocaleString()} lines for fast rendering.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAll(true)}
              className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 font-medium transition-colors cursor-pointer"
            >
              Load All ({totalLines.toLocaleString()})
            </button>
            <button
              onClick={handleCopy}
              className="px-2 py-0.5 rounded border border-amber-500/30 hover:bg-amber-500/10 transition-colors cursor-pointer"
            >
              {copied ? 'Copied!' : 'Copy Full File'}
            </button>
          </div>
        </div>
      )}

      {/* Content Body */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        {isMarkdown && viewMode === 'preview' ? (
          <div className="markdown-body p-5 leading-relaxed text-[13px] bg-[var(--bg-surface)]">
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                code({node, inline, className, children, ...props}: any) {
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
                    const clean = resolvedSrc.replace(/^file:\/\/\/?/, '');
                    resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(clean)}`;
                  }
                  return (
                    <div className="my-3 rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-app)]/50 p-2 shadow-xs">
                      <img src={resolvedSrc} alt={alt || 'Image'} className="max-w-full rounded object-contain max-h-[500px] mx-auto" {...props} />
                      {alt && <div className="text-center text-xs text-[var(--text-muted)] mt-1.5 font-mono">{alt}</div>}
                    </div>
                  );
                },
                table({node, children, ...props}: any) {
                  return <TableContainer>{children}</TableContainer>;
                },
                blockquote({node, children, ...props}: any) {
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
              {content || '// Empty markdown file'}
            </ReactMarkdown>
          </div>
        ) : (
          /* Code Viewer: Raw plain text or Syntax Highlighted */
          <div className="min-h-full bg-white dark:bg-[#161616] text-[12.5px] leading-relaxed select-text flex flex-col">
            {viewMode === 'raw' ? (
              <pre className={`p-4 font-mono text-[12.5px] leading-relaxed select-text ${wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'} text-zinc-800 dark:text-zinc-200`}>
                {displayedContent}
              </pre>
            ) : (
              <SyntaxHighlighter
                language={codeLang}
                style={isDark ? vscDarkPlus : vs}
                showLineNumbers={true}
                wrapLines={wrapLines}
                wrapLongLines={wrapLines}
                customStyle={{
                  margin: 0,
                  padding: '16px 12px',
                  background: isDark ? '#161616' : '#ffffff',
                  fontSize: '12.5px',
                  lineHeight: '1.65',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  minHeight: '100%',
                }}
                lineNumberStyle={{
                  minWidth: '2.5em',
                  paddingRight: '1.2em',
                  color: isDark ? '#505050' : '#a1a1aa',
                  userSelect: 'none',
                  textAlign: 'right',
                }}
              >
                {displayedContent}
              </SyntaxHighlighter>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
