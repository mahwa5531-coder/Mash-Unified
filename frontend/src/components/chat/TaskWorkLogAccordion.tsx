"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ChevronRight, Loader2, Check, Copy, AlertCircle
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FileIcon from '../common/FileIcon';

export interface ToolCallItem {
  id?: string;
  name: string;
  args?: Record<string, any>;
  output?: string;
  status?: 'running' | 'completed' | 'failed';
  durationSeconds?: number;
}

export interface ExecutionStep {
  id?: string;
  step_index?: number;
  type?: string;
  content?: string;
  name?: string;
  args?: Record<string, any>;
  output?: string;
  status?: 'running' | 'completed' | 'failed' | 'cancelled';
  action_type?: string;
  tool_call_id?: string;
  durationMs?: number;
  durationSeconds?: number;
  thinkingDurationSeconds?: number;
  startTime?: number;
  thoughts?: string[];
  tools?: ToolCallItem[];
}

// ponytail: explicit status check prevents completed tools with empty output from staying stuck on "running"
function isToolRunning(tool?: ToolCallItem, isStreaming?: boolean): boolean {
  if (!tool) return false;
  if (tool.status === 'completed' || tool.status === 'failed' || (tool.status as string) === 'cancelled') return false;
  if (tool.status === 'running') return true;
  return !!(isStreaming && tool.output === undefined);
}

function formatToolDuration(tool?: ToolCallItem): string | null {
  const secs = tool?.durationSeconds ?? ((tool as any)?.durationMs ? (tool as any).durationMs / 1000 : undefined);
  if (secs !== undefined && secs > 0) {
    if (secs < 1) {
      return `${Math.round(secs * 1000)}ms`;
    }
    return `${secs.toFixed(1)}s`;
  }
  return null;
}

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

function extractLineRange(args?: Record<string, any>): string | null {
  if (!args) return null;
  const start = args.StartLine ?? args.start_line ?? args.startLine;
  const end = args.EndLine ?? args.end_line ?? args.endLine;
  if (start && end) return `#L${start}-${end}`;
  if (start) return `#L${start}`;
  return null;
}

function FilePill({
  filename,
  filePath,
  lineRange,
  onOpenFile,
}: {
  filename: string;
  filePath: string;
  lineRange?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenFile?.(filePath);
      }}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[5px] font-mono text-[12px] bg-zinc-100 hover:bg-zinc-200/90 dark:bg-[#1e1e22] dark:hover:bg-[#27272c] text-zinc-900 dark:text-zinc-200 border border-zinc-300/80 dark:border-white/[0.08] hover:border-zinc-400 dark:hover:border-white/[0.22] hover:shadow-sm dark:hover:shadow-[0_0_10px_rgba(255,255,255,0.08)] transition-all duration-150 ease-out cursor-pointer select-none shadow-xs group/file active:scale-[0.98]"
      title={`Open ${filePath}`}
    >
      <FileIcon filename={filename || filePath} size={13} className="shrink-0 group-hover/file:scale-105 transition-transform" />
      <span className="truncate max-w-[240px] font-medium text-zinc-800 dark:text-zinc-200 group-hover/file:text-zinc-950 dark:group-hover/file:text-white transition-colors">{filename}</span>
      {lineRange && (
        <span className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px] shrink-0 font-normal ml-0.5">
          {lineRange}
        </span>
      )}
    </button>
  );
}

// ponytail: parse file:/// URIs in tool outputs into interactive clickable buttons
function renderOutputWithLinks(text: string, onOpenFile?: (path: string) => void) {
  if (!text) return null;
  const linkRegex = /(file:\/\/\/[^\s\)\"\']+)/g;
  const parts = text.split(linkRegex);
  if (parts.length === 1) return text;

  return parts.map((part, idx) => {
    if (part.startsWith('file:///')) {
      const cleanPath = decodeURIComponent(part.replace(/^file:\/\/\/?/, '')).replace(/^\/([a-zA-Z]:)/, '$1');
      const basename = cleanPath.split(/[/\\]/).pop() || cleanPath;
      return (
        <button
          key={idx}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenFile?.(cleanPath);
          }}
          className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline cursor-pointer font-mono font-medium underline-offset-2 select-text"
          title={`Open ${cleanPath}`}
        >
          {basename}
        </button>
      );
    }
    return part;
  });
}

interface TimelineEntry {
  id: string;
  type: 'thought' | 'text' | 'file_read' | 'folder_view' | 'search' | 'task' | 'timer' | 'subagent' | 'edit' | 'command' | 'other' | 'command_group' | 'exploration_group' | 'edit_group';
  data: any;
  items?: TimelineEntry[];
}

function formatDurationDisplay(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
}

function parseToolItem(t: ToolCallItem, tIdx: number | string): TimelineEntry {
  const name = (t.name || '').toLowerCase();
  let args = t.args || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  if (
    name.includes('run_shell_command') || 
    name.includes('run_command') || 
    name.includes('shell') || 
    name.includes('run_code') ||
    name.includes('bash') ||
    name.includes('terminal')
  ) {
    const rawCmd = args.CommandLine || args.command || args.cmd || args.code || args.source_code || (typeof args === 'string' ? args : 'command');
    const cleanCmd = String(rawCmd).replace(/^powershell\s+-Command\s+/i, '').trim();
    return {
      id: `tool-${tIdx}`,
      type: 'command',
      data: { tool: t, cmd: cleanCmd, fullCmd: String(rawCmd) }
    };
  } else if (name.includes('list_directory') || name.includes('list_dir') || name.includes('browse')) {
    const p = args.DirectoryPath || args.dir_path || args.path || 'directory';
    const fname = String(p).split(/[/\\]/).pop() || p;
    return {
      id: `tool-${tIdx}`,
      type: 'folder_view',
      data: { tool: t, foldername: fname, folderPath: String(p) }
    };
  } else if (name.includes('read_file') || name.includes('view_file') || name.includes('read_many_files') || name.includes('get_file')) {
    const p = args.TargetFile || args.AbsolutePath || args.file_path || args.path || 'file';
    const fname = String(p).split(/[/\\]/).pop() || p;
    const isDir = !fname.includes('.') || name.includes('list');
    if (isDir) {
      return {
        id: `tool-${tIdx}`,
        type: 'folder_view',
        data: { tool: t, foldername: fname, folderPath: String(p) }
      };
    } else {
      return {
        id: `tool-${tIdx}`,
        type: 'file_read',
        data: { tool: t, filename: fname, filePath: String(p), lineRange: extractLineRange(args) }
      };
    }
  } else if (
    name === 'replace' ||
    name.includes('replace_file_content') ||
    name.includes('write_file') ||
    name.includes('write_to_file') ||
    name.includes('edit_file') ||
    name.includes('multiedit') ||
    name.includes('apply_patch') ||
    name.includes('patch') ||
    name === 'write'
  ) {
    const p = args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.target_file || args.filepath || 'file';
    const fname = String(p).split(/[/\\]/).pop() || p;
    let added = 0;
    let deleted = 0;

    if (args.ReplacementContent !== undefined && args.TargetContent !== undefined) {
      added = String(args.ReplacementContent).split('\n').length;
      deleted = String(args.TargetContent).split('\n').length;
    } else if (args.new_string !== undefined && args.old_string !== undefined) {
      added = String(args.new_string).split('\n').length;
      deleted = String(args.old_string).split('\n').length;
    } else if (Array.isArray(args.edits)) {
      for (const edit of args.edits) {
        if (edit?.new_string) added += String(edit.new_string).split('\n').length;
        if (edit?.old_string) deleted += String(edit.old_string).split('\n').length;
      }
      added = Math.max(1, added);
    } else if (args.patch || args.input) {
      const patchLines = String(args.patch || args.input).split('\n');
      for (const line of patchLines) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++;
        else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
      }
      added = Math.max(1, added);
    } else if (args.CodeContent !== undefined || args.content !== undefined) {
      added = String(args.CodeContent ?? args.content ?? '').split('\n').length;
      deleted = 0;
    }

    return {
      id: `tool-${tIdx}`,
      type: 'edit',
      data: { 
        tool: t, 
        filename: fname, 
        filePath: String(p), 
        added, 
        deleted, 
        lineRange: extractLineRange(args) 
      }
    };
  } else if (
    name.includes('search') || 
    name.includes('glob') || 
    name.includes('grep') || 
    name.includes('find') ||
    name.includes('web_fetch') ||
    name.includes('read_url_content')
  ) {
    const pattern = args.Query || args.Pattern || args.pattern || args.query || args.search_term || args.url || args.Url || '*';
    let countStr = '';
    if (t.output) {
      const lines = t.output.split('\n').filter((l) => l.trim().length > 0);
      countStr = `${lines.length} result${lines.length !== 1 ? 's' : ''}`;
    }
    return {
      id: `tool-${tIdx}`,
      type: 'search',
      data: { tool: t, pattern: String(pattern), countStr }
    };
  } else if (name.includes('invoke_subagent') || name.includes('define_subagent') || (name.includes('subagent') && !name.includes('manage'))) {
    let subagentRoles: string[] = [];
    if (Array.isArray(args.Subagents)) {
      subagentRoles = args.Subagents.map((s: any) => s.Role || s.TypeName || 'Subagent');
    } else if (args.Role || args.TypeName) {
      subagentRoles = [args.Role || args.TypeName];
    }
    const roleLabel = subagentRoles.length > 0 ? subagentRoles.join(', ') : (args.toolSummary || args.description || 'Subagent');
    return {
      id: `tool-${tIdx}`,
      type: 'subagent',
      data: { tool: t, roleLabel, args }
    };
  } else if (name.includes('schedule') || (name.includes('timer') && !name.includes('manage'))) {
    const dur = args.DurationSeconds ?? args.duration_seconds ?? args.duration ?? args.seconds ?? 0;
    const prompt = args.Prompt || args.prompt || args.description || args.toolSummary || '';
    return {
      id: `tool-${tIdx}`,
      type: 'timer',
      data: { tool: t, durationSeconds: Number(dur), prompt: String(prompt) }
    };
  } else if (
    name.includes('task') || 
    name.includes('manage_task')
  ) {
    const isStatusCheck = args.Action === 'status';
    let taskName = args.toolSummary || args.description || args.Prompt || '';
    if (!taskName) {
      if (args.Action === 'list') taskName = 'Running background tasks';
      else if (args.Action === 'status') taskName = args.TaskId ? `task ${args.TaskId}` : 'task';
      else if (args.Action === 'kill') taskName = `Cancel task ${args.TaskId || ''}`.trim();
      else if (args.TaskId) taskName = `Task ${args.TaskId}`;
      else taskName = 'Background task';
    }
    return {
      id: `tool-${tIdx}`,
      type: 'task',
      data: { tool: t, taskName: String(taskName), isStatusCheck, action: args.Action }
    };
  } else {
    return {
      id: `tool-${tIdx}`,
      type: 'other',
      data: { tool: t }
    };
  }
}

/**
 * Returns timeline entries individually without coalescing into grouped cards.
 * ponytail: Each tool step (file read, folder view, search, command, edit) is rendered
 * individually as its own distinct row, matching individual tool rendering across the UI.
 */
function groupToolEntries(entries: TimelineEntry[], _isStreaming: boolean): TimelineEntry[] {
  return entries;
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
        } else if (step.type === 'text' && step.content && step.content.trim()) {
          // ponytail: Render intermediate working text between tools as an authentic unitised step
          const cleanText = step.content.replace(/\[VERIFIED\]\s*/gi, '').trim();
          if (cleanText) {
            const hasRemainingTools = steps.slice(sIdx + 1).some((s: any) => s.type === 'tool' || (s.tools && s.tools.length > 0) || s.type === 'thinking');
            if (hasRemainingTools || (isStreaming && sIdx < steps.length - 1)) {
              rawEntries.push({
                id: step.id ? `text-${step.id}-${sIdx}` : `text-step-${sIdx}`,
                type: 'text',
                data: {
                  text: cleanText,
                },
              });
            }
          }
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

  const renderTimelineRow = (entry: TimelineEntry, isChild = false) => {
    // 1. Thought Row: Naked text link + Dedicated Thought Card with distinct reasoning typography
    if (entry.type === 'thought') {
      const isThoughtActive = Boolean(isStreaming && entry.data.status === 'running');
      const isExpanded = !!expandedThoughts[entry.id] || isThoughtActive;
      const displaySecs = isThoughtActive 
        ? liveThinkingSeconds 
        : (entry.data.durationSecs || thinkingDurationSeconds || latchedThinkingSeconds || 1);

      return (
        <div key={entry.id} className="my-1">
          <button
            type="button"
            onClick={() => toggleThought(entry.id)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-normal py-0.5 cursor-pointer select-none transition-colors group"
          >
            <span className="font-sans">
              {isThoughtActive 
                ? `Thinking for ${formatDurationDisplay(liveThinkingSeconds)}...` 
                : `Thought for ${formatDurationDisplay(displaySecs)}`}
            </span>
            <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isExpanded && "rotate-90")} />
          </button>

          {isExpanded && (
            <div 
              ref={isThoughtActive ? thoughtScrollRef : undefined}
              className="mt-1.5 rounded-xl border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015] p-2.5 text-[12px] leading-relaxed text-muted-foreground select-text max-h-60 overflow-y-auto custom-scrollbar font-sans transition-all duration-200 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_strong]:text-foreground [&_strong]:font-medium [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:space-y-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-zinc-200/50 dark:[&_code]:bg-white/[0.06] [&_code]:text-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_pre]:my-1.5 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:bg-zinc-100/50 dark:[&_pre]:bg-white/[0.03] [&_pre]:border [&_pre]:border-zinc-200/60 dark:[&_pre]:border-white/[0.05]"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {entry.data.text}
              </ReactMarkdown>
            </div>
          )}
        </div>
      );
    }

    // 2. Clean Unified Exploration Card: ONLY for 2+ parallel exploratory items
    if (entry.type === 'exploration_group') {
      const isGroupExpanded = !!expandedGroups[entry.id];
      return (
        <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
          <button
            type="button"
            onClick={() => toggleGroup(entry.id)}
            className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-muted-foreground font-sans">
                {entry.data.isCancelled
                  ? 'Cancelled'
                  : !entry.data.summaryText.includes('file') && !entry.data.summaryText.includes('search') && !entry.data.summaryText.includes('folder')
                  ? (entry.data.isRunning ? 'Running' : 'Ran')
                  : (entry.data.isRunning ? 'Exploring' : 'Explored')}
              </span>
              <span className="font-medium text-foreground truncate">
                {entry.data.summaryText}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
                {entry.data.totalCount}
              </Badge>
              <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
            </div>
          </button>

          {isGroupExpanded && (
            <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
              {entry.items?.map((child) => renderTimelineRow(child, true))}
            </div>
          )}
        </div>
      );
    }

    // 3. Command Group: Clean Unified Card for 2+ parallel commands
    if (entry.type === 'command_group') {
      const isGroupExpanded = !!expandedGroups[entry.id];
      return (
        <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
          <button
            type="button"
            onClick={() => toggleGroup(entry.id)}
            className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-muted-foreground font-sans">
                {entry.data.isCancelled ? 'Cancelled' : entry.data.isRunning ? 'Running' : 'Ran'}
              </span>
              <span className="font-medium text-foreground font-sans">
                {entry.data.count} commands
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
                {entry.data.count}
              </Badge>
              <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
            </div>
          </button>

          {isGroupExpanded && (
            <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
              {entry.items?.map((child) => renderTimelineRow(child, true))}
            </div>
          )}
        </div>
      );
    }

    // 3b. Edit Group: Clean Unified Card for 2+ parallel edits
    if (entry.type === 'edit_group') {
      const isGroupExpanded = !!expandedGroups[entry.id];
      return (
        <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-1 rounded-xl overflow-hidden transition-colors duration-200", isGroupExpanded ? "border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-50/50 dark:bg-white/[0.015]" : "hover:bg-muted/30")}>
          <button
            type="button"
            onClick={() => toggleGroup(entry.id)}
            className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none group w-full transition-colors text-xs"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-muted-foreground font-sans">
                {entry.data.isCancelled ? 'Cancelled' : entry.data.isRunning ? 'Editing' : 'Edited'}
              </span>
              <span className="font-medium text-foreground font-sans">
                {entry.data.count} files
              </span>
              {(entry.data.added > 0 || entry.data.deleted > 0) && (
                <span className="inline-flex items-center gap-1 text-[11px] font-mono shrink-0 ml-1">
                  {entry.data.added > 0 && (
                    <span className="px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">+{entry.data.added}</span>
                  )}
                  {entry.data.deleted > 0 && (
                    <span className="px-1 py-0.2 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">-{entry.data.deleted}</span>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-mono">
                {entry.data.count}
              </Badge>
              <ChevronRight size={11} className={cn("text-muted-foreground transition-transform shrink-0", isGroupExpanded && "rotate-90")} />
            </div>
          </button>

          {isGroupExpanded && (
            <div className="border-t border-zinc-200/60 dark:border-white/[0.05] overflow-hidden divide-y divide-zinc-200/40 dark:divide-white/[0.03] transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
              {entry.items?.map((child) => renderTimelineRow(child, true))}
            </div>
          )}
        </div>
      );
    }

    // 4. Single Command Row: Naked text dropdown with expandable console
    if (entry.type === 'command') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const toolId = String(entry.data.tool?.id || entry.id);
      const isCmdExpanded = expandedCmdIndex === toolId;
      const rawOutput = entry.data.tool?.output || '';
      const outputText = rawOutput.trim();
      const hasOutput = outputText.length > 0 && outputText !== 'Done.';
      const isFailed = entry.data.tool?.status === 'failed' || /error|failed|command not found/i.test(outputText);
      const duration = formatToolDuration(entry.data.tool);

      return (
        <div key={entry.id} className={cn("flex flex-col min-w-0 max-w-full my-0.5", isChild ? "px-3 py-1 hover:bg-muted/40 transition-colors" : "")}>
          <div
            onClick={() => hasOutput && setExpandedCmdIndex(isCmdExpanded ? null : toolId)}
            className={cn(
              "flex items-center justify-between text-xs py-0.5 group select-none transition-colors w-full",
              hasOutput ? "cursor-pointer" : "cursor-default"
            )}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
              <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
                {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
                {isCancelled ? 'Cancelled' : isRunning ? 'Running' : 'Ran'}
              </span>
              <span className="font-mono text-foreground font-medium truncate max-w-xl">{entry.data.cmd}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {duration && (
                <span className="font-mono text-[10.5px] text-muted-foreground/70 tabular-nums">
                  {duration}
                </span>
              )}
              {hasOutput && (
                <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform shrink-0", isCmdExpanded && "rotate-90")} />
              )}
            </div>
          </div>

          {hasOutput && isCmdExpanded && (
            <div className="py-1 overflow-hidden transition-all duration-200 ease-out animate-in fade-in-50 slide-in-from-top-1">
              <div className="w-full rounded-lg border border-zinc-200/70 dark:border-white/[0.06] bg-zinc-100/40 dark:bg-white/[0.02] p-2 font-mono text-[11px] transition-colors duration-200 shadow-none">
                <div className="text-muted-foreground mb-1 flex items-center justify-between border-b border-zinc-200/60 dark:border-white/[0.05] pb-1 text-[10.5px]">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-muted-foreground/60 truncate text-[10px]">...\Mash &gt;</span>
                    <span className="text-foreground/90 font-medium truncate text-[10.5px]">{entry.data.fullCmd}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(outputText || entry.data.fullCmd, toolId);
                      }}
                      className="p-0.5 text-muted-foreground hover:text-foreground rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
                      title="Copy command/output"
                    >
                      {copiedId === toolId ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                    </button>
                    {isFailed ? (
                      <AlertCircle size={12} className="text-rose-500" />
                    ) : (
                      <Check size={12} className="text-emerald-500/80" />
                    )}
                  </div>
                </div>
                <pre className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-tight max-h-24 overflow-y-auto custom-scrollbar font-mono text-[10.5px]">
                  {renderOutputWithLinks(outputText, onOpenFile)}
                </pre>
              </div>
            </div>
          )}
        </div>
      );
    }

    // 5. File Read Row: Naked text row
    if (entry.type === 'file_read') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const duration = formatToolDuration(entry.data.tool);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Canceled' : isRunning ? 'Analyzing' : 'Analyzed'}
            </span>
            <FilePill
              filename={entry.data.filename}
              filePath={entry.data.filePath}
              lineRange={entry.data.lineRange}
              onOpenFile={onOpenFile}
            />
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 6. Edited File Row: Naked text row with diff counts and duration
    if (entry.type === 'edit') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const duration = formatToolDuration(entry.data.tool);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Canceled' : isRunning ? 'Editing' : 'Edited'}
            </span>
            <FilePill
              filename={entry.data.filename}
              filePath={entry.data.filePath}
              onOpenFile={onOpenFile}
            />
            <span className="inline-flex items-center gap-1 text-[11.5px] font-mono shrink-0 ml-1.5 font-medium select-none">
              {entry.data.added > 0 && (
                <span className="text-emerald-500 dark:text-emerald-400">+{entry.data.added}</span>
              )}
              {entry.data.deleted > 0 && (
                <span className="text-rose-500 dark:text-rose-400">-{entry.data.deleted}</span>
              )}
              {entry.data.added === 0 && entry.data.deleted === 0 && (
                <span className="text-zinc-500 dark:text-zinc-400">+0 -0</span>
              )}
            </span>
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 7. Folder View Row: Naked text row
    if (entry.type === 'folder_view') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const duration = formatToolDuration(entry.data.tool);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Canceled' : isRunning ? 'Analyzing' : 'Analyzed'}
            </span>
            <span className="font-medium text-foreground truncate max-w-sm">
              {entry.data.foldername}
            </span>
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 8. Search Row: Naked text row
    if (entry.type === 'search') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const duration = formatToolDuration(entry.data.tool);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
              {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
              {isCancelled ? 'Canceled' : isRunning ? 'Searching' : 'Searched'}
            </span>
            <span className="font-mono text-foreground font-medium truncate max-w-sm">
              {entry.data.pattern}
            </span>
            {entry.data.countStr && (
              <span className="text-muted-foreground text-[10.5px] font-mono px-1 py-0.2 rounded bg-muted border border-border/40 shrink-0">
                {entry.data.countStr}
              </span>
            )}
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 8b. Timer Row (schedule/timer tool)
    if (entry.type === 'timer') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const isCancelled = entry.data.tool?.status === 'cancelled';
      const duration = formatToolDuration(entry.data.tool);
      const isExpanded = !!expandedGroups[entry.id];
      const durLabel = entry.data.durationSeconds ? `${entry.data.durationSeconds} seconds` : 'timer';
      return (
        <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <button
            type="button"
            onClick={() => toggleGroup(entry.id)}
            className="flex items-center justify-between min-w-0 w-full text-left cursor-pointer group"
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 text-muted-foreground font-sans shrink-0">
                {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
                {isCancelled ? 'Canceled' : isRunning ? 'Timing' : 'Timed'}
              </span>
              <span className="font-medium text-foreground truncate">{durLabel}</span>
              <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform ml-0.5", isExpanded && "rotate-90")} />
            </div>
            {duration && (
              <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
                {duration}
              </span>
            )}
          </button>
          {isExpanded && entry.data.prompt && (
            <div className="mt-1 pl-4 text-[11.5px] text-muted-foreground font-sans">
              {entry.data.prompt}
            </div>
          )}
        </div>
      );
    }

    // 9. Task Action Row (Standalone process action - manage_task / background task)
    if (entry.type === 'task') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const duration = formatToolDuration(entry.data.tool);
      const isExpanded = !!expandedGroups[entry.id];
      const hasOutput = !!(entry.data.tool?.output && entry.data.tool.output.trim().length > 0);
      const isTimerNotification = entry.data.taskName.includes('Timer has expired') || entry.data.taskName.includes('Timer:');

      return (
        <div key={entry.id} className={cn("flex flex-col text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <button
            type="button"
            onClick={() => hasOutput && toggleGroup(entry.id)}
            className={cn("flex items-center justify-between min-w-0 w-full text-left group", hasOutput && "cursor-pointer")}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="inline-flex items-center gap-1 font-medium text-foreground truncate max-w-md">
                {isRunning && <Loader2 size={10} className="animate-spin text-sky-500 shrink-0" />}
                {entry.data.isStatusCheck
                  ? `Checked task ${entry.data.taskName}`
                  : `${entry.data.taskName}${!isRunning && !isTimerNotification && !entry.data.taskName.endsWith('finished') ? ' finished' : ''}`}
              </span>
              {hasOutput && (
                <ChevronRight size={11} className={cn("text-muted-foreground group-hover:text-foreground transition-transform ml-0.5 shrink-0", isExpanded && "rotate-90")} />
              )}
            </div>
            {duration && (
              <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
                {duration}
              </span>
            )}
          </button>
          {isExpanded && hasOutput && (
            <div className="mt-1 rounded-md bg-muted/40 border border-border/40 p-2 font-mono text-[11px] text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">
              {renderOutputWithLinks(entry.data.tool.output, onOpenFile)}
            </div>
          )}
        </div>
      );
    }

    // 10. Subagent Invocation Row
    if (entry.type === 'subagent') {
      const isRunning = isToolRunning(entry.data.tool, isStreaming);
      const duration = formatToolDuration(entry.data.tool);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs py-0.5 select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "")}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-muted-foreground font-sans shrink-0">{isRunning ? 'Running subagent' : 'Subagent task'}</span>
            <Badge variant="outline" className="text-foreground border-border/60 text-[11px] truncate max-w-sm">
              {entry.data.roleLabel}
            </Badge>
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 11. Other Action Row
    if (entry.type === 'other') {
      const t = entry.data.tool;
      const displayName = t?.name && t?.name !== 'action' ? t.name : 'Action';
      const isRunning = isToolRunning(t, isStreaming);
      const duration = formatToolDuration(t);
      return (
        <div key={entry.id} className={cn("flex items-center justify-between text-xs select-none transition-colors", isChild ? "px-3 py-1 hover:bg-muted/40" : "py-0.5")}>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="shrink-0 text-muted-foreground font-sans">{isRunning ? 'Executing' : 'Executed'}</span>
            <span className="font-mono text-foreground truncate max-w-sm">{displayName}</span>
          </div>
          {duration && (
            <span className="font-mono text-[10.5px] text-muted-foreground/70 shrink-0 ml-2 tabular-nums">
              {duration}
            </span>
          )}
        </div>
      );
    }

    // 12. Intermediate In-Flow Text Step Row
    if (entry.type === 'text') {
      const cleanText = (entry.data.text || '').replace(/\[VERIFIED\]\s*/gi, '').trim();
      if (!cleanText) return null;
      return (
        <div key={entry.id} className="text-zinc-600 dark:text-zinc-400 text-xs py-1 px-1 font-sans leading-relaxed select-text whitespace-pre-wrap">
          {cleanText}
        </div>
      );
    }

    return null;
  };

  // 1. While actively streaming: render timeline steps + dynamic animated "Working..." or "Thinking for Xs..."
  if (isStreaming) {
    return (
      <div className="w-full min-w-0 text-[13px] font-sans my-1 select-none">
        {groupedTimeline.length > 0 && (
          <div className="flex flex-col gap-1 py-1 text-xs mb-1">
            {groupedTimeline.map((entry) => renderTimelineRow(entry, false))}
          </div>
        )}
        {isActivelyThinking && !groupedTimeline.some(e => e.type === 'thought') ? (
          <div className="flex items-center gap-1.5 text-xs text-foreground font-sans py-0.5">
            <Loader2 size={11} className="animate-spin text-sky-500 shrink-0" />
            <span>Thinking for {formatDurationDisplay(liveThinkingSeconds)}</span>
            <span className="inline-flex items-center ml-0.5 space-x-0.5 animate-loading-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        ) : !isActivelyThinking && groupedTimeline.length === 0 ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-sans py-0.5">
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
