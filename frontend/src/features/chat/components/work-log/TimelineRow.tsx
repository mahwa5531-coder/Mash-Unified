"use client";

// One timeline row (thought card / tool row / command console / group card).
// Prop names mirror TaskWorkLogAccordion identifiers (container/view split).
import React from 'react';
import type { TimelineEntry } from './types';
import { ThoughtTimelineRow } from './ThoughtTimelineRow';
import { GroupTimelineRow } from './GroupTimelineRow';
import { CommandTimelineRow } from './CommandTimelineRow';
import { ToolTimelineRow } from './ToolTimelineRow';

interface TimelineRowProps {
  entry: TimelineEntry;
  isChild?: boolean;
  isStreaming?: boolean;
  thinkingDurationSeconds?: number;
  onOpenFile?: (path: string) => void;
  liveThinkingSeconds: number;
  latchedThinkingSeconds: number | null;
  expandedThoughts: Record<string, boolean>;
  expandedCmdIndex: string | null;
  expandedGroups: Record<string, boolean>;
  copiedId: string | null;
  toggleThought: (id: string) => void;
  toggleGroup: (id: string) => void;
  handleCopy: (text: string, id: string) => void;
  setExpandedCmdIndex: React.Dispatch<React.SetStateAction<string | null>>;
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
        isCmdExpanded={props.expandedCmdIndex === toolId}
        copiedId={props.copiedId}
        onOpenFile={props.onOpenFile}
        handleCopy={props.handleCopy}
        setExpandedCmdIndex={props.setExpandedCmdIndex}
      />
    );
  }

  // 4. Other Tools & Actions
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
