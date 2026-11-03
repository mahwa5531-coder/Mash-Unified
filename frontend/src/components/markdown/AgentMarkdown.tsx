"use client";

import React, { memo } from 'react';
import katex from 'katex';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import CodeBlock from '@/components/renderers/CodeBlock';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import { useAgentMarkdownComponents } from './useAgentMarkdownComponents';
import { escapeCurrencyInMarkdown } from '@/features/chat/components/messages/proseHelpers';
import MermaidRenderer, { repairMermaidSyntax } from '@/components/renderers/MermaidRenderer';

/**
 * AgentMarkdown — unified markdown renderer powered directly by Streamdown.
 * Uses official @streamdown/mermaid and @streamdown/math plugins for deterministic,
 * streaming-safe diagram and KaTeX equation rendering without fragile line chunking.
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

// Custom renderer for Mermaid diagrams — Unit 16 clean inline look with foreground modal zoom lightbox
function MermaidBlock({ code: chart, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  return <MermaidRenderer chart={chart} isStreaming={isIncomplete} />;
}

// Custom renderer for Code blocks — Unit 17 fast regex tokenizer with header bar, line count, and copy
function StreamdownCodeBlock({ code, language, isIncomplete }: { code: string; language: string; isIncomplete?: boolean }) {
  return <CodeBlock language={language || 'code'} code={code} isStreaming={isIncomplete} />;
}

// ponytail: proxy matches all languages except mermaid and latex, routing them to Unit 17 CodeBlock
const allOtherLanguages = new Proxy([] as string[], {
  get(target, prop) {
    if (prop === 'includes') {
      return (lang: string) => {
        if (!lang) return true;
        const l = String(lang).toLowerCase().trim();
        if (l === 'mermaid') return false;
        if (LATEX_LANGUAGES.includes(l)) return false;
        return true;
      };
    }
    return Reflect.get(target, prop);
  }
});

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
    let text = escapeCurrencyInMarkdown(content);
    if (text.includes('```mermaid')) {
      text = text.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_, code) => {
        return '```mermaid\n' + repairMermaidSyntax(code) + '\n```';
      });
    }
    return text;
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
          math: mathPlugin,
          renderers: [
            { component: LatexBlock, language: LATEX_LANGUAGES },
            { component: MermaidBlock, language: 'mermaid' },
            { component: StreamdownCodeBlock, language: allOtherLanguages },
          ],
        }}
        remarkPlugins={[remarkGfm, ensureCodeLanguagePlugin]}
        controls={false}
        components={components}
        urlTransform={safeUrlTransform}
        caret={isChat && isStreaming ? 'block' : undefined}
        codeBlockMaxHeight={isChat ? 400 : 0}
        tableMaxHeight={isChat ? 340 : 0}
      >
        {sanitizedContent}
      </Streamdown>
    </div>
  );
});

export default AgentMarkdown;
