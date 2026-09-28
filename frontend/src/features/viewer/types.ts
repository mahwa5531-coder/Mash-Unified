// Viewer feature — shared types.
export interface TabItem {
  id: string;
  title: string;
  type: 'file' | 'terminal' | 'image';
  path?: string;
}
