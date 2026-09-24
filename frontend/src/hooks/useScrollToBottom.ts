import { RefObject, useState, useCallback, useRef } from "react";

/**
 * Velocity-aware scroll retention hook adapted directly from OpenHands.
 * - Detects scrolling direction: scrolling UP immediately disarms autoscroll.
 * - Scrolling to within 20px of bottom re-arms autoscroll.
 * - Prevents streaming text from yanking the user's viewport down.
 * - Exposes hitBottom to show a floating "Scroll to bottom" button when user is scrolled up.
 */
export function useScrollToBottom(scrollRef: RefObject<HTMLDivElement | null>) {
  // Track whether automatic content-following is enabled
  const [autoscroll, setAutoscroll] = useState(true);

  // Track whether the user is currently pinned to the bottom of the scroll area
  const [hitBottom, setHitBottom] = useState(true);

  // Store previous scroll position to detect scroll direction
  const prevScrollTopRef = useRef<number>(0);

  // Check if the scroll position is within 20px of the bottom
  const isAtBottom = useCallback((element: HTMLElement): boolean => {
    const bottomThreshold = 20;
    const bottomPosition = element.scrollTop + element.clientHeight;
    return bottomPosition >= element.scrollHeight - bottomThreshold;
  }, []);

  // Handle scroll events on the chat container
  const onChatBodyScroll = useCallback(
    (e: HTMLElement) => {
      const isCurrentlyAtBottom = isAtBottom(e);
      setHitBottom(isCurrentlyAtBottom);

      // Get current scroll position
      const currentScrollTop = e.scrollTop;

      // Detect scroll direction: upward scroll immediately pauses following
      const isScrollingUp = currentScrollTop < prevScrollTopRef.current;

      // Update previous scroll position for next comparison
      prevScrollTopRef.current = currentScrollTop;

      // Turn off autoscroll only when scrolling up
      if (isScrollingUp) {
        setAutoscroll(false);
      }

      // Turn on autoscroll when scrolled back to the bottom
      if (isCurrentlyAtBottom) {
        setAutoscroll(true);
      }
    },
    [isAtBottom],
  );

  // Scroll to bottom on demand or on send
  const scrollDomToBottom = useCallback(() => {
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
    autoScroll: autoscroll,
    setAutoScroll: setAutoscroll,
    scrollDomToBottom,
    hitBottom,
    setHitBottom,
    onChatBodyScroll,
  };
}
