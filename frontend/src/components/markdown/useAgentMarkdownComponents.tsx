"use client";

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  FilePill,
  PathPill,
  ExtensionBadge,
  WebLink
} from '@/primitives';
import CalloutBlockquote from '@/components/renderers/CalloutBlockquote';
import TableContainer from '@/components/renderers/TableContainer';
import { normalizePath } from '@/utils/normalizePath';
import { BASE_URL } from '@/services/client';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import {
  extractChildText,
  formatFilePill,
  prunePathPunctuation,
  isFullFilePath,
  isFileExtension,
  isDirectoryPath,
  processTextNodes,
} from '@/features/chat/components/messages/proseHelpers';

/**
 * Unified component map for AgentMarkdown — used by BOTH chat mode and
 * artifact mode so file pills, audit badges, math, tables, and images behave
 * identically everywhere.
 *
 * Fenced code blocks, Mermaid diagrams, and math are intentionally NOT
 * overridden here: they are owned by the streamdown plugins
 * (@streamdown/code, @streamdown/mermaid, @streamdown/math).
 */
export interface UseAgentMarkdownComponentsOptions {
  mode: 'chat' | 'artifact';
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
}

export function useAgentMarkdownComponents({
  mode,
  sessionId,
  onOpenFile,
  onImageClick,
}: UseAgentMarkdownComponentsOptions) {
  const isChat = mode === 'chat';

  return useMemo(() => ({
    /**
     * Inline code — detects file paths / extensions / directories and
     * renders them as interactive workspace pills (FilePill feature #1).
     */
    inlineCode({ children, node: _node, ...props }: any) {
      const rawText = String(children ?? '').replace(/\n$/, '');

      if (React.isValidElement(children) && ((children as any).type === FilePill || (children as any).props?.path)) {
        return children;
      }

      const plainText = (extractChildText(children) || rawText).trim();
      const { cleanPath } = prunePathPunctuation(plainText);

      if (isFullFilePath(cleanPath)) {
        const { filePath, display } = formatFilePill(cleanPath, cleanPath);
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

    /** Audit callout styling for blockquotes (feature #3). */
    blockquote({ children, node: _node, ...props }: any) {
      return <CalloutBlockquote {...props}>{children}</CalloutBlockquote>;
    },

    p({ children, node: _node, ...props }: any) {
      return (
        <p className={isChat
          ? "mb-2.5 text-[13.5px] leading-[1.72] text-zinc-900 dark:text-zinc-100 last:mb-0 [li>&]:mb-0 [li>&]:my-0.5 [&+ul]:mt-1.5 [&+ol]:mt-1.5"
          : "mb-3 text-[13.5px] leading-[1.75] text-zinc-900 dark:text-zinc-100 last:mb-0 [li>&]:mb-0 [li>&]:my-0.5 [&+ul]:mt-1.5 [&+ol]:mt-1.5"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </p>
      );
    },

    ul({ children, node: _node, ...props }: any) {
      return (
        <ul className="my-2 pl-4 list-disc space-y-1 text-zinc-900 dark:text-zinc-100 marker:text-zinc-400 dark:marker:text-zinc-500 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&>li>p]:my-0.5 [&>li>p]:mb-0" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, node: _node, ...props }: any) {
      return (
        <ol className="my-2 pl-4 list-decimal space-y-1 text-zinc-900 dark:text-zinc-100 marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400 [&_ul]:my-1 [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:pl-4 [&>li>p]:my-0.5 [&>li>p]:mb-0" {...props}>
          {children}
        </ol>
      );
    },

    hr({ node: _node, ...props }: any) {
      return (
        <hr className="my-4 border-t border-zinc-200/60 dark:border-white/[0.08]" {...props} />
      );
    },

    li({ children, node: _node, ...props }: any) {
      return (
        <li className="my-0.5 text-[13.5px] leading-[1.68] text-zinc-900 dark:text-zinc-100 [&_p]:mb-0 [&_p]:my-0.5" {...props}>
          {processTextNodes(children, onOpenFile)}
        </li>
      );
    },

    h1({ children, node: _node, ...props }: any) {
      return (
        <h1 className={isChat
          ? "mt-4 mb-2 text-[18px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 [&+h2]:mt-2 [&+h3]:mt-1.5"
          : "mt-6 mb-3 text-[20px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 [&+h2]:mt-2.5"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h1>
      );
    },

    h2({ children, node: _node, ...props }: any) {
      return (
        <h2 className={isChat
          ? "mt-3.5 mb-1.5 text-[16px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 [&+h3]:mt-1.5 [&+h4]:mt-1"
          : "mt-5 mb-2.5 text-[17px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/60 dark:border-white/[0.08] pb-1.5 [&+h3]:mt-2"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h2>
      );
    },

    h3({ children, node: _node, ...props }: any) {
      return (
        <h3 className="mt-3 mb-1 text-[14.5px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0 [&+h4]:mt-1" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h3>
      );
    },

    h4({ children, node: _node, ...props }: any) {
      return (
        <h4 className="mt-2.5 mb-1 text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0 [&+h5]:mt-1" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h4>
      );
    },

    h5({ children, node: _node, ...props }: any) {
      return (
        <h5 className="mt-2 mb-0.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-200 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h5>
      );
    },

    h6({ children, node: _node, ...props }: any) {
      return (
        <h6 className="mt-1.5 mb-0.5 text-[12.5px] font-medium text-zinc-600 dark:text-zinc-400 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h6>
      );
    },

    strong({ children, node: _node, ...props }: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },

    /** Single-source naked table via MASH Unit 15 TableContainer — zero extra card/frame, zero clutter buttons */
    table({ children, node: _node, className: _cls, ...props }: any) {
      return <TableContainer {...props}>{children}</TableContainer>;
    },

    th({ children, node: _node, className, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <th className={cn("px-3.5 py-2 font-semibold text-zinc-900 dark:text-zinc-100 text-[12px] uppercase tracking-wider border-r border-zinc-200/60 dark:border-white/[0.05] last:border-r-0 whitespace-nowrap", alignClass, className)} {...props}>
          {children}
        </th>
      );
    },

    td({ children, node: _node, className, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      // ponytail: detect Unit 15 financial column semantics from cell text
      const rawText = extractChildText(children).trim();
      const isNumericOrCurrency = /^[₹$€£+\-—\d]/.test(rawText) || props.align === 'right';
      const isCreditOrNegative = rawText.startsWith('-') || /^\([₹$€£\d]/.test(rawText) || /CR/i.test(rawText);
      const isDebitOrPositive = rawText.startsWith('+') || /DR/i.test(rawText);
      const isCode = /^(?:[A-Z]{2,4}-\d+|\d{4,6}|SA\s*\d+)$/i.test(rawText);

      const colorClass = isCreditOrNegative
        ? "text-rose-500 dark:text-rose-400 font-mono"
        : isDebitOrPositive
        ? "text-emerald-600 dark:text-emerald-400 font-mono"
        : isCode
        ? "font-mono text-zinc-500 dark:text-zinc-400"
        : isNumericOrCurrency
        ? "font-mono tabular-nums text-zinc-900 dark:text-zinc-100"
        : "";

      return (
        <td className={cn("px-3.5 py-2 text-[13px] border-r border-zinc-200/40 dark:border-white/[0.04] last:border-r-0", isNumericOrCurrency && "whitespace-nowrap", colorClass, alignClass, className)} {...props}>
          {processTextNodes(children, onOpenFile)}
        </td>
      );
    },

    /** Links: file paths become FilePills, external links use WebLink (feature #1). */
    a({ href, children, node: _node, ...props }: any) {
      if (!href) return <span {...props}>{children}</span>;

      const isFileUri = href.startsWith('file:///') || href.startsWith('file://');
      const isWinPath = /^[a-zA-Z]:[/\\]/.test(href);
      const isUnixAbsPath = /^\/(?:Users|home|tmp|var|etc)\//.test(href);
      const isExternal = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
      const hasFileExt = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|tsx?|jsx?|mjs|json|ya?ml|toml|sql|md|txt|xml|xbrl)$/i.test(href.split('#')[0]);
      const isFullFile = !isExternal && (isFileUri || isWinPath || isUnixAbsPath || isFullFilePath(href) || hasFileExt);

      if (isFullFile) {
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

    /** Images: resolve local paths via connector, single-frame lightbox on click (eliminated 3 nested frames) */
    img({ src, alt, node: _node, ...props }: any) {
      let resolvedSrc = src;
      let cleanPath = src;
      const isRemote = resolvedSrc && (resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://') || resolvedSrc.startsWith('data:'));

      if (resolvedSrc && !isRemote) {
        cleanPath = normalizePath(resolvedSrc);
        resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
      }

      const caption = alt && alt.trim() ? alt.trim() : null;

      return (
        <span
          onClick={() => {
            onImageClick?.({ src: resolvedSrc, alt: caption || '', path: cleanPath });
          }}
          className="group/img my-3 block max-w-full cursor-pointer select-none"
          title={caption ? `Click to inspect: ${caption}` : 'Click to inspect image'}
        >
          <img
            src={resolvedSrc}
            alt={caption || 'Chart'}
            className="max-w-full rounded-lg object-contain max-h-[480px] border border-zinc-200/60 dark:border-white/[0.08] transition-transform duration-200 group-hover/img:scale-[1.01]"
            loading="lazy"
            {...props}
          />
          {caption && (
            <span className="block text-center text-xs text-zinc-500 dark:text-zinc-400 mt-1.5 font-medium truncate px-1">
              {caption}
            </span>
          )}
        </span>
      );
    },
  }), [isChat, sessionId, onOpenFile, onImageClick]);
}
