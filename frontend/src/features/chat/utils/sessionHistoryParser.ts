import { Message, ToolCall } from '@/types/chat';

const PROTOCOL_TAGS_REGEX = /<\/?(?:user[\s_]+message|assistant[\s_]+message|task_result|user_rules|user_information|identity|system_prompt|session_mode|file_storage_and_discipline|tool_execution_discipline|ui_presentation_format|runtime_context|skills|Skill[A-Za-z0-9_-]+|scratchpad|thought|thinking|tool_use|tool_result|tool_name|tool_output|use_parallel_tool_calls|parallel_tool|summary_data_json|empty)>\s*/gi;
const PROTOCOL_BRACKETS_REGEX = /\[(?:sub_agent_id|SYSTEM NOTICE):[^\]]*\]\s*/gi;

// ponytail: strip NexAU protocol sentinels, [empty], and prompt tag leakage
export function cleanAssistantContent(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '[empty]' || /^\[?(DONE|END|done|end)\]?$/i.test(trimmed)) return '';
  return trimmed
    .replace(/\[VERIFIED\]\s*/gi, '')
    .replace(PROTOCOL_BRACKETS_REGEX, '')
    .replace(PROTOCOL_TAGS_REGEX, '')
    .replace(/^(?:#+\s*)?(?:User|Assistant)\s+Message\s*:\s*$/gim, '')
    .replace(/(?:^|\n)\s*\[(DONE|END|done|end)\]\s*(?=\n|$)/gi, '')
    .replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '')
    .trim();
}

// ponytail: strip internal mid-flight steering protocol envelopes from user prompt text
export function cleanUserSteeringEnvelope(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;
  if (cleaned.includes('<USER_STEERING>') || cleaned.includes('[USER MID-FLIGHT INSTRUCTION]:') || cleaned.includes('</USER_STEERING>')) {
    const match = cleaned.match(/<USER_STEERING>[\s\S]*?(?:\[USER MID-FLIGHT INSTRUCTION\]:)?\s*([\s\S]*?)(?:\s*Adapt your current plan and respond to this instruction immediately\.?)?\s*<\/USER_STEERING>/i);
    if (match && match[1] && match[1].trim()) {
      cleaned = match[1].trim();
    } else {
      cleaned = cleaned
        .replace(/<\/?USER_STEERING>/gi, '')
        .replace(/\[USER MID-FLIGHT INSTRUCTION\]:\s*/gi, '')
        .replace(/Adapt your current plan and respond to this instruction immediately\.?/gi, '')
        .trim();
    }
  }

  return cleaned
    .replace(PROTOCOL_BRACKETS_REGEX, '')
    .replace(PROTOCOL_TAGS_REGEX, '')
    .replace(/^(?:#+\s*)?User\s+Message\s*:\s*$/gim, '')
    .replace(/(?:^|\n)\s*\[(DONE|END|done|end)\]\s*(?=\n|$)/gi, '')
    .replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '')
    .trim();
}

// ponytail: strip internal protocol envelopes and attachments for composer textarea
export function cleanUserPromptForComposer(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text.replace(/\[Attached (?:file|files)[^\]]*\]/gi, '').replace(/<attachments>[\s\S]*?<\/attachments>/gi, '').trim();
  cleaned = cleaned.replace(/^Please inspect and analyze the attached (?:audit )?documents?:?\s*/i, '').trim();
  return cleanUserSteeringEnvelope(cleaned);
}

// Helper: Normalize tool call attributes without inventing data (no fabricated 'Done.')
function normalizeTool(t: any, idx: number, prefix: string): ToolCall {
  const args = typeof t.args === 'object' && t.args !== null ? t.args : {};
  return {
    id: t.id || `${prefix}_tc_${idx}`,
    name: t.name || 'action',
    args,
    output: typeof t.output === 'string' ? t.output : (t.output ? String(t.output) : ''),
    status: t.status || 'completed',
    decision: t.decision,
    toolSummary: t.toolSummary || t.tool_summary || args.toolSummary || args.tool_summary || args.summary || args.description,
    toolAction: t.toolAction || t.tool_action || args.toolAction || args.tool_action,
    command: t.command || args.CommandLine || args.command || args.cmd,
    path: t.path || args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.Path,
    is_compacted: Boolean(t.is_compacted),
  };
}

// ponytail: transforms normalized transcript lines into structured chat Message[] for rendering
export function parseSessionHistory(rawLines: any[]): Message[] {
  const parsedMsgs: Message[] = [];

  for (const line of rawLines) {
    try {
      const step = typeof line === 'string' ? JSON.parse(line) : line;
      if (!step || typeof step !== 'object') continue;

      // Compaction boundary handling: wire boundary and summary onto the preceding message
      if (step.type === 'compaction_boundary' || (step.role === 'system' && step.isCompacted)) {
        const lastMsg = parsedMsgs[parsedMsgs.length - 1];
        if (lastMsg) {
          lastMsg.compactionBoundary = true;
          if (step.summary || step.content) {
            lastMsg.compactionSummary = String(step.summary || step.content);
          }
        }
        continue;
      }

      if (step.role === 'user') {
        const userText = cleanUserSteeringEnvelope(typeof step.content === 'string' ? step.content : '');
        parsedMsgs.push({
          id: step.id || `m_${parsedMsgs.length}`,
          sessionId: step.session_id,
          turnId: step.turn_id,
          role: 'user',
          content: userText,
          timestamp: step.created_at || step.timestamp,
          thoughts: [],
          tools: [],
          tasks: [],
        });
      } else if (step.role === 'assistant') {
        const content = cleanAssistantContent(typeof step.content === 'string' ? step.content : '');
        const thoughts: string[] = Array.isArray(step.thoughts) ? step.thoughts.map(String) : [];
        const prefix = step.id || `m_${parsedMsgs.length}`;

        const rawTools: any[] = Array.isArray(step.tools) ? step.tools : [];
        const tools: ToolCall[] = rawTools.map((t, i) => normalizeTool(t, i, prefix));

        const resolvedSteps = Array.isArray(step.steps)
          ? step.steps.map((st: any) => ({
              ...st,
              toolSummary: st.toolSummary || st.args?.toolSummary,
              toolAction: st.toolAction || st.args?.toolAction,
            }))
          : [];

        const isAborted = step.status === 'aborted' || step.status === 'cancelled' || step.stop_reason === 'user_stopped' || step.stop_reason === 'cancelled';
        const isError = step.status === 'error' || step.status === 'failed';
        const status = isAborted ? 'aborted' : (isError ? 'error' : (step.status || 'completed'));

        const thinkingDurationSeconds = step.thinking_duration_seconds || step.thinkingDurationSeconds;
        const totalDurationSeconds = step.total_duration_seconds || step.totalDurationSeconds;

        const prevMsg = parsedMsgs.length > 0 ? parsedMsgs[parsedMsgs.length - 1] : null;
        if (prevMsg && prevMsg.role === 'assistant') {
          prevMsg.thoughts.push(...thoughts);
          prevMsg.tools.push(...tools);
          // Only append prose content if this step was NOT an intermediate tool-invocation step
          if (content && rawTools.length === 0) {
            prevMsg.content = prevMsg.content ? `${prevMsg.content}\n\n${content}`.trim() : content.trim();
          }
          if (resolvedSteps.length > 0) {
            if (!prevMsg.steps) prevMsg.steps = [];
            for (const rStep of resolvedSteps) {
              const last = prevMsg.steps[prevMsg.steps.length - 1];
              if (last && last.type === 'thinking' && rStep.type === 'thinking') {
                last.content = `${last.content}\n\n${rStep.content}`.trim();
                if (rStep.thinkingDurationSeconds) {
                  last.thinkingDurationSeconds = (last.thinkingDurationSeconds || 0) + rStep.thinkingDurationSeconds;
                }
              } else {
                prevMsg.steps.push(rStep);
              }
            }
          }
          if (isAborted) prevMsg.status = 'aborted';
          else if (isError) prevMsg.status = 'error';
          if (step.created_at || step.timestamp) prevMsg.timestamp = step.created_at || step.timestamp;
          if (thinkingDurationSeconds) prevMsg.thinkingDurationSeconds = thinkingDurationSeconds;
          if (totalDurationSeconds) prevMsg.totalDurationSeconds = totalDurationSeconds;
        } else {
          parsedMsgs.push({
            id: step.id || `m_${parsedMsgs.length}`,
            sessionId: step.session_id,
            turnId: step.turn_id,
            role: 'assistant',
            content: rawTools.length === 0 ? content.trim() : '',
            status,
            thoughts,
            tools,
            tasks: [],
            steps: resolvedSteps,
            timestamp: step.created_at || step.timestamp,
            thinkingDurationSeconds,
            totalDurationSeconds,
          });
        }
      }
    } catch (err) {
      console.warn('[sessionHistoryParser] Failed to parse transcript line:', err);
    }
  }

  return parsedMsgs;
}
