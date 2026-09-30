import { Message, Turn } from '@/types/chat';

// ponytail: helper to transform raw backend transcript steps into structured chat messages
export function parseTranscriptLines(rawLines: any[]): Message[] {
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



        parsedMsgs.push({
          role: 'user',
          content: userText,
          timestamp: step.created_at || (step as any).timestamp,
          thoughts: [],
          tools: [],
          tasks: [],
        });
      } else if (step.role === 'assistant' || step.source === 'MODEL' || step.type === 'PLANNER_RESPONSE') {
        let content = typeof step.content === 'string' ? step.content.replace(/\[VERIFIED\]\s*/gi, '') : '';
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
              const cleanBText = b.text.replace(/\[VERIFIED\]\s*/gi, '');
              content += (content ? '\n' : '') + cleanBText;
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
          if (step.created_at || (step as any).timestamp) {
            prevMsg.timestamp = step.created_at || (step as any).timestamp;
          }
          if (thinkingDurationSeconds) prevMsg.thinkingDurationSeconds = thinkingDurationSeconds;
          if (totalDurationSeconds) prevMsg.totalDurationSeconds = totalDurationSeconds;
        } else {
          parsedMsgs.push({ 
            role: 'assistant', 
            content: content.trim(), 
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
          const target = prevMsg.tools.find((t: any) => t.id === toolId);
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
            for (const s of prevMsg.steps) {
              if (Array.isArray(s.tools)) {
                const st = s.tools.find((t: any) => t.id === toolId);
                if (st) {
                  st.output = outputText || 'Done.';
                  st.status = 'completed';
                  matchedStep = true;
                }
              }
              if (s.type === 'tool' && (s.tool_call_id === toolId || s.id === toolId)) {
                s.output = outputText || 'Done.';
                s.status = 'completed';
                matchedStep = true;
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

// ponytail: compute chat turn groupings in linear O(N) time with stable keys to avoid 120fps GC thrashing
export function buildTurns(chatMessages: Message[]): Turn[] {
  const result: Turn[] = [];
  let flatIdx = 0;
  for (let i = 0; i < chatMessages.length; i++) {
    const msg = chatMessages[i];
    if (msg.role === 'user') {
      const snippet = typeof msg.content === 'string' ? msg.content.slice(0, 16).replace(/\s+/g, '_') : 'msg';
      const stableId = msg.turnId || `turn_${msg.sessionId || 'sid'}_${flatIdx}_${snippet}`;
      result.push({ 
        id: stableId,
        turnId: msg.turnId,
        status: msg.status,
        userMsg: msg, 
        aiMsgs: [], 
        flatIdx,
        turnIndex: result.length,
        compactionBoundary: msg.compactionBoundary,
        compactionSummary: msg.compactionSummary,
      });
    } else if (result.length > 0) {
      const currentTurn = result[result.length - 1];
      if (currentTurn.aiMsgs.length === 0) {
        currentTurn.aiMsgs.push(msg);
      } else {
        // Consolidate multiple assistant responses within the same turn into one unified message
        const existing = currentTurn.aiMsgs[0];

        // Merge thoughts chronologically without duplicates
        if (msg.thoughts && msg.thoughts.length > 0) {
          const existingSet = new Set(existing.thoughts || []);
          for (const th of msg.thoughts) {
            if (!existingSet.has(th)) {
              existing.thoughts.push(th);
              existingSet.add(th);
            }
          }
        }

        // Merge tools by id
        if (msg.tools && msg.tools.length > 0) {
          const existingToolIds = new Set((existing.tools || []).map((t: any) => t.id));
          for (const tl of msg.tools) {
            if (tl.id && existingToolIds.has(tl.id)) {
              const idx = existing.tools.findIndex((t: any) => t.id === tl.id);
              if (idx >= 0) existing.tools[idx] = { ...existing.tools[idx], ...tl };
            } else {
              existing.tools.push(tl);
              if (tl.id) existingToolIds.add(tl.id);
            }
          }
        }

        // Merge steps
        if (msg.steps && msg.steps.length > 0) {
          if (!existing.steps) existing.steps = [];
          for (const st of msg.steps) {
            const last = existing.steps[existing.steps.length - 1];
            if (last && last.type === 'thinking' && st.type === 'thinking') {
              const lastContent = last.content || '';
              const stContent = st.content || '';
              if (!lastContent.includes(stContent)) {
                last.content = (lastContent + '\n\n' + stContent).trim();
              }
            } else {
              existing.steps.push(st);
            }
          }
        }

        // Consolidate content cleanly: avoid duplicating prefix drafts
        if (msg.content && msg.content.trim()) {
          const newContent = msg.content.trim();
          const oldContent = existing.content.trim();
          if (!oldContent) {
            existing.content = newContent;
          } else if (newContent.startsWith(oldContent) || newContent.length >= oldContent.length) {
            existing.content = newContent;
          } else if (!oldContent.includes(newContent)) {
            existing.content = (oldContent + '\n\n' + newContent).trim();
          }
        }

        // Aggregate timing and status
        if (msg.thinkingDurationSeconds) {
          existing.thinkingDurationSeconds = (existing.thinkingDurationSeconds || 0) + msg.thinkingDurationSeconds;
        }
        if (msg.totalDurationSeconds) {
          existing.totalDurationSeconds = Math.max(existing.totalDurationSeconds || 0, msg.totalDurationSeconds);
        }
        if (msg.status) {
          existing.status = msg.status;
          currentTurn.status = msg.status;
        }
        if (msg.error) existing.error = msg.error;
        if (msg.errorId) existing.errorId = msg.errorId;
      }
    } else {
      const stableId = msg.turnId || `turn_ctx_0`;
      result.push({
        id: stableId,
        turnId: msg.turnId,
        status: msg.status,
        userMsg: { 
          role: 'user', 
          content: '[Earlier Context]', 
          thoughts: [], 
          tools: [], 
          tasks: [],
          compactionBoundary: msg.compactionBoundary,
          compactionSummary: msg.compactionSummary,
        },
        aiMsgs: [msg],
        flatIdx: 0,
        turnIndex: 0,
        compactionBoundary: msg.compactionBoundary,
        compactionSummary: msg.compactionSummary,
      });
    }
    flatIdx++;
  }

  return result;
}

