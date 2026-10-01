"use client";

import { useState, useCallback } from 'react';
import { sessionStore, notifyStoreListeners } from '../state/sessionStore';

interface UseChatSteeringOptions {
  activeSessionIdRef: React.RefObject<string | null>;
  sessionId: string | null;
  onSendMessage: (
    model?: string,
    effort?: string,
    text?: string,
    isRetry?: boolean,
    targetSessionId?: string,
    isImmediate?: boolean
  ) => Promise<void>;
}

export function useChatSteering({
  activeSessionIdRef,
  sessionId,
  onSendMessage,
}: UseChatSteeringOptions) {
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);

  const injectQueued = useCallback(async () => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s) return;
    const msgToInject = s.queuedMessage;
    if (!msgToInject) return;

    s.queuedMessage = null;
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessage(null);
    }
    notifyStoreListeners();
    await onSendMessage(undefined, undefined, msgToInject, false, activeSid, true);
  }, [activeSessionIdRef, sessionId, onSendMessage]);

  const discardQueued = useCallback(() => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s) return;
    s.queuedMessage = null;
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessage(null);
    }
    notifyStoreListeners();
  }, [activeSessionIdRef, sessionId]);

  return {
    queuedMessage,
    setQueuedMessage,
    injectQueued,
    discardQueued,
  };
}
