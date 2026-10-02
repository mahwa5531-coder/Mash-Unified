"use client";

import { useState, useCallback, useRef } from 'react';
import { fetchTranscript } from '@/services/sessions';
import { parseSessionHistory } from '@/features/chat/utils/turns';
import { sessionStore, type SessionRuntimeState } from '../state/sessionStore';
import type { Message } from '@/types/chat';

interface UseSessionHistoryOptions {
  sessionId: string | null;
  activeSessionIdRef: React.RefObject<string | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onHistoryLoaded?: (msgs: Message[]) => void;
}

export function useSessionHistory({
  sessionId,
  activeSessionIdRef,
  scrollContainerRef,
  onHistoryLoaded,
}: UseSessionHistoryOptions) {
  const [isHistoryLoaded, setIsHistoryLoaded] = useState<boolean>(
    () => !sessionId || (sessionStore.get(sessionId)?.isHistoryLoaded ?? false)
  );
  const [historyLoadError, setHistoryLoadError] = useState<boolean>(
    () => !sessionId ? false : (sessionStore.get(sessionId)?.historyLoadError ?? false)
  );
  const [hasEarlierTurns, setHasEarlierTurns] = useState<boolean>(false);
  const [remainingEarlierCount, setRemainingEarlierCount] = useState<number>(0);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState<boolean>(false);
  const [historyRetryNonce, setHistoryRetryNonce] = useState(0);

  const updatePaginationState = useCallback((s: SessionRuntimeState) => {
    const remaining = Math.max(0, s.totalHistoryCount - s.loadedRawCount);
    setRemainingEarlierCount(remaining);
    setHasEarlierTurns(remaining > 0);
  }, []);

  const retryLoadHistory = useCallback(() => {
    setHistoryRetryNonce(n => n + 1);
  }, []);

  const loadEarlierTurns = useCallback(async (onPrepend: (olderMsgs: Message[]) => void) => {
    const curSid = activeSessionIdRef.current;
    if (!curSid) return;
    const s = sessionStore.get(curSid);
    if (!s || isLoadingEarlier) return;
    if (s.loadedRawCount >= s.totalHistoryCount) {
      setHasEarlierTurns(false);
      setRemainingEarlierCount(0);
      return;
    }

    setIsLoadingEarlier(true);
    try {
      const container = scrollContainerRef?.current;
      const prevScrollHeight = container ? container.scrollHeight : 0;
      const prevScrollTop = container ? container.scrollTop : 0;

      const PAGE_SIZE = 100;
      const resp = await fetchTranscript(curSid, PAGE_SIZE, true, s.loadedRawCount);
      const olderLines = resp.lines || [];

      if (olderLines.length > 0) {
        s.rawLines = [...olderLines, ...(s.rawLines || [])];
        s.loadedRawCount += olderLines.length;
        s.totalHistoryCount = resp.total || s.totalHistoryCount;

        const olderMsgs = parseSessionHistory(olderLines);
        s.chatMessages = [...olderMsgs, ...s.chatMessages];

        if (activeSessionIdRef.current === curSid) {
          onPrepend(s.chatMessages);
          updatePaginationState(s);

          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
            }
          });
        }
      } else {
        s.loadedRawCount = s.totalHistoryCount;
        updatePaginationState(s);
      }
    } catch (err) {
      console.warn("Failed to load earlier transcript turns:", err);
    } finally {
      setIsLoadingEarlier(false);
    }
  }, [activeSessionIdRef, isLoadingEarlier, scrollContainerRef, updatePaginationState]);

  return {
    isHistoryLoaded,
    setIsHistoryLoaded,
    historyLoadError,
    setHistoryLoadError,
    hasEarlierTurns,
    setHasEarlierTurns,
    remainingEarlierCount,
    setRemainingEarlierCount,
    isLoadingEarlier,
    historyRetryNonce,
    retryLoadHistory,
    updatePaginationState,
    loadEarlierTurns,
  };
}
