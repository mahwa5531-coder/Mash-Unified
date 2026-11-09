import { useMemo } from 'react';
import type { Message, ExecutionStep, ToolCall } from '@/types/chat';

export type MessageInterleavedUnit =
  | { type: 'worklog'; id: string; steps: ExecutionStep[]; thoughts: string[]; tools: ToolCall[] }
  | { type: 'prose'; id: string; content: string };

import { cleanAssistantContent } from '@/features/chat/utils/sessionHistoryParser';

const cleanProseContent = cleanAssistantContent;

/**
 * Micro-commentary detection:
 * Short 1-line operational updates (<120 chars without formatting) stay inside the worklog
 * timeline as subtle inline step notes. Only substantive prose (headings, markdown lists,
 * tables, paragraphs) splits into an independent conversational prose unit.
 */
function isSubstantiveProse(text?: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes('\n')) return true;
  if (/^(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s*|\|)/.test(trimmed)) return true;
  return trimmed.length > 120;
}

function extractWorklogToolsAndThoughts(workSteps: ExecutionStep[]) {
  const tools: ToolCall[] = [];
  const thoughts: string[] = [];

  workSteps.forEach((s) => {
    if (s.type === 'tool' || (!s.type && (s.name || s.tool_call_id))) {
      tools.push({
        id: s.tool_call_id || s.id,
        name: s.name || 'action',
        args: s.args || {},
        output: s.output || '',
        status: (s.status as any) || 'completed',
        toolSummary: s.toolSummary,
        toolAction: s.toolAction,
        decision: (s as any).decision,
      });
    } else if ((s.type === 'thinking' || s.type === 'reasoning') && (s.content || s.thinking)) {
      thoughts.push(s.content || s.thinking || '');
    } else if (s.thoughts && s.thoughts.length > 0) {
      thoughts.push(...s.thoughts);
    }
    if (s.tools && s.tools.length > 0) {
      tools.push(...s.tools);
    }
  });

  return { tools, thoughts };
}

/**
 * Group execution steps and conversational prose for an assistant turn in O(N) time.
 * Contiguous tool/thinking clusters are grouped into compact worklog units, alternating
 * with substantive conversational prose. Intermediate micro-notes remain inside the worklog.
 */
export function computeInterleavedUnits(msg: Message, isActivelyStreaming: boolean): MessageInterleavedUnit[] {
  const hasWork =
    (msg.thoughts && msg.thoughts.length > 0) ||
    (msg.tools && msg.tools.length > 0) ||
    (msg.steps && msg.steps.some((s) => (s.type && s.type !== 'text') || (s.tools && s.tools.length > 0) || (s.thoughts && s.thoughts.length > 0) || Boolean(s.name) || Boolean(s.tool_call_id)));
  const hasDuration = Boolean(
    (msg.totalDurationSeconds || msg.thinkingDurationSeconds) && hasWork
  );
  const shouldIncludeWorklog = hasWork || isActivelyStreaming || msg.status === 'running' || hasDuration;

  if (msg.steps && msg.steps.length > 0) {
    const result: MessageInterleavedUnit[] = [];
    let currentWorkSteps: ExecutionStep[] = [];
    let unitIdx = 0;

    const flushWorklog = () => {
      if (currentWorkSteps.length === 0) return;
      const { tools, thoughts } = extractWorklogToolsAndThoughts(currentWorkSteps);
      result.push({
        type: 'worklog',
        id: `work_${msg.id || 'w'}_${unitIdx++}`,
        steps: currentWorkSteps,
        thoughts: thoughts.length > 0 ? thoughts : (result.length === 0 ? (msg.thoughts || []) : []),
        tools: tools.length > 0 ? tools : (result.length === 0 ? (msg.tools || []) : []),
      });
      currentWorkSteps = [];
    };

    // Pre-scan: track whether subsequent tools follow step i to preserve micro-notes inside worklog
    const hasToolAfter = new Array(msg.steps.length).fill(false);
    let seenTool = false;
    for (let i = msg.steps.length - 1; i >= 0; i--) {
      hasToolAfter[i] = seenTool;
      const s = msg.steps[i];
      if (s.type === 'tool' || (!s.type && (s.name || s.tool_call_id)) || (s.tools && s.tools.length > 0)) {
        seenTool = true;
      }
    }

    for (let i = 0; i < msg.steps.length; i++) {
      const step = msg.steps[i];
      const isWork =
        step.type === 'tool' ||
        step.type === 'thinking' ||
        step.type === 'reasoning' ||
        (step.type && step.type !== 'text') ||
        Boolean(step.name) ||
        Boolean(step.tool_call_id) ||
        (step.tools && step.tools.length > 0);

      const isMicroNote = step.type === 'text' && hasToolAfter[i] && !isSubstantiveProse(step.content);

      if (isWork || isMicroNote) {
        currentWorkSteps.push(step);
      } else if (step.type === 'text' && step.content?.trim()) {
        flushWorklog();
        const cleaned = cleanProseContent(step.content);
        if (cleaned) {
          result.push({
            type: 'prose',
            id: `prose_${msg.id || 'p'}_${unitIdx++}`,
            content: cleaned,
          });
        }
      }
    }

    flushWorklog();

    // Reconcile trailing stream content or fallback prose if steps only contained tools
    const existingProse = result
      .filter((u): u is { type: 'prose'; id: string; content: string } => u.type === 'prose')
      .map((u) => u.content)
      .join('\n\n');
    const fullClean = cleanProseContent(msg.content);

    if (fullClean && !existingProse) {
      let finalProse = fullClean;
      const worklogSteps = result.flatMap((u) => (u.type === 'worklog' ? u.steps : []));
      for (const ws of worklogSteps) {
        if (ws.type === 'text' && ws.content) {
          const cleanedNote = cleanProseContent(ws.content);
          if (cleanedNote) {
            finalProse = finalProse.replace(cleanedNote, '').trim();
          }
        }
      }
      if (finalProse) {
        result.push({
          type: 'prose',
          id: `prose_${msg.id || 'p'}_${unitIdx++}`,
          content: finalProse,
        });
      }
    } else if (fullClean && existingProse && fullClean !== existingProse && fullClean.startsWith(existingProse)) {
      const tail = fullClean.slice(existingProse.length).trim();
      if (tail) {
        result.push({
          type: 'prose',
          id: `prose_${msg.id || 'p'}_${unitIdx++}`,
          content: tail,
        });
      }
    }

    if (result.length === 0 && shouldIncludeWorklog) {
      result.push({
        type: 'worklog',
        id: `work_primary_${msg.id || 'start'}`,
        steps: [],
        thoughts: msg.thoughts || [],
        tools: msg.tools || [],
      });
    }

    return result;
  }

  // Fallback for flat or legacy messages without a steps array
  const fallbackUnits: MessageInterleavedUnit[] = [];
  if (shouldIncludeWorklog) {
    fallbackUnits.push({
      type: 'worklog',
      id: `work_primary_${msg.id || 'start'}`,
      steps: msg.steps || [],
      thoughts: msg.thoughts || [],
      tools: msg.tools || [],
    });
  }
  const cleanContent = cleanProseContent(msg.content);
  if (cleanContent) {
    fallbackUnits.push({
      type: 'prose',
      id: `prose_primary_${msg.id || 'end'}`,
      content: cleanContent,
    });
  }
  return fallbackUnits;
}

export function useInterleavedUnits(msg: Message, isActivelyStreaming: boolean): MessageInterleavedUnit[] {
  return useMemo<MessageInterleavedUnit[]>(
    () => computeInterleavedUnits(msg, isActivelyStreaming),
    [
      msg.steps,
      msg.thoughts,
      msg.tools,
      msg.content,
      msg.status,
      msg.id,
      msg.totalDurationSeconds,
      msg.thinkingDurationSeconds,
      msg.turnStartTime,
      isActivelyStreaming,
    ]
  );
}

