/**
 * Tool execution and argument parsing helpers for artifact extraction.
 * Decoupled to eliminate circular import dependencies between extraction and extractEditedFiles.
 */

/**
 * Checks whether a tool execution produced valid non-error output.
 * Reusable guard preventing phantom cards from unexecuted, pending, or failed tools.
 */
export function isSuccessfulToolCall(t: any): boolean {
  if (!t || t.status === 'failed' || t.status === 'pending_approval' || (t.status as string) === 'running' || !t.output) {
    return false;
  }
  const out = String(t.output).trim().toLowerCase();
  return !(
    out.startsWith('error:') ||
    out.startsWith('validationerror:') ||
    out.startsWith('exception:') ||
    out.startsWith('failed:') ||
    out.includes('validation error') ||
    out.includes('schema validation failed') ||
    out.includes('failed to write') ||
    out.includes('permission denied')
  );
}

/**
 * Parses tool arguments safely, handling stringified JSON or plain objects.
 */
export function parseToolArgs(args: any): Record<string, any> {
  if (!args) return {};
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return typeof args === 'object' ? args : {};
}

/**
 * Resolves the primary target file path from common tool argument keys.
 */
export function resolveToolFilePath(args: Record<string, any>): string {
  const raw = args.file_path || args.path || args.TargetFile || args.AbsolutePath || args.target_file || args.filepath;
  return raw ? String(raw) : '';
}
