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

export function isSessionDeleted(sessionId: string): boolean {
  return deletedSessionIds.has(sessionId);
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
  try {
    const params = new URLSearchParams();
    if (limit > 0) params.set("limit", limit.toString());
    if (shallowTools) params.set("shallow_tools", "true");
    if (offset > 0) params.set("offset", offset.toString());
    const qs = params.toString() ? `?${params.toString()}` : "";
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/transcript${qs}`);
    if (!res.ok) return { lines: [], total: 0 };
    const data = await res.json();
    return { lines: data.lines || [], total: data.total || 0 };
  } catch {
    return { lines: [], total: 0 };
  }
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

export async function deleteSession(sessionId: string): Promise<boolean> {
  markSessionDeleted(sessionId);
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to delete session:", err);
    return false;
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

export async function fetchSessionQueue(
  sessionId: string
): Promise<{ session_id: string; queued: string[]; count: number }> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/queue`);
    if (!res.ok) return { session_id: sessionId, queued: [], count: 0 };
    return await res.json();
  } catch (err) {
    return { session_id: sessionId, queued: [], count: 0 };
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

export async function fetchSessionUploads(
  sessionId: string
): Promise<Array<{ name: string; path: string; size_bytes: number }>> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/uploads/${sessionId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.uploads || [];
  } catch (err) {
    console.warn("Failed to fetch uploads:", err);
    return [];
  }
}
