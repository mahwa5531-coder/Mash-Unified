"use client";

import React, { useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from './ImageLightboxModal';
import { sanitizeMathString } from './proseHelpers';
import { useMarkdownComponents } from './useMarkdownComponents';

const REMARK_PLUGINS = [remarkGfm, remarkMath] as any;
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, errorColor: '#71717a', strict: false }]] as any;

export interface AssistantProseProps {
  content: string;
  isStreaming?: boolean;
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
  className?: string;
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

  const components = useMarkdownComponents({
    onOpenFile,
    onImageClick,
    isStreaming,
    sessionId,
  });

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
