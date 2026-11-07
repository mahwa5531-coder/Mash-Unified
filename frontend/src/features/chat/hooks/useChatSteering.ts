"use client";

import { useState, useCallback } from 'react';
import { sessionStore, notifyStoreListeners, persistSessionQueue } from '../state/sessionStore';
import { queueSteeringMessage, clearSessionQueue } from '@/services/sessions';
import type { Message } from '@/types/chat';

interface UseChatSteeringOptions {
  activeSessionIdRef: React.RefObject<string | null>;
  sessionId: string | null;
  onSendMessage: (
    text?: string,
    isRetry?: boolean,
    isImmediate?: boolean,
    targetSessionId?: string
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

    // Remove from local queue
    s.queuedMessages.splice(index, 1);
    persistSessionQueue(activeSid, s.queuedMessages);
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessages([...s.queuedMessages]);
    }
    notifyStoreListeners();

    if (s.isStreaming) {
      // Send mid-flight steering message directly to the running agent (DeepSeek Harness pattern)
      try {
        const ok = await queueSteeringMessage(activeSid, msgToInject);
        if (!ok) {
          // Restore on failure to prevent silent message loss
          s.queuedMessages.splice(index, 0, msgToInject);
          persistSessionQueue(activeSid, s.queuedMessages);
          if (activeSid === activeSessionIdRef.current) {
            setQueuedMessages([...s.queuedMessages]);
          }
          notifyStoreListeners();
        } else {
          // Echo injected steer into local chat messages so user sees it immediately
          const userSteerMsg: Message = {
            id: `msg_steer_${Date.now()}`,
            role: 'user',
            content: msgToInject,
            timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }),
            sessionId: activeSid,
            thoughts: [],
            tools: [],
          };
          s.chatMessages = [...s.chatMessages, userSteerMsg];
          notifyStoreListeners();
        }
      } catch (_err) {
        s.queuedMessages.splice(index, 0, msgToInject);
          persistSessionQueue(activeSid, s.queuedMessages);
        if (activeSid === activeSessionIdRef.current) {
          setQueuedMessages([...s.queuedMessages]);
        }
        notifyStoreListeners();
      }
    } else {
      // Agent is idle: dispatch immediately as a normal turn
      await onSendMessage(msgToInject, false, false, activeSid);
    }
  }, [activeSessionIdRef, sessionId, onSendMessage]);

  const discardQueued = useCallback((index?: number) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s) return;
    if (index !== undefined && s.queuedMessages) {
      s.queuedMessages.splice(index, 1);
      clearSessionQueue(activeSid, index).catch(() => {});
    } else {
      s.queuedMessages = [];
      s.isQueuePaused = false;
      clearSessionQueue(activeSid).catch(() => {});
    }
    persistSessionQueue(activeSid, s.queuedMessages);
    if (activeSid === activeSessionIdRef.current) {
      setQueuedMessages([...s.queuedMessages]);
    }
    notifyStoreListeners();
  }, [activeSessionIdRef, sessionId]);

  const activeSid = activeSessionIdRef.current || sessionId;
  const isQueuePaused = Boolean(activeSid && sessionStore.get(activeSid)?.isQueuePaused && queuedMessages.length > 0);

  const resumeQueue = useCallback(async () => {
    const sid = activeSessionIdRef.current || sessionId;
    if (!sid) return;
    const s = sessionStore.get(sid);
    if (!s || !s.queuedMessages || s.queuedMessages.length === 0) return;
    s.isQueuePaused = false;
    notifyStoreListeners();
    await injectQueued(0);
  }, [activeSessionIdRef, sessionId, injectQueued]);

  return {
    queuedMessages,
    queuedMessage: queuedMessages[0] || null,
    isQueuePaused,
    setQueuedMessages,
    injectQueued,
    resumeQueue,
    discardQueued,
  };
}
