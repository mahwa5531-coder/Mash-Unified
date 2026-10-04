"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { fetchTranscript, renameSession, markSessionViewed, queueSteeringMessage, fetchSessionQueue, removeSessionQueueItem } from '@/services/sessions';
import { streamQuery } from '@/services/stream';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { parseSessionHistory, buildTurns } from '@/features/chat/utils/turns';
import {
  sessionStore,
  getOrCreateSessionState,
  setViewingSession,
  subscribeToSessionStore,
  notifyStoreListeners,
  findTargetAssistantIdx,
} from '../state/sessionStore';
import { extractArtifacts, getArtifactCanonicalGroup } from '@/features/artifacts/utils/extraction';
import { useSessionHistory } from './useSessionHistory';
import { useChatSteering } from './useChatSteering';
import { useSseBufferFlusher } from './useSseBufferFlusher';

const messageArtifactCache = new WeakMap<Message, ArtifactItem[]>();

function getCachedArtifacts(msg: Message, isStreamingMsg: boolean): ArtifactItem[] {
  if (isStreamingMsg) return [];
  let cached = messageArtifactCache.get(msg);
  if (!cached) {
    cached = extractArtifacts(msg);
    messageArtifactCache.set(msg, cached);
  }
  return cached;
}

interface UseChatStreamOptions {
  sessionId: string | null;
  sessionRepo?: string;
  pendingWorkspacePath?: string | null;
  onSessionCreated: (newSessionId: string, title?: string, repoName?: string) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function useChatStream({
  sessionId,
  sessionRepo,
  pendingWorkspacePath,
  onSessionCreated,
  scrollContainerRef,
}: UseChatStreamOptions) {
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const fallbackScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef || fallbackScrollRef;
  const isAtBottomRef = useRef<boolean>(true);

  const activeSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  const DEFAULT_MODEL = 'default';
  const thinkingBudget = 'high';
  const lastModelRef = useRef<{ model: string; effort: string }>({ model: 'default', effort: 'high' });

  // 1. Atomised Buffer Flusher
  const { flushActiveStreamBuffer, scheduleFlush, cancelFlush } = useSseBufferFlusher({
    activeSessionIdRef,
    setChatMessages,
    scrollRef,
    isAtBottomRef,
  });

  // 2. Atomised Session History & Reverse-Scroll Pagination
  const history = useSessionHistory({
    sessionId,
    activeSessionIdRef,
    scrollContainerRef,
  });

  const handleSendMessageRef = useRef<((...args: any[]) => Promise<void>) | null>(null);
  const dispatchSendMessage = useCallback(
    (...args: any[]) => {
      if (handleSendMessageRef.current) {
        return handleSendMessageRef.current(...args);
      }
      return Promise.resolve();
    },
    []
  );

  // 3. Atomised Chat Steering
  const steering = useChatSteering({
    activeSessionIdRef,
    sessionId,
    onSendMessage: dispatchSendMessage,
  });

  // Handle autoscroll tracking
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

  // Session switching: 0ms instantaneous read from in-memory sessionStore cache
  useEffect(() => {
    flushActiveStreamBuffer();
    activeSessionIdRef.current = sessionId;
    setViewingSession(sessionId);
    cancelFlush();

    if (!sessionId) {
      setChatMessages([]);
      setIsStreaming(false);
      setInputPrompt('');
      history.setHasEarlierTurns(false);
      history.setRemainingEarlierCount(0);
      history.setIsHistoryLoaded(true);
      history.setHistoryLoadError(false);
      return;
    }

    const state = getOrCreateSessionState(sessionId);
    setChatMessages(state.chatMessages);
    setIsStreaming(state.isStreaming);
    setInputPrompt(state.inputPrompt);
    steering.setQueuedMessages(state.queuedMessages || []);
    history.setIsHistoryLoaded(state.isHistoryLoaded);
    history.setHistoryLoadError(state.historyLoadError ?? false);
    history.updatePaginationState(state);

    // Rehydrate any unconsumed queued messages from backend on refresh / session switch
    fetchSessionQueue(sessionId).then((backendQueue) => {
      const s = sessionStore.get(sessionId);
      if (!s) return;
      if (backendQueue && backendQueue.length > 0 && (!s.queuedMessages || s.queuedMessages.length === 0)) {
        s.queuedMessages = [...backendQueue];
        s.queuedMessage = backendQueue[0] || null;
        if (activeSessionIdRef.current === sessionId) {
          steering.setQueuedMessages([...backendQueue]);
        }
        notifyStoreListeners();
      }
    }).catch(() => {});

    const PAGE_SIZE = 100;
    if (!state.isHistoryLoaded || (!state.isStreaming && state.chatMessages.length === 0)) {
      fetchTranscript(sessionId, PAGE_SIZE, true, 0)
        .then((resp) => {
          const s = sessionStore.get(sessionId);
          if (!s) return;
          if (s.isHistoryLoaded && s.loadedRawCount > 0 && !s.isStreaming) return;

          const rawLines = resp.lines || [];
          s.isHistoryLoaded = true;
          s.historyLoadError = false;
          s.totalHistoryCount = resp.total || 0;
          s.rawLines = rawLines;
          s.loadedRawCount = rawLines.length;

          if (rawLines.length > 0) {
            const parsedMsgs = parseSessionHistory(rawLines);
            if (s.isStreaming) {
              s.chatMessages = [...parsedMsgs, ...s.chatMessages];
            } else {
              s.chatMessages = parsedMsgs;
            }
          }

          if (activeSessionIdRef.current === sessionId) {
            history.setIsHistoryLoaded(true);
            history.setHistoryLoadError(false);
            setChatMessages([...s.chatMessages]);
            history.updatePaginationState(s);
            requestAnimationFrame(() => {
              const container = scrollContainerRef?.current || scrollRef.current;
              if (container) container.scrollTop = container.scrollHeight;
            });
          }
        })
        .catch((err) => {
          console.warn('Failed to load transcript:', err);
          const s = sessionStore.get(sessionId);
          if (s) {
            s.isHistoryLoaded = false;
            s.historyLoadError = true;
          }
          if (activeSessionIdRef.current === sessionId) {
            history.setIsHistoryLoaded(false);
            history.setHistoryLoadError(true);
          }
        });
    } else {
      history.updatePaginationState(state);
      requestAnimationFrame(() => {
        const container = scrollContainerRef?.current || scrollRef.current;
        if (container) container.scrollTop = container.scrollHeight;
      });
    }
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

  const handleSendMessage = async (
    explicitModelOrText?: string,
    explicitEffort?: string,
    explicitText?: string,
    isRetry: boolean = false,
    targetSessionId?: string,
    isImmediate: boolean = false
  ) => {
    let model = DEFAULT_MODEL;
    let thinkingEffort = thinkingBudget;
    let textToSend = explicitText;

    if (explicitText === undefined && explicitModelOrText !== undefined) {
      if (explicitModelOrText.includes(' ') || explicitModelOrText.includes('\n') || explicitEffort === undefined) {
        textToSend = explicitModelOrText;
      } else {
        model = explicitModelOrText;
      }
    } else {
      if (explicitModelOrText) model = explicitModelOrText;
      if (explicitEffort) thinkingEffort = explicitEffort;
    }

    lastModelRef.current = { model, effort: thinkingEffort };
    const rawText = textToSend !== undefined ? textToSend : inputPrompt;
    if (!rawText.trim()) return;
    const userText = rawText.trim();
    if (explicitText === undefined && textToSend === undefined) {
      handleSetInputPrompt('');
    }

    let activeSid = targetSessionId || activeSessionIdRef.current || sessionId;
    const isNewSession = !isRetry && !activeSid;
    const title = generateCleanSessionTitle(userText, activeSid || '');

    if (isNewSession) {
      const randSuffix =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
          : Math.random().toString(36).slice(2, 10);
      activeSid = `sess_${Date.now().toString(36)}_${randSuffix}`;
      activeSessionIdRef.current = activeSid;
      onSessionCreated(activeSid, title, sessionRepo);
      renameSession(activeSid, title).catch(() => {});
    }

    if (!activeSid) return;
    const targetSession = getOrCreateSessionState(activeSid);

    if (targetSession.isStreaming && !isRetry && !isImmediate) {
      targetSession.queuedMessages = [...(targetSession.queuedMessages || []), userText];
      targetSession.queuedMessage = targetSession.queuedMessages[0] || null;
      if (activeSid === activeSessionIdRef.current) {
        steering.setQueuedMessages([...targetSession.queuedMessages]);
      }
      notifyStoreListeners();
      return;
    }

    if (targetSession.isStreaming && isImmediate) {
      targetSession.abortController?.abort();
      targetSession.abortController = null;
      targetSession.isStreaming = false;
      try {
        await fetch(`${BASE_URL}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: activeSid, user_id: 'default_user', force: true }),
        });
      } catch {}
    }

    const currentStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    targetSession.activeTurnId = currentTurnId;

    targetSession.chatMessages = targetSession.chatMessages.map((m) => {
      if (m.role === 'assistant' && m.status === 'running') {
        return { ...m, status: 'completed' as const };
      }
      return m;
    });

    if (isRetry) {
      const targetIdx = findTargetAssistantIdx(targetSession.chatMessages);
      if (targetIdx >= 0) {
        const next = [...targetSession.chatMessages];
        const existingTurnId = next[targetIdx].turnId || currentTurnId;
        targetSession.activeTurnId = existingTurnId;
        const startNow = Date.now();
        next[targetIdx] = {
          role: 'assistant',
          turnId: existingTurnId,
          status: 'running',
          content: '',
          thoughts: [],
          tools: [],
          tasks: [],
          steps: [],
          error: undefined,
          sessionId: activeSid,
          turnStartTime: startNow,
        };
        targetSession.chatMessages = next;
      } else {
        const startNow = Date.now();
        targetSession.chatMessages = [
          ...targetSession.chatMessages,
          {
            role: 'assistant',
            turnId: currentTurnId,
            status: 'running',
            content: '',
            thoughts: [],
            tools: [],
            tasks: [],
            steps: [],
            sessionId: activeSid,
            turnStartTime: startNow,
          },
        ];
      }
    } else {
      const startNow = Date.now();
      targetSession.chatMessages = [
        ...targetSession.chatMessages,
        {
          id: `msg_u_${Date.now()}`,
          turnId: currentTurnId,
          status: 'completed',
          role: 'user',
          content: userText,
          timestamp: currentStamp,
          thoughts: [],
          tools: [],
          tasks: [],
          sessionId: activeSid,
        },
        {
          id: `msg_a_${Date.now()}`,
          turnId: currentTurnId,
          status: 'running',
          role: 'assistant',
          content: '',
          thoughts: [],
          tools: [],
          tasks: [],
          steps: [],
          sessionId: activeSid,
          turnStartTime: startNow,
        },
      ];
      targetSession.loadedRawCount += 2;
      targetSession.totalHistoryCount += 2;
      if (!targetSession.isHistoryLoaded && targetSession.chatMessages.length === 2) {
        targetSession.isHistoryLoaded = true;
      }
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
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
    notifyStoreListeners();

    try {
      await streamQuery(
        activeSid,
        userText,
        {
          onToken: (token) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            s.tokenBuffer += token;
            if (activeSid === activeSessionIdRef.current) scheduleFlush();
          },
          onThought: (thought) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            s.thoughtBuffer += thought;
            if (activeSid === activeSessionIdRef.current) scheduleFlush();
          },
          onThinkingEnd: () => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            if (activeSid === activeSessionIdRef.current) flushActiveStreamBuffer();
            const next = [...s.chatMessages];
            const idx = findTargetAssistantIdx(next, s.activeTurnId);
            if (idx >= 0 && next[idx].steps) {
              const currentSteps = [...next[idx].steps];
              let changed = false;
              for (const st of currentSteps) {
                if (st.type === 'thinking' && st.status === 'running') {
                  st.status = 'completed';
                  const sTime = st.startTime || s.turnStartTime || Date.now();
                  st.thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - sTime) / 1000));
                  if (s.thinkingDuration === null) s.thinkingDuration = st.thinkingDurationSeconds;
                  changed = true;
                }
              }
              if (changed) {
                next[idx] = {
                  ...next[idx],
                  steps: currentSteps,
                  thinkingDurationSeconds: s.thinkingDuration ?? next[idx].thinkingDurationSeconds,
                };
                s.chatMessages = next;
                if (activeSid === activeSessionIdRef.current) setChatMessages(next);
              }
            }
          },
          onToolCall: (toolCall) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            if (activeSid === activeSessionIdRef.current) flushActiveStreamBuffer();
            const next = [...s.chatMessages];
            const idx = findTargetAssistantIdx(next, s.activeTurnId);
            if (idx >= 0) {
              const existingTools = [...next[idx].tools];
              const matchIdx = existingTools.findIndex((t) => t.id && t.id === toolCall.id);
              if (matchIdx >= 0) {
                existingTools[matchIdx] = { ...existingTools[matchIdx], ...toolCall };
              } else {
                existingTools.push(toolCall);
              }

              const currentSteps: any[] = next[idx].steps && next[idx].steps.length > 0
                ? [...next[idx].steps]
                : [];

              for (const st of currentSteps) {
                if (st.type === 'thinking' && st.status === 'running') {
                  st.status = 'completed';
                  const sTime = st.startTime || s.turnStartTime || Date.now();
                  st.thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - sTime) / 1000));
                  if (s.thinkingDuration === null) {
                    s.thinkingDuration = st.thinkingDurationSeconds;
                  }
                }
                if (st.type === 'text' && st.status === 'running') {
                  st.status = 'completed';
                }
              }
              const sMatchIdx = currentSteps.findIndex((st) => 
                st.tool_call_id === toolCall.id || (st.type === 'tool' && st.id === toolCall.id)
              );
              if (sMatchIdx >= 0) {
                currentSteps[sMatchIdx] = {
                  ...currentSteps[sMatchIdx],
                  ...toolCall,
                  status: toolCall.status || (toolCall.output ? 'completed' : 'running'),
                };
              } else {
                currentSteps.push({
                  id: toolCall.id || `step_${currentSteps.length}`,
                  step_index: currentSteps.length,
                  type: 'tool',
                  tool_call_id: toolCall.id,
                  name: toolCall.name,
                  args: toolCall.args,
                  output: toolCall.output || '',
                  status: toolCall.status || (toolCall.output ? 'completed' : 'running'),
                });
              }

              next[idx] = {
                ...next[idx],
                tools: existingTools,
                steps: currentSteps,
                thinkingDurationSeconds: s.thinkingDuration ?? next[idx].thinkingDurationSeconds,
              };
              s.chatMessages = next;
              if (activeSid === activeSessionIdRef.current) {
                setChatMessages(next);
                if (scrollRef.current && isAtBottomRef.current) {
                  scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
              }
            }
          },
          onError: (errText, errId) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            if (activeSid === activeSessionIdRef.current) flushActiveStreamBuffer();
            const next = [...s.chatMessages];
            const idx = findTargetAssistantIdx(next, s.activeTurnId);
            if (idx >= 0) {
              next[idx] = {
                ...next[idx],
                status: 'error',
                error: errText,
                errorId: errId,
              };
              s.chatMessages = next;
              if (activeSid === activeSessionIdRef.current) {
                setChatMessages(next);
              }
            }
            s.isStreaming = false;
            s.abortController = null;
            if (activeSid === activeSessionIdRef.current) {
              setIsStreaming(false);
            }
            notifyStoreListeners();
          },
        },
        {
          workspace_uri: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
          working_directory: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
          section: (pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo')) ? 'workspace' : 'conversation',
          ...(isNewSession ? { title, custom_title: title } : {}),
          model,
          thinking_effort: thinkingEffort,
        },
        targetSession.abortController?.signal
      );
    } finally {
      const s = sessionStore.get(activeSid);
      let nextQueuedMsg: string | null = null;
      if (s) {
        s.isStreaming = false;
        s.abortController = null;
        const totalElapsed = s.turnStartTime > 0 ? Math.max(1, Math.round((Date.now() - s.turnStartTime) / 1000)) : undefined;
        const next = [...s.chatMessages];
        const idx = findTargetAssistantIdx(next, s.activeTurnId);
        if (idx >= 0 && next[idx].status !== 'aborted') {
          next[idx] = {
            ...next[idx],
            status: s.wasUserAborted ? 'aborted' : 'completed',
            totalDurationSeconds: totalElapsed ?? next[idx].totalDurationSeconds,
          };
          s.chatMessages = next;
          if (activeSid === activeSessionIdRef.current) {
            setChatMessages(next);
          }
        }
        const wasAborted = s.wasUserAborted;
        s.wasUserAborted = false;

        // Auto-send next queued message if user had one waiting
        if (!wasAborted && s.queuedMessages && s.queuedMessages.length > 0) {
          nextQueuedMsg = s.queuedMessages.shift() || null;
          s.queuedMessage = s.queuedMessages[0] || null;
          if (activeSid === activeSessionIdRef.current) {
            steering.setQueuedMessages([...s.queuedMessages]);
          }
        }
      }
      if (activeSid === activeSessionIdRef.current) {
        setIsStreaming(false);
        flushActiveStreamBuffer();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mash:turn_completed', { detail: { sessionId: activeSid } }));
      }
      notifyStoreListeners();
      markSessionViewed(activeSid).catch(() => {});

      // Auto-dispatch next queued message to honor "Sends after agent finishes working"
      if (nextQueuedMsg) {
        removeSessionQueueItem(activeSid, 0).catch(() => {});
        setTimeout(() => {
          handleSendMessage(undefined, undefined, nextQueuedMsg!, false, activeSid);
        }, 80);
      }
    }
  };
  handleSendMessageRef.current = handleSendMessage;

  const handleStopStreaming = useCallback(async () => {
    const curSid = activeSessionIdRef.current;
    if (!curSid) return;
    const s = sessionStore.get(curSid);
    if (!s || !s.isStreaming) return;
    s.wasUserAborted = true;
    s.isStreaming = false;
    flushActiveStreamBuffer();

    const elapsed = s.turnStartTime > 0 ? Math.max(1, Math.round((Date.now() - s.turnStartTime) / 1000)) : undefined;
    const next = [...s.chatMessages];
    const targetIdx = findTargetAssistantIdx(next, s.activeTurnId);
    if (targetIdx >= 0) {
      next[targetIdx] = {
        ...next[targetIdx],
        status: 'aborted',
        totalDurationSeconds: elapsed ?? next[targetIdx].totalDurationSeconds,
      };
      s.chatMessages = next;
      if (curSid === activeSessionIdRef.current) {
        setChatMessages(next);
      }
    }
    setIsStreaming(false);
    notifyStoreListeners();

    const ctrl = s.abortController;
    s.abortController = null;
    ctrl?.abort();

    try {
      await fetch(`${BASE_URL}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: curSid, user_id: 'default_user', force: true }),
      });
    } catch {}
  }, [flushActiveStreamBuffer]);

  const handleRetry = useCallback((userText?: string, targetSid?: string) => {
    const m = lastModelRef.current.model;
    const e = lastModelRef.current.effort;
    const sidToUse = targetSid || activeSessionIdRef.current || sessionId;
    if (!sidToUse) return;
    handleSendMessage(m, e, userText, true, sidToUse);
  }, [sessionId, handleSendMessage]);

  const handleUndo = useCallback((flatIdx?: number, userText?: string, turnIdx?: number) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (s) {
      s.abortController?.abort();
      s.isStreaming = false;
      if (typeof flatIdx === 'number') {
        s.chatMessages = s.chatMessages.slice(0, flatIdx);
      } else {
        const msgs = [...s.chatMessages];
        let removeCount = 0;
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') removeCount++;
        if (msgs.length > removeCount && msgs[msgs.length - 1 - removeCount].role === 'user') removeCount++;
        s.chatMessages = msgs.slice(0, msgs.length - removeCount);
      }
      setChatMessages(s.chatMessages);
    }
    setIsStreaming(false);
    if (userText) handleSetInputPrompt(userText);
    fetch(`${BASE_URL}/sessions/${activeSid}/undo`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_turn: turnIdx ?? 0 }),
    }).catch(() => {});
    notifyStoreListeners();
  }, [sessionId, handleSetInputPrompt]);

  const turns = useMemo(() => buildTurns(chatMessages), [chatMessages]);

  const streamingArtifactsCacheRef = useRef<Map<string, ArtifactItem[]>>(new Map());

  const artifactsByTurnMsg = useMemo(() => {
    if (isStreaming && streamingArtifactsCacheRef.current.size > 0) {
      return streamingArtifactsCacheRef.current;
    }
    const locMap = new Map<string, string>();
    const rawMap = new Map<string, ArtifactItem[]>();
    const lastTurnIdx = turns.length - 1;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const isLastTurn = i === lastTurnIdx;
      for (let j = 0; j < turn.aiMsgs.length; j++) {
        const key = `${i}_${j}`;
        const isStreamingAiMsg = isStreaming && isLastTurn && j === turn.aiMsgs.length - 1;
        const arts = getCachedArtifacts(turn.aiMsgs[j], isStreamingAiMsg);
        rawMap.set(key, arts);
        for (const art of arts) {
          const group = getArtifactCanonicalGroup(art.filePath || art.title || art.id);
          if (group) locMap.set(group, key);
        }
      }
    }
    const resMap = new Map<string, ArtifactItem[]>();
    for (const [key, arts] of rawMap.entries()) {
      const visible = arts.filter((art) => {
        const group = getArtifactCanonicalGroup(art.filePath || art.title || art.id);
        if (!group) return true;
        return locMap.get(group) === key;
      });
      resMap.set(key, visible);
    }
    if (!isStreaming) streamingArtifactsCacheRef.current = resMap;
    return resMap;
  }, [turns, isStreaming]);

  const handleLoadEarlier = useCallback(async () => {
    await history.loadEarlierTurns((olderMsgs) => {
      setChatMessages([...olderMsgs]);
    });
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

  return {
    chatMessages,
    inputPrompt,
    setInputPrompt: handleSetInputPrompt,
    isStreaming,
    isHistoryLoaded: history.isHistoryLoaded,
    historyLoadError: history.historyLoadError,
    retryLoadHistory: history.retryLoadHistory,
    queuedMessages: steering.queuedMessages,
    queuedMessage: steering.queuedMessage,
    turns,
    artifactsByTurnMsg,
    send: handleSendMessage,
    stop: handleStopStreaming,
    retry: handleRetry,
    undo: handleUndo,
    injectQueued: steering.injectQueued,
    discardQueued: steering.discardQueued,
    hasEarlierTurns: history.hasEarlierTurns,
    isLoadingEarlier: history.isLoadingEarlier,
    remainingEarlierCount: history.remainingEarlierCount,
    loadEarlierTurns: handleLoadEarlier,
  };
}
