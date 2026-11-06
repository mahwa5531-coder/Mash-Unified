import { useCallback, useRef, useState } from "react";
import type { AgentState, TeamStreamEnvelope, TeamStreamEnvelopeResponse } from "../types";
import { applyEnvelope } from "../state/applyEnvelope";

export type TeamStream = ReturnType<typeof useTeamStream>;

/**
 * ponytail: extracted unified SSE stream parser eliminating 30 lines of duplication
 * between startStream and subscribeToStream (R6b)
 */
export async function consumeSseStream(
  response: Response,
  onEnvelope: (envelope: TeamStreamEnvelope) => void,
  onError: (error: string) => void
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json) continue;

      try {
        const msg: TeamStreamEnvelopeResponse = JSON.parse(json);
        if (msg.type === "error") {
          onError(msg.error ?? "Stream error");
          return;
        }
        if (msg.type === "complete") {
          return;
        }
        if (msg.type === "team_event" && msg.envelope) {
          onEnvelope(msg.envelope);
        }
      } catch {
        // skip malformed JSON
      }
    }
  }
}

/** Hook for connecting to /team/stream SSE endpoint with history support. */
export function useTeamStream() {
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const activeSessionRef = useRef<{
    userId: string;
    sessionId: string;
  } | null>(null);

  /** Fetch and replay stored events from the backend. Returns the number of events loaded. */
  const loadHistory = useCallback(
    async (userId: string, sessionId: string): Promise<number> => {
      try {
        const url = `/team/history?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}`;
        const res = await fetch(url);
        if (!res.ok) {
          return 0;
        }
        const events: TeamStreamEnvelope[] = await res.json();
        if (!events.length) return 0;
        setAgents(() => {
          let state: Record<string, AgentState> = {};
          for (const envelope of events) {
            if (envelope.agent_id && envelope.event) {
              state = applyEnvelope(state, envelope);
            }
          }
          return state;
        });
        return events.length;
      } catch {
        return 0;
      }
    },
    []
  );

  const startStream = useCallback(
    async (message: string, userId: string, sessionId: string) => {
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      activeSessionRef.current = { userId, sessionId };
      setIsStreaming(true);
      setError(null);

      try {
        const response = await fetch("/team/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            message,
            user_id: userId,
            session_id: sessionId,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        await consumeSseStream(
          response,
          (envelope) => setAgents((prev) => applyEnvelope(prev, envelope)),
          (errMsg) => setError(errMsg)
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setIsStreaming(false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    []
  );

  const sendUserMessage = useCallback(
    async (
      content: string,
      userId: string,
      sessionId: string,
      toAgentId?: string
    ) => {
      try {
        const res = await fetch("/team/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content,
            user_id: userId,
            session_id: sessionId,
            to_agent_id: toAgentId,
          }),
        });
        if (!res.ok) {
          throw new Error(`Failed to send message: ${res.statusText}`);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    },
    []
  );

  const stopStream = useCallback(async (userId: string, sessionId: string) => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);

    try {
      await fetch("/team/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, session_id: sessionId }),
      });
    } catch {
      // abort locally even if server call fails
    }
  }, []);

  const subscribeToStream = useCallback(
    async (userId: string, sessionId: string, lastEventId: number) => {
      abortRef.current?.abort();

      const controller = new AbortController();
      abortRef.current = controller;
      activeSessionRef.current = { userId, sessionId };
      setIsStreaming(true);
      setError(null);

      try {
        const url = `/team/stream?user_id=${encodeURIComponent(userId)}&session_id=${encodeURIComponent(sessionId)}&last_event_id=${lastEventId}`;
        const response = await fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 404) {
            setIsStreaming(false);
            return;
          }
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        await consumeSseStream(
          response,
          (envelope) => setAgents((prev) => applyEnvelope(prev, envelope)),
          (errMsg) => setError(errMsg)
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        if (abortRef.current === controller) {
          setIsStreaming(false);
          activeSessionRef.current = null;
        }
      }
    },
    []
  );

  return {
    agents,
    setAgents,
    isStreaming,
    error,
    startStream,
    sendUserMessage,
    stopStream,
    loadHistory,
    subscribeToStream,
  };
}
