import { Message, ArtifactItem, EditedFileItem } from '@/lib/types';

// ----------------------------------------------------------------------
// Helper to extract and format Artifact cards (Walkthrough, Plan only)
// Code files and scripts are clickable in chat text only, not bottom cards
// ----------------------------------------------------------------------
export function extractArtifacts(msg: Message): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  const seenPaths = new Set<string>();

  // ONLY extract documentation artifacts (Walkthrough, Implementation Plan)
  const isDocArtifactPath = (p: string) => {
    const lower = p.toLowerCase();
    const isCode = /\.(py|ts|tsx|js|jsx|json|sql|csv|xlsx|parquet|sh|bat)$/i.test(lower);
    if (isCode) return false;
    return lower.includes('walkthrough') || lower.includes('implementation_plan') || lower.endsWith('.md');
  };

  // 1. Check tools for explicit walkthrough or implementation plan
  if (msg.tools && msg.tools.length > 0) {
    for (const t of msg.tools) {
      let args = t.args || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      const p = args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.target_file || args.filepath;
      if (p && isDocArtifactPath(String(p))) {
        const pathStr = String(p);
        if (!seenPaths.has(pathStr)) {
          seenPaths.add(pathStr);
          const rawTitle = pathStr.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || 'Walkthrough';
          const friendlyTitle = rawTitle.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const meta = args.ArtifactMetadata || args.artifact_metadata;
          const summary = meta?.Summary || meta?.summary || `${friendlyTitle} documenting analysis and verification results.`;
          const isPlanFile = pathStr.toLowerCase().includes('implementation_plan') || pathStr.toLowerCase().includes('plan.md');
          const isFeedbackRequested = Boolean(meta?.RequestFeedback ?? meta?.requestFeedback);
          artifacts.push({
            id: pathStr,
            title: friendlyTitle,
            summary,
            filePath: pathStr,
            requestFeedback: isFeedbackRequested,
          });
        }
      }
    }
  }

  // 2. Strict Fallback: Check markdown text ONLY if the message had no tool calls
  // (e.g. initial turn when plan was output directly in text without tool execution)
  // Never create bottom cards from casual prose mentions in messages that executed other work
  if (artifacts.length === 0 && (!msg.tools || msg.tools.length === 0) && msg.content) {
    const linkRegex = /\[([^\]]+)\]\((file:\/\/\/[^)]+|(?:[a-zA-Z]:[/\\]|\/|\.\/)[^)]+\.(?:md))\)/gi;
    let match;
    while ((match = linkRegex.exec(msg.content)) !== null) {
      const linkText = match[1];
      let linkPath = match[2].replace(/^file:\/\/\/?/, '');
      linkPath = linkPath.replace(/^\/([a-zA-Z]:)/, '$1');

      if (isDocArtifactPath(linkPath) || isDocArtifactPath(linkText)) {
        if (!seenPaths.has(linkPath)) {
          seenPaths.add(linkPath);
          const rawTitle = linkPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || linkText;
          const friendlyTitle = rawTitle.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const beforeText = msg.content.slice(0, match.index).trim();
          const lastSentence = beforeText.split('\n').pop() || '';
          const summary = lastSentence.replace(/^#+\s*/, '').trim() || `${friendlyTitle} documenting analysis and verification.`;
          artifacts.push({
            id: linkPath,
            title: friendlyTitle,
            summary,
            filePath: linkPath,
            requestFeedback: false,
          });
        }
      }
    }
  }

  return artifacts;
}

// ponytail: canonical group for doc artifacts so revised plans/walkthroughs vanish from past turns
export function getArtifactCanonicalGroup(filePathOrTitle: string): string {
  if (!filePathOrTitle) return '';
  const clean = filePathOrTitle.replace(/^file:\/\/\/?/, '').replace(/\\/g, '/');
  const filename = (clean.split('/').pop() || clean).toLowerCase().trim();
  if (filename.includes('implementation_plan') || filename.includes('plan.md')) {
    return 'implementation_plan.md';
  }
  if (filename.includes('walkthrough')) {
    return 'walkthrough.md';
  }
  return filename;
}

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
        let p = raw.replace(/^file:\/\/\/?/, '');
        return p.replace(/^\/([a-zA-Z]:)/, '$1');
      };

      const shouldExclude = (p: string) => {
        const lower = p.toLowerCase().replace(/\\/g, '/');
        // Ignore all doc artifacts as they appear in ArtifactCards at the bottom of the turn
        if (lower.endsWith('.md')) {
          return true;
        }
        // Exclude scratch scripts and internal agent directories from git-like files changed drawer
        return (
          lower.includes('/scratch/') ||
          lower.startsWith('scratch/') ||
          lower.includes('/.scratch/') ||
          lower.startsWith('.scratch/') ||
          lower.includes('/.gemini/') ||
          lower.includes('/.nexau/') ||
          lower.includes('/tmp/') ||
          lower.includes('/temp/')
        );
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
          if (!shouldExclude(clean)) {
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
          if (!shouldExclude(clean)) {
            const code = args.content ?? args.CodeContent ?? '';
            const added = code ? String(code).trim().split('\n').length : 1;
            recordEdit(clean, added, 0);
          }
        }
      } else if (isMultiEdit) {
        const p = args.file_path || args.TargetFile || args.AbsolutePath || args.path || args.target_file || args.filepath;
        if (p) {
          const clean = normalizeClean(String(p));
          if (!shouldExclude(clean)) {
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
          if (shouldExclude(clean)) continue;

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
