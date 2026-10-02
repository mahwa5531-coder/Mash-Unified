"use client";

import React, { memo } from 'react';
import katex from 'katex';
import { Streamdown } from 'streamdown';
import { code as codePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { mermaid as mermaidPlugin } from '@streamdown/mermaid';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import { useAgentMarkdownComponents } from './useAgentMarkdownComponents';

/**
 * AgentMarkdown — the single unified markdown renderer for the whole app.
 *
 * Replaces the former react-markdown stack (AssistantProse +
 * useMarkdownComponents + MarkdownFileViewer) with streamdown 2.7:
 *  - Streaming-first: remend repairs unterminated fences/tables/math mid-stream
 *  - Shiki grammar-aware dual-theme syntax highlighting (@streamdown/code)
 *  - KaTeX math (@streamdown/math) and Mermaid diagrams (@streamdown/mermaid)
 *  - Custom Mash features (FilePills, AuditBadges, AuditCallout, lightbox)
 *    preserved via the shared component map.
 *
 * mode="chat"     → compact message typography, streaming caret, capped blocks
 * mode="artifact" → spacious document typography, full-height code/tables
 */

// Single-dollar inline math ($...$) — matches the previous remark-math behavior.
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });

// Fenced ```latex / ```math / ```katex blocks render as display math
// (preserves the previous useMarkdownComponents behavior).
const LATEX_LANGUAGES = ['latex', 'math', 'katex'];

function LatexBlock({ code: source, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  if (isIncomplete) {
    return (
      <div className="my-2.5 p-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 overflow-x-auto select-text whitespace-pre">
        {source}
      </div>
    );
  }
  try {
    const html = katex.renderToString(source, { displayMode: true, throwOnError: false, strict: false });
    return (
      <div
        className="my-2.5 overflow-x-auto select-text custom-scrollbar py-2 text-center"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return <div className="font-mono text-xs text-rose-400 my-2">{source}</div>;
  }
}

// Same URL policy as the previous AssistantProse stack.
function safeUrlTransform(url: string): string {
  return /^\s*(javascript|vbscript|data):/i.test(url) ? '' : url;
}

export interface AgentMarkdownProps {
  content: string;
  mode: 'chat' | 'artifact';
  isStreaming?: boolean;
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
  className?: string;
}

export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  mode,
  isStreaming = false,
  sessionId,
  onOpenFile,
  onImageClick,
  className,
}: AgentMarkdownProps) {
  const components = useAgentMarkdownComponents({ mode, sessionId, onOpenFile, onImageClick });

  if (!content) return null;

  const isChat = mode === 'chat';

  return (
    <div className={cn(
      "font-sans text-zinc-800 dark:text-[#ececed] text-[13.5px] leading-[1.68]",
      isChat
        ? "mt-2"
        : "p-5 md:p-6 leading-[1.75] text-[13.5px] bg-[var(--bg-surface)]",
      className
    )}>
      <Streamdown
        mode={isStreaming ? 'streaming' : 'static'}
        plugins={{
          code: codePlugin,
          math: mathPlugin,
          mermaid: mermaidPlugin,
          renderers: [{ component: LatexBlock, language: LATEX_LANGUAGES }],
        }}
        components={components}
        urlTransform={safeUrlTransform}
        caret={isChat && isStreaming ? 'block' : undefined}
        codeBlockMaxHeight={isChat ? 400 : 0}
        tableMaxHeight={isChat ? 300 : 0}
      >
        {content}
      </Streamdown>
    </div>
  );
});

export default AgentMarkdown;
