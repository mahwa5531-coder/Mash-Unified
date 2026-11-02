import { useMemo } from 'react';
import type { Message, ExecutionStep, ToolCall } from '@/types/chat';

export type MessageInterleavedUnit =
  | { type: 'worklog'; id: string; steps: ExecutionStep[]; thoughts: string[]; tools: ToolCall[] }
  | { type: 'prose'; id: string; content: string };

import { cleanAssistantContent } from '@/features/chat/utils/sessionHistoryParser';

const cleanProseContent = cleanAssistantContent;

function isWorkStep(s: ExecutionStep): boolean {
  return (
    s.type === 'tool' ||
    s.type === 'thinking' ||
    s.type === 'reasoning' ||
    (s.type && s.type !== 'text') ||
    Boolean(s.tools && s.tools.length > 0) ||
    Boolean(s.thoughts && s.thoughts.length > 0) ||
    Boolean(s.name) ||
    Boolean(s.tool_call_id)
  );
}

/**
 * ponytail: Compute Authentic Interleaved Chronological Units per Turn
 * Sequentially interleaves execution phases (thinking + tools in WorkLog accordion)
 * and assistant commentary/prose in exact chronological order:
 * [WorkLog] -> [Prose Note] -> [WorkLog] -> [Prose Summary]
 */
export function computeInterleavedUnits(msg: Message, isActivelyStreaming: boolean): MessageInterleavedUnit[] {
  const result: MessageInterleavedUnit[] = [];
  const rawSteps = msg.steps && msg.steps.length > 0 ? msg.steps : [];

  if (rawSteps.length > 0) {
    let currentWorkChunk: ExecutionStep[] = [];
    let currentProseChunk: ExecutionStep[] = [];

    const flushWork = () => {
      if (currentWorkChunk.length === 0) return;
      const tools: ToolCall[] = [];
      const thoughts: string[] = [];
      currentWorkChunk.forEach((s) => {
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

      result.push({
        type: 'worklog',
        id: `work_${msg.id || 'turn'}_${result.length}`,
        steps: [...currentWorkChunk],
        thoughts,
        tools,
      });
      currentWorkChunk = [];
    };

    const flushProse = () => {
      if (currentProseChunk.length === 0) return;
      const text = currentProseChunk
        .map((s) => cleanProseContent(s.content))
        .filter(Boolean)
        .join('\n\n');
      if (text) {
        result.push({
          type: 'prose',
          id: `prose_${msg.id || 'turn'}_${result.length}`,
          content: text,
        });
      }
      currentProseChunk = [];
    };

    for (const step of rawSteps) {
      if (isWorkStep(step)) {
        flushProse();
        currentWorkChunk.push(step);
      } else if (step.type === 'text') {
        flushWork();
        currentProseChunk.push(step);
      }
    }
    flushWork();
    flushProse();

    // Check if prose was produced; if not, or if trailing msg.content exists
    const cleanMsg = cleanProseContent(msg.content);
    if (cleanMsg) {
      const existingProse = result
        .filter((u): u is { type: 'prose'; id: string; content: string } => u.type === 'prose')
        .map((u) => u.content)
        .join('\n\n');

      if (!existingProse) {
        result.push({
          type: 'prose',
          id: `prose_final_${msg.id || 'turn'}`,
          content: cleanMsg,
        });
      } else if (cleanMsg.length > existingProse.length && cleanMsg.startsWith(existingProse)) {
        const remaining = cleanMsg.slice(existingProse.length).trim();
        if (remaining) {
          result.push({
            type: 'prose',
            id: `prose_final_${msg.id || 'turn'}`,
            content: remaining,
          });
        }
      }
    }

    return result;
  }

  // Fallback: Legacy or steps-less messages
  const hasWork =
    (msg.thoughts && msg.thoughts.length > 0) ||
    (msg.tools && msg.tools.length > 0);
  if (hasWork || isActivelyStreaming || msg.status === 'running') {
    result.push({
      type: 'worklog',
      id: `work_primary_${msg.id || 'start'}`,
      steps: [],
      thoughts: msg.thoughts || [],
      tools: msg.tools || [],
    });
  }
  const cleanContent = cleanProseContent(msg.content);
  if (cleanContent) {
    result.push({
      type: 'prose',
      id: `prose_primary_${msg.id || 'end'}`,
      content: cleanContent,
    });
  }
  return result;
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
