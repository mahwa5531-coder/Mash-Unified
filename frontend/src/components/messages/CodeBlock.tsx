"use client";

import { useState, memo } from 'react';
import { Check, Copy } from 'lucide-react';
import SyntaxHighlighter from '@/lib/lightSyntaxHighlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useIsDarkMode } from '@/hooks/useIsDarkMode';

// ----------------------------------------------------------------------
// CodeBlock with Copy, Language Pill, and Collapse Toggle
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
  const [collapsed, setCollapsed] = useState(false);
  const isDark = useIsDarkMode();
  const lines = code.split('\n');
  const lineCount = lines.length;
  const isLong = lineCount > 45;

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-[var(--border-subtle)] shadow-sm bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{language || 'code'}</span>
          <span className="text-[10px] text-[var(--text-muted)] font-sans">({lineCount} lines)</span>
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors px-1.5 py-0.5 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
            >
              {collapsed ? `Expand (${lineCount} lines)` : 'Collapse'}
            </button>
          )}
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
      <div className={collapsed ? 'max-h-[220px] overflow-hidden relative' : ''}>
        {isStreaming ? (
          <pre
            className="font-mono text-[13px] leading-[1.5] p-3 text-zinc-800 dark:text-zinc-200 overflow-x-auto whitespace-pre select-text m-0"
            style={{ background: 'var(--bg-surface)' }}
          >
            <code>{code}</code>
          </pre>
        ) : (
          <SyntaxHighlighter
            style={(isDark ? vscDarkPlus : vs) as any}
            language={language || 'text'}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: '0.75rem',
              background: 'var(--bg-surface)',
              fontSize: '13px',
              lineHeight: '1.5'
            }}
          >
            {code}
          </SyntaxHighlighter>
        )}
        {collapsed && (
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--bg-surface)] to-transparent pointer-events-none flex items-end justify-center pb-2">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="pointer-events-auto px-3 py-1 bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] rounded-full shadow-md hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
            >
              Show {lineCount - 10} more lines
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default CodeBlock;
