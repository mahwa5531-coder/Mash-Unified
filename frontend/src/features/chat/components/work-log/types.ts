// Work-log timeline types (tool calls, execution steps, timeline entries).
import type { ToolCall, ExecutionStep as CoreExecutionStep } from '@/types/chat';

// Re-export canonical types to prevent type duplication and schema drift
export type ToolCallItem = ToolCall;
export type ExecutionStep = CoreExecutionStep;

export interface TimelineEntry {
  id: string;
  type: 'thought' | 'text' | 'file_read' | 'folder_view' | 'search' | 'web_search' | 'web_fetch' | 'code_search' | 'task' | 'subagent' | 'edit' | 'command' | 'approval' | 'other' | 'command_group' | 'exploration_group' | 'edit_group';
  data: any;
  items?: TimelineEntry[];
}
