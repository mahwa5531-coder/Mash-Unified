// Artifact domain models — deliverables detected in assistant messages
// and edited-file receipts rendered in the chat stream.

export interface ArtifactItem {
  id: string;
  title: string;
  summary: string;
  filePath: string;
  type?: 'doc' | 'plan' | 'walkthrough' | 'spreadsheet' | 'chart';
  thumbnailUrl?: string;
  requestFeedback?: boolean;
}

export interface EditedFileItem {
  path: string;
  filename: string;
  dir: string;
  addedLines?: number;
  deletedLines?: number;
}
