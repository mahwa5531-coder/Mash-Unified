// Agent SSE stream: POST /stream with event normalization (AG-UI protocol events).

import { BASE_URL } from './client';
import type { ToolCall } from '@/types/chat';

export interface StreamEventHandlers {
  onToken: (token: string) => void;
  onThought?: (thought: string) => void;
  onThinkingEnd?: () => void;
  onToolCall?: (tool: ToolCall) => void;
  onError?: (error: string, errorId?: string) => void;
}

// ponytail: normalize raw backend stack traces, 404s, and provider JSON envelopes into clean user notices
export function formatErrorMessage(rawErr: string): string {
  if (!rawErr) return "An unexpected error occurred during execution.";

  // Extract nested message from OpenAI / OpenRouter error payload string if present
  const innerMsgMatch = rawErr.match(/['"]message['"]:\s*['"]([^'"]+)['"]/);
  const innerMsg = innerMsgMatch ? innerMsgMatch[1] : null;

  if (rawErr.includes("404") || (innerMsg && innerMsg.toLowerCase().includes("unavailable"))) {
    return innerMsg || "The requested service or route is temporarily unavailable. Please try again shortly.";
  }
  if (rawErr.includes("429") || rawErr.toLowerCase().includes("rate limit") || rawErr.toLowerCase().includes("quota")) {
    return innerMsg || "Plan token quota reached. Please wait for your renewal window or upgrade tier.";
  }
  if (rawErr.includes("401") || rawErr.toLowerCase().includes("unauthorized")) {
    return "API authentication failed. Please sign in to your MASH account.";
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
  const onError = typeof handlers === 'object' ? handlers.onError : undefined;

  // Track raw argument buffers per tool_call_id
  const toolArgBuffers: Record<string, string> = {};
  const toolCallNames: Record<string, string> = {};
  const completedToolIds = new Set<string>();
  let currentRunId = "";

  const finalizeRunningTools = (status: "completed" | "cancelled" = "completed") => {
    if (!onToolCall) return;
    for (const callId of Object.keys(toolCallNames)) {
      if (!completedToolIds.has(callId)) {
        let finalArgs: Record<string, any> = {};
        try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
        onToolCall({
          id: callId,
          name: toolCallNames[callId],
          args: finalArgs,
          output: status === "cancelled" ? "Execution interrupted." : "Done.",
          status: status,
        });
        completedToolIds.add(callId);
      }
    }
  };

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    let response: Response | null = null;
    const MAX_CONNECT_ATTEMPTS = 6;
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      if (signal?.aborted) return;
      try {
        response = await fetch(`${BASE_URL}/stream`, {
          method: "POST",
          headers,
          signal,
          body: JSON.stringify({
            session_id: sessionId,
            messages: userMessage,
            context: context || {},
          }),
        });
        if (response.ok) break;
        if (response.status >= 500 && attempt < MAX_CONNECT_ATTEMPTS) {
          const backoff = Math.min(1000 * Math.pow(1.5, attempt), 8000);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      } catch (fetchErr: any) {
        if (signal?.aborted) return;
        if (attempt === MAX_CONNECT_ATTEMPTS) {
          throw fetchErr;
        }
        const backoff = Math.min(1000 * Math.pow(1.5, attempt), 8000);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }

    if (!response) return;

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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        // Terminal SSE protocol sentinel frame ([DONE] or [END])
        if (jsonStr === "[DONE]" || jsonStr === "[END]") {
          break;
        }

        try {
          const event = JSON.parse(jsonStr);
          const eventType = String(event.type || "").toUpperCase();
          const data = event.data && typeof event.data === "object" ? event.data : {};
          if (event.run_id || data.run_id) {
            currentRunId = String(event.run_id || data.run_id);
          }

          // 1. Text token delta (the main assistant output)
          if (eventType === "TEXT_MESSAGE_CONTENT" || eventType === "TEXT_MESSAGE_CHUNK") {
            const rawToken = event.delta ?? data.delta ?? event.content ?? data.content ?? "";
            if (typeof rawToken === "string" && rawToken) {
              if (/^\[?(DONE|END)\]?$/i.test(rawToken.trim())) continue;
              const tokenText = rawToken.replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '');
              if (tokenText) onToken(tokenText);
            }
          }

          // 2. Thinking/Reasoning deltas — CONTENT events
          else if (
            eventType === "THINKING_TEXT_MESSAGE_CONTENT" ||
            eventType === "REASONING_MESSAGE_CONTENT" ||
            eventType === "REASONING_MESSAGE_CHUNK"
          ) {
            const rawThought = event.delta ?? data.delta ?? event.content ?? data.content ?? "";
            if (typeof rawThought === "string" && rawThought) {
              if (/^\[?(DONE|END)\]?$/i.test(rawThought.trim())) continue;
              const thoughtText = rawThought.replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '');
              if (thoughtText && onThought) onThought(thoughtText);
            }
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
            const rawId = String(event.tool_call_id || data.tool_call_id || data.id || `tc_${Date.now()}`);
            const callId = `${event.run_id || data.run_id || currentRunId || 'run'}_${rawId}`;
            const toolName = event.tool_call_name || data.tool_call_name || event.name || data.name || "action";
            toolArgBuffers[callId] = "";
            toolCallNames[callId] = toolName;
            if (onToolCall) {
              onToolCall({ id: callId, name: toolName, args: {}, status: "running" });
            }
          }

          // 4. Tool Call Args — streamed JSON chunks for the arguments
          else if (eventType === "TOOL_CALL_ARGS") {
            const rawId = String(event.tool_call_id || data.tool_call_id || data.id || "");
            const callId = `${event.run_id || data.run_id || currentRunId || 'run'}_${rawId}`;
            const deltaArg = event.delta ?? data.delta ?? event.arguments ?? data.arguments ?? "";
            if (callId && deltaArg) {
              toolArgBuffers[callId] = (toolArgBuffers[callId] || "") + deltaArg;
              let parsedArgs: Record<string, any> = {};
              try { parsedArgs = JSON.parse(toolArgBuffers[callId]); } catch { /* still buffering */ }
              if (onToolCall) {
                const currentName = toolCallNames[callId] || event.tool_call_name || data.tool_call_name || "action";
                onToolCall({ id: callId, name: currentName, args: parsedArgs, status: "running" });
              }
            }
          }

          // 5. Tool Call End — args fully streamed, finalize
          else if (eventType === "TOOL_CALL_END") {
            const rawId = String(event.tool_call_id || data.tool_call_id || data.id || "");
            const callId = `${event.run_id || data.run_id || currentRunId || 'run'}_${rawId}`;
            if (callId && onToolCall) {
              let finalArgs: Record<string, any> = {};
              try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
              const currentName = toolCallNames[callId] || event.tool_call_name || data.tool_call_name || "action";
              onToolCall({ id: callId, name: currentName, args: finalArgs, status: "running" });
            }
          }

          // 6. Tool Call Result — the output/response from the tool execution
          else if (eventType === "TOOL_CALL_RESULT") {
            const rawId = String(event.tool_call_id || data.tool_call_id || data.id || "");
            const callId = `${event.run_id || data.run_id || currentRunId || 'run'}_${rawId}`;
            // Backend field is `content` (not `output`)
            const rawOutput = event.content ?? data.content ?? event.output ?? data.output ?? event.result ?? data.result ?? "";
            const outputStr = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput, null, 2);
            if (callId && onToolCall) {
              let finalArgs: Record<string, any> = {};
              try { finalArgs = JSON.parse(toolArgBuffers[callId] || "{}"); } catch { /* noop */ }
              const currentName = toolCallNames[callId] || event.tool_call_name || data.tool_call_name || "action";
              const isFailed = Boolean(
                event.is_error ||
                data.is_error ||
                event.status === "failed" ||
                data.status === "failed" ||
                /^(error|exception|validationerror|failed):/i.test(outputStr.trim()) ||
                outputStr.toLowerCase().includes("schema validation failed") ||
                outputStr.toLowerCase().includes("validation error")
              );

              onToolCall({
                id: callId,
                name: currentName,
                args: finalArgs,
                output: outputStr || "Done.",
                status: isFailed ? "failed" : "completed",
                durationSeconds: event.duration_seconds ?? data.duration_seconds,
              });
              completedToolIds.add(callId);
            }
          }

          // 6b. Tool Call Pending Approval (RFC-0019 permissions)
          else if (eventType === "TOOL_CALL_PENDING_APPROVAL") {
            const rawId = String(event.tool_call_id || data.tool_call_id || data.id || `tc_${Date.now()}`);
            const callId = `${event.run_id || data.run_id || currentRunId || 'run'}_${rawId}`;
            const toolName = event.tool_name || data.tool_name || "action";
            const params = event.parameters || data.parameters || {};
            completedToolIds.add(callId);
            if (onToolCall) {
              onToolCall({
                id: callId,
                name: toolName,
                args: params,
                status: "pending_approval",
                toolSummary: params.toolSummary || event.prompt || data.prompt,
                toolAction: params.toolAction,
              });
            }
          }

          // 7. Run fully finished
          else if (eventType === "RUN_FINISHED") {
            // stream is done — finalize any in-flight running tools
            finalizeRunningTools("completed");
          }

          // 8. Errors — clean normalization avoiding raw JSON envelope dumps in chat
          else if (eventType === "RUN_ERROR" || eventType === "TRANSPORT_ERROR") {
            finalizeRunningTools("cancelled");
            const errStr = event.message || data.message || event.error_message || data.error_message || data.error || "Unknown error";
            const formatted = formatErrorMessage(errStr);
            const errId = event.run_id || data.run_id || event.error_id || data.error_id || event.id;
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
    finalizeRunningTools("cancelled");
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
