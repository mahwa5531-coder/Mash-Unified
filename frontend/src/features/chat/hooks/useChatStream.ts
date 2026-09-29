"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { fetchTranscript, renameSession, markSessionViewed, queueSteeringMessage, fetchSessionQueue } from '@/services/sessions';
import { streamQuery } from '@/services/stream';
import { fetchBackgroundTasks, killBackgroundTask, BackgroundTaskItem } from '@/services/tasks';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { parseTranscriptLines, buildTurns } from '@/features/chat/utils/turns';
import {
  sessionStore,
  getOrCreateSessionState,
  type SessionRuntimeState,
  setViewingSession,
  subscribeToSessionStore,
  notifyStoreListeners,
  isSessionStreaming,
  findTargetAssistantIdx,
} from '../state/sessionStore';
import { extractArtifacts, getArtifactCanonicalGroup } from '@/features/artifacts/utils/extraction';


const messageArtifactCache = new WeakMap<Message, ArtifactItem[]>();

function getCachedArtifacts(msg: Message, isStreamingMsg: boolean): ArtifactItem[] {
  if (isStreamingMsg) {
    return [];
  }
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

export function useChatStream({ sessionId, sessionRepo, pendingWorkspacePath, onSessionCreated, scrollContainerRef }: UseChatStreamOptions) {
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState<boolean>(() => !sessionId || (sessionStore.get(sessionId)?.isHistoryLoaded ?? false));
  const [historyLoadError, setHistoryLoadError] = useState<boolean>(() => !sessionId ? false : (sessionStore.get(sessionId)?.historyLoadError ?? false));
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [hasEarlierTurns, setHasEarlierTurns] = useState<boolean>(false);
  const [remainingEarlierCount, setRemainingEarlierCount] = useState<number>(0);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState<boolean>(false);
  // ponytail: nonce to force history reload effect to re-trigger (M-01)
  const [historyRetryNonce, setHistoryRetryNonce] = useState(0);
  const fallbackScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = scrollContainerRef || fallbackScrollRef;
  const isAtBottomRef = useRef<boolean>(true);

  const updatePaginationState = useCallback((s: SessionRuntimeState) => {
    const remaining = Math.max(0, s.totalHistoryCount - s.loadedRawCount);
    setRemainingEarlierCount(remaining);
    setHasEarlierTurns(remaining > 0);
  }, []);

  const activeSessionIdRef = useRef<string | null>(sessionId);
  useEffect(() => {
    activeSessionIdRef.current = sessionId;
  }, [sessionId]);

  const DEFAULT_MODEL = 'default';
  const [thinkingBudget, setThinkingBudget] = useState<string>('high');
  const lastModelRef = useRef<{ model: string; effort: string }>({ model: 'default', effort: 'high' });

  const rafIdRef = useRef<number | null>(null);

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

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottomRef.current = scrollHeight - (scrollTop + clientHeight) < 80;
  };

  // ponytail: flush batched tokens to the active session at 60fps via requestAnimationFrame
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
  }, []);

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



  // Session switching: 0ms instantaneous read from in-memory sessionStore cache!
  useEffect(() => {
    // Flush any pending active buffer into memory before switching sessions
    flushActiveStreamBuffer();
    activeSessionIdRef.current = sessionId;
    setViewingSession(sessionId);
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (!sessionId) {
      setChatMessages([]);
      setIsStreaming(false);
      setQueuedMessage(null);
      setInputPrompt('');
      setHasEarlierTurns(false);
      setRemainingEarlierCount(0);
      setIsHistoryLoaded(true);
      setHistoryLoadError(false);
      return;
    }

    const state = getOrCreateSessionState(sessionId);
    // Instant 0ms render from store
    setChatMessages(state.chatMessages);
    setIsStreaming(state.isStreaming);
    setQueuedMessage(state.queuedMessage);
    setInputPrompt(state.inputPrompt);
    setIsHistoryLoaded(state.isHistoryLoaded);
    setHistoryLoadError(state.historyLoadError ?? false);
    updatePaginationState(state);

    // ponytail: Load up to 100 turns to populate the live DOM window
    const PAGE_SIZE = 100;

    // If history is not yet loaded in cache, fetch recent 100 turns from backend
    if (!state.isHistoryLoaded || (!state.isStreaming && state.chatMessages.length === 0)) {
      fetchTranscript(sessionId, PAGE_SIZE, true, 0).then((resp) => {
        const s = sessionStore.get(sessionId);
        if (!s) return;
        // Avoid duplicate application if history was already populated
        if (s.isHistoryLoaded && s.loadedRawCount > 0 && !s.isStreaming) return;

        const rawLines = resp.lines || [];
        s.isHistoryLoaded = true;
        s.historyLoadError = false;
        s.totalHistoryCount = resp.total || 0;
        s.rawLines = rawLines;
        s.loadedRawCount = rawLines.length;

        if (rawLines.length > 0) {
          const parsedMsgs = parseTranscriptLines(rawLines);
          if (s.isStreaming) {
            // Race condition resolved: user sent a message while fetch was in-flight.
            // Prepend loaded history behind active in-flight streaming turns without dropping anything!
            s.chatMessages = [...parsedMsgs, ...s.chatMessages];
          } else {
            s.chatMessages = parsedMsgs;
          }
        }

        // Only commit to active React state if user is still on this session
        if (activeSessionIdRef.current === sessionId) {
          setIsHistoryLoaded(true);
          setHistoryLoadError(false);
          setChatMessages([...s.chatMessages]);
          updatePaginationState(s);
          requestAnimationFrame(() => {
            const container = scrollContainerRef?.current || scrollRef.current;
            if (container) {
              container.scrollTop = container.scrollHeight;
            }
          });
        }
      }).catch((err) => {
        console.warn("Failed to load transcript:", err);
        const s = sessionStore.get(sessionId);
        if (s) {
          s.isHistoryLoaded = false;
          s.historyLoadError = true;
        }
        if (activeSessionIdRef.current === sessionId) {
          setIsHistoryLoaded(false);
          setHistoryLoadError(true);
        }
      });
    } else {
      updatePaginationState(state);
      requestAnimationFrame(() => {
        const container = scrollContainerRef?.current || scrollRef.current;
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    }
  }, [sessionId, historyRetryNonce, scrollContainerRef, updatePaginationState]);

  // Load earlier turns via reverse scroll pagination
  const loadEarlierTurns = useCallback(async () => {
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
      const container = scrollContainerRef?.current || scrollRef.current;
      const prevScrollHeight = container ? container.scrollHeight : 0;
      const prevScrollTop = container ? container.scrollTop : 0;

      const PAGE_SIZE = 100;
      const resp = await fetchTranscript(curSid, PAGE_SIZE, true, s.loadedRawCount);
      const olderLines = resp.lines || [];

      if (olderLines.length > 0) {
        s.rawLines = [...olderLines, ...(s.rawLines || [])];
        s.loadedRawCount += olderLines.length;
        s.totalHistoryCount = resp.total || s.totalHistoryCount;

        const mergedMsgs = parseTranscriptLines(s.rawLines);
        if (s.isStreaming) {
          // ponytail: preserve all active turn messages (user prompt + assistant steps) during streaming
          const inFlightTurns = s.chatMessages.filter(
            m => (s.activeTurnId && m.turnId === s.activeTurnId) || m.status === 'running'
          );
          s.chatMessages = [...mergedMsgs, ...inFlightTurns];
        } else {
          s.chatMessages = mergedMsgs;
        }

        if (activeSessionIdRef.current === curSid) {
          setChatMessages([...s.chatMessages]);
          updatePaginationState(s);

          // OpenHands formula: retain viewport anchor after prepending elements
          requestAnimationFrame(() => {
            if (container) {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
            }
          });
        }
      } else {
        s.loadedRawCount = s.totalHistoryCount;
        updatePaginationState(s);
      }
    } catch (err) {
      console.warn("Failed to load earlier history:", err);
    } finally {
      setIsLoadingEarlier(false);
    }
  }, [isLoadingEarlier, scrollContainerRef, updatePaginationState]);

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

  const handleInjectQueuedMessage = async () => {
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
    await handleSendMessage(DEFAULT_MODEL, thinkingBudget, msgToInject, false, activeSid, true);
  };



  const handleSendMessage = async (
    explicitModelOrText?: string, 
    explicitEffort?: string, 
    explicitText?: string,
    isRetry: boolean = false,
    targetSessionId?: string,
    isImmediate: boolean = false
  ) => {
    // ponytail: support both send(text) and send(model, effort, text) flexibly
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
    const title = generateCleanSessionTitle(userText, activeSid || '');

    let isNewSession = false;
    if (!isRetry && !activeSid) {
      const randSuffix = typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
        : Math.random().toString(36).slice(2, 10);
      activeSid = `sess_${Date.now().toString(36)}_${randSuffix}`;
      activeSessionIdRef.current = activeSid;
      isNewSession = true;
      onSessionCreated(activeSid, title, sessionRepo);
      renameSession(activeSid, title).catch(() => {});
    }

    if (!activeSid) return;
    const targetSession = getOrCreateSessionState(activeSid);

    // ponytail: queue message if agent is actively streaming and this is not an immediate interrupt
    if (targetSession.isStreaming && !isRetry && !isImmediate) {
      targetSession.queuedMessage = userText;
      if (activeSid === activeSessionIdRef.current) {
        setQueuedMessage(userText);
      }
      notifyStoreListeners();
      queueSteeringMessage(activeSid, userText).catch(() => {});
      return;
    }

    // If explicit immediate interrupt requested, abort current runner cleanly
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
      targetSession.queuedMessage = null;
      if (activeSid === activeSessionIdRef.current) {
        setQueuedMessage(null);
      }
    }

    const currentStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    targetSession.activeTurnId = currentTurnId;

    // Finalize any lingering unfinalized messages from previous runs to guarantee clean isolation
    targetSession.chatMessages = targetSession.chatMessages.map(m => {
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
          sessionId: activeSid 
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
        // Brand-new fresh session has no remote history
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
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 50);
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
            if (activeSid === activeSessionIdRef.current) {
              scheduleFlush();
            }
          },
          onThought: (thought) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            s.thoughtBuffer += thought;
            if (activeSid === activeSessionIdRef.current) {
              scheduleFlush();
            }
          },
          onThinkingEnd: () => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            if (activeSid === activeSessionIdRef.current) {
              flushActiveStreamBuffer();
            }
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
                  if (s.thinkingDuration === null) {
                    s.thinkingDuration = st.thinkingDurationSeconds;
                  }
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
                if (activeSid === activeSessionIdRef.current) {
                  setChatMessages(next);
                }
              }
            }
          },
          onToolCall: (toolCall) => {
            const s = sessionStore.get(activeSid);
            if (!s) return;
            if (activeSid === activeSessionIdRef.current) {
              flushActiveStreamBuffer();
            }
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

              // Mark any active thinking or text step as completed when a tool call starts
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
            if (activeSid === activeSessionIdRef.current) {
              flushActiveStreamBuffer();
            }
            const next = [...s.chatMessages];
            const idx = findTargetAssistantIdx(next, s.activeTurnId);
            if (idx >= 0) {
              const fallbackId = `${activeSid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-${Date.now().toString(16)}`;
              next[idx] = { 
                ...next[idx], 
                error: errText, 
                errorId: errId || fallbackId,
                status: 'error' 
              };
              s.chatMessages = next;
              if (activeSid === activeSessionIdRef.current) {
                setChatMessages(next);
              }
            }
          },
        },
        {
          workspace_uri: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
          working_directory: pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo' ? sessionRepo : 'No Repo'),
          section: (pendingWorkspacePath || (sessionRepo && sessionRepo !== 'No Repo')) ? 'workspace' : 'conversation',
          // ponytail: only send title on first message of a new session (C-06)
          ...(isNewSession ? { title, custom_title: title } : {}),
          model,
          thinking_effort: thinkingEffort,
        },
        targetSession.abortController?.signal
      );
    } finally {
      const s = sessionStore.get(activeSid);
      if (s) {
        const totalElapsed = s.turnStartTime > 0 
          ? Math.max(1, Math.round((Date.now() - s.turnStartTime) / 1000)) 
          : 0;
        if (s.thinkingDuration === null && s.turnStartTime > 0) {
          s.thinkingDuration = totalElapsed;
        }
        if (activeSid === activeSessionIdRef.current) {
          flushActiveStreamBuffer();
        } else {
          if (s.tokenBuffer || s.thoughtBuffer) {
            const idx = findTargetAssistantIdx(s.chatMessages, s.activeTurnId);
            if (idx >= 0) {
              const msg = s.chatMessages[idx];
              let updatedThoughts = [...msg.thoughts];
              if (s.thoughtBuffer) {
                if (updatedThoughts.length === 0) updatedThoughts.push(s.thoughtBuffer);
                else updatedThoughts[updatedThoughts.length - 1] += s.thoughtBuffer;
              }
              s.chatMessages[idx] = {
                ...msg,
                content: s.tokenBuffer ? msg.content + s.tokenBuffer : msg.content,
                thoughts: updatedThoughts,
              };
            }
            s.tokenBuffer = '';
            s.thoughtBuffer = '';
          }
        }
        const next = [...s.chatMessages];
        const idx = findTargetAssistantIdx(next, s.activeTurnId);
        if (idx >= 0) {
          const completionStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const currentStatus = next[idx].status;
          const isAborted = s.abortController?.signal?.aborted || currentStatus === 'aborted';
          const finalStatus = (currentStatus === 'error' || isAborted) ? (currentStatus === 'error' ? 'error' : 'aborted') : 'completed';
          const cleanedSteps = (next[idx].steps || []).map((st: any) => {
            if (st.status === 'running') {
              const sTime = st.startTime || s.turnStartTime || Date.now();
              const dur = Math.max(1, Math.round((Date.now() - sTime) / 1000));
              return {
                ...st,
                status: isAborted ? 'cancelled' : 'completed',
                thinkingDurationSeconds: st.type === 'thinking' ? (st.thinkingDurationSeconds || dur) : st.thinkingDurationSeconds,
              };
            }
            return st;
          }).filter(
            (st: any) =>
              (st.type === 'text' && st.content && st.content.trim().length > 0) ||
              (st.type === 'thinking' && st.content && st.content.trim().length > 0) ||
              (st.type === 'tool') ||
              (st.thoughts && st.thoughts.length > 0 && st.thoughts.some((t: string) => t.trim().length > 0)) ||
              (st.tools && st.tools.length > 0)
          );
          next[idx] = {
            ...next[idx],
            timestamp: next[idx].timestamp || completionStamp,
            steps: cleanedSteps,
            thinkingDurationSeconds: s.thinkingDuration ?? next[idx].thinkingDurationSeconds,
            totalDurationSeconds: totalElapsed > 0 ? totalElapsed : next[idx].totalDurationSeconds,
            status: finalStatus,
          };
          s.chatMessages = next;
        }
        s.activeTurnId = null;
        s.isStreaming = false;
        s.abortController = null;

        if (activeSid === activeSessionIdRef.current) {
          setIsStreaming(false);
          setChatMessages(next);
          // ponytail: user saw the completion in the active session, sync viewed time immediately
          markSessionViewed(activeSid).catch(() => {});
        } else {
          // Stream completed in the background while user is viewing a different session!
          const sState = sessionStore.get(activeSid);
          if (sState) {
            sState.hasUnread = true;
          }
        }
        notifyStoreListeners();

        // Auto-dispatch next queued message for this specific session if queued
        const queuedToRun = s.queuedMessage;
        if (queuedToRun) {
          s.queuedMessage = null;
          if (activeSid === activeSessionIdRef.current) {
            setQueuedMessage(null);
          }
          setTimeout(() => {
            handleSendMessage(DEFAULT_MODEL, thinkingBudget, queuedToRun, false, activeSid);
          }, 100);
        } else {
          fetchSessionQueue(activeSid).then((data) => {
            if (data && data.count > 0 && data.queued.length > 0) {
              const pendingInstruction = data.queued[0];
              setTimeout(() => {
                handleSendMessage(DEFAULT_MODEL, thinkingBudget, pendingInstruction, false, activeSid);
              }, 100);
            }
          }).catch(() => {});
        }
      }
    }
  };

  const handleStop = () => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (!s) return;

    const totalElapsed = s.turnStartTime > 0 
      ? Math.max(1, Math.round((Date.now() - s.turnStartTime) / 1000)) 
      : 0;
    if (s.thinkingDuration === null && s.turnStartTime > 0) {
      s.thinkingDuration = totalElapsed;
    }
    flushActiveStreamBuffer();
    const next = [...s.chatMessages];
    const targetIdx = findTargetAssistantIdx(next, s.activeTurnId);
    if (targetIdx >= 0) {
      const steps = (next[targetIdx].steps || []).map((st: any) =>
        st.status === 'running' ? { ...st, status: 'cancelled' } : st
      );
      next[targetIdx] = {
        ...next[targetIdx],
        steps,
        thinkingDurationSeconds: s.thinkingDuration ?? next[targetIdx].thinkingDurationSeconds,
        totalDurationSeconds: totalElapsed > 0 ? totalElapsed : next[targetIdx].totalDurationSeconds,
        status: 'aborted',
      };
      s.chatMessages = next;
    }
    s.isStreaming = false;
    s.abortController?.abort();

    fetch(`${BASE_URL}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: activeSid, user_id: 'default_user', force: true }),
    }).catch(() => {});

    setIsStreaming(false);
    setChatMessages(next);
    notifyStoreListeners();
  };

  // Linear O(N) grouping
  const turns = useMemo(() => buildTurns(chatMessages), [chatMessages]);

  // ponytail: Cache for artifacts during streaming to avoid O(N) recalculation
  const streamingArtifactsCacheRef = useRef<Map<string, ArtifactItem[]>>(new Map());

  const artifactsByTurnMsg = useMemo(() => {
    // freeze artifacts mapping during streaming because streamed messages return [] anyway
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
          if (group) {
            locMap.set(group, key);
          }
        }
      }
    }

    const resultMap = new Map<string, ArtifactItem[]>();
    for (const [key, arts] of rawMap.entries()) {
      const active = arts.filter((art) => {
        const group = getArtifactCanonicalGroup(art.filePath || art.title || art.id);
        const latestKey = locMap.get(group);
        return !latestKey || latestKey === key;
      });
      resultMap.set(key, active);
    }
    streamingArtifactsCacheRef.current = resultMap;
    return resultMap;
  }, [turns, isStreaming]);

  const handleUndoTurn = useCallback((flatIdx: number, userText: string, turnIdx: number) => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (!activeSid) return;
    const s = sessionStore.get(activeSid);
    if (s) {
      s.abortController?.abort();
      s.isStreaming = false;
      s.chatMessages = s.chatMessages.slice(0, flatIdx);
      setChatMessages(s.chatMessages);
    }
    setIsStreaming(false);
    handleSetInputPrompt(userText);
    fetch(`${BASE_URL}/sessions/${activeSid}/undo`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_turn: turnIdx }),
    }).catch(() => {});
    notifyStoreListeners();
  }, [sessionId, handleSetInputPrompt]);

  const handleRetry = useCallback((userText: string, targetSid?: string) => {
    const m = lastModelRef.current.model;
    const e = lastModelRef.current.effort;
    const sidToUse = targetSid || activeSessionIdRef.current || sessionId;
    if (!sidToUse) return;
    handleSendMessage(m, e, userText, true, sidToUse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const discardQueued = () => {
    const activeSid = activeSessionIdRef.current || sessionId;
    if (activeSid) {
      const s = sessionStore.get(activeSid);
      if (s) s.queuedMessage = null;
    }
    setQueuedMessage(null);
    notifyStoreListeners();
  };

  const retryLoadHistory = useCallback(() => {
    if (!sessionId) return;
    const s = sessionStore.get(sessionId);
    if (s) {
      s.isHistoryLoaded = false;
      s.historyLoadError = false;
      s.loadedRawCount = 0; // ponytail: reset so guard at line 268 doesn't bail (M-01)
    }
    setHistoryLoadError(false);
    setIsHistoryLoaded(false);
    setHistoryRetryNonce(n => n + 1); // ponytail: bump nonce to re-trigger effect (M-01)
  }, [sessionId]);

  return {
    chatMessages,
    inputPrompt,
    setInputPrompt: handleSetInputPrompt,
    isStreaming,
    isHistoryLoaded,
    historyLoadError,
    retryLoadHistory,
    queuedMessage,
    scrollRef,
    handleScroll,
    turns,
    artifactsByTurnMsg,
    send: handleSendMessage,
    stop: handleStop,
    retry: handleRetry,
    undo: handleUndoTurn,
    injectQueued: handleInjectQueuedMessage,
    discardQueued,
    hasEarlierTurns,
    isLoadingEarlier,
    remainingEarlierCount,
    loadEarlierTurns,
  };
}

