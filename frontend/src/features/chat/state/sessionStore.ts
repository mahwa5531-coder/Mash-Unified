// ----------------------------------------------------------------------
// Multi-session runtime state (module-level store).
// Completely isolates session data, SSE buffers, and streaming states so
// parallel sessions never cross-talk or leak. LRU-evicts non-streaming
// sessions beyond MAX_CACHED_SESSIONS.
// ----------------------------------------------------------------------
import type { Message } from '@/types/chat';

export interface SessionRuntimeState {
  chatMessages: Message[];
  activeTurnId: string | null;
  loadedRawCount: number;
  totalHistoryCount: number;
  isStreaming: boolean;
  tokenBuffer: string;
  thoughtBuffer: string;
  turnStartTime: number;
  thinkingDuration: number | null;
  abortController: AbortController | null;
  queuedMessage: string | null;
  inputPrompt: string;
  isHistoryLoaded: boolean;
  historyLoadError?: boolean;
  rawLines?: any[];
  hasUnread?: boolean;
}

export const sessionStore = new Map<string, SessionRuntimeState>();
let currentViewingSessionId: string | null = null;

/** Track which session the user is currently viewing (eviction guard). */
export function setViewingSession(sid: string | null) {
  currentViewingSessionId = sid;
}

export function clearSessionStore() {
  sessionStore.clear();
}

const MAX_CACHED_SESSIONS = 25;

export function getOrCreateSessionState(sid: string): SessionRuntimeState {
  let state = sessionStore.get(sid);
  if (state) {
    // True LRU: touch key on access so Map keeps it at the tail (most recent)
    sessionStore.delete(sid);
    sessionStore.set(sid, state);
    return state;
  }
  // Evict least recently accessed non-streaming session when ceiling is reached
  if (sessionStore.size >= MAX_CACHED_SESSIONS) {
    for (const [cachedSid, cachedState] of sessionStore.entries()) {
      if (!cachedState.isStreaming && cachedSid !== currentViewingSessionId && cachedSid !== sid) {
        sessionStore.delete(cachedSid);
        break;
      }
    }
  }
  state = {
    chatMessages: [],
    activeTurnId: null,
    loadedRawCount: 0,
    totalHistoryCount: 0,
    isStreaming: false,
    tokenBuffer: '',
    thoughtBuffer: '',
    turnStartTime: 0,
    thinkingDuration: null,
    abortController: null,
    queuedMessage: null,
    inputPrompt: '',
    isHistoryLoaded: false,
    historyLoadError: false,
    rawLines: [],
  };
  sessionStore.set(sid, state);
  return state;
}

const storeListeners = new Set<() => void>();
export function subscribeToSessionStore(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

export function notifyStoreListeners() {
  storeListeners.forEach((fn) => {
    try { fn(); } catch (_) {}
  });
}

export function isSessionStreaming(sid: string | null): boolean {
  if (!sid) return false;
  return sessionStore.get(sid)?.isStreaming ?? false;
}

export function findTargetAssistantIdx(msgs: Message[], turnId?: string | null): number {
  if (turnId) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant' && msgs[i].turnId === turnId) return i;
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant' && msgs[i].status === 'running') return i;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'assistant') return i;
  }
  return -1;
}
