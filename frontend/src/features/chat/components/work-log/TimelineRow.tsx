"use client";

// One timeline row (thought card / tool row / command console / group card).
// Prop names mirror TaskWorkLogAccordion identifiers (container/view split).
import React from 'react';
import { cn } from '@/lib/utils';
import type { TimelineEntry } from './types';
import { ThoughtTimelineRow } from './ThoughtTimelineRow';
import { GroupTimelineRow } from './GroupTimelineRow';
import { CommandTimelineRow } from './CommandTimelineRow';
import { ToolTimelineRow } from './ToolTimelineRow';
import { ApprovalCard } from '../approval/ApprovalCard';

interface TimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  onOpenFile?: (path: string) => void;
  onApproveTool?: (toolCallId: string, action: 'allow_once' | 'allow' | 'deny', feedback?: string) => Promise<void> | void;
  liveThinkingSeconds: number;
  latchedThinkingSeconds: number | null;
  expandedThoughts: Record<string, boolean>;
  expandedCmds: Record<string, boolean>;
  expandedGroups: Record<string, boolean>;
  copiedId: string | null;
  toggleThought: (id: string) => void;
  toggleCmd: (id: string) => void;
  toggleGroup: (id: string) => void;
  handleCopy: (text: string, id: string) => void;
  setCopiedId: React.Dispatch<React.SetStateAction<string | null>>;
  thoughtScrollRef: React.RefObject<HTMLDivElement | null>;
}

export function TimelineRow(props: TimelineRowProps) {
  const { entry, isChild = false } = props;

  // Recursive rendering for child rows inside group cards.
  const renderChildRow = (childEntry: TimelineEntry) => (
    <TimelineRow {...props} entry={childEntry} isChild={true} />
  );

  // 1. Thought Row
  if (entry.type === 'thought') {
    return (
      <ThoughtTimelineRow
        entry={entry}
        isStreaming={props.isStreaming}
        thinkingDurationSeconds={props.thinkingDurationSeconds}
        liveThinkingSeconds={props.liveThinkingSeconds}
        latchedThinkingSeconds={props.latchedThinkingSeconds}
        isExpanded={!!props.expandedThoughts[entry.id]}
        toggleThought={props.toggleThought}
        thoughtScrollRef={props.thoughtScrollRef}
      />
    );
  }

  // 2. Command, Edit, or Exploration Groups
  if (entry.type === 'command_group' || entry.type === 'edit_group' || entry.type === 'exploration_group') {
    return (
      <GroupTimelineRow
        entry={entry}
        isGroupExpanded={!!props.expandedGroups[entry.id]}
        toggleGroup={props.toggleGroup}
        renderChildRow={renderChildRow}
      />
    );
  }

  // 3. Command Row
  if (entry.type === 'command') {
    const toolId = String(entry.data?.tool?.id || entry.id);
    return (
      <CommandTimelineRow
        entry={entry}
        isChild={isChild}
        isStreaming={props.isStreaming}
        isCmdExpanded={!!props.expandedCmds[toolId]}
        copiedId={props.copiedId}
        onOpenFile={props.onOpenFile}
        handleCopy={props.handleCopy}
        toggleCmd={props.toggleCmd}
      />
    );
  }

  // 4. Approval Card (Sensitive operations / Permission checks)
  if (entry.type === 'approval') {
    const toolCallId = String(entry.data?.toolCallId || entry.data?.tool?.id || entry.id);
    return (
      <div className={cn("my-1.5 w-full", isChild ? "pl-2" : "")}>
        <ApprovalCard
          toolCallId={toolCallId}
          toolName={entry.data?.toolName || entry.data?.tool?.name || 'action'}
          toolSummary={entry.data?.toolSummary}
          toolAction={entry.data?.toolAction}
          command={entry.data?.command}
          args={entry.data?.args}
          status={entry.data?.status || 'pending'}
          decision={entry.data?.decision}
          onApprove={(action, feedback) => {
            if (props.onApproveTool) {
              return props.onApproveTool(toolCallId, action, feedback);
            }
          }}
        />
      </div>
    );
  }

  // 5. Intermediate Step Note / Commentary
  if (entry.type === 'text') {
    const text = entry.data?.text || entry.data?.content || '';
    if (!text) return null;
    return (
      <div
        key={entry.id}
        className={cn(
          "flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 font-sans my-0.5",
          isChild ? "pl-1 py-0.5" : "my-0.5"
        )}
      >
        <span className="font-sans text-[12px] text-zinc-500 dark:text-zinc-400 italic">
          {text}
        </span>
      </div>
    );
  }

  // 6. Other Tools & Actions
  return (
    <ToolTimelineRow
      entry={entry}
      isChild={isChild}
      isStreaming={props.isStreaming}
      isExpanded={!!props.expandedGroups[entry.id]}
      onOpenFile={props.onOpenFile}
      toggleGroup={props.toggleGroup}
    />
  );
}
