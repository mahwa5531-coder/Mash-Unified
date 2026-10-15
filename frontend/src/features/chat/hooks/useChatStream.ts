"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Message } from '@/types/chat';
import { buildTurns } from '@/features/chat/utils/turns';
import { sessionStore, getOrCreateSessionState, setViewingSession, subscribeToSessionStore, notifyStoreListeners } from '../state/sessionStore';
import { useSessionHistory } from './useSessionHistory';
import { useChatSteering } from './useChatSteering';
import { useSseBufferFlusher } from './useSseBufferFlusher';
import { buildTurnArtifactMap, syncSessionSwitchingState } from './streamEventParser';
import { executeToolApproval } from './streamToolManager';
import { prepareSteerTurn, prepareTurnMessages, resolveActiveSession, stopSessionStream, executeSessionUndo, runChatStream } from './streamRetryManager';
import type { PermissionMode } from '../components/composer/PermissionModeSelector';

interface UseChatStreamOptions {
  sessionId: string | null;
  sessionRepo?: string;
  pendingWorkspacePath?: string | null;
  onSessionCreated: (newSessionId: string, title?: string, repoName?: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  permissionMode?: PermissionMode;
}

export function useChatStream({
  sessionId,
  sessionRepo,
  pendingWorkspacePath,
  onSessionCreated,
  scrollContainerRef,
  permissionMode = 'default',
}: UseChatStreamOptions) {
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const fallbackScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef || fallbackScrollRef;
  const isAtBottomRef = useRef(true);

  const activeSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => { activeSessionIdRef.current = sessionId; }, [sessionId]);

  const { flushActiveStreamBuffer, scheduleFlush, cancelFlush } = useSseBufferFlusher({
    activeSessionIdRef, setChatMessages, scrollRef, isAtBottomRef,
  });

  const history = useSessionHistory({ sessionId, activeSessionIdRef, scrollContainerRef });

  const handleSendMessageRef = useRef<((...args: any[]) => Promise<void>) | null>(null);
  const dispatchSendMessage = useCallback((...args: any[]) => {
    return handleSendMessageRef.current ? handleSendMessageRef.current(...args) : Promise.resolve();
  }, []);

  const steering = useChatSteering({ activeSessionIdRef, sessionId, onSendMessage: dispatchSendMessage });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      isAtBottomRef.current = scrollHeight - (scrollTop + clientHeight) < 80;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  useEffect(() => {
    flushActiveStreamBuffer();
    activeSessionIdRef.current = sessionId;
    setViewingSession(sessionId);
    cancelFlush();
    syncSessionSwitchingState({
      sessionId,
      activeSessionIdRef,
      history,
      steering,
      setChatMessages,
      setIsStreaming,
      setInputPrompt,
      scrollRef: scrollContainerRef || fallbackScrollRef,
    });
  }, [sessionId, history.historyRetryNonce, scrollContainerRef, cancelFlush, flushActiveStreamBuffer, history.updatePaginationState]);

  const handleSetInputPrompt = useCallback((val: string | ((prev: string) => string)) => {
    setInputPrompt((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      const curSid = activeSessionIdRef.current;
      if (curSid) {
        const s = sessionStore.get(curSid);
        if (s) s.inputPrompt = next;
      }
      return next;
    });
  }, []);

  const handleSendMessage = async (textToSend?: string, isRetry = false, isImmediate = false, targetSessionId?: string, isResume = false) => {
    const rawText = textToSend !== undefined ? textToSend : inputPrompt;
    if (!rawText.trim() && !isResume) return;
    const userText = rawText.trim();
    if (textToSend === undefined) handleSetInputPrompt('');

    const { activeSid, isNewSession, title } = resolveActiveSession(
      targetSessionId, activeSessionIdRef.current, sessionId, userText, isRetry || isResume, onSessionCreated, sessionRepo
    );
    if (!activeSid) return;
    activeSessionIdRef.current = activeSid;
    const targetSession = getOrCreateSessionState(activeSid);

    if (targetSession.isStreaming && !isRetry && !isImmediate && !isResume) {
      targetSession.queuedMessages = [...(targetSession.queuedMessages || []), userText];
      targetSession.queuedMessage = targetSession.queuedMessages[0] || null;
      if (activeSid === activeSessionIdRef.current) steering.setQueuedMessages([...targetSession.queuedMessages]);
      notifyStoreListeners();
      return;
    }
    if (targetSession.isStreaming && isImmediate) stopSessionStream(activeSid);

    let currentTurnId = targetSession.activeTurnId || `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    if (!isResume) {
      currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      targetSession.activeTurnId = currentTurnId;
      targetSession.chatMessages = prepareSteerTurn(targetSession.chatMessages);
    }

    const { updatedMessages, targetTurnId } = prepareTurnMessages(targetSession.chatMessages, {
      isResume, isRetry, userText, turnId: currentTurnId, activeSid,
    });
    targetSession.chatMessages = updatedMessages;
    targetSession.activeTurnId = targetTurnId;
    if (!isResume && !isRetry) {
      targetSession.loadedRawCount += 2;
      targetSession.totalHistoryCount += 2;
      if (!targetSession.isHistoryLoaded && targetSession.chatMessages.length === 2) targetSession.isHistoryLoaded = true;
    }

    targetSession.isStreaming = true;
    targetSession.tokenBuffer = '';
    targetSession.thoughtBuffer = '';
    targetSession.turnStartTime = Date.now();
    targetSession.thinkingDuration = null;
    targetSession.abortController = new AbortController();

    if (activeSid === activeSessionIdRef.current) {
      setChatMessages([...targetSession.chatMessages]);
      setIsStreaming(true);
      isAtBottomRef.current = true;
      requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    }
    notifyStoreListeners();

    await runChatStream(activeSid, userText, {
      isResume,
      signal: targetSession.abortController.signal,
      scheduleFlush,
      flushBuffer: flushActiveStreamBuffer,
      onUpdateMessages: (msgs) => { if (activeSid === activeSessionIdRef.current) setChatMessages(msgs); },
      onStreamEnd: () => { if (activeSid === activeSessionIdRef.current) setIsStreaming(false); },
      scrollToBottom: () => { if (scrollRef.current && isAtBottomRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; },
      onAutoDispatchQueue: (msg) => handleSendMessage(msg, false, false, activeSid),
      onSyncSteeringQueue: (q) => { if (activeSid === activeSessionIdRef.current) steering.setQueuedMessages(q); },
      context: {
        workspace_uri: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
        working_directory: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
        section: (pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo')) ? 'workspace' : 'conversation',
        ...(isNewSession ? { title, custom_title: title } : {}),
        thinking_effort: 'high',
        permission_mode: permissionMode || 'default',
      },
    });
  };
  handleSendMessageRef.current = handleSendMessage;

  const handleStopStreaming = useCallback(async () => {
    const curSid = activeSessionIdRef.current;
    if (!curSid) return;
    flushActiveStreamBuffer();
    setIsStreaming(false);
    const msgs = stopSessionStream(curSid);
    if (msgs.length && curSid === activeSessionIdRef.current) setChatMessages(msgs);
  }, [flushActiveStreamBuffer]);

  const handleRetry = useCallback((userText?: string, targetSid?: string) => {
    const sidToUse = targetSid || activeSessionIdRef.current || sessionId;
    if (sidToUse) handleSendMessage(userText, true, false, sidToUse);
  }, [sessionId, handleSendMessage]);

  const handleUndo = useCallback((flatIdx?: number, userText?: string, turnIdx?: number) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const msgs = executeSessionUndo(activeSid, flatIdx, turnIdx);
    if (msgs) setChatMessages(msgs);
    setIsStreaming(false);
    if (userText) handleSetInputPrompt(userText);
  }, [sessionId, handleSetInputPrompt]);

  const turns = useMemo(() => buildTurns(chatMessages), [chatMessages]);
  const streamingArtifactsCacheRef = useRef<Map<string, any>>(new Map());
  const artifactsByTurnMsg = useMemo(
    () => buildTurnArtifactMap(turns, isStreaming, streamingArtifactsCacheRef.current),
    [turns, isStreaming]
  );

  const handleLoadEarlier = useCallback(async () => {
    await history.loadEarlierTurns((olderMsgs) => setChatMessages([...olderMsgs]));
  }, [history]);

  useEffect(() => {
    return subscribeToSessionStore(() => {
      const curSid = activeSessionIdRef.current;
      if (!curSid) return;
      const s = sessionStore.get(curSid);
      if (s) {
        setIsStreaming(s.isStreaming);
        steering.setQueuedMessages(s.queuedMessages || []);
      }
    });
  }, [steering]);

  const approveToolCall = useCallback(
    async (toolCallId: string, action: 'allow_once' | 'allow' | 'deny', feedback?: string) => {
      const curSid = activeSessionIdRef.current || sessionId;
      if (!curSid) return;
      const ok = await executeToolApproval(curSid, toolCallId, action, feedback);
      if (!ok) return;
      if (curSid === activeSessionIdRef.current) {
        const s = sessionStore.get(curSid);
        if (s) setChatMessages(s.chatMessages);
      }
      dispatchSendMessage('', false, true, curSid, true);
    },
    [sessionId, dispatchSendMessage]
  );

  return {
    chatMessages, inputPrompt, setInputPrompt: handleSetInputPrompt, isStreaming,
    isHistoryLoaded: history.isHistoryLoaded, historyLoadError: history.historyLoadError,
    retryLoadHistory: history.retryLoadHistory, queuedMessages: steering.queuedMessages,
    queuedMessage: steering.queuedMessage, turns, artifactsByTurnMsg, send: handleSendMessage,
    stop: handleStopStreaming, retry: handleRetry, undo: handleUndo, approveToolCall,
    injectQueued: steering.injectQueued, discardQueued: steering.discardQueued,
    hasEarlierTurns: history.hasEarlierTurns, isLoadingEarlier: history.isLoadingEarlier,
    remainingEarlierCount: history.remainingEarlierCount, loadEarlierTurns: handleLoadEarlier,
  };
}
