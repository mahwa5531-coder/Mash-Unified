/**
 * Declarative parameter priority order per tool name (R8).
 * Drives both preview subtitle formatting and tabular input inspector.
 */
export const TOOL_FIELD_ORDER: Record<string, string[]> = {
  write_file: ["path", "file_path", "content"],
  read_file: ["path", "file_path"],
  replace: ["path", "file_path", "old_str", "new_str"],
  search_file_content: ["pattern", "path", "file_path"],
  glob: ["pattern", "directory", "path"],
  list_directory: ["path", "directory"],
  run_shell_command: ["command"],
  web_search: ["query"],
  web_read: ["url"],
  write_todos: ["todos"],
  ask_user: ["questions"],
};

export const DEFAULT_TOOL_FIELDS = ["path", "file_path", "command", "query", "url", "pattern", "content"];

export function getToolKeyFields(toolName: string): string[] {
  const norm = toolName.toLowerCase();
  for (const [key, fields] of Object.entries(TOOL_FIELD_ORDER)) {
    if (norm.includes(key)) return fields;
  }
  return DEFAULT_TOOL_FIELDS;
}
