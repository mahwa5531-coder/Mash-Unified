"use client";

import React from 'react';
import { ReasoningDisclosure } from '@/primitives';
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
    <ReasoningDisclosure
      text={entry.data?.text || ''}
      isStreaming={isThoughtActive}
      durationSeconds={displaySecs}
      liveSeconds={liveThinkingSeconds}
      isOpen={isExpanded}
      onToggle={() => toggleThought(entry.id)}
      scrollRef={thoughtScrollRef}
    />
  );
}
