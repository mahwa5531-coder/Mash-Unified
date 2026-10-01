"use client";

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import katex from 'katex';
import { 
  FilePill, 
  PathPill, 
  ExtensionBadge, 
  AuditCallout, 
  WebLink 
} from '@/primitives';
import CodeBlock from '@/components/renderers/CodeBlock';
import TableContainer from '@/components/renderers/TableContainer';
import { normalizePath } from '@/utils/normalizePath';
import { shouldExcludePath } from '@/features/artifacts/utils/extraction';
import { BASE_URL } from '@/services/client';
import type { LightboxImageData } from './ImageLightboxModal';
import {
  extractChildText,
  formatFilePill,
  isFullFilePath,
  isFileExtension,
  isDirectoryPath,
  processTextNodes,
} from './proseHelpers';

const MermaidRenderer = dynamic(() => import('@/components/renderers/MermaidRenderer'), {
  ssr: false,
  loading: () => (
    <div className="my-2.5 p-3 bg-zinc-50 dark:bg-[#121214] border border-zinc-200 dark:border-white/[0.08] rounded-xl text-xs font-mono text-zinc-500 animate-pulse flex items-center gap-2">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
      <span>Rendering diagram...</span>
    </div>
  ),
});

interface UseMarkdownComponentsProps {
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
  isStreaming?: boolean;
  sessionId?: string;
}

export function useMarkdownComponents({
  onOpenFile,
  onImageClick,
  isStreaming,
  sessionId,
}: UseMarkdownComponentsProps) {
  return useMemo(() => ({
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
        <p className="mb-3.5 text-[13.5px] leading-[1.75] text-zinc-800 dark:text-[#d4d4d8] last:mb-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </p>
      );
    },

    ul({ children, ...props }: any) {
      return (
        <ul className="my-3 pl-5 list-disc space-y-1.5 text-zinc-800 dark:text-[#d4d4d8] marker:text-zinc-400 dark:marker:text-zinc-500" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, ...props }: any) {
      return (
        <ol className="my-3 pl-5 list-decimal space-y-1.5 text-zinc-800 dark:text-[#d4d4d8] marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400" {...props}>
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
        <h1 className="mt-7 mb-3.5 text-[19px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h1>
      );
    },

    h2({ children, ...props }: any) {
      return (
        <h2 className="mt-6 mb-3 text-[16px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/70 dark:border-white/[0.08] pb-2" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h2>
      );
    },

    h3({ children, ...props }: any) {
      return (
        <h3 className="mt-5 mb-2.5 text-[14.5px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h3>
      );
    },

    h4({ children, ...props }: any) {
      return (
        <h4 className="mt-4 mb-2 text-[12.5px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h4>
      );
    },

    strong({ children, ...props }: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },

    td({ children, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <td className={`py-2 px-3.5 text-zinc-800 dark:text-zinc-200 tabular-nums ${alignClass} text-[12.5px]`} {...props}>
          {processTextNodes(children, onOpenFile)}
        </td>
      );
    },

    th({ children, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <th className={`py-2.5 px-3.5 font-semibold text-zinc-800 dark:text-zinc-200 text-[11.5px] uppercase tracking-wider ${alignClass}`} {...props}>
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
}
