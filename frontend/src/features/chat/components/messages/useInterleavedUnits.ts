import { useMemo } from 'react';
import type { Message, ExecutionStep, ToolCall } from '@/types/chat';

export type MessageInterleavedUnit =
  | { type: 'worklog'; id: string; steps: ExecutionStep[]; thoughts: string[]; tools: ToolCall[] }
  | { type: 'prose'; id: string; content: string };

/**
 * ponytail: Interleaved Sequential Units — clean chronological flow where worklogs and authentic prose alternate
 */
export function useInterleavedUnits(msg: Message, isActivelyStreaming: boolean): MessageInterleavedUnit[] {
  return useMemo<MessageInterleavedUnit[]>(() => {
    const hasWork =
      (msg.thoughts && msg.thoughts.length > 0) ||
      (msg.tools && msg.tools.length > 0) ||
      (msg.steps && msg.steps.some((s) => s.type !== 'text'));
    const hasDuration = Boolean(
      msg.totalDurationSeconds ||
      msg.thinkingDurationSeconds ||
      (msg.turnStartTime && !isActivelyStreaming)
    );
    const shouldIncludeWorklog = hasWork || isActivelyStreaming || msg.status === 'running' || hasDuration;

    if (msg.steps && msg.steps.length > 0) {
      const result: MessageInterleavedUnit[] = [];
      let currentWorkSteps: ExecutionStep[] = [];

      const flushWork = () => {
        if (currentWorkSteps.length > 0) {
          const tools: ToolCall[] = [];
          const thoughts: string[] = [];
          currentWorkSteps.forEach((s) => {
            if (s.type === 'tool') {
              tools.push({
                id: s.tool_call_id || s.id,
                name: s.name || 'action',
                args: s.args || {},
                output: s.output || '',
                status: (s.status as any) || 'completed',
              });
            } else if (s.type === 'thinking' && s.content) {
              thoughts.push(s.content);
            } else if (s.thoughts && s.thoughts.length > 0) {
              thoughts.push(...s.thoughts);
            }
            if (s.tools && s.tools.length > 0) {
              tools.push(...s.tools);
            }
          });

          result.push({
            type: 'worklog',
            id: `work_${result.length}_${currentWorkSteps[0].id || result.length}`,
            steps: [...currentWorkSteps],
            thoughts,
            tools,
          });
          currentWorkSteps = [];
        }
      };

      for (const step of msg.steps) {
        if (step.type === 'text') {
          const cleanText = (step.content || '').replace(/\[VERIFIED\]\s*/gi, '').trim();
          if (cleanText) {
            flushWork();
            result.push({
              type: 'prose',
              id: `prose_${result.length}_${step.id || ''}`,
              content: cleanText,
            });
          }
        } else {
          currentWorkSteps.push(step);
        }
      }
      flushWork();

      if (!result.some((u) => u.type === 'worklog') && shouldIncludeWorklog) {
        result.unshift({
          type: 'worklog',
          id: `work_primary_${msg.id || 'start'}`,
          steps: [],
          thoughts: msg.thoughts || [],
          tools: msg.tools || [],
        });
      }

      if (result.length > 0) {
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
    const cleanContent = (msg.content || '').replace(/\[VERIFIED\]\s*/gi, '').trim();
    if (cleanContent) {
      fallbackUnits.push({
        type: 'prose',
        id: 'prose_primary',
        content: cleanContent,
      });
    }
    return fallbackUnits;
  }, [
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
  ]);
}
