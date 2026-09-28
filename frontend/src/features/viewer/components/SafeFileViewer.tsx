"use client";

import React, { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { 
  Copy, Check, Download, AlertTriangle, 
  FileJson, Eye, Code, Loader2, FileSpreadsheet, FileText, ExternalLink
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BASE_URL } from '@/services/client';
import { openSystemFile } from '@/services/files';
import TableContainer from '@/components/renderers/TableContainer';
import CalloutBlockquote from '@/components/renderers/CalloutBlockquote';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';

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
const MASSIVE_FILE_LIMIT = 1.5 * 1024 * 1024; // 1.5 MB: prevents browser thread freeze on huge files (e.g. 20MB JSON)
const SYNTAX_HIGHLIGHT_LIMIT = 300 * 1024; // 300 KB: Prism tokenizer cap to maintain 60fps
const PREVIEW_CHUNK_SIZE = 250 * 1024; // 250 KB

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
  const [isOpeningSystem, setIsOpeningSystem] = useState(false);
  const isDark = useIsDarkMode();

  const cleanName = (path || filename || '').toLowerCase();
  const isImage = /\.(png|jpg|jpeg|svg|gif|webp|ico|bmp)$/.test(cleanName);
  const isMarkdown = /\.md$/i.test(cleanName);
  const isJson = /\.json$/i.test(cleanName);
  const isBinaryExcel = /\.(xlsx|xls|xlsm|xltx|xltm|xlsb|ods)$/i.test(cleanName);
  const isCsv = /\.csv$/i.test(cleanName);
  const isPdf = /\.pdf$/i.test(cleanName);
  const isUnsupported = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i.test(cleanName);

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

  const monacoLang = useMemo(() => {
    const ext = cleanName.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
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
    return map[ext] || 'plaintext';
  }, [cleanName]);

  // Fast file size formatting without duplicate Blob allocation
  const fileSizeStr = useMemo(() => {
    const bytes = content ? content.length : 0;
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  }, [content]);

  const isMassiveFile = (content?.length || 0) > MASSIVE_FILE_LIMIT;

  // Calculate lines efficiently on content slice
  const totalLines = useMemo(() => {
    if (!content) return 0;
    let count = 1;
    const sampleLimit = Math.min(content.length, 300000);
    for (let i = 0; i < sampleLimit; i++) {
      if (content.charCodeAt(i) === 10) count++;
    }
    if (content.length > sampleLimit) {
      count = Math.round((count / sampleLimit) * content.length);
    }
    return count;
  }, [content]);

  // Sliced content for preview
  const displayedContent = useMemo(() => {
    if (formattedJson !== null) return formattedJson;
    if (!content) return '// Empty file';
    const safeFormatLine = (l: string) => (l.length > 5000 ? l.slice(0, 5000) + '... [line truncated for browser safety]' : l);
    // Universal guard for minified single-line files
    if (content.length > 100_000 && !content.includes('\n')) {
      return safeFormatLine(content);
    }
    return content;
  }, [content, formattedJson]);

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
      // Safe guard: only format if under 300KB to prevent blocking UI
      if (content.length > 300_000) {
        alert(`File is ${fileSizeStr} — too large for in-browser JSON reformatting. Please view in Raw mode or download.`);
        return;
      }
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      setFormattedJson(formatted);
    } catch (err: any) {
      alert(`Invalid JSON format: ${err?.message || err}`);
    }
  }, [content, formattedJson, fileSizeStr]);

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
    const imgUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
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

  if (isBinaryExcel) {
    const downloadUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true`;
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-zinc-50 dark:bg-[#141414] text-zinc-600 dark:text-zinc-400 select-none">
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800/60 flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400 shadow-md">
          <FileSpreadsheet size={28} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1 font-mono break-all max-w-md">
          {filename}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mb-5 leading-relaxed">
          Excel Workbook · {fileSizeStr}
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


  // Native High-Performance PDFium Viewer (0 KB JS overhead, 120 FPS hardware-accelerated rasterization)
  if (isPdf) {
    const rawPdfUrl = `${BASE_URL}/files/content?path=${encodeURIComponent(path || filename)}&raw=true`;
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
              {totalLines.toLocaleString()} lines · {fileSizeStr}
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

            {isCsv && (
              <button
                type="button"
                onClick={() => openSystemFile(path || filename, sessionId)}
                className="px-2 py-0.5 rounded text-[11px] flex items-center gap-1 transition-colors text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer font-medium"
                title="Open CSV in default spreadsheet application"
              >
                <ExternalLink size={11} />
                <span>Open in Excel</span>
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

      {/* Massive File Backend Truncation Shield (Only for files > 1.5MB capped by server) */}
      {isMassiveFile && (
        <div className="px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-between text-xs text-amber-600 dark:text-amber-400 select-none shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={14} className="shrink-0 text-amber-500" />
            <span className="truncate">
              <strong>Massive File ({fileSizeStr} • ~{totalLines.toLocaleString()} lines)</strong>: Displaying initial 1.5MB preview.
            </span>
          </div>
          <button
            onClick={handleDownload}
            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-300 font-medium transition-colors cursor-pointer flex items-center gap-1 shrink-0"
          >
            <Download size={12} />
            <span>Download Full File</span>
          </button>
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
              {isMassiveFile ? displayedContent : (content || '// Empty markdown file')}
            </ReactMarkdown>
          </div>
        ) : (
          /* Code Viewer: Monaco Editor with Piece Table Virtualization & 60fps Scrolling, Raw mode fallback */
          <div className="flex-1 w-full h-full min-h-[350px] bg-white dark:bg-[#161616] text-[12.5px] leading-relaxed select-text flex flex-col overflow-hidden">
            {viewMode === 'raw' ? (
              <pre 
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 500px' }}
                className={`p-4 font-mono text-[12.5px] leading-relaxed select-text ${wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'} text-zinc-800 dark:text-zinc-200 h-full overflow-auto`}
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
                  minimap: { enabled: totalLines > 100 },
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: wrapLines ? 'on' : 'off',
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
