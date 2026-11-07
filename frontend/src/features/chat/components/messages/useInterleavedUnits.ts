import { useMemo } from 'react';
import type { Message, ExecutionStep, ToolCall } from '@/types/chat';

export type MessageInterleavedUnit =
  | { type: 'worklog'; id: string; steps: ExecutionStep[]; thoughts: string[]; tools: ToolCall[] }
  | { type: 'prose'; id: string; content: string };

import { cleanAssistantContent } from '@/features/chat/utils/sessionHistoryParser';

const cleanProseContent = cleanAssistantContent;

/**
 * Group execution steps and conversational prose for an assistant turn.
 * All pre-response execution steps (tools, reasoning, intermediate step notes) are
 * consolidated into a single worklog unit, followed by conversational prose.
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
    let lastWorkStepIdx = -1;
    for (let i = msg.steps.length - 1; i >= 0; i--) {
      const s = msg.steps[i];
      if (
        s.type === 'tool' ||
        s.type === 'thinking' ||
        s.type === 'reasoning' ||
        (s.type && s.type !== 'text') ||
        (s.tools && s.tools.length > 0) ||
        (s.thoughts && s.thoughts.length > 0) ||
        Boolean(s.name) ||
        Boolean(s.tool_call_id)
      ) {
        lastWorkStepIdx = i;
        break;
      }
    }

    const result: MessageInterleavedUnit[] = [];

    if (lastWorkStepIdx >= 0) {
      const workSteps = msg.steps.slice(0, lastWorkStepIdx + 1);
      const postWorkSteps = msg.steps.slice(lastWorkStepIdx + 1);

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

      if (msg.tools && msg.tools.length > 0 && tools.length === 0) {
        tools.push(...msg.tools);
      }
      if (msg.thoughts && msg.thoughts.length > 0 && thoughts.length === 0) {
        thoughts.push(...msg.thoughts);
      }

      result.push({
        type: 'worklog',
        id: `work_primary_${msg.id || 'start'}`,
        steps: workSteps,
        thoughts,
        tools,
      });

      let finalProse = postWorkSteps
        .filter((s) => s.type === 'text' && s.content)
        .map((s) => cleanProseContent(s.content))
        .filter(Boolean)
        .join('\n\n');

      if (!finalProse && postWorkSteps.length === 0 && msg.content) {
        let remaining = cleanProseContent(msg.content);
        for (const ws of workSteps) {
          if (ws.type === 'text' && ws.content) {
            remaining = remaining.replace(cleanProseContent(ws.content), '').trim();
          }
        }
        if (remaining) {
          finalProse = remaining;
        }
      }

      if (finalProse) {
        result.push({
          type: 'prose',
          id: `prose_summary_${msg.id || 'end'}`,
          content: finalProse,
        });
      }

      return result;
    } else {
      if (shouldIncludeWorklog) {
        result.push({
          type: 'worklog',
          id: `work_primary_${msg.id || 'start'}`,
          steps: [],
          thoughts: msg.thoughts || [],
          tools: msg.tools || [],
        });
      }
      const cleanContent = cleanProseContent(
        msg.steps.map((s) => s.content || '').join('\n\n') || msg.content
      );
      if (cleanContent) {
        result.push({
          type: 'prose',
          id: `prose_summary_${msg.id || 'end'}`,
          content: cleanContent,
        });
      }
      return result;
    }
  }

  // Fallback for flat or legacy messages
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
