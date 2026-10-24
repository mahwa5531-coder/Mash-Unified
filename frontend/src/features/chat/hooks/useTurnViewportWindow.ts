"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Turn } from '@/types/chat';

export interface UseTurnViewportWindowOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  turns: Turn[];
  isStreaming?: boolean;
  overscanScreens?: number; // default: 2 screen heights
  defaultTurnHeight?: number; // default: 180px
}

export interface UseTurnViewportWindowResult {
  startIndex: number;
  endIndex: number;
  turnHeightCache: Map<string, number>;
  recordTurnHeight: (turnKey: string, height: number) => void;
  estimateTurnHeight: (turn: Turn) => number;
}

/**
 * Fallback heuristic height estimation for turns before their initial DOM measurement.
 * Evaluates user content, assistant responses, tools, and code blocks.
 */
export function estimateTurnHeight(turn: Turn): number {
  if (!turn) return 180;
  if (turn.userMsg?.content === '[Earlier Context]') return 60;

  const userLen = turn.userMsg?.content?.length || 0;
  let aiLen = 0;
  let toolCount = 0;
  let hasCode = false;

  if (turn.aiMsgs && turn.aiMsgs.length > 0) {
    for (const msg of turn.aiMsgs) {
      const content = msg.content || '';
      aiLen += content.length;
      if (content.includes('```')) hasCode = true;
      if (msg.tools) toolCount += msg.tools.length;
      if (msg.thoughts) {
        aiLen += msg.thoughts.join('').length * 0.25;
      }
    }
  }

  // Base card wrapper & padding ~100px
  // Prose text density ~0.35px per character
  // Tool summary / accordion header ~45px
  // Code block syntax highlight frame ~160px
  let estimated = 100 + (userLen + aiLen) * 0.35;
  if (toolCount > 0) estimated += 45;
  if (hasCode) estimated += 160;

  return Math.round(Math.max(100, Math.min(1000, estimated)));
}

/**
 * Zero-dependency calculation of visible turn range [startIndex, endIndex]
 * based on container scrollTop, clientHeight, and a 2-screen overscan buffer.
 */
export function computeVisibleRange(
  container: HTMLDivElement | null,
  turns: Turn[],
  cache: Map<string, number>,
  overscanScreens = 2
): { startIndex: number; endIndex: number } {
  const count = turns.length;
  if (count === 0) {
    return { startIndex: 0, endIndex: 0 };
  }

  const clientHeight = container?.clientHeight || 800;
  const scrollTop = container?.scrollTop || 0;
  const overscanPx = overscanScreens * clientHeight;

  const targetTop = Math.max(0, scrollTop - overscanPx);
  const targetBottom = scrollTop + clientHeight + overscanPx;

  // Build prefix sums: prefix[0] = 0, prefix[i + 1] = prefix[i] + height[i]
  const prefix = new Float64Array(count + 1);
  prefix[0] = 0;
  for (let i = 0; i < count; i++) {
    const turn = turns[i];
    const key = turn.id || `turn_${turn.flatIdx}_${i}`;
    const h = cache.get(key) || estimateTurnHeight(turn);
    prefix[i + 1] = prefix[i] + h;
  }

  // Binary search for startIndex: first turn where prefix[i + 1] >= targetTop
  let low = 0;
  let high = count - 1;
  let startIndex = count - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (prefix[mid + 1] >= targetTop) {
      startIndex = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Binary search for endIndex: last turn where prefix[i] <= targetBottom
  low = startIndex;
  high = count - 1;
  let endIndex = count - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (prefix[mid] <= targetBottom) {
      endIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  startIndex = Math.max(0, Math.min(count - 1, startIndex));
  endIndex = Math.max(startIndex, Math.min(count - 1, endIndex));

  return { startIndex, endIndex };
}

/**
 * Custom viewport windowing hook maintaining a measured pixel height cache
 * and dynamically computing visible turn range with a 2-screen overscan buffer.
 *
 * Supports both options object:
 *   useTurnViewportWindow({ containerRef, turns, isStreaming })
 * and positional arguments:
 *   useTurnViewportWindow(containerRef, turns, isStreaming)
 */
export function useTurnViewportWindow(
  containerRefOrOptions: React.RefObject<HTMLDivElement | null> | UseTurnViewportWindowOptions,
  turnsArg?: Turn[],
  isStreamingArg?: boolean
): UseTurnViewportWindowResult {
  let containerRef: React.RefObject<HTMLDivElement | null>;
  let turns: Turn[];
  let isStreaming: boolean;
  let overscanScreens: number;

  if (containerRefOrOptions && 'containerRef' in containerRefOrOptions) {
    containerRef = containerRefOrOptions.containerRef;
    turns = containerRefOrOptions.turns || [];
    isStreaming = Boolean(containerRefOrOptions.isStreaming);
    overscanScreens = containerRefOrOptions.overscanScreens ?? 2;
  } else {
    containerRef = containerRefOrOptions as React.RefObject<HTMLDivElement | null>;
    turns = turnsArg || [];
    isStreaming = Boolean(isStreamingArg);
    overscanScreens = 2;
  }

  // Measured pixel height cache keyed by turn.id / turnKey
  const turnHeightCacheRef = useRef<Map<string, number>>(new Map());

  const [range, setRange] = useState<{ startIndex: number; endIndex: number }>(() =>
    computeVisibleRange(containerRef.current, turns, turnHeightCacheRef.current, overscanScreens)
  );

  const recordTurnHeight = useCallback((turnKey: string, height: number) => {
    if (!turnKey || height <= 0) return;
    const current = turnHeightCacheRef.current.get(turnKey);
    // Ignore micro-variations (< 2px) to prevent layout recalculation thrashing
    if (current === undefined || Math.abs(current - height) > 2) {
      turnHeightCacheRef.current.set(turnKey, Math.round(height));
    }
  }, []);

  const updateWindow = useCallback(() => {
    const container = containerRef.current;
    const newRange = computeVisibleRange(container, turns, turnHeightCacheRef.current, overscanScreens);
    setRange((prev) => {
      if (prev.startIndex === newRange.startIndex && prev.endIndex === newRange.endIndex) {
        return prev;
      }
      return newRange;
    });
  }, [containerRef, turns, overscanScreens]);

  // Scroll & resize listeners with 60 FPS RAF throttling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateWindow();
      });
    };

    const onResize = () => {
      turnHeightCacheRef.current.clear();
      onScroll();
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    // Initial calculation on mount/attachment
    updateWindow();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      container.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [containerRef, updateWindow]);

  // Update window when turns change
  useEffect(() => {
    updateWindow();
  }, [turns, updateWindow]);

  return {
    startIndex: range.startIndex,
    endIndex: range.endIndex,
    turnHeightCache: turnHeightCacheRef.current,
    recordTurnHeight,
    estimateTurnHeight,
  };
}
