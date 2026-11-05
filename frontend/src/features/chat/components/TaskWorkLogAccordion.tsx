"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimelineRow } from './work-log/TimelineRow';
import {
  formatDurationDisplay,
  parseToolItem,
  isToolRunning,
  groupTimelineEntries,
} from './work-log/toolTimeline';
import type { ToolCallItem, ExecutionStep, TimelineEntry } from './work-log/types';

interface TaskWorkLogAccordionProps {
  id?: string;
  steps?: ExecutionStep[];
  thoughts?: string[];
  tools?: ToolCallItem[];
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  hasAssistantContent?: boolean;
  totalDurationSeconds?: number;
  onOpenFile?: (path: string) => void;
  onApproveTool?: (toolCallId: string, action: 'allow_once' | 'allow' | 'deny', feedback?: string) => Promise<boolean | void> | boolean | void;
  isLast?: boolean;
  turnStartTime?: number;
}

// ponytail: Bounded LRU-100 accordion expansion cache avoids unbounded memory retention across long sessions
const MAX_ACCORDION_MEMORY = 100;
const userExpandedAccordions = new Map<string, boolean>();

function recordAccordionExpanded(key: string, expanded: boolean) {
  if (userExpandedAccordions.has(key)) {
    userExpandedAccordions.delete(key);
  } else if (userExpandedAccordions.size >= MAX_ACCORDION_MEMORY) {
    const oldest = userExpandedAccordions.keys().next().value;
    if (oldest) userExpandedAccordions.delete(oldest);
  }
  userExpandedAccordions.set(key, expanded);
}

export default function TaskWorkLogAccordion({
  id,
  steps = [],
  thoughts = [],
  tools = [],
  isStreaming = false,
  thinkingDurationSeconds,
  hasAssistantContent = false,
  totalDurationSeconds,
  onOpenFile,
  onApproveTool,
  isLast: _isLast = false,
  turnStartTime,
}: TaskWorkLogAccordionProps) {
  const hasTools = Boolean((tools && tools.length > 0) || (steps && steps.some((s: any) => s.type === 'tool' || (!s.type && (s.name || s.tool_call_id)) || (s.tools && s.tools.length > 0))));
  const [clusterOpen, setClusterOpen] = useState<boolean>(() => {
    if (id && userExpandedAccordions.has(id)) {
      return !!userExpandedAccordions.get(id);
    }
    return !hasAssistantContent && !hasTools && !isStreaming;
  });
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedCmds, setExpandedCmds] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const thoughtScrollRef = useRef<HTMLDivElement>(null);

  // Auto-collapse completed turns upon stream termination
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setClusterOpen(false);
      if (id) recordAccordionExpanded(id, false);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, id]);

  const toggleCluster = () => {
    setClusterOpen((prev) => {
      const next = !prev;
      if (id) recordAccordionExpanded(id, next);
      return next;
    });
  };

  // Live ticking seconds counter: active while latest step is actively in reasoning phase
  const activeThinkingStep = (steps && steps.length > 0 && steps[steps.length - 1].type === 'thinking' && steps[steps.length - 1].status === 'running')
    ? steps[steps.length - 1]
    : null;

  const isActivelyThinking = Boolean(
    isStreaming && (
      activeThinkingStep !== null ||
      (!steps?.length && thoughts.length > 0 && !hasAssistantContent && (!tools || tools.length === 0) && !thinkingDurationSeconds)
    )
  );

  const activeThinkingStart = activeThinkingStep?.startTime || turnStartTime || Date.now();

  const [liveThinkingSeconds, setLiveThinkingSeconds] = useState<number>(() => {
    return Math.max(1, Math.floor((Date.now() - activeThinkingStart) / 1000));
  });

  const [latchedThinkingSeconds, setLatchedThinkingSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!isActivelyThinking) return;
    const start = activeThinkingStep?.startTime || turnStartTime || Date.now();
    const update = () => {
      const s = Math.max(1, Math.floor((Date.now() - start) / 1000));
      setLiveThinkingSeconds(s);
      setLatchedThinkingSeconds(s);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isActivelyThinking, activeThinkingStep?.startTime, turnStartTime]);

  const wasActivelyThinkingRef = useRef(isActivelyThinking);
  useEffect(() => {
    if (wasActivelyThinkingRef.current && !isActivelyThinking) {
      setExpandedThoughts({});
    }
    wasActivelyThinkingRef.current = isActivelyThinking;
  }, [isActivelyThinking]);

  useEffect(() => {
    if (isActivelyThinking && thoughtScrollRef.current) {
      const el = thoughtScrollRef.current;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (isNearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [isActivelyThinking, thoughts, liveThinkingSeconds]);

  const hasWork = steps.length > 0 || thoughts.length > 0 || tools.length > 0;

  const hasPendingApproval = useMemo(() => {
    return tools.some(t => t.status === 'pending_approval' && !t.decision) ||
      steps.some((s: any) => s.type === 'approval' || (s.tools && s.tools.some((t: any) => t.status === 'pending_approval' && !t.decision)));
  }, [tools, steps]);

  const groupedTimeline = useMemo(() => {
    if (!clusterOpen && !isStreaming && !hasPendingApproval) return [];
    if (!hasWork && (!isStreaming || hasAssistantContent)) return [];
    const fullTimeline: TimelineEntry[] = [];

    if (steps && steps.length > 0) {
      steps.forEach((step: any, sIdx) => {
        if (step.type === 'thinking' || step.type === 'reasoning' || (step.thoughts && step.thoughts.length > 0)) {
          const thText = (step.content || (step.thoughts ? step.thoughts.join('\n\n') : '')).replace(/\[VERIFIED\]\s*/gi, '').replace(/<\/?(?:thought|thinking)>/gi, '').trim();
          if (thText) {
            const computedSecs = step.thinkingDurationSeconds || undefined;
            const lastEntry = fullTimeline[fullTimeline.length - 1];
            if (lastEntry && lastEntry.type === 'thought') {
              lastEntry.data.text += '\n\n' + thText;
              lastEntry.data.durationSecs = (lastEntry.data.durationSecs || 0) + computedSecs;
              if (step.status === 'running') lastEntry.data.status = 'running';
            } else {
              fullTimeline.push({
                id: step.id ? `thought-${step.id}-${sIdx}` : `thought-step-${sIdx}`,
                type: 'thought',
                data: {
                  text: thText,
                  durationSecs: computedSecs,
                  status: step.status || (isStreaming && sIdx === steps.length - 1 ? 'running' : 'completed'),
                  isLatest: sIdx === steps.length - 1,
                }
              });
            }
          }
        } else if (step.type === 'tool' || (!step.type && (step.name || step.tool_call_id))) {
          fullTimeline.push(parseToolItem(step, step.tool_call_id || (step.id ? `${step.id}_${sIdx}` : `tool_${sIdx}`)));
        } else if (step.tools && step.tools.length > 0) {
          const stepToolEntries = step.tools.map((t: any, tIdx: number) => parseToolItem(t, `${sIdx}_${tIdx}`));
          fullTimeline.push(...stepToolEntries);
        } else if (step.type === 'text' && step.content) {
          const noteText = step.content.replace(/\[VERIFIED\]\s*/gi, '').replace(/<\/?(?:thought|thinking)>/gi, '').trim();
          if (noteText) {
            fullTimeline.push({
              id: step.id ? `note-${step.id}-${sIdx}` : `note-step-${sIdx}`,
              type: 'text',
              data: {
                text: noteText,
                status: step.status || 'completed',
              }
            });
          }
        }
      });
      return groupTimelineEntries(fullTimeline);
    }

    const rawToolEntries = tools.map((t, tIdx) => parseToolItem(t, tIdx));
    const groupedTools = groupTimelineEntries(rawToolEntries);

    if (thoughts.length > 0) {
      const combinedThoughtText = thoughts.join('\n\n').replace(/\[VERIFIED\]\s*/gi, '').replace(/<\/?(?:thought|thinking)>/gi, '').trim();
      if (combinedThoughtText) {
        const computedSecs = thinkingDurationSeconds || undefined;
        fullTimeline.push({
          id: 'thought-primary',
          type: 'thought',
          data: {
            text: combinedThoughtText,
            durationSecs: computedSecs,
            isLatest: true,
          }
        });
      }
    }
    fullTimeline.push(...groupedTools);

    return fullTimeline;
  }, [steps, thoughts, tools, isStreaming, thinkingDurationSeconds, clusterOpen, hasPendingApproval, hasWork, hasAssistantContent]);

  const finalSecs = totalDurationSeconds || (isStreaming && turnStartTime ? Math.max(1, Math.round((Date.now() - turnStartTime) / 1000)) : undefined);
  const formattedTime = finalSecs ? formatDurationDisplay(finalSecs) : '';

  const hasDuration = Boolean(totalDurationSeconds || thinkingDurationSeconds || (isStreaming && turnStartTime));
  if (!hasWork && !isStreaming && !hasDuration) return null;
  if (!hasWork && isStreaming && hasAssistantContent) return null;

  const toggleThought = (id: string) => {
    setExpandedThoughts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCmd = (id: string) => {
    setExpandedCmds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const renderTimelineRow = (entry: TimelineEntry, isChild = false) => (
    <TimelineRow
      key={entry.id}
      entry={entry}
      isChild={isChild}
      isStreaming={isStreaming}
      thinkingDurationSeconds={thinkingDurationSeconds}
      onOpenFile={onOpenFile}
      onApproveTool={onApproveTool}
      liveThinkingSeconds={liveThinkingSeconds}
      latchedThinkingSeconds={latchedThinkingSeconds}
      expandedThoughts={expandedThoughts}
      expandedCmds={expandedCmds}
      expandedGroups={expandedGroups}
      copiedId={copiedId}
      toggleThought={toggleThought}
      toggleCmd={toggleCmd}
      toggleGroup={toggleGroup}
      handleCopy={handleCopy}
      setCopiedId={setCopiedId}
      thoughtScrollRef={thoughtScrollRef}
    />
  );

  // 1. While actively streaming: render timeline steps + dynamic "Working..." at end when no tool is running
  if (isStreaming) {
    const isAnyItemRunning = isActivelyThinking || groupedTimeline.some(entry => {
      if (entry.type === 'thought' && entry.data?.status === 'running') return true;
      if (entry.type === 'command_group' || entry.type === 'edit_group' || entry.type === 'exploration_group') {
        return Boolean(entry.data?.isRunning);
      }
      if (entry.data?.tool && isToolRunning(entry.data.tool, isStreaming)) return true;
      return false;
    });

    return (
      <div className="w-full min-w-0 text-[13px] font-sans my-1 select-none">
        {groupedTimeline.length > 0 && (
          <div className="flex flex-col gap-1 py-1 text-xs mb-1">
            {groupedTimeline.map((entry) => renderTimelineRow(entry, false))}
          </div>
        )}
        {!isAnyItemRunning && !hasAssistantContent && (
          <div className="flex items-center text-xs text-zinc-400 dark:text-zinc-500 font-sans py-0.5 select-none">
            <span>Working</span>
            <span className="inline-flex items-center ml-0.5 space-x-0.5 animate-loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  // 2. Completed turn: render summary button once turn is finished
  const hasThoughts = thoughts.length > 0 || (steps && steps.some((s: any) => s.type === 'thinking' || s.type === 'reasoning' || (s.thoughts && s.thoughts.length > 0)));
  let actionLabel = 'Completed';
  if (hasTools) {
    actionLabel = formattedTime ? `Worked for ${formattedTime}` : 'Worked';
  } else if (hasThoughts) {
    actionLabel = formattedTime ? `Thought for ${formattedTime}` : 'Thought';
  } else if (formattedTime) {
    actionLabel = `Completed in ${formattedTime}`;
  }

  const pendingApprovalEntry = groupedTimeline.find(
    (e) => e.type === 'approval' || (e.data?.tool && e.data.tool.status === 'pending_approval' && !e.data.tool.decision)
  );

  return (
    <div className="w-full min-w-0 text-[13px] font-sans my-1 select-text">
      <button
        type="button"
        aria-expanded={clusterOpen}
        onClick={toggleCluster}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-normal py-0.5 px-1 -mx-1 rounded-md hover:bg-muted/50 transition-all cursor-pointer select-none my-0.5 w-fit group"
      >
        <span className="font-sans">{actionLabel}</span>
        <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform", clusterOpen && "rotate-90")} />
      </button>

      {/* Prominently render pending approvals awaiting user decision */}
      {pendingApprovalEntry && !clusterOpen && (
        <div className="my-1.5 animate-in fade-in-50 slide-in-from-top-1">
          {renderTimelineRow(pendingApprovalEntry, false)}
        </div>
      )}

      {/* Grouped timeline items revealed upon user expansion */}
      {clusterOpen && (
        <div className="min-w-0 overflow-hidden mt-0.5 transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
          <div className="flex flex-col gap-1 py-1 text-xs">
            {groupedTimeline.length > 0 ? (
              groupedTimeline.map((entry) => renderTimelineRow(entry, false))
            ) : (
              <div className="text-xs text-muted-foreground/80 py-1 px-1 font-sans">
                Completed response {formattedTime ? `in ${formattedTime}` : ''}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
