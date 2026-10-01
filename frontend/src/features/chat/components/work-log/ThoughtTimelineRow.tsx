"use client";

import React from 'react';
import { ChevronRight, Loader2, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDurationDisplay } from './toolTimeline';
import type { TimelineEntry } from './types';

interface ThoughtTimelineRowProps {
  entry: TimelineEntry;
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  liveThinkingSeconds: number;
  latchedThinkingSeconds: number | null;
  isExpanded: boolean;
  copiedId: string | null;
  toggleThought: (id: string) => void;
  handleCopy: (text: string, id: string) => void;
  thoughtScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function ThoughtTimelineRow({
  entry,
  isStreaming,
  thinkingDurationSeconds,
  liveThinkingSeconds,
  latchedThinkingSeconds,
  isExpanded,
  copiedId,
  toggleThought,
  handleCopy,
  thoughtScrollRef,
}: ThoughtTimelineRowProps) {
  const isThoughtActive = Boolean(isStreaming && entry.data?.status === 'running');
  const displaySecs = isThoughtActive 
    ? liveThinkingSeconds 
    : (entry.data?.durationSecs || thinkingDurationSeconds || latchedThinkingSeconds || 1);

  return (
    <div key={entry.id} className="my-1">
      <button
        type="button"
        onClick={() => toggleThought(entry.id)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-normal py-0.5 cursor-pointer select-none transition-colors group"
      >
        <span className="font-sans">
          {isThoughtActive 
            ? `Thinking for ${formatDurationDisplay(liveThinkingSeconds)}...` 
            : `Thought for ${formatDurationDisplay(displaySecs)}`}
        </span>
        <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
      </button>

      {isExpanded && (
        <div className="mt-1 mb-2 rounded-xl border border-zinc-200/80 dark:border-white/[0.08] bg-zinc-50/70 dark:bg-white/[0.025] overflow-hidden shadow-none transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
          {/* Subtle Card Header */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-200/60 dark:border-white/[0.05] bg-zinc-100/40 dark:bg-white/[0.015]">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-sans">
              <span>{isThoughtActive ? 'Reasoning stream' : 'Internal chain-of-thought'}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isThoughtActive && (
                <span className="flex items-center gap-1 text-[11px] text-sky-500 font-mono">
                  <Loader2 size={10} className="animate-spin" />
                  Streaming
                </span>
              )}
              <button
                type="button"
                onClick={() => handleCopy(entry.data?.text || '', entry.id)}
                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                title="Copy thought content"
              >
                {copiedId === entry.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
              </button>
            </div>
          </div>

          {/* Reasoning Prose Body */}
          <div
            ref={thoughtScrollRef}
            className="p-3 text-[12.5px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar italic font-sans text-zinc-600 dark:text-zinc-400 select-text"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                code: ({ children, className }) => (
                  <code className={cn("px-1 py-0.5 rounded text-[11.5px] not-italic font-mono bg-zinc-200/60 dark:bg-white/[0.08] text-foreground", className)}>
                    {children}
                  </code>
                ),
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="pl-0.5">{children}</li>,
              }}
            >
              {entry.data?.text || ''}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
