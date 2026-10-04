"use client";

import { useState, useCallback } from 'react';
import { sessionStore, notifyStoreListeners } from '../state/sessionStore';
import { removeSessionQueueItem, queueSteeringMessage } from '@/services/sessions';

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
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  const injectQueued = useCallback(async (index = 0) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s || !s.queuedMessages || s.queuedMessages.length === 0) return;
    const msgToInject = s.queuedMessages[index];
    if (!msgToInject) return;

    s.queuedMessages.splice(index, 1);
    s.queuedMessage = s.queuedMessages[0] || null;
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessages([...s.queuedMessages]);
    }
    notifyStoreListeners();
    removeSessionQueueItem(activeSid, index).catch(() => {});

    if (s.isStreaming) {
      // Send mid-flight steering message directly to the running agent without aborting
      queueSteeringMessage(activeSid, msgToInject).catch(() => {});
    } else {
      // Agent is idle: dispatch immediately as a normal turn
      await onSendMessage(undefined, undefined, msgToInject, false, activeSid, false);
    }
  }, [activeSessionIdRef, sessionId, onSendMessage]);

  const discardQueued = useCallback((index?: number) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s) return;
    if (index !== undefined && s.queuedMessages) {
      s.queuedMessages.splice(index, 1);
      removeSessionQueueItem(activeSid, index).catch(() => {});
    } else {
      s.queuedMessages = [];
      removeSessionQueueItem(activeSid).catch(() => {});
    }
    s.queuedMessage = s.queuedMessages[0] || null;
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessages([...s.queuedMessages]);
    }
    notifyStoreListeners();
  }, [activeSessionIdRef, sessionId]);

  return {
    queuedMessages,
    queuedMessage: queuedMessages[0] || null,
    setQueuedMessages,
    injectQueued,
    discardQueued,
  };
}
