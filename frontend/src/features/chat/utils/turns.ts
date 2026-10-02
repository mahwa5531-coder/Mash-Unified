import { Message, Turn } from '@/types/chat';

export { parseSessionHistory } from './sessionHistoryParser';

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
