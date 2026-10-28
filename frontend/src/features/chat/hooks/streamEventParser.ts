// SSE wire protocol event parser, sentinel stripper, artifact builder, and session rehydration (<250 LOC).

import type { Message, Turn } from '@/types/chat';
import type { ArtifactItem } from '@/types/artifacts';
import { extractArtifacts, getArtifactCanonicalGroup } from '@/features/artifacts/utils/extraction';
import { fetchTranscript, fetchSessionQueue } from '@/services/sessions';
import { parseSessionHistory } from '@/features/chat/utils/turns';
import { sessionStore, getOrCreateSessionState, notifyStoreListeners } from '../state/sessionStore';

export interface StreamWireEvent {
  type: string;
  delta?: string;
  content?: string;
  run_id?: string;
  tool_call_id?: string;
  tool_call_name?: string;
  name?: string;
  arguments?: string;
  parameters?: any;
  data?: any;
  [key: string]: any;
}

export function isHeartbeatComment(line: string): boolean {
  return typeof line === 'string' && line.trim().startsWith(':');
}

export function stripSentinels(rawToken: string): string {
  if (typeof rawToken !== 'string' || !rawToken) return '';
  // QA-BUG-1 Fix: Require brackets so ordinary words ("done", "end", "empty") are never dropped from chat
  if (/^\[(DONE|END|done|end|empty)\]$/i.test(rawToken.trim())) return '';
  return rawToken
    .replace(/\[VERIFIED\]\s*/gi, '')
    .replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '');
}

export function extractTokenDelta(event: StreamWireEvent): string {
  if (!event) return '';
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  return stripSentinels(event.delta ?? data.delta ?? event.content ?? data.content ?? '');
}

export function extractThoughtDelta(event: StreamWireEvent): string {
  if (!event) return '';
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  return stripSentinels(event.delta ?? data.delta ?? event.content ?? data.content ?? '');
}

const messageArtifactCache = new WeakMap<Message, ArtifactItem[]>();

export function getCachedArtifacts(msg: Message, isStreamingMsg: boolean): ArtifactItem[] {
  if (isStreamingMsg) return [];
  let cached = messageArtifactCache.get(msg);
  if (!cached) {
    cached = extractArtifacts(msg);
    messageArtifactCache.set(msg, cached);
  }
  return cached;
}

export function buildTurnArtifactMap(
  turns: Turn[],
  isStreaming: boolean,
  streamingCache: Map<string, ArtifactItem[]>
): Map<string, ArtifactItem[]> {
  if (isStreaming && streamingCache.size > 0) return streamingCache;
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
      return !group || locMap.get(group) === key;
    });
    resMap.set(key, visible);
  }
  if (!isStreaming) {
    streamingCache.clear();
    for (const [k, v] of resMap.entries()) streamingCache.set(k, v);
  }
  return resMap;
}

export async function rehydrateSessionTranscript(
  sessionId: string,
  onLoaded?: (msgs: Message[], s: any) => void,
  onError?: () => void
) {
  try {
    const resp = await fetchTranscript(sessionId, 100, true, 0);
    const s = sessionStore.get(sessionId);
    if (!s || (s.isHistoryLoaded && s.loadedRawCount > 0 && !s.isStreaming)) return;
    const rawLines = resp.lines || [];
    s.isHistoryLoaded = true;
    s.historyLoadError = false;
    s.totalHistoryCount = resp.total || 0;
    s.rawLines = rawLines;
    s.loadedRawCount = rawLines.length;
    if (rawLines.length > 0) {
      const parsedMsgs = parseSessionHistory(rawLines);
      s.chatMessages = s.isStreaming ? [...parsedMsgs, ...s.chatMessages] : parsedMsgs;
    }
    onLoaded?.(s.chatMessages, s);
  } catch (err) {
    console.warn('Failed to load transcript:', err);
    const s = sessionStore.get(sessionId);
    if (s) { s.isHistoryLoaded = false; s.historyLoadError = true; }
    onError?.();
  }
}

export async function syncBackendSessionQueue(sessionId: string, onSynced?: (queue: string[]) => void) {
  try {
    const backendQueue = await fetchSessionQueue(sessionId);
    const s = sessionStore.get(sessionId);
    if (s && backendQueue?.length && (!s.queuedMessages || s.queuedMessages.length === 0)) {
      s.queuedMessages = [...backendQueue];
      onSynced?.(backendQueue);
      notifyStoreListeners();
    }
  } catch {}
}

export function syncSessionSwitchingState(params: {
  sessionId: string | null;
  activeSessionIdRef: React.MutableRefObject<string | null>;
  history: any;
  steering: any;
  setChatMessages: (msgs: Message[]) => void;
  setIsStreaming: (streaming: boolean) => void;
  setInputPrompt: (prompt: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { sessionId, activeSessionIdRef, history, steering, setChatMessages, setIsStreaming, setInputPrompt, scrollRef } = params;
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

  syncBackendSessionQueue(sessionId, (queue) => {
    if (activeSessionIdRef.current === sessionId) steering.setQueuedMessages([...queue]);
  });

  if (!state.isHistoryLoaded || (!state.isStreaming && state.chatMessages.length === 0)) {
    rehydrateSessionTranscript(sessionId, (msgs, s) => {
      if (activeSessionIdRef.current === sessionId) {
        history.setIsHistoryLoaded(true);
        history.setHistoryLoadError(false);
        setChatMessages([...msgs]);
        history.updatePaginationState(s);
        requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
      }
    }, () => {
      if (activeSessionIdRef.current === sessionId) {
        history.setIsHistoryLoaded(false);
        history.setHistoryLoadError(true);
      }
    });
  } else {
    history.updatePaginationState(state);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
  }
}
