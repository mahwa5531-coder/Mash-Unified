// In-flight tool calls, args buffering, cleanup, and approval manager (<250 LOC).

import type { Message, ToolCall } from '@/types/chat';
import { BASE_URL, safeFetch } from '@/services/client';
import { findTargetAssistantIdx, sessionStore, notifyStoreListeners } from '../state/sessionStore';

export function isSameToolId(idA?: string, idB?: string): boolean {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  const cleanA = idA.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  const cleanB = idB.replace(/^run_[^_]+_/, '').replace(/^run_/, '');
  return cleanA === cleanB || idA.endsWith(`_${idB}`) || idB.endsWith(`_${idA}`);
}

export { isToolRunning } from '../components/work-log/toolTimeline';

export class InFlightToolTracker {
  toolArgBuffers: Record<string, string> = {};
  toolCallNames: Record<string, string> = {};
  completedToolIds = new Set<string>();
  currentRunId = '';

  reset() {
    this.toolArgBuffers = {};
    this.toolCallNames = {};
    this.completedToolIds.clear();
    this.currentRunId = '';
  }

  private callId(rawId: string, runId?: string): string {
    return `${runId || this.currentRunId || 'run'}_${rawId}`;
  }

  handleToolStart(rawId: string, toolName: string, runId?: string, onToolCall?: (t: ToolCall) => void): string {
    const cid = this.callId(rawId, runId);
    this.toolArgBuffers[cid] = '';
    this.toolCallNames[cid] = toolName;
    if (onToolCall) onToolCall({ id: cid, name: toolName, args: {}, status: 'running' });
    return cid;
  }

  handleToolArgs(rawId: string, deltaArg: string, runId?: string, onToolCall?: (t: ToolCall) => void) {
    const cid = this.callId(rawId, runId);
    if (!cid || !deltaArg) return;
    this.toolArgBuffers[cid] = (this.toolArgBuffers[cid] || '') + deltaArg;
    let parsedArgs: any = {};
    try { parsedArgs = JSON.parse(this.toolArgBuffers[cid]); } catch {}
    const toolSummary = parsedArgs?.toolSummary || parsedArgs?.tool_summary;
    const toolAction = parsedArgs?.toolAction || parsedArgs?.tool_action;
    if (onToolCall) onToolCall({
      id: cid,
      name: this.toolCallNames[cid] || 'action',
      args: parsedArgs,
      status: 'running',
      ...(toolSummary ? { toolSummary } : {}),
      ...(toolAction ? { toolAction } : {}),
    });
  }

  handleToolEnd(rawId: string, runId?: string, onToolCall?: (t: ToolCall) => void) {
    const cid = this.callId(rawId, runId);
    if (!cid || !onToolCall) return;
    let finalArgs: any = {};
    try { finalArgs = JSON.parse(this.toolArgBuffers[cid] || '{}'); } catch {}
    const toolSummary = finalArgs?.toolSummary || finalArgs?.tool_summary;
    const toolAction = finalArgs?.toolAction || finalArgs?.tool_action;
    onToolCall({
      id: cid,
      name: this.toolCallNames[cid] || 'action',
      args: finalArgs,
      status: 'running',
      ...(toolSummary ? { toolSummary } : {}),
      ...(toolAction ? { toolAction } : {}),
    });
  }

  handleToolResult(rawId: string, rawOutput: any, isError: boolean, durationSeconds?: number, runId?: string, onToolCall?: (t: ToolCall) => void) {
    const cid = this.callId(rawId, runId);
    const outputStr = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput, null, 2);
    if (cid && onToolCall) {
      let finalArgs: any = {};
      try { finalArgs = JSON.parse(this.toolArgBuffers[cid] || '{}'); } catch {}
      const toolSummary = finalArgs?.toolSummary || finalArgs?.tool_summary;
      const toolAction = finalArgs?.toolAction || finalArgs?.tool_action;
      onToolCall({
        id: cid,
        name: this.toolCallNames[cid] || 'action',
        args: finalArgs,
        output: outputStr || 'Done.',
        status: isError ? 'failed' : 'completed',
        durationSeconds,
        ...(toolSummary ? { toolSummary } : {}),
        ...(toolAction ? { toolAction } : {}),
      });
      this.completedToolIds.add(cid);
    }
  }

  handlePendingApproval(rawId: string, toolName: string, params: any, prompt?: string, action?: string, runId?: string, onToolCall?: (t: ToolCall) => void) {
    const cid = this.callId(rawId, runId);
    this.completedToolIds.add(cid);
    if (onToolCall) onToolCall({ id: cid, name: toolName || 'action', args: params || {}, status: 'pending_approval', toolSummary: params?.toolSummary || prompt, toolAction: action || params?.toolAction });
  }

  finalizeRunningTools(status: 'completed' | 'cancelled' = 'completed', onToolCall?: (t: ToolCall) => void) {
    for (const cid of Object.keys(this.toolCallNames)) {
      if (!this.completedToolIds.has(cid)) {
        let finalArgs: any = {};
        try { finalArgs = JSON.parse(this.toolArgBuffers[cid] || '{}'); } catch {}
        const toolSummary = finalArgs?.toolSummary || finalArgs?.tool_summary;
        const toolAction = finalArgs?.toolAction || finalArgs?.tool_action;
        if (onToolCall) onToolCall({
          id: cid,
          name: this.toolCallNames[cid],
          args: finalArgs,
          output: status === 'cancelled' ? 'Execution interrupted.' : 'Done.',
          status,
          ...(toolSummary ? { toolSummary } : {}),
          ...(toolAction ? { toolAction } : {}),
        });
        this.completedToolIds.add(cid);
      }
    }
  }
}

export function updateAssistantToolsAndSteps(
  messages: Message[], targetTurnId: string | null, toolCall: ToolCall, thinkingDuration?: number | null
): Message[] {
  const next = [...messages];
  const idx = findTargetAssistantIdx(next, targetTurnId);
  if (idx < 0) return next;
  const tools = next[idx].tools ? [...next[idx].tools] : [];
  const matchIdx = tools.findIndex((t) => isSameToolId(t.id, toolCall.id));
  if (matchIdx >= 0) tools[matchIdx] = { ...tools[matchIdx], ...toolCall };
  else tools.push(toolCall);

  const steps: any[] = next[idx].steps && next[idx].steps.length > 0 ? [...next[idx].steps] : [];
  for (const st of steps) {
    if (st.type === 'thinking' && st.status === 'running') {
      st.status = 'completed';
      const sTime = st.startTime || next[idx].turnStartTime || Date.now();
      st.thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - sTime) / 1000));
    }
    if (st.type === 'text' && st.status === 'running') st.status = 'completed';
  }
  const sIdx = steps.findIndex((st) => isSameToolId(st.tool_call_id, toolCall.id) || (st.type === 'tool' && isSameToolId(st.id, toolCall.id)));
  if (sIdx >= 0) {
    steps[sIdx] = { ...steps[sIdx], ...toolCall, status: toolCall.status || (toolCall.output ? 'completed' : 'running') };
  } else {
    steps.push({
      id: toolCall.id || `step_${steps.length}`, step_index: steps.length, type: 'tool', tool_call_id: toolCall.id, name: toolCall.name, args: toolCall.args, output: toolCall.output || '', status: toolCall.status || (toolCall.output ? 'completed' : 'running'),
      toolSummary: toolCall.toolSummary,
      toolAction: toolCall.toolAction,
    });
  }
  next[idx] = { ...next[idx], tools, steps, thinkingDurationSeconds: thinkingDuration ?? next[idx].thinkingDurationSeconds };
  return next;
}

export function completeAssistantThinking(messages: Message[], targetTurnId: string | null, thinkingDurationOverride?: number | null) {
  const next = [...messages];
  const idx = findTargetAssistantIdx(next, targetTurnId);
  let duration = thinkingDurationOverride ?? null;
  if (idx >= 0 && next[idx].steps) {
    const currentSteps = [...next[idx].steps];
    let changed = false;
    for (const st of currentSteps) {
      if (st.type === 'thinking' && st.status === 'running') {
        st.status = 'completed';
        const sTime = st.startTime || next[idx].turnStartTime || Date.now();
        st.thinkingDurationSeconds = Math.max(1, Math.round((Date.now() - sTime) / 1000));
        if (duration === null) duration = st.thinkingDurationSeconds;
        changed = true;
      }
    }
    if (changed) {
      next[idx] = { ...next[idx], steps: currentSteps, thinkingDurationSeconds: duration ?? next[idx].thinkingDurationSeconds };
      return { updatedMessages: next, thinkingDuration: duration };
    }
  }
  return { updatedMessages: messages, thinkingDuration: duration };
}

export function dismissPendingApprovals(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!m.tools || !m.tools.some((t) => t.status === 'pending_approval' && !t.decision)) return m;
    return {
      ...m,
      tools: m.tools.map((t) => t.status === 'pending_approval' && !t.decision ? { ...t, status: 'denied' as const, decision: 'deny' as const } : t),
    };
  });
}

export function applyToolApproval(
  messages: Message[], toolCallId: string, action: 'allow_once' | 'allow' | 'deny', rawTcId: string
): Message[] {
  return messages.map((m) => {
    let tools = m.tools;
    if (tools?.length) {
      tools = tools.map((t) => isSameToolId(t.id, toolCallId) || isSameToolId(t.id, rawTcId) ? { ...t, status: action === 'deny' ? ('denied' as const) : ('running' as const), decision: action } : t);
    }
    let steps = m.steps;
    if (steps?.length) {
      steps = steps.map((st: any) => {
        const matches = isSameToolId(st.tool_call_id, toolCallId) || isSameToolId(st.tool_call_id, rawTcId) || (st.type === 'tool' && (isSameToolId(st.id, toolCallId) || isSameToolId(st.id, rawTcId)));
        return matches ? { ...st, status: action === 'deny' ? 'denied' : 'running', decision: action } : st;
      });
    }
    return { ...m, tools, steps };
  });
}

export async function executeToolApproval(curSid: string, toolCallId: string, action: 'allow_once' | 'allow' | 'deny', feedback?: string): Promise<boolean> {
  const rawTcId = toolCallId.includes('_') && !toolCallId.startsWith('call_') && !toolCallId.startsWith('tc_') ? toolCallId.split('_').slice(1).join('_') : toolCallId;
  try {
    const res = await safeFetch(`${BASE_URL}/api/chat/${curSid}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool_call_id: rawTcId, action, feedback, user_id: 'default_user' }),
    });
    if (!res.ok) return false;
  } catch { return false; }
  const s = sessionStore.get(curSid);
  if (s) {
    s.chatMessages = applyToolApproval(s.chatMessages, toolCallId, action, rawTcId);
    notifyStoreListeners();
  }
  return true;
}

export function createStreamCallbacks(
  activeSid: string,
  handlers: {
    scheduleFlush: () => void;
    flushBuffer: () => void;
    onUpdateMessages: (msgs: Message[]) => void;
    onStreamError: (errText: string, errId?: string) => void;
    onToolCallRender: () => void;
    onRetryAttempt?: (attempt: number) => void;
  }
) {
  return {
    onToken: (token: string) => {
      const s = sessionStore.get(activeSid);
      if (!s) return;
      s.tokenBuffer += token;
      handlers.scheduleFlush();
    },
    onThought: (thought: string) => {
      const s = sessionStore.get(activeSid);
      if (!s) return;
      s.thoughtBuffer += thought;
      handlers.scheduleFlush();
    },
    onThinkingEnd: () => {
      const s = sessionStore.get(activeSid);
      if (!s) return;
      handlers.flushBuffer();
      const res = completeAssistantThinking(s.chatMessages, s.activeTurnId, s.thinkingDuration);
      s.chatMessages = res.updatedMessages;
      if (s.thinkingDuration === null) s.thinkingDuration = res.thinkingDuration;
      handlers.onUpdateMessages(s.chatMessages);
    },
    onToolCall: (toolCall: ToolCall) => {
      const s = sessionStore.get(activeSid);
      if (!s) return;
      handlers.flushBuffer();
      s.chatMessages = updateAssistantToolsAndSteps(s.chatMessages, s.activeTurnId, toolCall, s.thinkingDuration);
      handlers.onUpdateMessages(s.chatMessages);
      handlers.onToolCallRender();
    },
    onError: (errText: string, errId?: string) => handlers.onStreamError(errText, errId),
    onRetryAttempt: (attempt: number) => {
      const s = sessionStore.get(activeSid);
      if (!s) return;
      const idx = findTargetAssistantIdx(s.chatMessages, s.activeTurnId);
      if (idx >= 0) {
        const next = [...s.chatMessages];
        next[idx] = { ...next[idx], retryAttempt: attempt > 0 ? attempt : undefined };
        s.chatMessages = next;
        handlers.onUpdateMessages(s.chatMessages);
        notifyStoreListeners();
      }
      handlers.onRetryAttempt?.(attempt);
    },
  };
}
