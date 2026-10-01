import { Message } from '@/types/chat';
import { EditedFileItem } from '@/types/artifacts';
import { normalizePath } from '@/utils/normalizePath';
import { shouldExcludePath } from './paths';

// ----------------------------------------------------------------------
// Edited Files (Extract created/modified code files for Antigravity-style drawer)
// ----------------------------------------------------------------------
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
      if (t.status === 'failed') continue;
      if (t.output) {
        const out = String(t.output).trim().toLowerCase();
        if (
          out.startsWith('error:') ||
          out.startsWith('validationerror:') ||
          out.startsWith('exception:') ||
          out.startsWith('failed:') ||
          out.includes('validation error') ||
          out.includes('schema validation failed') ||
          out.includes('failed to write') ||
          out.includes('permission denied')
        ) {
          continue;
        }
      }

      const name = (t.name || '').toLowerCase();
      let args = t.args || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }

      const isReplace = (
        name === 'replace' ||
        name.includes('replace_file_content') ||
        name.includes('edit_file')
      );
      const isWrite = (
        name.includes('write_file') ||
        name.includes('write_to_file') ||
        name.includes('create_file') ||
        name === 'write'
      );
      const isMultiEdit = name.includes('multiedit');
      const isPatch = name.includes('apply_patch') || name.includes('patch');

      const normalizeClean = (raw: string) => {
        return normalizePath(raw, false);
      };

      const recordEdit = (cleanPath: string, added: number, deleted: number) => {
        totalAdded += added;
        totalDeleted += deleted;
        const parts = cleanPath.split(/[/\\]/);
        const filename = parts.pop() || cleanPath;
        const dir = parts.join('/');

        if (fileMap.has(cleanPath)) {
          const item = fileMap.get(cleanPath)!;
          item.addedLines = (item.addedLines || 0) + added;
          item.deletedLines = (item.deletedLines || 0) + deleted;
        } else {
          fileMap.set(cleanPath, {
            path: cleanPath,
            filename,
            dir: dir ? (dir.startsWith('/') || dir.includes(':') ? dir : `/${dir}`) : '',
            addedLines: added,
            deletedLines: deleted,
          });
        }
      };

      if (isReplace) {
        const p = args.file_path || args.TargetFile || args.AbsolutePath || args.path || args.target_file || args.filepath;
        if (p) {
          const clean = normalizeClean(String(p));
          if (!shouldExcludePath(clean)) {
            const newText = args.new_string ?? args.ReplacementContent ?? '';
            const oldText = args.old_string ?? args.TargetContent ?? '';
            const added = newText ? String(newText).trim().split('\n').length : 1;
            const deleted = oldText ? String(oldText).trim().split('\n').length : 0;
            recordEdit(clean, added, deleted);
          }
        }
      } else if (isWrite) {
        const p = args.file_path || args.TargetFile || args.AbsolutePath || args.path || args.target_file || args.filepath;
        if (p) {
          const clean = normalizeClean(String(p));
          if (!shouldExcludePath(clean)) {
            const code = args.content ?? args.CodeContent ?? '';
            const added = code ? String(code).trim().split('\n').length : 1;
            recordEdit(clean, added, 0);
          }
        }
      } else if (isMultiEdit) {
        const p = args.file_path || args.TargetFile || args.AbsolutePath || args.path || args.target_file || args.filepath;
        if (p) {
          const clean = normalizeClean(String(p));
          if (!shouldExcludePath(clean)) {
            let added = 0;
            let deleted = 0;
            if (Array.isArray(args.edits)) {
              for (const edit of args.edits) {
                if (edit?.new_string) added += String(edit.new_string).trim().split('\n').length;
                if (edit?.old_string) deleted += String(edit.old_string).trim().split('\n').length;
              }
            }
            recordEdit(clean, Math.max(1, added), deleted);
          }
        }
      } else if (isPatch) {
        const patchText = String(args.input || args.patch || '');
        const fileRegex = /\*\*\*\s*(?:Add|Update|Delete)\s*File:\s*([^\n\r]+)/gi;
        let fileMatch;
        while ((fileMatch = fileRegex.exec(patchText)) !== null) {
          const rawPath = fileMatch[1].trim();
          if (!rawPath) continue;
          const clean = normalizeClean(rawPath);
          if (shouldExcludePath(clean)) continue;

          const nextIdx = patchText.indexOf('*** ', fileMatch.index + fileMatch[0].length);
          const hunk = nextIdx !== -1 ? patchText.slice(fileMatch.index, nextIdx) : patchText.slice(fileMatch.index);
          let added = 0;
          let deleted = 0;
          for (const line of hunk.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) added++;
            else if (line.startsWith('-') && !line.startsWith('---')) deleted++;
          }
          recordEdit(clean, Math.max(1, added), deleted);
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
