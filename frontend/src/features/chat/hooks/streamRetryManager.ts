// Disconnect recovery, retry reset, continue logic, and abort/error management (<250 LOC).

import type { Message } from '@/types/chat';
import { BASE_URL, safeFetch } from '@/services/client';
import { markSessionViewed, removeSessionQueueItem, renameSession } from '@/services/sessions';
import { streamQuery } from '@/services/stream';
import { generateCleanSessionTitle } from '@/utils/sessionTitle';
import { findTargetAssistantIdx, sessionStore, notifyStoreListeners, type SessionRuntimeState } from '../state/sessionStore';
import { createStreamCallbacks } from './streamToolManager';

export function formatErrorMessage(rawErr: string): string {
  if (!rawErr) return 'An unexpected error occurred during execution.';
  const match = rawErr.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  const inner = match ? match[1] : null;
  if (rawErr.includes('404') || (inner && inner.toLowerCase().includes('unavailable'))) return inner || 'The requested service or route is temporarily unavailable. Please try again shortly.';
  if (rawErr.includes('429') || rawErr.toLowerCase().includes('rate limit') || rawErr.toLowerCase().includes('quota')) return inner || 'Plan token quota reached. Please wait for your renewal window or upgrade tier.';
  if (rawErr.includes('401') || rawErr.toLowerCase().includes('unauthorized')) return 'API authentication failed. Please sign in to your MASH account.';
  if (inner) return inner;
  const cleaned = rawErr.replace(/^(Error:\s*)+/i, '').trim();
  return cleaned.length > 200 ? cleaned.slice(0, 197) + '...' : cleaned;
}

export function classifyDisconnectError(err: any): string {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const isFetch = err?.name === 'TypeError' || String(err?.message || '').toLowerCase().includes('failed to fetch') || String(err?.message || '').toLowerCase().includes('networkerror');
  if (isOffline) return 'Network connection lost (WiFi disconnected). Reconnection timed out. Agent execution terminated.';
  if (isFetch) return 'Network connection interrupted or backend server unreachable. Could not reconnect within time. Agent execution terminated.';
  return formatErrorMessage(err?.message || String(err));
}

export function prepareRetryMessages(
  messages: Message[], activeTurnId?: string | null, activeSid?: string
): { updatedMessages: Message[]; targetTurnId: string } {
  const targetIdx = findTargetAssistantIdx(messages);
  const startNow = Date.now();
  if (targetIdx >= 0) {
    const next = [...messages];
    const existingTurnId = next[targetIdx].turnId || activeTurnId || `turn_${startNow}_${Math.random().toString(36).slice(2, 6)}`;
    next[targetIdx] = {
      role: 'assistant', turnId: existingTurnId, status: 'running', content: '', thoughts: [], tools: [], tasks: [], steps: [], error: undefined, sessionId: activeSid, turnStartTime: startNow,
    };
    return { updatedMessages: next, targetTurnId: existingTurnId };
  }
  const fallbackTurnId = activeTurnId || `turn_${startNow}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    updatedMessages: [...messages, { role: 'assistant', turnId: fallbackTurnId, status: 'running', content: '', thoughts: [], tools: [], tasks: [], steps: [], sessionId: activeSid, turnStartTime: startNow }],
    targetTurnId: fallbackTurnId,
  };
}

export function prepareResumeMessages(messages: Message[], activeTurnId?: string | null): { updatedMessages: Message[]; targetTurnId: string } {
  const targetIdx = findTargetAssistantIdx(messages, activeTurnId);
  const fallbackTurnId = activeTurnId || `turn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  if (targetIdx >= 0) {
    const next = [...messages];
    next[targetIdx] = { ...next[targetIdx], status: 'running' };
    return { updatedMessages: next, targetTurnId: next[targetIdx].turnId || fallbackTurnId };
  }
  return { updatedMessages: messages, targetTurnId: fallbackTurnId };
}

export function prepareSteerTurn(messages: Message[]): Message[] {
  return messages.map((m) => {
    let updated = m;
    if (m.role === 'assistant' && (m.status === 'running' || m.error)) updated = { ...updated, error: undefined, status: 'completed' as const };
    if (m.tools && m.tools.some((t) => t.status === 'pending_approval' && !t.decision)) {
      updated = {
        ...updated,
        tools: m.tools.map((t) => t.status === 'pending_approval' && !t.decision ? { ...t, status: 'failed' as const, decision: 'deny' as const } : t),
      };
    }
    return updated;
  });
}

export function prepareTurnMessages(
  messages: Message[],
  options: { isResume?: boolean; isRetry?: boolean; userText: string; turnId: string; activeSid?: string }
): { updatedMessages: Message[]; targetTurnId: string } {
  if (options.isResume) return prepareResumeMessages(messages, options.turnId);
  if (options.isRetry) return prepareRetryMessages(messages, options.turnId, options.activeSid);
  const startNow = Date.now();
  const currentStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return {
    updatedMessages: [
      ...messages,
      { id: `msg_u_${startNow}`, turnId: options.turnId, status: 'completed', role: 'user', content: options.userText, timestamp: currentStamp, thoughts: [], tools: [], tasks: [], sessionId: options.activeSid },
      { id: `msg_a_${startNow}`, turnId: options.turnId, status: 'running', role: 'assistant', content: '', thoughts: [], tools: [], tasks: [], steps: [], sessionId: options.activeSid, turnStartTime: startNow },
    ],
    targetTurnId: options.turnId,
  };
}

export function computeUndoMessages(messages: Message[], flatIdx?: number): Message[] {
  if (typeof flatIdx === 'number') return messages.slice(0, flatIdx);
  let removeCount = 0;
  if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') removeCount++;
  if (messages.length > removeCount && messages[messages.length - 1 - removeCount].role === 'user') removeCount++;
  return messages.slice(0, messages.length - removeCount);
}

export function applyStreamError(messages: Message[], activeTurnId: string | null, errorText: string, errorId?: string): Message[] {
  const next = [...messages];
  const idx = findTargetAssistantIdx(next, activeTurnId);
  if (idx >= 0 && next[idx].status !== 'aborted') {
    next[idx] = { ...next[idx], status: 'error', error: errorText, ...(errorId ? { errorId } : {}) };
  }
  return next;
}

export function applyStreamAbort(messages: Message[], activeTurnId: string | null, turnStartTime: number): Message[] {
  const elapsed = turnStartTime > 0 ? Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)) : undefined;
  const next = [...messages];
  const targetIdx = findTargetAssistantIdx(next, activeTurnId);
  if (targetIdx >= 0) {
    next[targetIdx] = { ...next[targetIdx], status: 'aborted', totalDurationSeconds: elapsed ?? next[targetIdx].totalDurationSeconds };
  }
  return next;
}

export function applyStreamCompletion(messages: Message[], activeTurnId: string | null, wasUserAborted: boolean, turnStartTime: number): Message[] {
  const totalElapsed = turnStartTime > 0 ? Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)) : undefined;
  const next = [...messages];
  const idx = findTargetAssistantIdx(next, activeTurnId);
  if (idx >= 0 && next[idx].status !== 'aborted' && next[idx].status !== 'error') {
    next[idx] = { ...next[idx], status: wasUserAborted ? 'aborted' : 'completed', totalDurationSeconds: totalElapsed ?? next[idx].totalDurationSeconds };
  }
  return next;
}

export function finalizeStreamSession(activeSid: string): { updatedMessages: Message[]; nextQueuedMsg: string | null } {
  const s = sessionStore.get(activeSid);
  let nextQueuedMsg: string | null = null;
  let updatedMessages: Message[] = [];
  if (s) {
    s.isStreaming = false;
    s.abortController = null;
    s.chatMessages = applyStreamCompletion(s.chatMessages, s.activeTurnId, !!s.wasUserAborted, s.turnStartTime);
    updatedMessages = s.chatMessages;
    const wasAborted = s.wasUserAborted;
    const hasPending = s.chatMessages.some((m) => m.tools?.some((t) => t.status === 'pending_approval' && !t.decision));
    if (!wasAborted && !hasPending && s.queuedMessages?.length) {
      nextQueuedMsg = s.queuedMessages.shift() || null;
      s.queuedMessage = s.queuedMessages[0] || null;
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mash:turn_completed', { detail: { sessionId: activeSid } }));
  notifyStoreListeners();
  markSessionViewed(activeSid).catch(() => {});
  return { updatedMessages, nextQueuedMsg };
}

export function resolveActiveSession(
  targetSessionId: string | undefined, currentSid: string | null, sessionIdProp: string | null, userText: string,
  skipNew: boolean, onCreated: (id: string, title?: string, repo?: string) => void, repo?: string
): { activeSid: string; isNewSession: boolean; title: string } {
  const isExisting = Boolean(currentSid || sessionIdProp);
  const isNewSession = !skipNew && !isExisting;
  let activeSid = targetSessionId || currentSid || sessionIdProp || '';
  if (isNewSession && !activeSid) {
    const randSuffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 10) : Math.random().toString(36).slice(2, 10);
    activeSid = `sess_${Date.now().toString(36)}_${randSuffix}`;
  }
  const title = generateCleanSessionTitle(userText || 'Resumed Turn', activeSid);
  if (isNewSession) {
    onCreated(activeSid, title, repo);
    renameSession(activeSid, title).catch(() => {});
  }
  return { activeSid, isNewSession, title };
}

export function stopSessionStream(curSid: string): Message[] {
  const s = sessionStore.get(curSid);
  if (!s || !s.isStreaming) return [];
  s.wasUserAborted = true;
  s.isStreaming = false;
  s.chatMessages = applyStreamAbort(s.chatMessages, s.activeTurnId, s.turnStartTime);
  notifyStoreListeners();
  const ctrl = s.abortController;
  s.abortController = null;
  ctrl?.abort();
  safeFetch(`${BASE_URL}/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: curSid, user_id: 'default_user', force: true }),
  }).catch(() => {});
  return s.chatMessages;
}

export function executeSessionUndo(activeSid: string, flatIdx?: number, turnIdx?: number): Message[] | null {
  const s = sessionStore.get(activeSid);
  if (!s) return null;
  s.abortController?.abort();
  s.isStreaming = false;
  s.chatMessages = computeUndoMessages(s.chatMessages, flatIdx);
  notifyStoreListeners();
  safeFetch(`${BASE_URL}/sessions/${activeSid}/undo`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from_turn: turnIdx ?? 0 }),
  }).catch(() => {});
  return s.chatMessages;
}

export async function runChatStream(
  activeSid: string, userText: string,
  options: {
    isResume: boolean; signal?: AbortSignal; context: Record<string, any>; scheduleFlush: () => void; flushBuffer: () => void;
    onUpdateMessages: (msgs: Message[]) => void; onStreamEnd: () => void; scrollToBottom: () => void;
    onAutoDispatchQueue: (msg: string) => void; onSyncSteeringQueue?: (queue: string[]) => void;
  }
) {
  try {
    await streamQuery(
      activeSid, options.isResume ? '' : userText,
      createStreamCallbacks(activeSid, {
        scheduleFlush: options.scheduleFlush, flushBuffer: options.flushBuffer, onUpdateMessages: options.onUpdateMessages,
        onStreamError: (errText, errId) => {
          const s = sessionStore.get(activeSid);
          if (!s) return;
          options.flushBuffer();
          s.chatMessages = applyStreamError(s.chatMessages, s.activeTurnId, errText, errId);
          s.isStreaming = false;
          s.abortController = null;
          options.onUpdateMessages(s.chatMessages);
          options.onStreamEnd();
          notifyStoreListeners();
        },
        onToolCallRender: options.scrollToBottom,
      }),
      options.context, options.signal
    );
  } catch (err: any) {
    console.warn('Stream exception:', err);
    const s = sessionStore.get(activeSid);
    if (s) {
      s.chatMessages = applyStreamError(s.chatMessages, s.activeTurnId, err?.message || 'Agent execution encountered an error.');
      options.onUpdateMessages(s.chatMessages);
    }
  } finally {
    const { updatedMessages, nextQueuedMsg } = finalizeStreamSession(activeSid);
    options.onUpdateMessages(updatedMessages);
    options.onStreamEnd();
    options.flushBuffer();
    const s = sessionStore.get(activeSid);
    if (s?.queuedMessages && options.onSyncSteeringQueue) options.onSyncSteeringQueue([...s.queuedMessages]);
    if (nextQueuedMsg) {
      removeSessionQueueItem(activeSid, 0).catch(() => {});
      setTimeout(() => options.onAutoDispatchQueue(nextQueuedMsg), 80);
    }
  }
}
