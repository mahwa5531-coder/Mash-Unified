"use client";

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface AssistantMessageFooterProps {
  displayTime: string;
  rawText: string;
  hasPrecedingContent?: boolean;
}

export function AssistantMessageFooter({
  displayTime,
  rawText,
  hasPrecedingContent = false,
}: AssistantMessageFooterProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (rawText) {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={`flex items-center justify-between mt-3 pt-1 text-[var(--text-muted)] transition-opacity ${
        hasPrecedingContent ? 'border-t border-zinc-200/70 dark:border-white/[0.04]' : ''
      }`}
    >
      <span className="text-[11px] text-[var(--text-muted)] font-mono">
        {displayTime}
      </span>
      {rawText ? (
        <button
          onClick={handleCopy}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
          title="Copy response"
        >
          {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
        </button>
      ) : null}
    </div>
  );
}
