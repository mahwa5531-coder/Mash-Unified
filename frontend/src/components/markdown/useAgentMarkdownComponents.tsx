"use client";

import React, { useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
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

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Unified component map for AgentMarkdown — used by BOTH chat mode and
 * artifact mode so file pills, audit badges, tables, and links behave
 * identically everywhere.
 *
 * Fenced code blocks, Mermaid diagrams, and math are owned by Streamdown's
 * plugins and custom renderers in AgentMarkdown.tsx.
 */
export interface UseAgentMarkdownComponentsOptions {
  mode: 'chat' | 'artifact';
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
}

interface InlineMarkdownImageProps {
  src?: string;
  alt?: string;
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (data: LightboxImageData) => void;
  [key: string]: any;
}

function InlineMarkdownImage({
  src,
  alt,
  sessionId,
  onOpenFile,
  onImageClick,
  ...props
}: InlineMarkdownImageProps) {
  const [hasError, setHasError] = useState(false);

  let resolvedSrc = src;
  let cleanPath = src;
  const isRemote = resolvedSrc && (resolvedSrc.startsWith('http://') || resolvedSrc.startsWith('https://') || resolvedSrc.startsWith('data:'));

  if (resolvedSrc && !isRemote) {
    cleanPath = normalizePath(resolvedSrc);
    resolvedSrc = `${BASE_URL}/files/content?path=${encodeURIComponent(cleanPath)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`;
  }

  const caption = alt && alt.trim() ? alt.trim() : null;
  const parts = cleanPath ? cleanPath.split(/[/\\]/) : [];
  const displayName = parts.length > 0 ? parts[parts.length - 1] : 'Image';

  if (hasError) {
    const handleGhostClick = () => {
      if (cleanPath && onOpenFile) {
        onOpenFile(cleanPath);
      } else if (cleanPath && onImageClick) {
        onImageClick({ src: resolvedSrc || '', alt: caption || displayName, path: cleanPath });
      }
    };

    return (
      <span
        onClick={handleGhostClick}
        className="group/ghost my-2.5 inline-flex items-center gap-3 px-3.5 py-2.5 rounded-lg bg-zinc-100/90 hover:bg-zinc-200/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.15] text-xs transition-all duration-150 cursor-pointer select-none max-w-lg shadow-2xs"
        title={cleanPath ? `File no longer on disk: ${cleanPath}. Click to inspect.` : 'Image unavailable'}
      >
        <span className="w-8 h-8 rounded-md bg-zinc-200/70 dark:bg-white/[0.06] flex items-center justify-center text-zinc-400 dark:text-zinc-500 shrink-0 group-hover/ghost:text-zinc-600 dark:group-hover/ghost:text-zinc-300 transition-colors">
          <ImageOff size={16} strokeWidth={2} />
        </span>
        <span className="flex flex-col min-w-0 pr-1 text-left">
          <span className="font-medium text-xs text-zinc-800 dark:text-zinc-200 truncate leading-tight">
            {caption || displayName}
          </span>
          <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 leading-tight flex items-center gap-1.5">
            {caption && caption !== displayName && (
              <>
                <span className="text-zinc-500 dark:text-zinc-400">{displayName}</span>
                <span className="text-zinc-300 dark:text-zinc-600">•</span>
              </>
            )}
            <span>File no longer on disk</span>
          </span>
        </span>
      </span>
    );
  }

  return (
    <span
      onClick={() => {
        onImageClick?.({ src: resolvedSrc || '', alt: caption || '', path: cleanPath });
      }}
      className="group/img my-3 block max-w-full cursor-pointer select-none"
      title={caption ? `Click to inspect: ${caption}` : 'Click to inspect image'}
    >
      <img
        src={resolvedSrc}
        alt={caption || 'Chart'}
        onError={() => setHasError(true)}
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

      // A backtick token is only converted to an interactive FilePill if it has a concrete path structure
      // (contains a path separator like src/app.py or Audit_Deliverables/test.xlsx, or is a root dotfile like .env).
      // Bare filenames or code identifiers (like main.py or console.log) remain as clean code badges.
      const hasConcretePath = cleanPath.includes('/') || cleanPath.includes('\\') || /^\.env(?:\.[a-zA-Z0-9_-]+)?$/i.test(cleanPath);
      if (isFullFilePath(cleanPath) && hasConcretePath) {
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
          ? "mb-3 text-[15px] leading-[1.65] text-zinc-900 dark:text-zinc-200 last:mb-0 [li>&]:my-0 [li>&+p]:mt-2 [&+ul]:mt-2 [&+ol]:mt-2"
          : "mb-3.5 text-[15px] leading-[1.68] text-zinc-900 dark:text-zinc-200 last:mb-0 [li>&]:my-0 [li>&+p]:mt-2 [&+ul]:mt-2 [&+ol]:mt-2"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </p>
      );
    },

    ul({ children, node: _node, ...props }: any) {
      return (
        <ul className="my-3 pl-6 list-disc text-zinc-900 dark:text-zinc-200 marker:text-zinc-400 dark:marker:text-zinc-500 [&_ul]:my-1.5 [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:pl-5" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, node: _node, ...props }: any) {
      return (
        <ol className="my-3 pl-6 list-decimal text-zinc-900 dark:text-zinc-200 marker:font-semibold marker:text-zinc-500 dark:marker:text-zinc-400 [&_ul]:my-1.5 [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:pl-5 [&>li]:font-medium [&>li>p]:font-normal [&>li>ul]:font-normal [&>li>ul>li]:font-normal" {...props}>
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
        <li className="py-1 text-[15px] leading-[1.65] text-zinc-900 dark:text-zinc-200" {...props}>
          {processTextNodes(children, onOpenFile)}
        </li>
      );
    },

    h1({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h1 id={headingId || undefined} className={isChat
          ? "mt-7 mb-3 text-[22px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 [&+h2]:mt-3 [&+h3]:mt-2"
          : "mt-8 mb-4 text-[24px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 [&+h2]:mt-3"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h1>
      );
    },

    h2({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h2 id={headingId || undefined} className={isChat
          ? "mt-7 mb-3 text-[20px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 [&+h3]:mt-2.5 [&+h4]:mt-2"
          : "mt-7 mb-3.5 text-[20px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0 border-b border-zinc-200/60 dark:border-white/[0.08] pb-1.5 [&+h3]:mt-2.5"
        } {...props}>
          {processTextNodes(children, onOpenFile)}
        </h2>
      );
    },

    h3({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h3 id={headingId || undefined} className="mt-5 mb-2 text-[16.5px] font-semibold text-zinc-950 dark:text-zinc-100 tracking-tight first:mt-0 [&+h4]:mt-1.5" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h3>
      );
    },

    h4({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h4 id={headingId || undefined} className="mt-4 mb-1.5 text-[14.5px] font-semibold text-zinc-900 dark:text-zinc-200 tracking-tight first:mt-0 [&+h5]:mt-1" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h4>
      );
    },

    h5({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h5 id={headingId || undefined} className="mt-2 mb-0.5 text-[13px] font-medium text-zinc-800 dark:text-zinc-200 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h5>
      );
    },

    h6({ children, node: _node, id: propId, ...props }: any) {
      const headingId = propId || slugifyHeading(extractChildText(children));
      return (
        <h6 id={headingId || undefined} className="mt-1.5 mb-0.5 text-[12.5px] font-medium text-zinc-600 dark:text-zinc-400 tracking-tight first:mt-0" {...props}>
          {processTextNodes(children, onOpenFile)}
        </h6>
      );
    },

    strong({ children, node: _node, ...props }: any) {
      return <strong className="text-zinc-950 dark:text-white font-semibold" {...props}>{children}</strong>;
    },

    /** Single-source naked table via MASH Unit 15 TableContainer — zero extra card/frame, zero clutter buttons */
    table({ children, node: _node, className: _cls, ...props }: any) {
      return <TableContainer isChat={isChat} {...props}>{children}</TableContainer>;
    },

    th({ children, node: _node, className, ...props }: any) {
      const alignClass = props.align === 'right' ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';
      return (
        <th className={cn("px-3.5 py-2.5 font-semibold text-zinc-900 dark:text-zinc-100 text-[11.5px] uppercase tracking-wider bg-zinc-100/90 dark:bg-[#18181c] border-r border-zinc-300/80 dark:border-zinc-700/80 last:border-r-0", alignClass, className)} {...props}>
          {children}
        </th>
      );
    },

    td({ children, node: _node, className, ...props }: any) {
      const isRight = props.align === 'right';
      const alignClass = isRight ? 'text-right' : props.align === 'center' ? 'text-center' : 'text-left';

      return (
        <td
          className={cn(
            "px-3.5 py-2 text-[13px] border-r border-zinc-200 dark:border-zinc-800/60 last:border-r-0 text-zinc-900 dark:text-zinc-100",
            isRight && "font-mono tabular-nums whitespace-nowrap",
            alignClass,
            className
          )}
          {...props}
        >
          {processTextNodes(children, onOpenFile)}
        </td>
      );
    },
    /** Links: file paths become FilePills, external links use WebLink (feature #1). */
    a({ href, children, node: _node, ...props }: any) {
      if (!href) return <span {...props}>{children}</span>;

      // In-document anchor links: smoothly scroll target heading into view
      if (href.startsWith('#')) {
        const targetId = href.slice(1);
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(targetId) || document.getElementById(decodeURIComponent(targetId));
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
            className="text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 underline underline-offset-2 cursor-pointer font-medium"
            {...props}
          >
            {children}
          </a>
        );
      }

      const isFileUri = href.startsWith('file:///') || href.startsWith('file://');
      const isWinPath = /^[a-zA-Z]:[/\\]/.test(href);
      const isUnixAbsPath = /^\/(?:Users|home|tmp|var|etc)\//.test(href);
      const isExternal = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:');
      const hasFileExt = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|tsx?|jsx?|mjs|json|ya?ml|toml|sql|md|txt|xml|xbrl|png|jpe?g|gif|svg|webp)$/i.test(href.split('#')[0]);
      const isFullFile = !isExternal && (isFileUri || isWinPath || isUnixAbsPath || isFullFilePath(href) || hasFileExt);

      if (isFullFile) {
        const rawLabel = extractChildText(children);
        const { filePath, display } = formatFilePill(rawLabel || href, href);
        return <FilePill path={filePath} label={display} onOpenFile={onOpenFile} />;
      }

      if (!isExternal && isDirectoryPath(href)) {
        return <PathPill path={href} />;
      }

      return (
        <WebLink href={href} {...props}>
          {children}
        </WebLink>
      );
    },

    /** Images: resolve local paths via connector, single-frame lightbox on click, clean ghost on missing */
    img(props: any) {
      return (
        <InlineMarkdownImage
          sessionId={sessionId}
          onOpenFile={onOpenFile}
          onImageClick={onImageClick}
          {...props}
        />
      );
    },
  }), [isChat, sessionId, onOpenFile, onImageClick]);
}
