"use client";

import { useState, useMemo, memo } from 'react';
import { Check, Copy } from 'lucide-react';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';
import { useTurnViewport } from '@/features/chat/context/TurnViewportContext';
import { highlightCodeSnippet } from '@/lib/syntaxHighlighter';

export { highlightCodeSnippet };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
