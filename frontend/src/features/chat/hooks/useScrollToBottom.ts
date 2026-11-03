import { RefObject, useState, useCallback, useRef } from "react";

/**
 * Velocity-aware scroll retention hook adapted directly from OpenHands.
 * - Detects scrolling direction: scrolling UP immediately disarms autoscroll.
 * - Scrolling to within 20px of bottom re-arms autoscroll.
 * - Exposes synchronous isPinnedToBottomRef for 60fps RAF stream flusher to prevent yanking.
 * - Exposes hitBottom to show a floating "Scroll to bottom" button when user is scrolled up.
 */
export function useScrollToBottom(scrollRef: RefObject<HTMLDivElement | null>) {
  // Synchronous pin ref for RAF/stream flusher (bypasses React state batching)
  const isPinnedToBottomRef = useRef<boolean>(true);

  // Track whether automatic content-following is enabled
  const [autoscroll, setAutoscroll] = useState(true);

  // Track whether the user is currently pinned to the bottom of the scroll area
  const [hitBottom, setHitBottom] = useState(true);

  // Store previous scroll position to detect scroll direction
  const prevScrollTopRef = useRef<number>(0);

  // Handle scroll events on the chat container
  const onChatBodyScroll = useCallback(
    (e: HTMLElement) => {
      const currentScrollTop = e.scrollTop;
      const distFromBottom = e.scrollHeight - (currentScrollTop + e.clientHeight);
      const isCurrentlyAtBottom = distFromBottom <= 20;

      // Detect scroll direction: upward scroll or distance > 40px immediately disarms autoscroll
      const isScrollingUp = currentScrollTop < prevScrollTopRef.current;
      prevScrollTopRef.current = currentScrollTop;

      if (isScrollingUp || distFromBottom > 40) {
        isPinnedToBottomRef.current = false;
        setAutoscroll((prev) => (prev ? false : prev));
        setHitBottom((prev) => (prev ? false : prev));
      } else if (isCurrentlyAtBottom) {
        isPinnedToBottomRef.current = true;
        setAutoscroll((prev) => (!prev ? true : prev));
        setHitBottom((prev) => (!prev ? true : prev));
      }
    },
    [],
  );

  // Scroll to bottom on demand or on send
  const scrollDomToBottom = useCallback(() => {
    isPinnedToBottomRef.current = true;
    const dom = scrollRef.current;
    if (dom) {
      requestAnimationFrame(() => {
        setAutoscroll(true);
        setHitBottom(true);
        dom.scrollTop = dom.scrollHeight;
      });
    }
  }, [scrollRef]);

  return {
    scrollRef,
    isPinnedToBottomRef,
    autoScroll: autoscroll,
    setAutoScroll: setAutoscroll,
    scrollDomToBottom,
    hitBottom,
    setHitBottom,
    onChatBodyScroll,
  };
}
