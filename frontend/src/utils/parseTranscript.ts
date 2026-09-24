export interface ToolCall {
  id?: string;
  name: string;
  args?: Record<string, any>;
  output?: string;
  status?: 'running' | 'completed' | 'failed';
  durationSeconds?: number;
}

export interface SubTask {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assignedAgent?: string;
}

export interface Step {
  step_index: number;
  source: string;
  type: string;
  status: string;
  created_at: string;
  content?: string;
  tool_calls?: ToolCall[];
  thinking?: string;
  tasks?: SubTask[];
}

export type TurnStatus = 'running' | 'completed' | 'error' | 'aborted';

export interface ExecutionStep {
  id?: string;
  step_index?: number;
  type?: 'thinking' | 'text' | 'tool' | 'diff' | 'system';
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
  tools?: ToolCall[];
}

export interface Message {
  id?: string;
  turnId?: string;
  status?: TurnStatus;
  role: 'user' | 'assistant';
  content: string;
  thoughts: string[];
  tools: ToolCall[];
  tasks?: SubTask[];
  steps?: ExecutionStep[];
  timestamp?: string;
  error?: string;
  errorId?: string;
  sessionId?: string;
  thinkingDurationSeconds?: number;
  totalDurationSeconds?: number;
  turnStartTime?: number;
  steeringInjected?: string[];
  compactionBoundary?: boolean;
  compactionSummary?: string;
}

