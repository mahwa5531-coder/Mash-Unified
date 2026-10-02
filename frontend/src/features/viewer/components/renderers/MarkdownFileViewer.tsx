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
    <div className="p-3 bg-zinc-100/60 dark:bg-[#121215] min-h-full">
      <div className="markdown-body p-6 md:p-8 leading-relaxed text-[13px] bg-white dark:bg-[#1c1c20] text-zinc-900 dark:text-zinc-100 rounded-xl shadow-xs border border-zinc-200/70 dark:border-white/[0.08]">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={{
            h1({children, ...props}: any) {
              return <h1 className="mt-6 mb-3 text-[18px] font-bold text-zinc-950 dark:text-white tracking-tight first:mt-0" {...props}>{children}</h1>;
            },
            h2({children, ...props}: any) {
              return <h2 className="mt-5 mb-2.5 text-[15.5px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight first:mt-0 border-b border-zinc-200/70 dark:border-white/[0.08] pb-1.5" {...props}>{children}</h2>;
            },
            h3({children, ...props}: any) {
              return <h3 className="mt-4 mb-2 text-[14px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight first:mt-0" {...props}>{children}</h3>;
            },
            h4({children, ...props}: any) {
              return <h4 className="mt-3.5 mb-1.5 text-[12.5px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 first:mt-0" {...props}>{children}</h4>;
            },
            p({children, ...props}: any) {
              return <p className="mb-3 text-[13px] leading-[1.7] text-zinc-800 dark:text-[#d4d4d8] last:mb-0" {...props}>{children}</p>;
            },
            ul({children, ...props}: any) {
              return <ul className="my-2.5 pl-5 list-disc space-y-1 text-zinc-800 dark:text-[#d4d4d8] marker:text-zinc-400 dark:marker:text-zinc-500" {...props}>{children}</ul>;
            },
            ol({children, ...props}: any) {
              return <ol className="my-2.5 pl-5 list-decimal space-y-1 text-zinc-800 dark:text-[#d4d4d8] marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400" {...props}>{children}</ol>;
            },
            li({children, ...props}: any) {
              return <li className="my-0.5 text-[13px] leading-[1.65]" {...props}>{children}</li>;
            },
            hr({...props}: any) {
              return <hr className="my-4 border-t border-zinc-200/70 dark:border-white/[0.08]" {...props} />;
            },
            a({href, children, ...props}: any) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 dark:text-sky-400 underline underline-offset-2 hover:text-sky-500 transition-colors"
                  {...props}
                >
                  {children}
                </a>
              );
            },
            code({inline, className, children, ...props}: any) {
              const match = /language-(\w+)/.exec(className || '');
              const lang = match ? match[1].toLowerCase() : '';
              if (!inline && lang === 'mermaid') {
                return <MermaidRenderer chart={String(children).replace(/\n$/, '')} />;
              }
              if (inline) {
                return (
                  <code className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-zinc-100 dark:bg-[#28282e] text-zinc-800 dark:text-zinc-200 border border-zinc-200/60 dark:border-white/[0.08]" {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <div className="my-3 rounded-lg overflow-hidden border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50 dark:bg-[#141416]">
                  {lang && (
                    <div className="px-3 py-1 bg-zinc-100 dark:bg-[#19191d] border-b border-zinc-200/70 dark:border-zinc-800/80 text-[10.5px] font-mono font-medium text-zinc-500 uppercase tracking-wider">
                      {lang}
                    </div>
                  )}
                  <pre className="p-3.5 overflow-x-auto text-[12px] font-mono leading-relaxed text-zinc-800 dark:text-zinc-200">
                    <code className={className} {...props}>
                      {children}
                    </code>
                  </pre>
                </div>
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
    </div>
  );
}
