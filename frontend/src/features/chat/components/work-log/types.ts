// Work-log timeline types (tool calls, execution steps, timeline entries).
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

export interface TimelineEntry {
  id: string;
  type: 'thought' | 'text' | 'file_read' | 'folder_view' | 'search' | 'task' | 'timer' | 'subagent' | 'edit' | 'command' | 'other' | 'command_group' | 'exploration_group' | 'edit_group';
  data: any;
  items?: TimelineEntry[];
}
