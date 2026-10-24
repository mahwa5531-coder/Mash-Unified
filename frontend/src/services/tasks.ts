// Background task log fetch.

import { BASE_URL, safeFetch } from './client';

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
