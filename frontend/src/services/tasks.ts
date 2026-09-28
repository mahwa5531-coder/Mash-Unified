// Background tasks: list/kill + task log fetch.

import { BASE_URL, safeFetch } from './client';

export interface BackgroundTaskItem {
  pid: number;
  command: string;
  status: 'running' | 'completed' | 'failed';
  duration_ms?: number;
  cwd?: string;
}

export async function fetchBackgroundTasks(sessionId?: string): Promise<BackgroundTaskItem[]> {
  try {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    const res = await safeFetch(`${BASE_URL}/api/tasks${qs}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.tasks || [];
  } catch (err) {
    return [];
  }
}

export async function killBackgroundTask(pid: number): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/tasks/${pid}/kill`, {
      method: 'POST'
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function fetchTaskLog(taskId: string): Promise<string> {
  try {
    const res = await safeFetch(`${BASE_URL}/tasks/${taskId}/log`);
    if (!res.ok) return "Failed to load task log.";
    const data = await res.json();
    return data.content || "";
  } catch (err) {
    console.warn("Failed to fetch task log:", err);
    return "Error fetching task log.";
  }
}
