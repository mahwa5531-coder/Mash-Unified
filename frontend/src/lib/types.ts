// ----------------------------------------------------------------------
// Central shared types for the chat / message domain.
// The canonical backend transcript types (Message, ToolCall, SubTask, Step)
// live in @/utils/parseTranscript and are re-exported here so downstream
// consumers can import everything from a single hub.
// ----------------------------------------------------------------------
import type { Message, ToolCall, SubTask, Step, TurnStatus } from '@/utils/parseTranscript';

export type { Message, ToolCall, SubTask, Step, TurnStatus };

export interface Turn {
  id: string;
  turnId?: string;
  status?: TurnStatus;
  userMsg: Message;
  aiMsgs: Message[];
  flatIdx: number;
  turnIndex?: number;
  compactionBoundary?: boolean;
  compactionSummary?: string;
}

export interface ArtifactItem {
  id: string;
  title: string;
  summary: string;
  filePath: string;
  requestFeedback?: boolean;
}

export interface EditedFileItem {
  path: string;
  filename: string;
  dir: string;
  addedLines?: number;
  deletedLines?: number;
}
