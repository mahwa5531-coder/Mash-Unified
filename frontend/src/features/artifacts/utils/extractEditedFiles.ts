import { Message } from '@/types/chat';
import { EditedFileItem } from '@/types/artifacts';
import { normalizePath } from '@/utils/normalizePath';
import { isScratchPath } from './paths';
import { isSuccessfulToolCall, parseToolArgs, resolveToolFilePath } from './toolHelpers';

/**
 * High-performance line counter with zero heap array allocation.
 */
function countLines(s: any): number {
  if (!s) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  let count = 1;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
}

/**
 * Extracts created or modified files from tool calls during an assistant turn.
 * Automatically filters out internal scratch files, temp directories, and failed tools.
 */
export function extractEditedFiles(msg: Message): {
  files: EditedFileItem[];
  totalAdded: number;
  totalDeleted: number;
} {
  const fileMap = new Map<string, EditedFileItem>();
  let totalAdded = 0;
  let totalDeleted = 0;

  if (msg.tools && msg.tools.length > 0) {
    for (const t of msg.tools) {
      if (!isSuccessfulToolCall(t)) continue;

      const name = (t.name || '').toLowerCase();
      const args = parseToolArgs(t.args);

      const recordEdit = (rawPath: string, added: number, deleted: number) => {
        const cleanPath = normalizePath(rawPath, false);
        if (isScratchPath(cleanPath)) return;

        totalAdded += added;
        totalDeleted += deleted;
        const parts = cleanPath.split(/[/\\]/);
        const filename = parts.pop() || cleanPath;
        const dir = parts.join('/');

        const existing = fileMap.get(cleanPath);
        if (existing) {
          existing.addedLines = (existing.addedLines || 0) + added;
          existing.deletedLines = (existing.deletedLines || 0) + deleted;
        } else {
          fileMap.set(cleanPath, {
            path: cleanPath,
            filename,
            dir: dir || '',
            addedLines: added,
            deletedLines: deleted,
          });
        }
      };

      if (name === 'replace' || name.includes('replace_file_content') || name.includes('edit_file')) {
        const p = resolveToolFilePath(args);
        if (p) {
          recordEdit(
            p,
            countLines(args.new_string ?? args.ReplacementContent) || 1,
            countLines(args.old_string ?? args.TargetContent)
          );
        }
      } else if (name.includes('write_file') || name.includes('write_to_file') || name.includes('create_file') || name === 'write') {
        const p = resolveToolFilePath(args);
        if (p) {
          recordEdit(p, countLines(args.content ?? args.CodeContent) || 1, 0);
        }
      } else if (name.includes('multiedit')) {
        const p = resolveToolFilePath(args);
        if (p) {
          let added = 0;
          let deleted = 0;
          if (Array.isArray(args.edits)) {
            for (const edit of args.edits) {
              if (edit?.new_string) added += countLines(edit.new_string);
              if (edit?.old_string) deleted += countLines(edit.old_string);
            }
          }
          recordEdit(p, Math.max(1, added), deleted);
        }
      } else if (name.includes('apply_patch') || name.includes('patch')) {
        const patchText = String(args.input || args.patch || '');
        const fileRegex = /\*\*\*\s*(?:Add|Update|Delete)\s*File:\s*([^\n\r]+)/gi;
        let fileMatch;
        while ((fileMatch = fileRegex.exec(patchText)) !== null) {
          const rawPath = fileMatch[1].trim();
          if (!rawPath) continue;

          const nextIdx = patchText.indexOf('*** ', fileMatch.index + fileMatch[0].length);
          const hunk = nextIdx !== -1 ? patchText.slice(fileMatch.index, nextIdx) : patchText.slice(fileMatch.index);
          let added = 0;
          let deleted = 0;
          for (const line of hunk.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) added++;
            else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
          }
          recordEdit(rawPath, Math.max(1, added), deleted);
        }
      } else if (name.includes('command') || name.includes('shell') || name === 'run_code') {
        const text = `${args.CommandLine || args.cmd || args.command || ''} ${String(t.output || '')}`;
        const match = text.match(/(?:Audit_Deliverables|working_papers|workpapers)[/\\][^\s"'<>|;]+\.[a-zA-Z0-9]+/gi);
        if (match) {
          for (const m of match) {
            recordEdit(m, 0, 0);
          }
        }
      }
    }
  }

  return {
    files: Array.from(fileMap.values()),
    totalAdded,
    totalDeleted,
  };
}
