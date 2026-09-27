// Client utility for communicating with the NexAU FastAPI backend

import { ToolCall, SubTask } from './parseTranscript';

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// ponytail: safeFetch retries once on transient network drops ONLY for idempotent methods (GET, HEAD)
// to prevent duplicate side-effects on POST/DELETE/PATCH mutations.
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';
  try {
    return await fetch(url, init);
  } catch {
    if (isIdempotent) {
      await new Promise((r) => setTimeout(r, 350));
      try {
        return await fetch(url, init);
      } catch {}
    }
    return new Response(JSON.stringify({ error: "Backend unavailable" }), {
      status: 503,
      statusText: "Backend unavailable",
      headers: { "Content-Type": "application/json" }
    });
  }
}

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

export interface WorkspaceNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: WorkspaceNode[];
}

export interface WorkspaceTreeResponse {
  workspace: WorkspaceNode[];
  scratch: WorkspaceNode[];
  artifacts: WorkspaceNode[];
  root: string;
}

export async function fetchWorkspaceTree(sessionId?: string): Promise<WorkspaceTreeResponse | null> {
  try {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    const res = await safeFetch(`${BASE_URL}/workspace/tree${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch workspace tree:", err);
    return null;
  }
}

// Client-side in-memory cache with LRU eviction: keeps active working-set tabs instantly accessible with 0ms network latency
const MAX_FILE_CACHE_SIZE = 25;
const fileContentMemoryCache = new Map<string, string>();
const inFlightFileFetches = new Map<string, Promise<string>>();

function cacheFileContent(cleanKey: string, content: string): void {
  if (fileContentMemoryCache.has(cleanKey)) {
    fileContentMemoryCache.delete(cleanKey);
  } else if (fileContentMemoryCache.size >= MAX_FILE_CACHE_SIZE) {
    const oldestKey = fileContentMemoryCache.keys().next().value;
    if (oldestKey) fileContentMemoryCache.delete(oldestKey);
  }
  fileContentMemoryCache.set(cleanKey, content);
}

export function getFileContentFromCache(filePath: string): string | undefined {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  return fileContentMemoryCache.get(cleanKey);
}

export function setFileContentInCache(filePath: string, content: string): void {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  cacheFileContent(cleanKey, content);
}

export async function fetchFileContent(filePath: string, sessionId?: string): Promise<string> {
  const cleanKey = decodeURIComponent((filePath || '').replace(/^file:\/\/\/?/i, '')).replace(/^\/([a-zA-Z]:)/, '$1').replace(/\\/g, '/').split('#')[0];
  if (fileContentMemoryCache.has(cleanKey)) {
    return fileContentMemoryCache.get(cleanKey)!;
  }
  if (inFlightFileFetches.has(cleanKey)) {
    return inFlightFileFetches.get(cleanKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const qs = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';
      const res = await safeFetch(`${BASE_URL}/files/content?path=${encodeURIComponent(cleanKey)}${qs}`);
      if (!res.ok) return "Failed to load file content.";
      const data = await res.json();
      if (data.type === 'excel' || data.type === 'univer') {
        const serialized = JSON.stringify(data);
        cacheFileContent(cleanKey, serialized);
        return serialized;
      }
      const content = data.content !== undefined ? data.content : "";
      if (data.error || content.includes('not found on local disk')) {
        return content || "File not found on local disk.";
      }
      cacheFileContent(cleanKey, content);
      return content;
    } catch (err) {
      console.warn("Failed to fetch file content:", err);
      return "Error fetching file content.";
    } finally {
      inFlightFileFetches.delete(cleanKey);
    }
  })();

  inFlightFileFetches.set(cleanKey, fetchPromise);
  return fetchPromise;
}

export async function fetchExcelData(
  filePath: string,
  sheet?: string,
  page: number = 0,
  pageSize: number = 200
): Promise<any> {
  try {
    let url = `${BASE_URL}/files/content?path=${encodeURIComponent(filePath)}&page=${page}&page_size=${pageSize}`;
    if (sheet) url += `&sheet=${encodeURIComponent(sheet)}`;
    const res = await safeFetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch Excel data:", err);
    return null;
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

export interface UploadItem {
  name: string;
  path: string;
  size_bytes?: number;
  created_at?: string;
}

export async function fetchUploads(sessionId: string): Promise<UploadItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/uploads/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.uploads || [];
  } catch (err) {
    console.warn("Failed to fetch uploads:", err);
    return [];
  }
}

export interface ArtifactFileItem {
  name: string;
  path: string;
  type: 'walkthrough' | 'plan' | 'doc' | 'code';
}

export async function fetchSessionArtifacts(sessionId: string): Promise<ArtifactFileItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/artifacts/session/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const files: string[] = data.files || [];
    const brainDir: string = data.brain_directory || '';
    return files.map(f => {
      const lower = f.toLowerCase();
      let type: 'walkthrough' | 'plan' | 'doc' | 'code' = 'doc';
      if (lower.includes('walkthrough')) type = 'walkthrough';
      else if (lower.includes('plan')) type = 'plan';
      else if (/\.(py|ts|tsx|js|sql|sh|ps1)$/.test(lower)) type = 'code';
      return {
        name: f,
        path: brainDir ? `${brainDir}/${f}`.replace(/\\/g, '/') : f,
        type,
      };
    });
  } catch (err) {
    console.warn("Failed to fetch session artifacts:", err);
    return [];
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

export async function approvePlan(
  sessionId: string,
  action: "proceed" | "reject",
  feedback?: string,
  executionMode: string = "MANUAL_APPROVAL"
): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        action,
        feedback,
        execution_mode: executionMode,
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to submit plan approval:", err);
    return false;
  }
}

export interface StreamEventHandlers {
  onToken: (token: string) => void;
  onThought?: (thought: string) => void;
  onThinkingEnd?: () => void;
  onToolCall?: (tool: ToolCall) => void;
  onTasks?: (tasks: SubTask[]) => void;
  onError?: (error: string, errorId?: string) => void;
}

// ponytail: normalize raw backend stack traces, 404s, and provider JSON envelopes into clean user notices
export function formatErrorMessage(rawErr: string): string {
  if (!rawErr) return "An unexpected error occurred during execution.";

  // Extract nested message from OpenAI / OpenRouter error payload string if present
  const innerMsgMatch = rawErr.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  const innerMsg = innerMsgMatch ? innerMsgMatch[1] : null;

  if (rawErr.includes("404") || (innerMsg && innerMsg.toLowerCase().includes("unavailable"))) {
    return innerMsg || "The selected model is unavailable or has been deprecated. Please switch to an available model.";
  }
  if (rawErr.includes("429") || rawErr.toLowerCase().includes("rate limit") || rawErr.toLowerCase().includes("quota")) {
    return innerMsg || "Rate limit or token quota exceeded. Please switch models or try again shortly.";
  }
  if (rawErr.includes("401") || rawErr.toLowerCase().includes("unauthorized")) {
    return "API authentication failed. Please verify provider credentials or gateway key.";
  }
  if (innerMsg) {
    return innerMsg;
  }
  const cleaned = rawErr.replace(/^(Error:\s*)+/i, '').trim();
  return cleaned.length > 200 ? cleaned.slice(0, 197) + '...' : cleaned;
}

export async function streamQuery(
  sessionId: string,
  userMessage: string,
  handlers: ((token: string) => void) | StreamEventHandlers,
  context?: Record<string, any>,
  signal?: AbortSignal
): Promise<void> {
  const onToken = typeof handlers === 'function' ? handlers : handlers.onToken;
  const onThought = typeof handlers === 'object' ? handlers.onThought : undefined;
  const onThinkingEnd = typeof handlers === 'object' ? handlers.onThinkingEnd : undefined;
  const onToolCall = typeof handlers === 'object' ? handlers.onToolCall : undefined;
  const onTasks = typeof handlers === 'object' ? handlers.onTasks : undefined;
  const onError = typeof handlers === 'object' ? handlers.onError : undefined;

  // Track raw argument buffers per tool_call_id
  const toolArgBuffers: Record<string, string> = {};
  const toolCallNames: Record<string, string> = {};
  let isStalled = false;

  try {
    const response = await fetch(`${BASE_URL}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        session_id: sessionId,
        messages: userMessage,
        context: context || {},
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      let msg = `Server error (HTTP ${response.status})`;
      try {
        const parsed = JSON.parse(errText);
        if (parsed.detail) msg = parsed.detail;
      } catch {}
      throw new Error(msg);
    }

    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // ponytail: 5-minute stall watchdog — gives long tool commands (builds/tests) ample time
    // Server emits SSE : keepalive comments every 15s; this watchdog only trips if the link is truly dead.
    const STREAM_IDLE_TIMEOUT_MS = 300000;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    isStalled = false;

    const resetStallWatchdog = () => {
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        isStalled = true;
        try { reader.cancel(); } catch {}
      }, STREAM_IDLE_TIMEOUT_MS);
    };

    resetStallWatchdog();

    try {
      while (true) {
        const { done, value } = await reader.read();
        resetStallWatchdog();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);
          const eventType = String(event.type || "").toUpperCase();

          // 1. Text token delta (the main assistant output)
          if (eventType === "TEXT_MESSAGE_CONTENT" || eventType === "TEXT_MESSAGE_CHUNK") {
            const tokenText = event.delta || "";
            if (tokenText) onToken(tokenText);
          }

          // 2. Thinking/Reasoning deltas — CONTENT events
          else if (
            eventType === "THINKING_TEXT_MESSAGE_CONTENT" ||
            eventType === "REASONING_MESSAGE_CONTENT" ||
            eventType === "REASONING_MESSAGE_CHUNK"
          ) {
            const thoughtText = event.delta || "";
            if (thoughtText && onThought) onThought(thoughtText);
          }

          // 2b. Thinking/Reasoning Completed
          else if (
            eventType === "THINKING_TEXT_MESSAGE_END" ||
            eventType === "REASONING_MESSAGE_END"
          ) {
            if (onThinkingEnd) onThinkingEnd();
          }

          // 3. Tool Call Started — name + id become available here
          else if (eventType === "TOOL_CALL_START") {
            const rawId = String(event.tool_call_id || `tc_${Date.now()}`);
            const callId = `${event.run_id || 'run'}_${rawId}`;
            const toolName = event.tool_call_name || "action";
            toolArgBuffers[callId] = "";
            toolCallNames[callId] = toolName;
            if (onToolCall) {
              onToolCall({ id: callId, name: toolName, args: {}, status: "running" });
            }
          }

          // 4. Tool Call Args — streamed JSON chunks for the arguments
          else if (eventType === "TOOL_CALL_ARGS") {
            const rawId = String(event.tool_call_id || "");
            const callId = `${event.run_id || 'run'}_${rawId}`;
            const deltaArg = event.delta || "";
            if (callId && deltaArg) {
              toolArgBuffers[callId] = (toolArgBuffers[callId] || "") + deltaArg;
              let parsedArgs: Record<string, any> = {};
              try { parsedArgs = JSON.parse(toolArgBuffers[callId]); } catch { /* still buffering */ }
              if (onToolCall) {
                const currentName = toolCallNames[callId] || event.tool_call_name || "action";
                onToolCall({ id: callId, name: currentName, args: parsedArgs, status: "running" });
              }
            }
          }

          // 5. Tool Call End — args fully streamed, finalize
          else if (eventType === "TOOL_CALL_END") {
            const rawId = String(event.tool_call_id || "");
            const callId = `${event.run_id || 'run'}_${rawId}`;
            if (callId && onToolCall) {
              let finalArgs: Record<string, any> = {};
              try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
              const currentName = toolCallNames[callId] || event.tool_call_name || "action";
              onToolCall({ id: callId, name: currentName, args: finalArgs, status: "running" });
            }
          }

          // 6. Tool Call Result — the output/response from the tool execution
          else if (eventType === "TOOL_CALL_RESULT") {
            const rawId = String(event.tool_call_id || "");
            const callId = `${event.run_id || 'run'}_${rawId}`;
            // Backend field is `content` (not `output`)
            const rawOutput = event.content ?? event.output ?? event.result ?? "";
            const outputStr = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2);
            if (callId && onToolCall) {
              let finalArgs: Record<string, any> = {};
              try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
              const currentName = toolCallNames[callId] || event.tool_call_name || "action";
              onToolCall({
                id: callId,
                name: currentName,
                args: finalArgs,
                output: outputStr || "Done.",
                status: "completed",
                durationSeconds: event.duration_seconds,
              });
            }
          }

          // 6b. Background Tasks Updated
          else if (
            eventType === "TASKS_UPDATED" ||
            eventType === "TASKS" ||
            eventType === "TASK_UPDATE" ||
            eventType === "BACKGROUND_TASKS"
          ) {
            const rawTasks = event.tasks || event.data || [];
            if (onTasks && Array.isArray(rawTasks)) {
              onTasks(rawTasks);
            }
          }

          // 7. Run fully finished
          else if (eventType === "RUN_FINISHED") {
            // stream is done, nothing to do — reader.done will handle it
          }

          // 8. Errors — clean normalization avoiding raw JSON envelope dumps in chat
          else if (eventType === "RUN_ERROR" || eventType === "TRANSPORT_ERROR") {
            const errStr = event.message || event.error_message || "Unknown error";
            const formatted = formatErrorMessage(errStr);
            const errId = event.run_id || event.error_id || event.id;
            if (onError) {
              onError(formatted, errId);
            } else {
              onToken(`\n\n⚠️ ${formatted}`);
            }
          }
        } catch {
          // Malformed JSON line — skip silently
        }
      }
    }
  } finally {
    if (stallTimer !== null) clearTimeout(stallTimer);
  }

  if (isStalled) {
    throw new Error("Stream connection timed out: no data received from server. Network link may have been interrupted.");
  }
} catch (err: any) {
    if (signal?.aborted) return; // User stopped the stream intentionally
    console.warn("Error streaming query:", err);

    // ponytail: Detect WiFi / network disconnection with clear status messages
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const isFetchErr = err?.name === "TypeError" || 
      String(err?.message || "").toLowerCase().includes("failed to fetch") ||
      String(err?.message || "").toLowerCase().includes("networkerror");

    let formatted: string;

    if (isOffline) {
      formatted = "Network connection lost (WiFi disconnected). Reconnection timed out. Agent execution terminated.";
    } else if (isFetchErr) {
      formatted = "Network connection interrupted or backend server unreachable. Could not reconnect within time. Agent execution terminated.";
    } else if (isStalled) {
      formatted = "Stream connection timed out: no response from server within timeout. Agent execution terminated.";
    } else {
      formatted = formatErrorMessage(err?.message || String(err));
    }

    if (onError) {
      onError(formatted);
    } else {
      onToken(`\n\n⚠️ ${formatted}`);
    }
  }
}

export function formatRelativeTime(timestamp: number | string | null | undefined): string {
  if (!timestamp) return "now";
  let time: number;
  if (typeof timestamp === "number") {
    time = timestamp > 1e11 ? timestamp : timestamp * 1000;
  } else {
    let str = String(timestamp).trim();
    // Normalize space separator to 'T'
    str = str.replace(" ", "T");
    // If no timezone specified, assume UTC if ISO format
    if (str.length >= 19 && !str.endsWith("Z") && !str.includes("+") && !str.includes("-", 10)) {
      str += "Z";
    }
    time = new Date(str).getTime();
    if (isNaN(time)) {
      time = new Date(String(timestamp)).getTime();
    }
  }
  if (isNaN(time)) return "now";

  const diffMs = Date.now() - time;
  if (diffMs < 0) return "now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

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

export async function clearSessionQueue(
  sessionId: string
): Promise<{ status: string; session_id: string; count: number }> {
  try {
    const res = await safeFetch(`${BASE_URL}/sessions/${sessionId}/queue`, {
      method: "DELETE",
    });
    if (!res.ok) return { status: "error", session_id: sessionId, count: 0 };
    return await res.json();
  } catch (err) {
    return { status: "error", session_id: sessionId, count: 0 };
  }
}

const TITLE_ACRONYMS = new Set([
  'MCP', 'API', 'PDF', 'CPA', 'DB', 'AI', 'UI', 'UX', 'JSON', 
  'REST', 'SQL', 'AGI', 'LLM', 'OS', 'CLI', 'SDK', 'URL', 'HTTP', 'HTML', 'CSS', 'RAM', 'CPU', 'GPU'
]);

const TITLE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'with'
]);

export function toTitleCase(str: string): string {
  if (!str) return '';
  if (str.length > 1 && str === str.toUpperCase() && !str.includes(' ')) {
    return str;
  }
  const words = str.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => {
      const cleanWord = word.replace(/[^a-zA-Z0-9_-]/g, '');
      const upper = cleanWord.toUpperCase();
      if (TITLE_ACRONYMS.has(upper)) {
        return word.replace(cleanWord, upper);
      }
      const lower = cleanWord.toLowerCase();
      if (index > 0 && TITLE_MINOR_WORDS.has(lower)) {
        return word.replace(cleanWord, lower);
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function truncateAtWordBoundary(str: string, maxLen = 32): string {
  if (str.length <= maxLen) return str;
  const sliced = str.slice(0, maxLen);
  const lastSpace = sliced.lastIndexOf(' ');
  if (lastSpace > 12) {
    return sliced.slice(0, lastSpace).trim() + '...';
  }
  return sliced.trim() + '...';
}

/**
 * ponytail: extracts clean, human-readable session titles from user prompts.
 * Formats in Title Case, preserves acronyms, and avoids cutting words in half.
 */
export function generateCleanSessionTitle(rawText: string, fallbackId = ''): string {
  if (!rawText || typeof rawText !== 'string') {
    return fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session';
  }

  let t = rawText.trim().replace(/^["'`\s]+|["'`\s]+$/g, '').trim();
  if (!t) {
    return fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session';
  }

  // 1. Detect leading file/folder path (e.g. "C:\Users\...\file.xlsx" or /path/to/file)
  const pathMatch = t.match(/^([a-zA-Z]:[\\/][^"'`\r\n]*|\/[^"'`\r\n]+)/);
  if (pathMatch) {
    const rawPath = pathMatch[1].trim().replace(/^["']+|["']+$/g, '');
    const remainder = t.slice(pathMatch[0].length).replace(/^["'`\s,:;\-]+/, '').trim();
    const basename = rawPath.split(/[\\/]/).filter(Boolean).pop() || rawPath;

    if (remainder) {
      const verbMatch = remainder.match(/^(?:please\s+|can you\s+|could you\s+|kindly\s+)?(analyse|analyze|review|fix|check|run|inspect|explain|read|summarize|test|process|plot|visualize|debug|load|parse|clean|convert)\b/i);
      if (verbMatch && verbMatch[1]) {
        const verb = toTitleCase(verbMatch[1]);
        const candidate = `${verb} ${toTitleCase(basename)}`;
        return truncateAtWordBoundary(candidate, 34);
      }

      let cleanRemainder = remainder
        .replace(/^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want you to\s+|i want to\s+|i need to\s+)+/i, '')
        .trim();

      if (cleanRemainder) {
        cleanRemainder = toTitleCase(cleanRemainder);
        const candidate = `${truncateAtWordBoundary(cleanRemainder, 20)} (${basename})`;
        return truncateAtWordBoundary(candidate, 34);
      }
    }
    return truncateAtWordBoundary(toTitleCase(basename), 34);
  }

  // 2. Legacy filesystem paths stored in DB (e.g. "C:\Projects\benchmark...")
  if (t.includes('\\') || (t.includes('/') && t.split('/').length > 2)) {
    const parts = t.split(/[\\/]/).filter(Boolean);
    if (parts.length > 1) {
      const last = parts.pop() || '';
      if (last.length > 2) {
        return truncateAtWordBoundary(toTitleCase(last.replace(/\.+$/, '')), 32);
      }
    }
  }

  // 3. Normal user message: strip polite opening filler and question fluff
  t = t.replace(/^(?:please\s+|can you\s+|could you\s+|kindly\s+|help me\s+(?:to\s+)?|i want you to\s+|i want to\s+|i need to\s+|tell me about\s+|tell me\s+|explain\s+|what do you know about\s+|what is\s+|how to\s+|how do i\s+|i think we have to\s+|look at this\s*[,:]?\s*)+/i, '').trim();

  // Strip trailing punctuation
  t = t.replace(/[?!.:;]+$/, '').trim();

  if (t) {
    t = toTitleCase(t);
  }

  return truncateAtWordBoundary(t, 32) || (fallbackId ? `Session ${fallbackId.slice(0, 8)}` : 'New Session');
}

export interface ProjectItem {
  id: string;
  name: string;
  local_folder_path: string;
  created_at?: string;
  session_count?: number;
}

export async function fetchProjects(): Promise<ProjectItem[]> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.projects || [];
  } catch {
    return [];
  }
}

export async function createProject(name: string, localFolderPath: string): Promise<ProjectItem | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, local_folder_path: localFolderPath }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to create project:", err);
    return null;
  }
}

export async function deleteProject(projectId: string): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.warn("Failed to delete project:", err);
    return false;
  }
}

export async function selectFolder(folderPath?: string): Promise<{
  status: string;
  folder_path: string | null;
  folder_name: string | null;
  detail?: string;
}> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/select-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(folderPath ? { folder_path: folderPath } : {}),
    });
    if (!res.ok) return { status: 'error', folder_path: null, folder_name: null };
    return await res.json();
  } catch (err) {
    console.warn("Failed to open folder dialog:", err);
    return { status: 'error', folder_path: null, folder_name: null };
  }
}

export async function getQuickstartFolder(): Promise<{
  status: string;
  folder_path: string;
  folder_name: string;
}> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/quickstart-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { status: 'error', folder_path: '', folder_name: 'Quickstart' };
    return await res.json();
  } catch (err) {
    return { status: 'error', folder_path: '', folder_name: 'Quickstart' };
  }
}

export async function resolveFolder(folderName: string, sampleChildren?: string[]): Promise<{
  status: string;
  folder_path: string;
  folder_name: string;
}> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/system/resolve-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_name: folderName, sample_children: sampleChildren }),
    });
    if (!res.ok) return { status: 'error', folder_path: '', folder_name: folderName };
    return await res.json();
  } catch (err) {
    console.warn("Failed to resolve folder:", err);
    return { status: 'error', folder_path: '', folder_name: folderName };
  }
}

export interface DirectoryBrowseResponse {
  current_path: string;
  parent_path: string | null;
  drives: string[];
  shortcuts: Array<{ name: string; path: string }>;
  directories: Array<{ name: string; path: string; is_hidden?: boolean }>;
}

export async function browseDirectories(path?: string): Promise<DirectoryBrowseResponse | null> {
  try {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    const res = await safeFetch(`${BASE_URL}/api/system/browse-directories${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to browse directories:", err);
    return null;
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

export interface AuthUser {
  authenticated: boolean;
  email?: string;
  name?: string;
  plan?: string;
  credits_remaining?: number;
  accounts?: Array<{
    email: string;
    name: string;
    plan: string;
    credits_remaining: number;
  }>;
}

export async function fetchAuthMe(): Promise<AuthUser | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/me`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to fetch auth state:", err);
    return null;
  }
}

export async function logoutUser(): Promise<boolean> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/logout`, { method: "POST" });
    return res.ok;
  } catch (err) {
    console.warn("Failed to logout:", err);
    return false;
  }
}

export interface LoginPayload {
  code?: string;
  email?: string;
  name?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_at?: number;
}

export async function loginUser(payload: LoginPayload): Promise<AuthUser | null> {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to login:", err);
    return null;
  }
}

