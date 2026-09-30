"use client";

import React, { useMemo, memo } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { cn } from '@/lib/utils';
import { 
  FilePill, 
  PathPill, 
  ExtensionBadge, 
  AuditBadge, 
  AuditCallout, 
  WebLink 
} from '@/primitives';
import CodeBlock from '@/components/renderers/CodeBlock';
import TableContainer from '@/components/renderers/TableContainer';
import { normalizePath, safeDecodeURI } from '@/utils/normalizePath';
import { shouldExcludePath } from '@/features/artifacts/utils/extraction';
import { BASE_URL } from '@/services/client';

const REMARK_PLUGINS = [remarkGfm, remarkMath] as any;
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, errorColor: '#71717a', strict: false }]] as any;

const MermaidRenderer = dynamic(() => import('@/components/renderers/MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="my-2.5 p-3 bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-white/[0.08] rounded-xl text-xs font-mono text-zinc-500 animate-pulse flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
      <span>Rendering diagram...</span>
    </div>
  ),
});

import type { LightboxImageData } from './ImageLightboxModal';

export interface AssistantProseProps {
  content: string;
  isStreaming?: boolean;
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
  className?: string;
}

// Safely extract plain text from markdown AST / React children
function extractChildText(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractChildText).join('');
  if (typeof node === 'object' && node.props && node.props.children) {
    return extractChildText(node.props.children);
  }
  return '';
}

// Format file pill label and path cleanly
function formatFilePill(rawLabel: string, rawHref: string) {
  const rawPath = normalizePath(rawHref || rawLabel || '', false);
  const [filePath, lineAnchor] = rawPath.split('#');

  const parts = filePath.split(/[/\\]/);
  const basename = parts.pop() || filePath;
  const labelParts = safeDecodeURI(rawLabel || '').split(/[/\\]/);
  const cleanLabel = labelParts.pop() || basename;

  let display = (cleanLabel && !cleanLabel.startsWith('file:') && cleanLabel !== '[object Object]' ? cleanLabel : basename).trim();
  if (lineAnchor && !/:(?:L)?\d+(?:-\d+)?$/i.test(display)) {
    const cleanAnchor = lineAnchor.replace(/^[#L]+/, '');
    if (cleanAnchor) display = `${display}:${cleanAnchor}`;
  }

  return { filePath, display };
}

// Detect if a string is a valid full file path with recognized extension (must have directory slash, no wildcards)
function isFullFilePath(raw: string): boolean {
  if (!raw || typeof raw !== 'string' || shouldExcludePath(raw)) return false;
  const clean = normalizePath(raw.trim());
  if (shouldExcludePath(clean)) return false;
  if (!clean || clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')') || clean.includes('*') || clean.includes('?')) return false;

  const FILE_EXT_REGEX = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|log|html|css|scss|xml|xbrl|sh|bash|zsh|ps1|rs|go|c|cpp|h|java|zip|tar|gz|png|jpe?g|gif|svg|webp)$/i;

  const hasSlash = clean.includes('/') || clean.includes('\\');
  const parts = clean.split(/[/\\]/);
  const filename = parts.pop() || '';
  return hasSlash && FILE_EXT_REGEX.test(clean) && filename.length > 0 && !filename.startsWith('.');
}

// Detect if a string is a standalone file extension
function isFileExtension(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  return /^\.(xlsx?|xlsm|xlsb|ods|csv|tsv|pdf|docx?|pptx?|py|ipynb|tsx?|jsx?|json|ya?ml|toml|sql|md|markdown|txt|log|xml|xbrl|zip|tar|gz|png|jpe?g|svg)$/i.test(clean);
}

// Detect if a string is a directory or partial folder path
function isDirectoryPath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  if (clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')')) return false;
  const hasSlash = clean.includes('/') || clean.includes('\\');
  const endsWithSlash = clean.endsWith('/') || clean.endsWith('\\');
  const isLikelyFolder = (
    clean.startsWith('./') ||
    clean.startsWith('../') ||
    clean.startsWith('/') ||
    /^(workpapers|working_papers|audit_deliverables|deliverables|src|features|components|tests|scratch|docs|models|views|controllers)\//i.test(clean)
  );
  return (endsWithSlash || isLikelyFolder) && hasSlash && !isFullFilePath(clean);
}

const STATUS_TAG_REGEX = /(\[(?:COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\])/g;
const FILE_PATH_IN_PROSE_REGEX = /((?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|(?:scratch|tests|frontend|connector|src|working_papers|Audit_Deliverables)\/)[^\s'",;()<>]+\.(?:py|tsx?|jsx?|mjs|json|ya?ml|toml|sql|csv|xlsx?|md|txt|diff|patch|html|css|log)(?:#L\d+(?:-\d+)?)?)/gi;

function processTextNodes(children: any, onOpenFile?: (path: string) => void): any {
  if (typeof children === 'string') {
    const parts = children.split(STATUS_TAG_REGEX);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\]$/);
      if (match) {
        const tag = match[1];
        return (
          <AuditBadge key={`tag_${idx}`} status={tag}>
            {tag}
          </AuditBadge>
        );
      }

      const pathParts = part.split(FILE_PATH_IN_PROSE_REGEX);
      if (pathParts.length === 1) return part;

      return pathParts.map((pPart, pIdx) => {
        if (pPart && isFullFilePath(pPart)) {
          const { filePath, display } = formatFilePill(pPart, pPart);
          return (
            <FilePill
              key={`pill_${pIdx}_${filePath}`}
              path={filePath}
              label={display}
              onOpenFile={onOpenFile}
            />
          );
        }
        return pPart;
      });
    });
  }

  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === 'string') {
        return processTextNodes(c, onOpenFile);
      }
      if (React.isValidElement(c)) {
        const isInteractive = c.type === 'a' || c.type === FilePill || typeof (c.props as any)?.href === 'string' || (c.props as any)?.path;
        if (isInteractive) return c;

        // Never traverse into code, pre, or component elements — components.code handles code rendering cleanly and prevents double-wrapping
        if (c.type === 'code' || c.type === 'pre' || typeof c.type === 'function') {
          return c;
        }

        return React.cloneElement(c, { key: i } as any, processTextNodes((c.props as any)?.children, onOpenFile));
      }
      return c;
    });
  }
  return children;
}

// Safely balance LaTeX delimiters during live streaming
function sanitizeMathString(content: string, isStreaming: boolean = false): string {
  if (!content) return content;
  let text = content;

  if (isStreaming) {
    const lastOpenDisplay = text.lastIndexOf('\\[');
    const lastCloseDisplay = text.lastIndexOf('\\]');
    if (lastOpenDisplay !== -1 && lastOpenDisplay > lastCloseDisplay) {
      text = text + '\n\\]';
    }

    const lastOpenInline = text.lastIndexOf('\\(');
    const lastCloseInline = text.lastIndexOf('\\)');
    if (lastOpenInline !== -1 && lastOpenInline > lastCloseInline) {
      text = text + '\\)';
    }

    const doubleDollarMatches = text.match(/(?<!\\)\$\$/g);
    if (doubleDollarMatches && doubleDollarMatches.length % 2 === 1) {
      text = text + '\n$$';
    }
  }

  return text;
}

export const AssistantProse = memo(function AssistantProse({
  content,
  isStreaming = false,
  sessionId,
  onOpenFile,
  onImageClick,
  className,
}: AssistantProseProps) {
  const sanitizedContent = useMemo(() => {
    return sanitizeMathString(content, isStreaming);
  }, [content, isStreaming]);

  const components = useMemo(() => ({
    code({ node, className: codeClassName, children, ...props }: any) {
      const match = /language-(\w+)/.exec(codeClassName || '');
      const lang = match ? match[1].toLowerCase() : '';
      const rawText = String(children).replace(/\n$/, '');
      const isBlock = Boolean(codeClassName || rawText.includes('\n'));

      if (isBlock && lang === 'mermaid') {
        return <MermaidRenderer chart={rawText} isStreaming={isStreaming} />;
      }

      if (isBlock && (lang === 'latex' || lang === 'math' || lang === 'katex')) {
        try {
          const html = katex.renderToString(rawText, { displayMode: true, throwOnError: false });
          return <div className="my-2.5 overflow-x-auto select-text custom-scrollbar py-2 text-center" dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return <div className="font-mono text-xs text-rose-400 my-2">{rawText}</div>;
        }
      }

      if (isBlock) {
        return <CodeBlock language={lang || 'text'} code={rawText} isStreaming={isStreaming} />;
      }

      if (React.isValidElement(children) && ((children as any).type === FilePill || (children as any).props?.path)) {
        return children;
      }

      const plainText = (extractChildText(children) || rawText).trim();

      if (isFullFilePath(plainText)) {
        const { filePath, display } = formatFilePill(plainText, plainText);
        return <FilePill path={filePath} label={display} onOpenFile={onOpenFile} />;
      }

      if (isFileExtension(plainText)) {
        return <ExtensionBadge extension={plainText} />;
      }

      if (isDirectoryPath(plainText)) {
        return <PathPill path={plainText} />;
      }

      return (
        <code {...props} className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1.5 py-0.5 mx-0.5 rounded-[4px] font-mono text-[11.5px] font-medium break-all select-text align-baseline">
          {children}
        </code>
      );
    },

    blockquote({ children }: any) {
      return <AuditCallout>{children}</AuditCallout>;
    },

    table({ children }: any) {
      return <TableContainer>{children}</TableContainer>;
    },

    p({ children, ...props }: any) {
      return (
        <p className="mb-3 text-[13.5px] leading-[1.72] text-zinc-800 dark:text-[#d4d4d8] last:mb-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </p>
      );
    },

    ul({ children, ...props }: any) {
      return (
        <ul className="my-2.5 pl-5 list-disc space-y-1 text-zinc-800 dark:text-[#d4d4d8] marker:text-zinc-400 dark:marker:text-zinc-500" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, ...props }: any) {
      return (
        <ol className="my-2.5 pl-5 list-decimal space-y-1.5 text-zinc-800 dark:text-[#d4d4d8] marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400" {...props}>
          {children}
        </ol>
      );
    },

    hr({ ...props }: any) {
      return (
        <hr className="my-5 border-t border-zinc-200/60 dark:border-white/[0.08]" {...props} />
      );
    },

    li({ children, ...props }: any) {
      return (
        <li className="my-1 text-[13.5px] leading-[1.68] text-zinc-800 dark:text-[#d4d4d8]" {...props}>
          {processTextNodes(children, onOpenFile)}
        </li>
      );
    },

    h1({ children, ...props }: any) {
      return (
        <h1 className="mt-6 mb-3 text-[19px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h1>
      );
    },

    h2({ children, ...props }: any) {
      return (
        <h2 className="mt-5 mb-2.5 text-[16px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/60 dark:border-white/[0.08] pb-1.5" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h2>
      );
    },

    h3({ children, ...props }: any) {
      return (
        <h3 className="mt-4 mb-2 text-[14.5px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h3>
      );
    },

    h4({ children, ...props }: any) {
      return (
        <h4 className="mt-3.5 mb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h4>
      );
    },

    strong({ children, ...props }: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },

    td({ children, ...props }: any) {
      const text = extractChildText(children).trim();
      const isNumeric = /^[-−–]?\s*[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?\s*(%|Dr|Cr|dr|cr)?$/.test(text) || /^\([\d,]+(\.\d+)?\)/.test(text);
      return (
        <td className={`py-1.5 px-3 text-zinc-800 dark:text-zinc-300 ${isNumeric ? 'text-right font-mono text-[12px]' : 'text-left text-[12.5px]'}`} {...props}>
          {processTextNodes(children, onOpenFile)}
        </td>
      );
    },

    th({ children, ...props }: any) {
      const text = extractChildText(children).trim();
      const isNumeric = /^[-−–]?\s*[\$₹€£]?\s*[\(]?\s*[\d,]+(\.\d+)?\s*[\)]?\s*(%|Dr|Cr|dr|cr)?$/.test(text);
      return (
        <th className={`py-2 px-3 font-medium text-zinc-600 dark:text-zinc-400 text-[11px] uppercase tracking-wider ${isNumeric ? 'text-right' : 'text-left'}`} {...props}>
          {children}
        </th>
      );
    },

    a({ href, children, ...props }: any) {
      if (!href) return <span {...props}>{children}</span>;

      const isFileUri = href.startsWith('file:///') || href.startsWith('file://');
      const isWinPath = /^[a-zA-Z]:[/\\]/.test(href);
      const isRelativeFile = /\.(xlsx?|xlsm|csv|json|md|markdown|txt|log|py|tsx?|jsx?|mjs|sql|ya?ml|toml|xml|env|html|css|pdf|png|jpe?g|svg|webp|gif|j2|jinja2?)$/i.test(href.split('#')[0]);
      const isLocalPath = (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) && isFullFilePath(href);

      if ((isFileUri || isWinPath || isRelativeFile || isLocalPath || isFullFilePath(href)) && !shouldExcludePath(href)) {
        const rawLabel = extractChildText(children);
        const { filePath, display } = formatFilePill(rawLabel || href, href);
        return <FilePill path={filePath} label={display} onOpenFile={onOpenFile} />;
      }

      return (
        <WebLink href={href} {...props}>
          {children}
        </WebLink>
      );
    },

    img({ src, alt, ...props }: any) {
      let resolvedSrc = src;
      let cleanPath = src;
      const isRemote = resolvedSrc && (resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://') || resolvedSrc.startsWith('data:'));

      if (resolvedSrc && !isRemote) {
        cleanPath = normalizePath(resolvedSrc);
        resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
      }

      const caption = alt && alt.trim() ? alt.trim() : null;

      return (
        <div 
          onClick={() => {
            onImageClick?.({ src: resolvedSrc, alt: caption || '', path: cleanPath });
          }}
          className="my-3 rounded-xl overflow-hidden border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#141414] p-2.5 shadow-xs group/img cursor-pointer transition-all hover:border-zinc-300 dark:hover:border-white/[0.15]"
          title={caption ? `Click to inspect: ${caption}` : 'Click to inspect image'}
        >
          <div className="relative overflow-hidden rounded-lg bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center min-h-[120px] max-h-[500px]">
            <img 
              src={resolvedSrc} 
              alt={caption || 'Chart'} 
              className="max-w-full rounded-md object-contain max-h-[480px] mx-auto transition-transform duration-200 group-hover/img:scale-[1.01]" 
              loading="lazy"
              {...props} 
            />
          </div>
          {caption && (
            <div className="text-center text-xs text-zinc-500 dark:text-zinc-400 mt-2 font-medium truncate px-2">
              {caption}
            </div>
          )}
        </div>
      );
    },
  }), [onOpenFile, onImageClick, isStreaming, sessionId]);

  if (!sanitizedContent) return null;

  return (
    <div className={cn(
      "font-sans text-zinc-800 dark:text-[#ececed] text-[13.5px] leading-[1.68] mt-2",
      "[&_ul]:my-2.5 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:marker:text-zinc-400 dark:[&_ul]:marker:text-zinc-500",
      "[&_ol]:my-2.5 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:marker:text-zinc-400 dark:[&_ol]:marker:text-zinc-500",
      "[&_li>ul]:mt-1 [&_li>ul]:mb-0.5 [&_li>ol]:mt-1 [&_li>ol]:mb-0.5 [&_li_p]:mb-0 [&_li_p]:mt-0",
      "[&_hr]:my-4 [&_hr]:border-zinc-200/80 dark:[&_hr]:border-white/[0.08] [&_pre]:my-2.5",
      className
    )}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS as any}
        rehypePlugins={REHYPE_PLUGINS as any}
        urlTransform={(url) => /^\s*(javascript|vbscript|data):/i.test(url) ? '' : url}
        components={components}
      >
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  );
});

export default AssistantProse;
