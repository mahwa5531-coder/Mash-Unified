"use client";

import React, { memo } from 'react';
import katex from 'katex';
import { Streamdown } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from '@/features/chat/components/messages/ImageLightboxModal';
import { useAgentMarkdownComponents } from './useAgentMarkdownComponents';
import CodeBlock from '@/components/renderers/CodeBlock';
import MermaidRenderer from '@/components/renderers/MermaidRenderer';

/**
 * AgentMarkdown — the single unified markdown renderer for the whole app.
 *
 * Uses streamdown 2.7 for streaming-first AST repair & KaTeX math,
 * and delegates code blocks and diagrams to the proven existing Mash modules:
 *  - CodeBlock: full header bar with language, line count, collapse/expand, and Copy button
 *  - MermaidRenderer: Diagram View header with pulse indicator, zoom controls, Code/Visual toggle, and Copy SVG
 *  - components: FilePills, PathPills, ExtensionBadges, AuditBadges, AuditCallouts, TableContainer
 *
 * mode="chat"     → compact message typography, streaming caret, capped blocks
 * mode="artifact" → spacious document typography, full-height code/tables
 */

// Single-dollar inline math ($...$) — matches the previous remark-math behavior.
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

function StreamdownMermaidBlock({ code: chart, isIncomplete }: { code: string; isIncomplete?: boolean }) {
  return <MermaidRenderer chart={chart} isStreaming={isIncomplete} />;
}

function StreamdownCodeBlock({ code, language, isIncomplete }: { code: string; language: string; isIncomplete?: boolean }) {
  return <CodeBlock language={language || 'code'} code={code} isStreaming={isIncomplete} />;
}

// Proxy matching all programming languages except 'mermaid' and LATEX_LANGUAGES
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
          math: mathPlugin,
          renderers: [
            { component: StreamdownMermaidBlock, language: 'mermaid' },
            { component: LatexBlock, language: LATEX_LANGUAGES },
            { component: StreamdownCodeBlock, language: allOtherLanguages },
          ],
        }}
        remarkPlugins={[remarkGfm, ensureCodeLanguagePlugin]}
        controls={false}
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
