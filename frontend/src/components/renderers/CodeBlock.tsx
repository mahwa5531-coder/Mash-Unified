"use client";

import { useState, useMemo, memo } from 'react';
import { Check, Copy } from 'lucide-react';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';
import { useTurnViewport } from '@/features/chat/context/TurnViewportContext';

// ----------------------------------------------------------------------
// High-performance syntax tokenizer for standalone / fallback code blocks
// Tokenizer handles instant single-pass tokenization without virtual-DOM thrashing.
// ----------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const KEYWORDS = new Set([
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'of', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var',
  'void', 'while', 'with', 'yield',
  // Python
  'def', 'elif', 'except', 'is', 'lambda', 'nonlocal', 'pass', 'raise', 'with',
  'None', 'True', 'False', 'self',
  // Types / Common
  'type', 'interface', 'enum', 'implements', 'declare', 'abstract', 'readonly',
  // SQL
  'select', 'from', 'where', 'insert', 'update', 'delete', 'join', 'left',
  'right', 'inner', 'outer', 'group', 'by', 'order', 'having', 'limit',
  'create', 'table', 'drop', 'alter', 'and', 'or', 'not', 'distinct', 'as'
]);

export function highlightCodeSnippet(rawCode: string, language: string, isDark: boolean): string {
  if (!rawCode) return '';
  const lang = (language || '').toLowerCase().trim();

  // For plain text, markdown or diff, return escaped text
  if (lang === 'text' || lang === 'plain' || lang === 'txt') {
    return escapeHtml(rawCode);
  }

  // Tokenization regex matching comments, strings, numbers, words, operators
  const tokenRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b[a-zA-Z_][a-zA-Z0-9_]*\b)|([^\s\w]+|\s+)/g;

  let html = '';
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(rawCode)) !== null) {
    const [, comment, str, num, word, other] = match;

    if (comment) {
      const cls = isDark ? 'text-zinc-500 italic' : 'text-zinc-400 italic';
      html += `<span class="${cls}">${escapeHtml(comment)}</span>`;
    } else if (str) {
      const cls = isDark ? 'text-emerald-400' : 'text-emerald-600';
      html += `<span class="${cls}">${escapeHtml(str)}</span>`;
    } else if (num) {
      const cls = isDark ? 'text-amber-400' : 'text-amber-600';
      html += `<span class="${cls}">${escapeHtml(num)}</span>`;
    } else if (word) {
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower) || KEYWORDS.has(word)) {
        const cls = isDark ? 'text-purple-400 font-medium' : 'text-purple-600 font-medium';
        html += `<span class="${cls}">${escapeHtml(word)}</span>`;
      } else if (word === 'true' || word === 'false' || word === 'null' || word === 'None' || word === 'True' || word === 'False') {
        const cls = isDark ? 'text-rose-400 font-medium' : 'text-rose-600 font-medium';
        html += `<span class="${cls}">${escapeHtml(word)}</span>`;
      } else {
        html += escapeHtml(word);
      }
    } else if (other) {
      // Punctuation / operator
      if (/^[=+\-*/%&|^!<>?:;.,{}()[\]]+$/.test(other.trim())) {
        const cls = isDark ? 'text-zinc-400' : 'text-zinc-600';
        html += `<span class="${cls}">${escapeHtml(other)}</span>`;
      } else {
        html += escapeHtml(other);
      }
    }
  }

  return html;
}

// ----------------------------------------------------------------------
// CodeBlock with Copy and Language Pill (Untruncated, Full View)
// ponytail: code blocks never truncate or collapse; all lines are fully visible
// ----------------------------------------------------------------------
const CodeBlock = memo(function CodeBlock({ 
  language, 
  code, 
  isStreaming = false 
}: { 
  language: string; 
  code: string; 
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isDark = useIsDarkMode();
  const { isNearViewport } = useTurnViewport();
  
  // ponytail: allocation-free O(N) line counter avoids allocating thousands of throwaway substrings per render
  let lineCount = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) lineCount++;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightedHtml = useMemo(() => {
    if (isStreaming) return '';
    if (!isNearViewport) return escapeHtml(code);
    return highlightCodeSnippet(code, language, isDark);
  }, [code, language, isDark, isStreaming, isNearViewport]);

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-[var(--border-subtle)] shadow-xs bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{language || 'code'}</span>
          <span className="text-[10px] text-[var(--text-muted)] font-sans">({lineCount} lines)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
            title="Copy Code"
          >
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
      <div>
        {isStreaming ? (
          <pre
            className="font-mono text-[13px] leading-[1.5] p-3 text-zinc-800 dark:text-zinc-200 overflow-x-auto whitespace-pre select-text m-0"
            style={{ background: 'var(--bg-surface)' }}
          >
            <code>{code}</code>
          </pre>
        ) : (
          <pre
            className="font-mono text-[13px] leading-[1.5] p-3 text-zinc-800 dark:text-zinc-200 overflow-x-auto whitespace-pre select-text m-0"
            style={{ background: 'var(--bg-surface)' }}
          >
            <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          </pre>
        )}
      </div>
    </div>
  );
});

export default CodeBlock;
