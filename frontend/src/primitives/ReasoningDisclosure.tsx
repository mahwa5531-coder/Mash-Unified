"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReasoningDisclosureProps {
  /** The raw reasoning/chain-of-thought text */
  text: string;
  /** Whether the model is currently actively thinking */
  isStreaming?: boolean;
  /** Final duration in seconds once thought is completed */
  durationSeconds?: number;
  /** Live ticking seconds while actively streaming */
  liveSeconds?: number;
  /** Controlled open state */
  isOpen?: boolean;
  /** Initial open state if uncontrolled */
  defaultOpen?: boolean;
  /** Callback fired when user clicks to decompose/group */
  onToggle?: () => void;
  /** Custom class name for the wrapper */
  className?: string;
  /** Optional external ref to the scrollable text viewport */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function formatReasoningDuration(secs: number): string {
  if (!secs || secs <= 0) return '0s';
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * ReasoningDisclosure Primitive
 * 
 * Minimal, zero-decoration reasoning disclosure:
 * - Active state: "Thinking..." / "Thinking (12s)..."
 * - Completed state: "Thought for 12s"
 * - Decomposes on click; grouped by default after completing.
 * - No brain icon, no sparkles icon, no extraneous buttons.
 */
export function ReasoningDisclosure({
  text = '',
  isStreaming = false,
  durationSeconds,
  liveSeconds,
  isOpen: controlledIsOpen,
  defaultOpen = false,
  onToggle,
  className,
  scrollRef: externalScrollRef,
}: ReasoningDisclosureProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const wasStreamingRef = useRef(isStreaming);
  const localScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = externalScrollRef || localScrollRef;
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Group (collapse) when job completes
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setInternalIsOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const isExpanded = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;

  const handleToggle = useCallback(() => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalIsOpen(prev => !prev);
    }
  }, [onToggle]);

  // Auto-scroll when decomposed during live streaming
  useEffect(() => {
    if (!isStreaming || !isExpanded || userScrolledUp || !scrollRef.current) return;
    const el = scrollRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (isNearBottom || !userScrolledUp) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text, isStreaming, isExpanded, userScrolledUp, scrollRef]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!isNearBottom);
  }, [scrollRef]);

  const effectiveSecs = durationSeconds || liveSeconds || 1;
  const formattedDuration = formatReasoningDuration(effectiveSecs);

  const displayLabel = isStreaming
    ? 'Thinking...'
    : `Thought for ${formattedDuration}`;

  return (
    <div className={cn("my-1 select-none font-sans", className)}>
      {/* Trigger: Pure text + chevron, NO brain button or icons */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-1.5 text-xs font-normal py-0.5 cursor-pointer select-none transition-colors group text-left w-fit",
          "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        )}
      >
        {isStreaming && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
        <span className="font-sans text-[12px]">
          {displayLabel}
        </span>
        <ChevronRight
          size={11}
          className={cn(
            "text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-transform duration-200 shrink-0",
            isExpanded && "rotate-90"
          )}
        />
      </button>

      {/* Decomposed Reasoning Block as Clean Paragraphs */}
      {isExpanded && (
        <div className="mt-1.5 mb-2 pl-2">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              maskImage: 'linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 12px, black calc(100% - 12px), transparent 100%)',
            }}
            className={cn(
              "max-h-56 sm:max-h-72 overflow-y-auto custom-scrollbar select-text py-1 px-1",
              "text-[12.5px] leading-relaxed font-sans text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap break-words"
            )}
          >
            {text || (
              <span className="text-zinc-400 dark:text-zinc-500">
                {isStreaming ? 'Thinking...' : 'No reasoning trace recorded.'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ReasoningDisclosure;
