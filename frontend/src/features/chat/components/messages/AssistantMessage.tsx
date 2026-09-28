"use client";

import React, { useState, useMemo, memo } from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import TaskWorkLogAccordion from '@/features/chat/components/TaskWorkLogAccordion';
import ArtifactCard from '@/features/artifacts/components/ArtifactCard';
import FilesChangedDrawer from '@/features/artifacts/components/FilesChangedDrawer';
import FileIcon from '@/components/renderers/FileIcon';
import CodeBlock from '@/components/renderers/CodeBlock';
import CalloutBlockquote from '@/components/renderers/CalloutBlockquote';
import TableContainer from '@/components/renderers/TableContainer';
import { extractArtifacts, extractEditedFiles } from '@/features/artifacts/utils/extraction';
import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { cn } from '@/lib/utils';
import { FilePill } from '@/primitives';
import { ExecutionStatusDisclosure } from './ExecutionStatusDisclosure';
import { ImageLightboxModal, LightboxImageData } from './ImageLightboxModal';
import { AssistantMessageFooter } from './AssistantMessageFooter';

// ponytail: stable plugin array references — prevents ReactMarkdown from re-parsing on every streaming flush
const REMARK_PLUGINS = [remarkGfm, remarkMath] as any;
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, errorColor: '#71717a', strict: false }]] as any;

const MermaidRenderer = dynamic(() => import('@/components/renderers/MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="my-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-xs font-mono text-[var(--text-muted)] animate-pulse flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
      <span>Loading diagram engine...</span>
    </div>
  ),
});

// ----------------------------------------------------------------------
// AssistantMessage Component with WorkLog and TaskPlan
interface AssistantMessageProps {
  msg: Message;
  artifacts?: ArtifactItem[];
  isLast: boolean;
  isStreaming: boolean;
  onOpenFile?: (path: string) => void;
  onProceed?: (path: string) => void;
  onRetry?: () => void;
  onContinue?: () => void;
}

// ponytail: safely extract plain text from nested React children / markdown AST nodes
function extractChildText(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractChildText).join('');
  if (typeof node === 'object' && node.props && node.props.children) {
    return extractChildText(node.props.children);
  }
  return '';
}

// ponytail: format file pills to render clean basenames instead of overwhelming full filesystem paths
function formatFilePill(rawLabel: string, rawHref: string) {
  let rawPath = decodeURIComponent(rawHref || rawLabel || '').replace(/^file:\/\/\/?/i, '');
  rawPath = rawPath.replace(/^\/([a-zA-Z]:)/, '$1');
  const [filePath, lineAnchor] = rawPath.split('#');

  const parts = filePath.split(/[/\\]/);
  const basename = parts.pop() || filePath;
  const labelParts = decodeURIComponent(rawLabel || '').split(/[/\\]/);
  const cleanLabel = labelParts.pop() || basename;

  let display = (cleanLabel && !cleanLabel.startsWith('file:') && cleanLabel !== '[object Object]' ? cleanLabel : basename).trim();
  if (lineAnchor && !/:(?:L)?\d+(?:-\d+)?$/i.test(display)) {
    const cleanAnchor = lineAnchor.replace(/^[#L]+/, '');
    if (cleanAnchor) display = `${display}:${cleanAnchor}`;
  }

  return {
    filePath,
    display,
    isDoc: filePath.toLowerCase().endsWith('.md'),
  };
}

// ponytail: Detect if a string is a valid file path or standalone filename with recognized extension
function isFilePathOrName(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim().replace(/^file:\/\/\/?/i, '').split('#')[0];
  if (!clean || clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')')) return false;

  const FILE_EXT_REGEX = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|log|html|css|scss|xml|xbrl|sh|bash|zsh|ps1|rs|go|c|cpp|h|java|zip|tar|gz|png|jpe?g|gif|svg|webp)$/i;

  const parts = clean.split(/[/\\]/);
  const filename = parts.pop() || '';
  return FILE_EXT_REGEX.test(clean) && filename.length > 0 && !filename.startsWith('.');
}

// ponytail: Detect full file paths vs bare symbols, functions, half paths, and bare extensions
function isFullFilePath(raw: string): boolean {
  return isFilePathOrName(raw);
}

function renderFileButton(filePath: string, label?: string, onOpenFile?: (p: string) => void) {
  const { filePath: cleanPath, display } = formatFilePill(label || filePath, filePath);
  return (
    <FilePill
      key={`btn_${cleanPath}_${display}`}
      path={cleanPath}
      label={display}
      onOpenFile={onOpenFile}
    />
  );
}

const BADGE_STYLES: Record<string, string> = {
  COMPLIANT: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'NO EXCEPTION': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'NO EXCEPTION NOTED': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  PASS: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  EXCEPTION: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  'MATERIAL WEAKNESS': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  FAIL: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  'SIGNIFICANT DEFICIENCY': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'CONTROL DEFICIENCY': 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  'HIGH RISK': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'MEDIUM RISK': 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/50',
  'LOW RISK': 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700/50',
  NOTE: 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700/50',
  WARNING: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  CAUTION: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
};

const STATUS_TAG_REGEX = /(\[(?:COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\])/g;
const FILE_PATH_IN_PROSE_REGEX = /((?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|(?:scratch|tests|django|frontend|connector|src)\/)[^\s'",;()<>]+\.(?:py|tsx?|jsx?|mjs|json|ya?ml|toml|sql|csv|xlsx?|md|txt|diff|patch|html|css|log)(?:#L\d+(?:-\d+)?)?)/gi;

function processTextNodesForBadges(children: any, onOpenFile?: (path: string) => void): any {
  if (typeof children === 'string') {
    const parts = children.split(STATUS_TAG_REGEX);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\]$/);
      if (match) {
        const tag = match[1];
        const style = BADGE_STYLES[tag] || 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700';
        return (
          <span
            key={`tag_${idx}`}
            className={`inline-flex items-center px-1.5 py-0.2 mx-1 rounded-[4px] text-[10.5px] font-mono font-medium tracking-tight border select-none align-baseline ${style}`}
          >
            {tag}
          </span>
        );
      }

      // Check for file paths in prose text
      const pathParts = part.split(FILE_PATH_IN_PROSE_REGEX);
      if (pathParts.length === 1) return part;

      return pathParts.map((pPart, pIdx) => {
        if (pPart && isFullFilePath(pPart)) {
          return renderFileButton(pPart, pPart, onOpenFile);
        }
        return pPart;
      });
    });
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === 'string') {
        return processTextNodesForBadges(c, onOpenFile);
      }
      if (React.isValidElement(c)) {
        // If element is already an anchor, file pill, or interactive link, do NOT process its children for filepaths!
        // This eliminates nested buttons and double rendering!
        const isInteractiveLink = c.type === 'a' || c.type === FilePill || typeof (c.props as any)?.href === 'string' || (c.props as any)?.path;
        if (isInteractiveLink) {
          return c;
        }

        // If c is a code element and its content is a file, unwrap and return FilePill directly without amber badge!
        if (c.type === 'code') {
          const codeText = extractChildText((c.props as any)?.children).trim();
          if (isFilePathOrName(codeText)) {
            return renderFileButton(codeText, codeText, onOpenFile);
          }
        }

        return React.cloneElement(c, { key: i } as any, processTextNodesForBadges((c.props as any)?.children, onOpenFile));
      }
      return c;
    });
  }
  return children;
}

function formatTurnTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    if (/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(ts.trim())) {
      return ts.trim();
    }
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return ts;
  } catch {
    return ts;
  }
}

// ponytail: preprocess LaTeX blocks so \(...\) and \[...\] cleanly render via remarkMath/rehypeKatex
// Includes an unclosed-delimiter safety guard during streaming to prevent layout thrashing and AST errors
function formatMathInMarkdown(content: string, isStreaming: boolean = false): string {
  if (!content) return content;
  let text = content;

  if (isStreaming) {
    // 1. Unclosed LaTeX display block \[ ... without closing \]
    const lastOpenDisplay = text.lastIndexOf('\\[');
    const lastCloseDisplay = text.lastIndexOf('\\]');
    if (lastOpenDisplay !== -1 && lastOpenDisplay > lastCloseDisplay) {
      text = text + '\n\\]';
    }

    // 2. Unclosed LaTeX inline \( ... without closing \)
    const lastOpenInline = text.lastIndexOf('\\(');
    const lastCloseInline = text.lastIndexOf('\\)');
    if (lastOpenInline !== -1 && lastOpenInline > lastCloseInline) {
      text = text + '\\)';
    }

    // 3. Unclosed $$ block math: if odd number of unescaped $$, balance with a closing $$
    const doubleDollarMatches = text.match(/(?<!\\)\$\$/g);
    if (doubleDollarMatches && doubleDollarMatches.length % 2 === 1) {
      text = text + '\n$$';
    }

    // 4. Unclosed code fence: if odd number of ``` fences, balance so markdown tree stays stable
    const fenceMatches = text.match(/(?:^|\n)```/g);
    if (fenceMatches && fenceMatches.length % 2 === 1) {
      text = text + '\n```';
    }
  }

  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`);
}

// ponytail: memoize AssistantMessage so past turns never re-render during 120fps streaming
const AssistantMessage = memo(function AssistantMessage({
  msg,
  artifacts: passedArtifacts,
  isLast,
  isStreaming,
  onOpenFile,
  onProceed,
  onRetry,
  onContinue,
}: AssistantMessageProps) {
  const [lightboxImage, setLightboxImage] = useState<LightboxImageData | null>(null);

  // Freeze fallback completion time once on mount so it never drifts with live clock
  const [latchedTime] = useState(() => 
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const displayTime = (msg.timestamp && formatTurnTimestamp(msg.timestamp)) || latchedTime;
  // ponytail: skip artifact extraction during active streaming — only compute on final render
  const isActivelyStreaming = isLast && isStreaming;
  const localArtifacts = useMemo(() => isActivelyStreaming ? [] : extractArtifacts(msg), [msg.content, msg.tools, isActivelyStreaming]);
  const artifacts = passedArtifacts !== undefined ? passedArtifacts : localArtifacts;
  const editedFilesData = useMemo(() => isActivelyStreaming ? { files: [], totalAdded: 0, totalDeleted: 0 } : extractEditedFiles(msg), [msg.tools, isActivelyStreaming]);

  // ponytail: memoize formatted content with fallback to text steps so assistant answers are never hidden
  const rawText = useMemo(() => {
    if (msg.content && msg.content.trim().length > 0) return msg.content;
    if (msg.steps && msg.steps.length > 0) {
      const textSteps = msg.steps.filter((s: any) => s.type === 'text' && s.content && s.content.trim().length > 0);
      if (textSteps.length > 0) {
        return textSteps.map((s: any) => s.content.trim()).join('\n\n');
      }
    }
    return '';
  }, [msg.content, msg.steps]);

  const formattedContent = useMemo(() => formatMathInMarkdown(rawText, isActivelyStreaming), [rawText, isActivelyStreaming]);

  // ponytail: memoize ReactMarkdown components object — the #1 perf win
  // Without this, ReactMarkdown sees new function refs every flush and rebuilds its entire tree
  const markdownComponents = useMemo(() => ({
    code({node, inline, className, children, ...props}: any) {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1].toLowerCase() : '';
      const content = String(children).replace(/\n$/, '');
      // ponytail: react-markdown v9+ doesn't pass `inline` reliably — detect from className/content
      const isBlock = !!className || content.includes('\n');

      if (isBlock && lang === 'mermaid') {
        return <MermaidRenderer chart={content} isStreaming={isActivelyStreaming} />;
      }

      if (isBlock && (lang === 'latex' || lang === 'math' || lang === 'katex')) {
        try {
          const html = katex.renderToString(content, { displayMode: true, throwOnError: false });
          return <div className="my-3 overflow-x-auto select-text custom-scrollbar py-2 text-center" dangerouslySetInnerHTML={{ __html: html }} />;
        } catch (e) {
          return <div className="font-mono text-xs text-rose-400 my-2">{content}</div>;
        }
      }

      if (isBlock) {
        return <CodeBlock language={lang || 'text'} code={content} isStreaming={isActivelyStreaming} />;
      }

      // If children is already a FilePill element, return it directly!
      if (React.isValidElement(children) && ((children as any).type === FilePill || (children as any).props?.path)) {
        return children;
      }

      // Check if inline code is a file path or filename -> render as interactive FilePill directly!
      const plainCodeText = (extractChildText(children) || content).trim();
      if (isFilePathOrName(plainCodeText)) {
        return renderFileButton(plainCodeText, plainCodeText, onOpenFile);
      }

      // Inline code (symbols, functions, variables, regex) — distinct highlighted badge
      return (
        <code {...props} className="bg-amber-500/10 dark:bg-amber-400/[0.08] text-amber-800 dark:text-amber-200 border border-amber-500/20 dark:border-amber-400/20 px-1.5 py-0.5 mx-0.5 rounded-[5px] font-mono text-[12px] font-medium break-all select-text align-baseline">
          {children}
        </code>
      );
    },
    blockquote({node, children, ...props}: any) {
      return <CalloutBlockquote>{children}</CalloutBlockquote>;
    },
    table({node, children, ...props}: any) {
      return <TableContainer>{children}</TableContainer>;
    },
    p({children, ...props}: any) {
      return <p className="mb-3 text-[14px] leading-[1.72] text-zinc-800 dark:text-[#ececed] last:mb-0" {...props}>{processTextNodesForBadges(children, onOpenFile)}</p>;
    },
    li({children, ...props}: any) {
      return <li className="my-1 text-[14px] leading-[1.68] text-zinc-800 dark:text-[#ececed]" {...props}>{processTextNodesForBadges(children, onOpenFile)}</li>;
    },
    h1({children, ...props}: any) {
      return <h1 className="mt-6 mb-3 text-[21px] font-bold text-zinc-950 dark:text-zinc-50 tracking-tight pb-2 border-b border-zinc-200/80 dark:border-white/[0.08] first:mt-0" {...props}>{processTextNodesForBadges(children, onOpenFile)}</h1>;
    },
    h2({children, ...props}: any) {
      return <h2 className="mt-5 mb-2.5 text-[17.5px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight pb-1 border-b border-zinc-100 dark:border-white/[0.04] first:mt-0" {...props}>{processTextNodesForBadges(children, onOpenFile)}</h2>;
    },
    h3({children, ...props}: any) {
      return <h3 className="mt-4 mb-2 text-[15.5px] font-semibold text-zinc-900 dark:text-zinc-200 tracking-tight first:mt-0" {...props}>{processTextNodesForBadges(children, onOpenFile)}</h3>;
    },
    h4({children, ...props}: any) {
      return <h4 className="mt-3 mb-1.5 text-[14px] font-semibold text-zinc-800 dark:text-zinc-300 tracking-tight first:mt-0" {...props}>{processTextNodesForBadges(children, onOpenFile)}</h4>;
    },
    strong({children, ...props}: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },
    td({children, ...props}: any) {
      const text = extractChildText(children).trim();
      const isNumeric = /^[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?%?$/.test(text) || /^\([\d,]+(\.\d+)?\)/.test(text);
      return (
        <td className={`py-2 px-3 text-zinc-800 dark:text-zinc-300 ${isNumeric ? 'text-right font-mono text-[12px]' : 'text-left text-[12.5px]'}`} {...props}>
          {processTextNodesForBadges(children, onOpenFile)}
        </td>
      );
    },
    th({children, ...props}: any) {
      const text = extractChildText(children).trim();
      const isNumeric = /^[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?%?$/.test(text);
      return (
        <th className={`py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400 text-[11px] uppercase tracking-wider ${isNumeric ? 'text-right' : 'text-left'}`} {...props}>
          {children}
        </th>
      );
    },
    a({href, children, ...props}: any) {
      if (!href) return <span {...props}>{children}</span>;

      const isFileUri = href.startsWith('file:///') || href.startsWith('file://');
      const isWinPath = /^[a-zA-Z]:[/\\]/.test(href);
      const isRelativeFile = /\.(xlsx?|xlsm|csv|json|md|markdown|txt|log|py|tsx?|jsx?|mjs|sql|ya?ml|toml|xml|env|html|css|pdf|png|jpe?g|svg|webp|gif|j2|jinja2?)$/i.test(href.split('#')[0]);
      const isLocalPath = (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) && isFullFilePath(href);

      if (isFileUri || isWinPath || isRelativeFile || isLocalPath || isFilePathOrName(href)) {
        const rawLabel = extractChildText(children);
        return renderFileButton(href, rawLabel, onOpenFile);
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 decoration-blue-500/40 hover:decoration-blue-400 transition-colors inline-flex items-center gap-0.5 font-medium" {...props}>
          {children}
        </a>
      );
    },
    img({src, alt, ...props}: any) {
      let resolvedSrc = src;
      let cleanPath = src;
      const isRemote = resolvedSrc && (resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://') || resolvedSrc.startsWith('data:'));

      if (resolvedSrc && !isRemote) {
        cleanPath = resolvedSrc.replace(/^file:\/\/\/?/, '');
        cleanPath = cleanPath.replace(/^\/([a-zA-Z]:)/, '$1');
        resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${msg.sessionId ? `&session_id=${encodeURIComponent(msg.sessionId)}` : ''}`;
      }

      const dynamicCaption = alt && alt.trim() ? alt.trim() : null;

      return (
        <div 
          onClick={() => {
            setLightboxImage({ src: resolvedSrc, alt: dynamicCaption || undefined, path: cleanPath });
          }}
          className="my-3 rounded-xl overflow-hidden border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#141414] p-2.5 shadow-xs group/img cursor-pointer transition-all hover:border-zinc-300 dark:hover:border-white/[0.15]"
          title={dynamicCaption ? `Click to inspect: ${dynamicCaption}` : 'Click to inspect image on top screen'}
        >
          <div className="relative overflow-hidden rounded-lg bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center min-h-[120px] max-h-[500px]">
            <img 
              src={resolvedSrc} 
              alt={dynamicCaption || 'Visual Chart'} 
              className="max-w-full rounded-md object-contain max-h-[480px] mx-auto transition-transform duration-200 group-hover/img:scale-[1.01]" 
              loading="lazy"
              {...props} 
            />
          </div>
          {dynamicCaption && (
            <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-2 font-medium truncate px-2">
              {dynamicCaption}
            </div>
          )}
        </div>
      );
    }
  }), [editedFilesData.files, onOpenFile, isActivelyStreaming]);

  return (
    <div className="text-[13.5px] text-[var(--text-primary)] w-full mb-1.5">
      {/* 1. Single Top-Level Unified Work Log Accordion (Timeline Trace) */}
      <TaskWorkLogAccordion 
        steps={msg.steps}
        thoughts={msg.thoughts} 
        tools={msg.tools} 
        isStreaming={isLast && isStreaming} 
        isLast={isLast}
        thinkingDurationSeconds={msg.thinkingDurationSeconds}
        hasAssistantContent={!!(msg.content && msg.content.trim().length > 0)}
        totalDurationSeconds={msg.totalDurationSeconds}
        turnStartTime={msg.turnStartTime}
        onOpenFile={onOpenFile}
      />

      {/* 2. Unified Clean Markdown Content */}
      {formattedContent && (
        <div className="font-sans text-zinc-800 dark:text-[#ececed] text-[14px] leading-[1.72] mt-2 [&_ul]:my-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:marker:text-zinc-400 dark:[&_ul]:marker:text-zinc-500 [&_ol]:my-3 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:marker:text-zinc-400 dark:[&_ol]:marker:text-zinc-500 [&_li>ul]:mt-1.5 [&_li>ul]:mb-0.5 [&_li>ol]:mt-1.5 [&_li>ol]:mb-0.5 [&_li_p]:mb-0 [&_li_p]:mt-0 [&_hr]:my-4.5 [&_hr]:border-zinc-200/80 dark:[&_hr]:border-zinc-800/80 [&_pre]:my-3">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS as any}
            rehypePlugins={REHYPE_PLUGINS as any}
            // ponytail: block javascript:/vbscript:/data: but allow file:// for local paths (M-11)
            urlTransform={(url) => /^\s*(javascript|vbscript|data):/i.test(url) ? '' : url}
            components={markdownComponents}
          >
            {formattedContent}
          </ReactMarkdown>
        </div>
      )}

      {/* 4. Execution Status Disclosure (Error / Interrupted / Network Disconnect / Aborted) */}
      <ExecutionStatusDisclosure
        status={msg.status}
        error={msg.error}
        errorId={msg.errorId}
        totalDurationSeconds={msg.totalDurationSeconds}
        onRetry={onRetry}
        onContinue={onContinue}
      />

      {/* 5. Bottom Artifact Cards (Walkthrough, Implementation Plan, etc.) */}
      {artifacts.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {artifacts.map((art) => (
            <ArtifactCard 
              key={art.id} 
              artifact={art} 
              onOpen={(p) => onOpenFile?.(p)} 
              onProceed={onProceed}
              isLast={isLast}
              isStreaming={isStreaming}
            />
          ))}
        </div>
      )}

      {/* 6. Files Changed Drawer (Antigravity-style collapsible edited files list) */}
      {editedFilesData.files.length > 0 && (
        <FilesChangedDrawer
          files={editedFilesData.files}
          totalAdded={editedFilesData.totalAdded}
          totalDeleted={editedFilesData.totalDeleted}
          onOpenFile={onOpenFile}
          sessionId={msg.sessionId}
        />
      )}

      {/* Footer: timestamp on left, copy button on right — clean and symmetrical when turn is completed */}
      {!isActivelyStreaming && (
        <AssistantMessageFooter
          displayTime={displayTime}
          rawText={rawText || (msg.thoughts && msg.thoughts.length > 0 ? msg.thoughts.join('\n\n') : '')}
          hasPrecedingContent={!!(formattedContent || artifacts.length > 0 || editedFilesData.files.length > 0)}
        />
      )}

      {/* 7. Image Lightbox / Fullscreen Overlay on Top Screen */}
      <ImageLightboxModal
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}, (prev, next) => {
  // If actively streaming, allow re-render to flush chunks
  if (next.isLast && next.isStreaming) {
    return false;
  }
  // Historical turns skip re-render unless data explicitly changes
  return (
    prev.isLast === next.isLast &&
    prev.isStreaming === next.isStreaming &&
    prev.msg.status === next.msg.status &&
    prev.msg.content === next.msg.content &&
    prev.msg.timestamp === next.msg.timestamp &&
    prev.msg.error === next.msg.error &&
    prev.msg.thoughts === next.msg.thoughts &&
    prev.msg.tools === next.msg.tools &&
    (prev.msg.tools?.length ?? 0) === (next.msg.tools?.length ?? 0) &&
    prev.msg.steps === next.msg.steps &&
    (prev.msg.steps?.length ?? 0) === (next.msg.steps?.length ?? 0) &&
    prev.msg.thinkingDurationSeconds === next.msg.thinkingDurationSeconds &&
    prev.msg.totalDurationSeconds === next.msg.totalDurationSeconds &&
    prev.msg.steeringInjected === next.msg.steeringInjected &&
    (prev.artifacts === next.artifacts || ((prev.artifacts?.length ?? 0) === 0 && (next.artifacts?.length ?? 0) === 0))
  );
});

export default AssistantMessage;
