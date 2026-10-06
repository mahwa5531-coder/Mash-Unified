import { Message } from '@/types/chat';

// ponytail: strip NexAU reasoning-only [empty] sentinel, [VERIFIED] marker, and [DONE]/[END] protocol sentinels
function cleanAssistantContent(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (trimmed === '[empty]' || /^\[?(DONE|END|done|end)\]?$/i.test(trimmed)) return '';
  return raw
    .replace(/\[VERIFIED\]\s*/gi, '')
    .replace(/(\s*\[(DONE|END|done|end)\]\s*)+$/gi, '');
}

// ponytail: strip internal mid-flight steering protocol envelopes from user prompt text
export function cleanUserSteeringEnvelope(text?: string): string {
  if (!text || typeof text !== 'string') return '';
  if (text.includes('<USER_STEERING>') || text.includes('[USER MID-FLIGHT INSTRUCTION]:') || text.includes('</USER_STEERING>')) {
    const match = text.match(/<USER_STEERING>[\s\S]*?(?:\[USER MID-FLIGHT INSTRUCTION\]:)?\s*([\s\S]*?)(?:\s*Adapt your current plan and respond to this instruction immediately\.?)?\s*<\/USER_STEERING>/i);
    if (match && match[1] && match[1].trim()) {
      return match[1].trim();
    }
    return text
      .replace(/<\/?USER_STEERING>/gi, '')
      .replace(/\[USER MID-FLIGHT INSTRUCTION\]:\s*/gi, '')
      .replace(/Adapt your current plan and respond to this instruction immediately\.?/gi, '')
      .trim();
  }
  return text;
}

// ponytail: transforms raw NexAU DB action records into structured chat Message[] for rendering
export function parseSessionHistory(rawLines: any[]): Message[] {
  const parsedMsgs: Message[] = [];

  for (const line of rawLines) {
    try {
      const step = typeof line === 'string' ? JSON.parse(line) : line;

      // Skip framework internal markers
      if (step.type === 'compaction_boundary' || step.role === 'framework' || (step.role === 'system' && step.isCompacted)) {
        continue;
      }

      if (step.role === 'user' || step.source === 'USER_EXPLICIT' || step.source === 'USER' || step.type === 'USER_INPUT') {
        let userText = typeof step.content === 'string' ? step.content : (step.value || '');
        if (Array.isArray(step.content)) {
          userText = step.content.map((b: any) => (typeof b === 'string' ? b : b?.text || '')).join('\n');
        }

        // Defensive sanitize: strip legacy handoff summary prefix if present
        if (typeof userText === 'string' && userText.includes('The user request for this round is:')) {
          const parts = userText.split('The user request for this round is:');
          userText = parts[1].trim();
        } else if (typeof userText === 'string' && userText.trim().startsWith('[SYSTEM NOTICE:')) {
          continue;
        }

        userText = cleanUserSteeringEnvelope(userText);

        parsedMsgs.push({
          role: 'user',
          content: userText,
          timestamp: step.created_at || (step as any).timestamp,
          thoughts: [],
          tools: [],
          tasks: [],
        });
      } else if (step.role === 'assistant' || step.source === 'MODEL' || step.type === 'PLANNER_RESPONSE') {
        let content = cleanAssistantContent(typeof step.content === 'string' ? step.content : '');
        const thoughts: string[] = Array.isArray(step.thoughts) ? [...step.thoughts] : (step.thinking ? [step.thinking] : []);
        const rawTools: any[] = Array.isArray(step.tools) ? step.tools : (Array.isArray(step.tool_calls) ? step.tool_calls : []);
        const stepPrefix = step.action_id || step.id || (step as any).step_index !== undefined ? `st_${(step as any).step_index}` : `m_${parsedMsgs.length}`;
        const tools: any[] = [];
        for (const t of rawTools) {
          const name = t.name || t.function?.name || 'action';
          let args = t.args || t.input || t.function?.arguments || {};
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch { args = {}; }
          }
          const outputStr = String(t.output || '');
          const isFailed = Boolean(
            t.status === 'failed' ||
            t.is_error ||
            (outputStr && (
              /^(error|exception|validationerror|failed):/i.test(outputStr.trim()) ||
              outputStr.toLowerCase().includes("schema validation failed") ||
              outputStr.toLowerCase().includes("validation error")
            ))
          );
          tools.push({
            id: t.id || `${stepPrefix}_tc_${tools.length}`,
            name,
            args,
            output: outputStr,
            status: isFailed ? 'failed' : (t.status || 'completed')
          });
        }
        const tasks = step.tasks || [];

        if (Array.isArray(step.content)) {
          for (const b of step.content) {
            if (b.type === 'text' && b.text) {
              const cleanBText = cleanAssistantContent(b.text);
              if (cleanBText) {
                content += (content ? '\n' : '') + cleanBText;
              }
            }
            if ((b.type === 'reasoning' || b.type === 'thinking') && (b.text || b.thinking)) {
              thoughts.push(b.text || b.thinking);
            }
            if (b.type === 'tool_use' || b.type === 'tool_call') {
              const name = b.name || b.function?.name || 'action';
              let args = b.input || b.args || b.function?.arguments || {};
              if (typeof args === 'string') {
                try { args = JSON.parse(args); } catch { args = {}; }
              }
              tools.push({
                id: b.id || `${stepPrefix}_tc_${tools.length}`,
                name,
                args,
                output: '',
                status: 'completed'
              });
            }
          }
        }
        
        const thinkingDurationSeconds = step.thinking_duration_seconds || step.thinkingDurationSeconds;
        const totalDurationSeconds = step.total_duration_seconds || step.totalDurationSeconds;
        
        const rawSteps = Array.isArray(step.steps) && step.steps.length > 0 ? step.steps : null;
        let resolvedSteps: any[] = [];
        if (rawSteps) {
          resolvedSteps = [...rawSteps];
        } else {
          if (thoughts.length > 0) {
            resolvedSteps.push({
              id: `${stepPrefix}_th_${resolvedSteps.length}`,
              step_index: resolvedSteps.length,
              type: 'thinking',
              content: thoughts.join('\n'),
              status: 'completed',
            });
          }
          if (tools.length > 0) {
            for (const t of tools) {
              resolvedSteps.push({
                id: t.id || `${stepPrefix}_tc_${resolvedSteps.length}`,
                step_index: resolvedSteps.length,
                type: 'tool',
                tool_call_id: t.id,
                name: t.name,
                args: t.args,
                output: t.output || '',
                status: 'completed',
              });
            }
          }
          if (content && content.trim().length > 0) {
            resolvedSteps.push({
              id: `${stepPrefix}_tx_${resolvedSteps.length}`,
              step_index: resolvedSteps.length,
              type: 'text',
              content: content,
              status: 'completed',
            });
          }
        }

        const prevMsg = parsedMsgs.length > 0 ? parsedMsgs[parsedMsgs.length - 1] : null;
        if (prevMsg && prevMsg.role === 'assistant') {
          prevMsg.thoughts.push(...thoughts);
          prevMsg.tools.push(...tools);
          if (content) {
            prevMsg.content = prevMsg.content ? (prevMsg.content + '\n\n' + content).trim() : content.trim();
          }
          if (tasks.length > 0) prevMsg.tasks = tasks;
          if (resolvedSteps.length > 0) {
            if (!prevMsg.steps) prevMsg.steps = [];
            for (const rStep of resolvedSteps) {
              const last = prevMsg.steps[prevMsg.steps.length - 1];
              if (last && last.type === 'thinking' && rStep.type === 'thinking') {
                last.content = (last.content + '\n\n' + rStep.content).trim();
                if (rStep.thinkingDurationSeconds) {
                  last.thinkingDurationSeconds = (last.thinkingDurationSeconds || 0) + rStep.thinkingDurationSeconds;
                }
              } else {
                prevMsg.steps.push(rStep);
              }
            }
          }
          const isAborted = step.status === 'aborted' || step.stop_reason === 'user_stopped' || step.stop_reason === 'stop';
          if (isAborted) prevMsg.status = 'aborted';
          if (step.created_at || (step as any).timestamp) {
            prevMsg.timestamp = step.created_at || (step as any).timestamp;
          }
          if (thinkingDurationSeconds) prevMsg.thinkingDurationSeconds = thinkingDurationSeconds;
          if (totalDurationSeconds) prevMsg.totalDurationSeconds = totalDurationSeconds;
        } else {
          const isAborted = step.status === 'aborted' || step.stop_reason === 'user_stopped' || step.stop_reason === 'stop';
          parsedMsgs.push({ 
            role: 'assistant', 
            content: content.trim(), 
            status: isAborted ? 'aborted' : (step.status || 'completed'),
            thoughts: thoughts, 
            tools: tools,
            tasks: tasks,
            steps: resolvedSteps,
            timestamp: step.created_at || (step as any).timestamp,
            thinkingDurationSeconds,
            totalDurationSeconds,
          });
        }
      } else if (step.role === 'tool') {
        const prevMsg = parsedMsgs.length > 0 ? parsedMsgs[parsedMsgs.length - 1] : null;
        if (prevMsg && prevMsg.role === 'assistant') {
          const toolId = step.tool_call_id || step.id;
          let outputText = step.content || step.output || '';
          if (Array.isArray(step.content)) {
            const resBlock = step.content.find((b: any) => b.type === 'tool_result');
            if (resBlock) outputText = resBlock.content || '';
          }
          // ponytail: reverse scan finds the matching tool call in O(1) time at the tail
          let target: any = null;
          for (let ti = prevMsg.tools.length - 1; ti >= 0; ti--) {
            if (prevMsg.tools[ti].id === toolId) {
              target = prevMsg.tools[ti];
              break;
            }
          }
          if (target) {
            target.output = outputText || 'Done.';
            target.status = 'completed';
          } else if (outputText) {
            prevMsg.tools.push({
              id: toolId || `tc_${prevMsg.tools.length}`,
              name: step.name || 'action',
              args: {},
              output: outputText || 'Done.',
              status: 'completed'
            });
          }
          if (prevMsg.steps) {
            let matchedStep = false;
            for (let si = prevMsg.steps.length - 1; si >= 0; si--) {
              const s = prevMsg.steps[si];
              if (s.type === 'tool' && (s.tool_call_id === toolId || s.id === toolId)) {
                s.output = outputText || 'Done.';
                s.status = 'completed';
                matchedStep = true;
                break;
              }
              if (Array.isArray(s.tools)) {
                for (let ti = s.tools.length - 1; ti >= 0; ti--) {
                  if (s.tools[ti].id === toolId) {
                    s.tools[ti].output = outputText || 'Done.';
                    s.tools[ti].status = 'completed';
                    matchedStep = true;
                    break;
                  }
                }
                if (matchedStep) break;
              }
            }
            if (!matchedStep && outputText) {
              prevMsg.steps.push({
                id: toolId || `step_${prevMsg.steps.length}`,
                step_index: prevMsg.steps.length,
                type: 'tool',
                tool_call_id: toolId,
                name: step.name || 'action',
                args: {},
                output: outputText || 'Done.',
                status: 'completed',
              });
            }
          }
        }
      }
    } catch (err) {}
  }
  return parsedMsgs;
}
