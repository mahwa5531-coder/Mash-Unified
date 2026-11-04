"use client";

import React, { memo } from 'react';
import katex from 'katex';
import { Streamdown } from 'streamdown';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import { useAgentMarkdownComponents } from './useAgentMarkdownComponents';
import { escapeCurrencyInMarkdown } from '@/features/chat/components/messages/proseHelpers';
import MermaidRenderer from '@/components/renderers/MermaidRenderer';

/**
 * AgentMarkdown — unified markdown renderer powered directly by Streamdown.
 * Uses official @streamdown/code (Shiki) for 200+ language TextMate syntax highlighting,
 * official @streamdown/math for KaTeX equations, and custom Pele MermaidRenderer.
 * Code blocks never truncate or collapse; codeBlockMaxHeight={0} enforces full view.
 */

// Official math plugin with single-dollar inline math ($...$) support
const mathPlugin = createMathPlugin({ singleDollarTextMath: true });

// Fenced ```latex / ```math / ```katex blocks render as display math
const LATEX_LANGUAGES = ['latex', 'math', 'katex'];

function LatexBlock({ code: source, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  if (isIncomplete) {
    return (
      <div className="my-2.5 p-3 font-mono text-xs text-zinc-500 dark:text-zinc-400 overflow-x-auto select-text whitespace-pre">
        {source}
      </div>
    );
  }
  let html: string | null = null;
  let isError = false;
  try {
    html = katex.renderToString(source, { displayMode: true, throwOnError: false, strict: false });
    if (html && html.includes('katex-error')) {
      isError = true;
    }
  } catch {
    html = null;
  }
  if (!html || isError) {
    return (
      <div className="font-mono text-xs text-rose-400 my-2 select-text p-2 rounded bg-rose-500/10 border border-rose-500/20 whitespace-pre-wrap">
        {source}
      </div>
    );
  }
  return (
    <div
      className="my-2.5 overflow-x-auto select-text custom-scrollbar py-2 text-center"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Custom renderer for Mermaid diagrams — Pele engine with clean inline look & interactive foreground modal zoom
function MermaidBlock({ code: chart, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  return <MermaidRenderer chart={chart} isStreaming={isIncomplete} />;
}

// Remark plugin ensuring code blocks without explicit language get default 'text' lang
const ensureCodeLanguagePlugin = () => (tree: any) => {
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'code' && !node.lang) {
      node.lang = 'text';
    }
    if (Array.isArray(node.children)) {
      node.children.forEach(visit);
    }
  };
  visit(tree);
};

import { safeUrlTransform } from './urlPolicy';
export { safeUrlTransform };

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
  const sanitizedContent = React.useMemo(() => {
    if (!content) return '';
    return escapeCurrencyInMarkdown(content);
  }, [content]);

  if (!content) return null;

  const isChat = mode === 'chat';

  return (
    <div className={cn(
      "font-sans text-zinc-900 dark:text-zinc-100 text-[13.5px] leading-[1.68]",
      isChat
        ? "mt-2"
        : "p-5 md:p-6 leading-[1.75] text-[13.5px] bg-[var(--bg-surface)]",
      className
    )}>
      <Streamdown
        mode={isStreaming ? 'streaming' : 'static'}
        plugins={{
          code,
          math: mathPlugin,
          renderers: [
            { component: LatexBlock, language: LATEX_LANGUAGES },
            { component: MermaidBlock, language: 'mermaid' },
          ],
        }}
        remarkPlugins={[remarkGfm, ensureCodeLanguagePlugin]}
        controls={{ code: { copy: true } }}
        components={components}
        urlTransform={safeUrlTransform}
        caret={isChat && isStreaming ? 'block' : undefined}
        codeBlockMaxHeight={0}
        tableMaxHeight={0}
      >
        {sanitizedContent}
      </Streamdown>
    </div>
  );
});

export default AgentMarkdown;
