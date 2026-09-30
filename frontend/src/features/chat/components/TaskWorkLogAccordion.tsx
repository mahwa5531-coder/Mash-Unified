"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimelineRow } from './work-log/TimelineRow';
import {
  formatDurationDisplay,
  parseToolItem,
  groupToolEntries,
  isToolRunning,
} from './work-log/toolTimeline';
import type { ToolCallItem, ExecutionStep, TimelineEntry } from './work-log/types';

interface TaskWorkLogAccordionProps {
  steps?: ExecutionStep[];
  thoughts?: string[];
  tools?: ToolCallItem[];
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  hasAssistantContent?: boolean;
  totalDurationSeconds?: number;
  onOpenFile?: (path: string) => void;
  isLast?: boolean;
  turnStartTime?: number;
}

export default function TaskWorkLogAccordion({
  steps = [],
  thoughts = [],
  tools = [],
  isStreaming = false,
  thinkingDurationSeconds,
  hasAssistantContent = false,
  totalDurationSeconds,
  onOpenFile,
  isLast = false,
  turnStartTime,
}: TaskWorkLogAccordionProps) {
  // Starts collapsed by default so finished turns display "Worked for {time} >" summary
  const [clusterOpen, setClusterOpen] = useState<boolean>(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedCmdIndex, setExpandedCmdIndex] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const thoughtScrollRef = useRef<HTMLDivElement>(null);

  // Live ticking seconds counter: runs strictly when the latest step is actively in reasoning/thinking phase from LLM output
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

  // Seamless live streaming reasoning card auto-scroll
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

  // Build chronologically authentic timeline: Step 1 (Thought -> Parallel Tools) -> Step 2 (Thought -> Edits) -> Step 3 (Command)
  const groupedTimeline = useMemo(() => {
    if (!hasWork && (!isStreaming || hasAssistantContent)) return [];
    const fullTimeline: TimelineEntry[] = [];

    // Branch A: We have discrete structured execution steps from the agent run
    if (steps && steps.length > 0) {
      const rawEntries: TimelineEntry[] = [];
      steps.forEach((step: any, sIdx) => {
        // 1. Unitised 'thinking' step or legacy step.thoughts
        if (step.type === 'thinking' || (step.thoughts && step.thoughts.length > 0)) {
          const thText = (step.content || (step.thoughts ? step.thoughts.join('\n\n') : '')).replace(/\[VERIFIED\]\s*/gi, '').trim();
          if (thText) {
            const computedSecs = step.thinkingDurationSeconds 
              || Math.max(1, Math.min(60, Math.round(thText.length / 120)));
            const lastEntry = rawEntries[rawEntries.length - 1];
            if (lastEntry && lastEntry.type === 'thought') {
              lastEntry.data.text += '\n\n' + thText;
              lastEntry.data.durationSecs = (lastEntry.data.durationSecs || 0) + computedSecs;
              if (step.status === 'running') lastEntry.data.status = 'running';
            } else {
              rawEntries.push({
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
        } else if (step.type === 'tool') {
          // 2. Unitised 'tool' step
          rawEntries.push(parseToolItem(step, step.tool_call_id || (step.id ? `${step.id}_${sIdx}` : `tool_${sIdx}`)));
        } else if (step.tools && step.tools.length > 0) {
          // 3. Legacy step with tools array
          step.tools.forEach((t: any, tIdx: number) => {
            rawEntries.push(parseToolItem(t, `${sIdx}_${tIdx}`));
          });
        }
      });
      return groupToolEntries(rawEntries, isStreaming);
    }

    // Branch B: Streaming or legacy flat messages fallback
    const rawToolEntries = tools.map((t, tIdx) => parseToolItem(t, tIdx));
    const groupedTools = groupToolEntries(rawToolEntries, isStreaming);

    if (thoughts.length > 0) {
      const combinedThoughtText = thoughts.join('\n\n').trim();
      if (combinedThoughtText) {
        const computedSecs = thinkingDurationSeconds 
          || Math.max(1, Math.min(60, Math.round(combinedThoughtText.length / 120)));
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
  }, [steps, thoughts, tools, isStreaming, thinkingDurationSeconds]);

  // Format header time for completed turn (e.g. 3m or 26s)
  const fallbackSecs = Math.max(
    1,
    (thinkingDurationSeconds || 0) + tools.length * 2
  );
  const blockSecs = useMemo(() => {
    if (steps && steps.length > 0) {
      let totalMs = 0;
      for (const s of steps) {
        if (s.durationMs) totalMs += s.durationMs;
        else if (s.durationSeconds) totalMs += s.durationSeconds * 1000;
        else if (s.thinkingDurationSeconds) totalMs += s.thinkingDurationSeconds * 1000;
      }
      if (totalMs > 0) return Math.max(1, Math.round(totalMs / 1000));
      return Math.max(1, steps.length * 2);
    }
    return totalDurationSeconds || fallbackSecs;
  }, [steps, totalDurationSeconds, fallbackSecs]);

  const finalSecs = totalDurationSeconds || fallbackSecs;
  const formattedTime = formatDurationDisplay(finalSecs);
  const blockFormattedTime = formatDurationDisplay(blockSecs);

  if (!hasWork && (!isStreaming || hasAssistantContent)) return null;

  const toggleThought = (id: string) => {
    setExpandedThoughts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };


  const renderTimelineRow = (entry: TimelineEntry, isChild = false) => (
    <TimelineRow
      entry={entry}
      isChild={isChild}
      isStreaming={isStreaming}
      thinkingDurationSeconds={thinkingDurationSeconds}
      onOpenFile={onOpenFile}
      liveThinkingSeconds={liveThinkingSeconds}
      latchedThinkingSeconds={latchedThinkingSeconds}
      expandedThoughts={expandedThoughts}
      expandedCmdIndex={expandedCmdIndex}
      expandedGroups={expandedGroups}
      copiedId={copiedId}
      toggleThought={toggleThought}
      toggleGroup={toggleGroup}
      handleCopy={handleCopy}
      setExpandedCmdIndex={setExpandedCmdIndex}
      setCopiedId={setCopiedId}
      thoughtScrollRef={thoughtScrollRef}
    />
  );

  // 1. While actively streaming: render timeline steps + dynamic animated "Working..." or "Thinking for Xs..."
  if (isStreaming) {
    const isActivelyThinkingNow = isActivelyThinking || (activeThinkingStep !== null);
    const activeTool = tools.find(t => isToolRunning(t)) || (steps ? steps.find((s: any) => s.type === 'tool' && s.status === 'running') : null);

    return (
      <div className="w-full min-w-0 text-[13px] font-sans my-1 select-none">
        {groupedTimeline.length > 0 && (
          <div className="flex flex-col gap-1 py-1 text-xs mb-1">
            {groupedTimeline.map((entry) => renderTimelineRow(entry, false))}
          </div>
        )}
        {isActivelyThinkingNow && !groupedTimeline.some(e => e.type === 'thought') ? (
          <div className="flex items-center gap-1.5 text-xs text-foreground font-sans py-0.5">
            <Loader2 size={11} className="animate-spin text-sky-500 shrink-0" />
            <span>Thinking for {formatDurationDisplay(liveThinkingSeconds)}</span>
            <span className="inline-flex items-center ml-0.5 space-x-0.5 animate-loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        ) : activeTool ? (
          <div className="flex items-center gap-1.5 text-xs text-sky-500 dark:text-sky-400 font-sans py-0.5">
            <Loader2 size={11} className="animate-spin shrink-0" />
            <span>Running {activeTool.name || 'tool'}</span>
            <span className="inline-flex items-center ml-0.5 space-x-0.5 animate-loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        ) : !hasAssistantContent ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-sans py-0.5">
            <Loader2 size={11} className="animate-spin text-zinc-400 shrink-0" />
            <span className="inline-flex items-center text-muted-foreground">
              <span>Working</span>
              <span className="inline-flex items-center ml-0.5 space-x-0.5 animate-loading-dots">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  // 2. Completed turn: render "Worked for {formattedTime} >" or "Thought for {formattedTime} >" naked text link dropdown
  const hasOnlyThoughts = (!tools || tools.length === 0) && (!steps || steps.length === 0 || steps.every((s: any) => s.type === 'thinking' || (!s.tools || s.tools.length === 0) && (!s.name || s.name === 'thought')));
  const actionLabel = hasOnlyThoughts ? `Thought for ${formattedTime}` : `Worked for ${formattedTime}`;

  return (
    <div className="w-full min-w-0 text-[13px] font-sans my-1 select-text">
      <button
        type="button"
        aria-expanded={clusterOpen}
        onClick={() => setClusterOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-normal py-0.5 px-1 -mx-1 rounded-md hover:bg-muted/50 transition-all cursor-pointer select-none my-0.5 w-fit group"
      >
        <span className="font-sans">{actionLabel}</span>
        <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform", clusterOpen && "rotate-90")} />
      </button>

      {/* Chronological Timeline List revealed only when user expands */}
      {clusterOpen && (
        <div className="min-w-0 overflow-hidden mt-0.5 transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
          <div className="flex flex-col gap-1 py-1 text-xs">
            {groupedTimeline.map((entry) => renderTimelineRow(entry, false))}
          </div>
        </div>
      )}
    </div>
  );
}