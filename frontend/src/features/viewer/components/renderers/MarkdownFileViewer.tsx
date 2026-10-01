"use client";

import React from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BASE_URL } from '@/services/client';
import TableContainer from '@/components/renderers/TableContainer';
import CalloutBlockquote from '@/components/renderers/CalloutBlockquote';
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

interface MarkdownFileViewerProps {
  content: string;
  displayedContent: string;
  isMassiveFile: boolean;
  sessionQuery: string;
}

export function MarkdownFileViewer({
  content,
  displayedContent,
  isMassiveFile,
  sessionQuery,
}: MarkdownFileViewerProps) {
  return (
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
  );
}
