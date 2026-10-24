// Sessions: list/detail/transcript, rename/delete, viewed marks, steering queue, uploads.

import { BASE_URL, safeFetch } from './client';

export interface SessionItem {
  session_id: string;
  title: string;
  custom_title: string;
  workspace_uri: string;
  created_at: number | string;
  updated_at: number | string;
  message_count: number;
  total_tokens: number;
  last_user_view_time: number | string;
  has_unread: boolean;
  section?: 'workspace' | 'conversation';
}

// ponytail: Global deleted sessions tracking prevents background polling from resurrecting deleted sessions
export const deletedSessionIds = new Set<string>();

export function markSessionDeleted(sessionId: string): void {
  deletedSessionIds.add(sessionId);
}

export function unmarkSessionDeleted(sessionId: string): void {
  deletedSessionIds.delete(sessionId);
}

export async function fetchSessions(): Promise<SessionItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions`);
    if (!res.ok) return [];
    const data = await res.json();
    const rawSessions: SessionItem[] = data.sessions || [];
    return rawSessions.filter((s) => !deletedSessionIds.has(s.session_id));
  } catch {
    return [];
  }
}

export interface TranscriptResponse {
  lines: any[];
  total: number;
}

export async function fetchTranscript(
  sessionId: string, 
  limit: number = 30, 
  shallowTools: boolean = true,
  offset: number = 0
): Promise<TranscriptResponse> {
  const params = new URLSearchParams();
  if (limit > 0) params.set("limit", limit.toString());
  if (shallowTools) params.set("shallow_tools", "true");
  if (offset > 0) params.set("offset", offset.toString());
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/transcript${qs}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch transcript: ${res.status}`);
  }
  const data = await res.json();
  return { lines: data.lines || [], total: data.total || 0 };
}

export async function markSessionViewed(sessionId: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/view`, {
      method: "POST",
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to mark session viewed:", err);
    return false;
  }
}

export async function renameSession(sessionId: string, customTitle: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_title: customTitle }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to rename session:", err);
    return false;
  }
}

export interface DeleteSessionResult {
  success: boolean;
  message?: string;
}

export async function deleteSession(sessionId: string): Promise<DeleteSessionResult> {
  markSessionDeleted(sessionId);
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      unmarkSessionDeleted(sessionId);
      let errMsg = `Failed to delete session (${res.status})`;
      try {
        const data = await res.json();
        if (data.detail) errMsg = data.detail;
        else if (data.message) errMsg = data.message;
      } catch {}
      return { success: false, message: errMsg };
    }
    return { success: true };
  } catch (err: any) {
    unmarkSessionDeleted(sessionId);
    return { success: false, message: err?.message || "Network error while deleting session" };
  }
}

export async function queueSteeringMessage(
  sessionId: string,
  message: string
): Promise<{ status: string; total_queued?: number }> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
    });
    if (!res.ok) throw new Error(`Queue failed with status ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Failed to queue steering message:", err);
    return { status: "error" };
  }
}

export async function fetchSessionQueue(sessionId: string): Promise<string[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/queue`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.queued) ? data.queued : [];
  } catch (err) {
    console.warn("Failed to fetch session queue:", err);
    return [];
  }
}

export async function removeSessionQueueItem(sessionId: string, index?: number): Promise<boolean> {
  try {
    const url = index !== undefined
      ? `${BASE_URL}/sessions/${sessionId}/queue?index=${index}`
      : `${BASE_URL}/sessions/${sessionId}/queue`;
    const res = await safeFetch(url, { method: "DELETE" });
    return res.ok;
  } catch (err) {
    console.warn("Failed to remove session queue item:", err);
    return false;
  }
}

export async function uploadSessionFile(
  sessionId: string,
  file: File
): Promise<{ status: string; path: string } | null> {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await safeFetch(`${BASE_URL}/api/uploads/${sessionId}`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to upload file:", err);
    return null;
  }
}

export function cleanupSessionStorage(sessionId: string): void {
  const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return;
  try {
    for (const key of ['mash_pinned_sessions', 'nexau_pinned_sessions']) {
      const pinnedRaw = storage.getItem(key);
      if (pinnedRaw) {
        try {
          const pinned: string[] = JSON.parse(pinnedRaw);
          if (Array.isArray(pinned) && pinned.includes(sessionId)) {
            const updated = pinned.filter(id => id !== sessionId);
            storage.setItem(key, JSON.stringify(updated));
          }
        } catch {}
      }
    }

    for (const key of ['mash_archived_session_ids', 'nexau_archived_session_ids']) {
      const archivedRaw = storage.getItem(key);
      if (archivedRaw) {
        try {
          const archived: string[] = JSON.parse(archivedRaw);
          if (Array.isArray(archived) && archived.includes(sessionId)) {
            const updated = archived.filter(id => id !== sessionId);
            storage.setItem(key, JSON.stringify(updated));
          }
        } catch {}
      }
    }

    for (const key of ['mash_cached_sessions', 'nexau_cached_sessions']) {
      const cachedRaw = storage.getItem(key);
      if (cachedRaw) {
        try {
          const cached: SessionItem[] = JSON.parse(cachedRaw);
          if (Array.isArray(cached) && cached.some(s => s.session_id === sessionId)) {
            const updated = cached.filter(s => s.session_id !== sessionId);
            storage.setItem(key, JSON.stringify(updated));
          }
        } catch {}
      }
    }

    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (key.includes(sessionId) || key.startsWith(`draft_${sessionId}`))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  } catch {}
}
