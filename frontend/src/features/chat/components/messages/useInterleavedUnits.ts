import { useMemo } from 'react';
import type { Message, ExecutionStep, ToolCall } from '@/types/chat';

export type MessageInterleavedUnit =
  | { type: 'worklog'; id: string; steps: ExecutionStep[]; thoughts: string[]; tools: ToolCall[] }
  | { type: 'prose'; id: string; content: string };

import { cleanAssistantContent } from '@/features/chat/utils/sessionHistoryParser';

const cleanProseContent = cleanAssistantContent;

/**
 * ponytail: Compute Unified Global Worklog Units per Turn
 * Consolidate all execution steps prior to final answer into ONE unified worklog, with final prose as summary
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
      // Find the last execution step (tool, thinking, reasoning, or any non-text step)
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
        // Steps up to and including lastWorkStepIdx belong to the execution phase
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

        // ONE unified Global Worklog per turn
        result.push({
          type: 'worklog',
          id: `work_primary_${msg.id || 'start'}`,
          steps: workSteps,
          thoughts,
          tools,
        });

        // Final conversational answer (Summary)
        let finalProse = postWorkSteps
          .filter((s) => s.type === 'text' && s.content)
          .map((s) => cleanProseContent(s.content))
          .filter(Boolean)
          .join('\n\n');

        if (!finalProse && postWorkSteps.length === 0 && msg.content) {
          const intermediateTexts = workSteps
            .filter((s) => s.type === 'text' && s.content)
            .map((s) => cleanProseContent(s.content))
            .filter(Boolean);
          const cleanMsg = cleanProseContent(msg.content);
          if (cleanMsg) {
            const intermediateCombined = intermediateTexts.join('\n\n');
            if (intermediateCombined && cleanMsg === intermediateCombined) {
              finalProse = '';
            } else if (intermediateCombined && cleanMsg.startsWith(intermediateCombined)) {
              finalProse = cleanMsg.slice(intermediateCombined.length).trim();
            } else {
              finalProse = cleanMsg;
            }
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
        // No tool or thinking steps in msg.steps (all steps are text)
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

    // Fallback: Flat or legacy structure
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
