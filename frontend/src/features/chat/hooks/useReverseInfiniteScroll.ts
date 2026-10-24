"use client";

import { useEffect, useRef, useCallback, useLayoutEffect } from 'react';

interface UseReverseInfiniteScrollOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  hasEarlierTurns: boolean;
  isLoadingEarlier: boolean;
  loadEarlierTurns: () => Promise<void>;
  turnsCount: number;
}

/**
 * Seamless reverse infinite scroll with synchronous scroll-anchoring.
 * - Uses IntersectionObserver on a top sentinel to trigger loading earlier turns.
 * - Compensates scrollHeight deltas inside useLayoutEffect before paint to guarantee 0px visual jitter.
 */
export function useReverseInfiniteScroll({
  containerRef,
  hasEarlierTurns,
  isLoadingEarlier,
  loadEarlierTurns,
  turnsCount,
}: UseReverseInfiniteScrollOptions) {
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const isLoadingRef = useRef(isLoadingEarlier);
  isLoadingRef.current = isLoadingEarlier;

  const hasEarlierRef = useRef(hasEarlierTurns);
  hasEarlierRef.current = hasEarlierTurns;

  const loadEarlierRef = useRef(loadEarlierTurns);
  loadEarlierRef.current = loadEarlierTurns;

  // Record scroll anchor before new history arrives
  const triggerLoadEarlier = useCallback(async () => {
    if (isLoadingRef.current || !hasEarlierRef.current) return;
    const container = containerRef.current;
    if (container) {
      anchorRef.current = {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
    }
    await loadEarlierRef.current();
  }, [containerRef]);

  // Synchronous scroll-anchoring compensation before browser paint
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !anchorRef.current) return;

    const { prevScrollHeight, prevScrollTop } = anchorRef.current;
    const newScrollHeight = container.scrollHeight;
    const deltaHeight = newScrollHeight - prevScrollHeight;

    if (deltaHeight > 0) {
      container.scrollTop = prevScrollTop + deltaHeight;
    }
    anchorRef.current = null;
  }, [turnsCount, containerRef]);

  // Top boundary sentinel IntersectionObserver
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = containerRef.current;
    if (!sentinel || !container || !hasEarlierTurns) return;

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !isLoadingRef.current && hasEarlierRef.current) {
          triggerLoadEarlier();
        }
      },
      {
        root: container,
        rootMargin: '250px 0px 0px 0px', // Pre-fetch 250px before user hits absolute top
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasEarlierTurns, containerRef, triggerLoadEarlier]);

  return {
    topSentinelRef,
    triggerLoadEarlier,
  };
}
