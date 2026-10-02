"use client";

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDurationDisplay } from './toolTimeline';
import type { TimelineEntry } from './types';

interface ThoughtTimelineRowProps {
  entry: TimelineEntry;
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  liveThinkingSeconds: number;
  latchedThinkingSeconds: number | null;
  isExpanded: boolean;
  toggleThought: (id: string) => void;
  thoughtScrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function ThoughtTimelineRow({
  entry,
  isStreaming,
  thinkingDurationSeconds,
  liveThinkingSeconds,
  latchedThinkingSeconds,
  isExpanded,
  toggleThought,
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
            ? `Thinking (${formatDurationDisplay(liveThinkingSeconds)})...` 
            : `Thought for ${formatDurationDisplay(displaySecs)}`}
        </span>
        <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
      </button>

      {isExpanded && (
        <div
          ref={thoughtScrollRef}
          className="mt-1 mb-2 pl-3 border-l-2 border-zinc-300 dark:border-zinc-700/80 py-1 text-[12px] leading-relaxed max-h-56 overflow-y-auto custom-scrollbar italic font-sans text-zinc-500 dark:text-zinc-400 select-text whitespace-pre-wrap"
        >
          {entry.data?.text || ''}
        </div>
      )}
    </div>
  );
}
