"use client";

import { useEffect, useRef, useCallback } from 'react';
import { sessionStore, findTargetAssistantIdx } from '../state/sessionStore';
import type { Message } from '@/types/chat';

interface UseSseBufferFlusherOptions {
  activeSessionIdRef: React.RefObject<string | null>;
  setChatMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  isAtBottomRef: React.RefObject<boolean>;
}

export function useSseBufferFlusher({
  activeSessionIdRef,
  setChatMessages,
  scrollRef,
  isAtBottomRef,
}: UseSseBufferFlusherOptions) {
  const rafIdRef = useRef<number | null>(null);

  const flushActiveStreamBuffer = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const curSid = activeSessionIdRef.current;
    if (!curSid) return;
    const s = sessionStore.get(curSid);
    if (!s) return;

    const tokenDelta = s.tokenBuffer;
    const thoughtDelta = s.thoughtBuffer;
    if (!tokenDelta && !thoughtDelta) return;

    s.tokenBuffer = '';
    s.thoughtBuffer = '';

    if (tokenDelta && s.thinkingDuration === null && s.turnStartTime > 0) {
      s.thinkingDuration = Math.max(1, Math.round((Date.now() - s.turnStartTime) / 1000));
    }

    const next = [...s.chatMessages];
    const targetIdx = findTargetAssistantIdx(next, s.activeTurnId);
    if (targetIdx >= 0) {
      let updatedThoughts = next[targetIdx].thoughts || [];
      const currentSteps: any[] = next[targetIdx].steps && next[targetIdx].steps.length > 0
        ? [...next[targetIdx].steps]
        : [];

      if (thoughtDelta) {
        const currentThoughts = [...updatedThoughts];
        if (currentThoughts.length === 0) {
          currentThoughts.push(thoughtDelta);
        } else {
          currentThoughts[currentThoughts.length - 1] += thoughtDelta;
        }
        updatedThoughts = currentThoughts;

        const lastStep = currentSteps.length > 0 ? currentSteps[currentSteps.length - 1] : null;
        if (lastStep && lastStep.type === 'thinking' && lastStep.status === 'running') {
          lastStep.content = (lastStep.content || '') + thoughtDelta;
        } else {
          currentSteps.push({
            id: `step_${currentSteps.length}`,
            step_index: currentSteps.length,
            type: 'thinking',
            content: thoughtDelta,
            status: 'running',
            startTime: Date.now(),
          });
        }
      }

      if (tokenDelta) {
        // Complete any active thinking step as text has started
        for (const st of currentSteps) {
          if (st.type === 'thinking' && st.status === 'running') {
            st.status = 'completed';
            const sTime = st.startTime || s.turnStartTime || Date.now();
            st.thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - sTime) / 1000));
            if (s.thinkingDuration === null) {
              s.thinkingDuration = st.thinkingDurationSeconds;
            }
          }
        }

        const lastStep = currentSteps.length > 0 ? currentSteps[currentSteps.length - 1] : null;
        if (lastStep && lastStep.type === 'text' && lastStep.status === 'running') {
          lastStep.content = (lastStep.content || '') + tokenDelta;
        } else {
          currentSteps.push({
            id: `step_${currentSteps.length}`,
            step_index: currentSteps.length,
            type: 'text',
            content: tokenDelta,
            status: 'running',
          });
        }
      }

      next[targetIdx] = {
        ...next[targetIdx],
        content: tokenDelta ? next[targetIdx].content + tokenDelta : next[targetIdx].content,
        thoughts: updatedThoughts,
        steps: currentSteps,
        thinkingDurationSeconds: s.thinkingDuration ?? next[targetIdx].thinkingDurationSeconds,
      };
      s.chatMessages = next;
      setChatMessages(next);
    }

    if (scrollRef.current && isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSessionIdRef, isAtBottomRef, scrollRef, setChatMessages]);

  const scheduleFlush = useCallback(() => {
    // Schedule flush aligned to display animation frames (~60fps)
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        flushActiveStreamBuffer();
      });
    }
  }, [flushActiveStreamBuffer]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        flushActiveStreamBuffer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [flushActiveStreamBuffer]);

  const cancelFlush = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  return {
    flushActiveStreamBuffer,
    scheduleFlush,
    cancelFlush,
  };
}
