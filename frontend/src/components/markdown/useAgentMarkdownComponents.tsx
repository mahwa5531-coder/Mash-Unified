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
import { normalizePath } from '@/utils/normalizePath';
import { BASE_URL } from '@/services/client';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import {
  extractChildText,
  formatFilePill,
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

    /** Audit callout styling for blockquotes (feature #3). */
    blockquote({ children, node: _node, ...props }: any) {
      return <CalloutBlockquote {...props}>{children}</CalloutBlockquote>;
    },

    p({ children, node: _node, ...props }: any) {
      return (
        <p className={isChat
          ? "mb-3 text-[13.5px] leading-[1.75] text-zinc-900 dark:text-zinc-100 last:mb-0 [li>&]:mb-0 [li>&]:my-0.5"
          : "mb-3.5 text-[13.5px] leading-[1.75] text-zinc-900 dark:text-zinc-100 last:mb-0 [li>&]:mb-0 [li>&]:my-0.5"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </p>
      );
    },

    ul({ children, node: _node, ...props }: any) {
      return (
        <ul className="my-2 pl-5 list-disc space-y-1 text-zinc-900 dark:text-zinc-100 marker:text-zinc-400 dark:marker:text-zinc-500 [&_ul]:my-0.5 [&_ul]:pl-4 [&_ol]:my-0.5 [&_ol]:pl-4" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, node: _node, ...props }: any) {
      return (
        <ol className="my-2 pl-5 list-decimal space-y-1 text-zinc-900 dark:text-zinc-100 marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400 [&_ul]:my-0.5 [&_ul]:pl-4 [&_ol]:my-0.5 [&_ol]:pl-4" {...props}>
          {children}
        </ol>
      );
    },

    hr({ node: _node, ...props }: any) {
      return (
        <hr className="my-5 border-t border-zinc-200/60 dark:border-white/[0.08]" {...props} />
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
          ? "mt-7 mb-3.5 text-[22px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0"
          : "mt-8 mb-4 text-[22px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h1>
      );
    },

    h2({ children, node: _node, ...props }: any) {
      return (
        <h2 className={isChat
          ? "mt-6 mb-2.5 text-[17.5px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/60 dark:border-white/[0.08] pb-1.5"
          : "mt-7 mb-3 text-[17.5px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/60 dark:border-white/[0.08] pb-2"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h2>
      );
    },

    h3({ children, node: _node, ...props }: any) {
      return (
        <h3 className="mt-5 mb-2 text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h3>
      );
    },

    h4({ children, node: _node, ...props }: any) {
      return (
        <h4 className="mt-4 mb-1.5 text-[14.5px] font-semibold text-zinc-950 dark:text-white tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h4>
      );
    },

    strong({ children, node: _node, ...props }: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },

    /** Pure minimalist responsive table with subtle vertical hairlines — zero extra card/frame, zero clutter buttons */
    table({ children, node: _node, className, ...props }: any) {
      return (
        <div className="my-3 overflow-x-auto select-text custom-scrollbar">
          <table className={cn("w-full border-collapse text-[13px] text-zinc-900 dark:text-zinc-100", className)} {...props}>
            {children}
          </table>
        </div>
      );
    },

    thead({ children, node: _node, className, ...props }: any) {
      return (
        <thead className={cn("border-b border-zinc-200 dark:border-white/[0.1] bg-zinc-50/50 dark:bg-white/[0.02]", className)} {...props}>
          {children}
        </thead>
      );
    },

    tbody({ children, node: _node, className, ...props }: any) {
      return (
        <tbody className={cn("divide-y divide-zinc-200/60 dark:divide-white/[0.06]", className)} {...props}>
          {children}
        </tbody>
      );
    },

    tr({ children, node: _node, className, ...props }: any) {
      return (
        <tr className={cn("hover:bg-zinc-50/50 dark:hover:bg-white/[0.02] transition-colors", className)} {...props}>
          {children}
        </tr>
      );
    },

    td({ children, node: _node, className, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <td className={cn("px-3.5 py-2 text-zinc-900 dark:text-zinc-100 tabular-nums text-[13px] border-r border-zinc-200/40 dark:border-white/[0.04] last:border-r-0", alignClass, className)} {...props}>
          {processTextNodes(children, onOpenFile)}
        </td>
      );
    },

    th({ children, node: _node, className, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <th className={cn("px-3.5 py-2 font-semibold text-zinc-900 dark:text-zinc-100 text-[12px] uppercase tracking-wider text-left border-r border-zinc-200/60 dark:border-white/[0.05] last:border-r-0", alignClass, className)} {...props}>
          {children}
        </th>
      );
    },

    /** Links: file paths become FilePills, external links use WebLink (feature #1). */
    a({ href, children, node: _node, ...props }: any) {
      if (!href) return <span {...props}>{children}</span>;

      const isFileUri = href.startsWith('file:///') || href.startsWith('file://');
      const isWinPath = /^[a-zA-Z]:[/\\]/.test(href);
      const isUnixAbsPath = /^\/(?:Users|home|tmp|var|etc)\//.test(href);
      const isFullFile = isFileUri || isWinPath || isUnixAbsPath || isFullFilePath(href);

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

    /** Images: resolve local paths via connector, lightbox on click (feature #6). */
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
          className="block my-3 rounded-xl overflow-hidden border border-zinc-200 dark:border-white/[0.08] bg-zinc-50 dark:bg-[#141414] p-2.5 shadow-xs group/img cursor-pointer transition-all hover:border-zinc-300 dark:hover:border-white/[0.15]"
          title={caption ? `Click to inspect: ${caption}` : 'Click to inspect image'}
        >
          <span className="relative block overflow-hidden rounded-lg bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-center min-h-[120px] max-h-[500px]">
            { }
            <img
              src={resolvedSrc}
              alt={caption || 'Chart'}
              className="max-w-full rounded-md object-contain max-h-[480px] mx-auto transition-transform duration-200 group-hover/img:scale-[1.01]"
              loading="lazy"
              {...props}
            />
          </span>
          {caption && (
            <span className="block text-center text-xs text-zinc-500 dark:text-zinc-400 mt-2 font-medium truncate px-2">
              {caption}
            </span>
          )}
        </span>
      );
    },
  }), [isChat, sessionId, onOpenFile, onImageClick]);
}
