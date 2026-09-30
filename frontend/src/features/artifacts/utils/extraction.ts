import { Message } from '@/types/chat';
import { ArtifactItem, EditedFileItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { normalizePath } from '@/utils/normalizePath';

export function shouldExcludePath(p: string): boolean {
  const lower = p.toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/scratch/') ||
    lower.startsWith('scratch/') ||
    lower.includes('/.scratch/') ||
    lower.startsWith('.scratch/') ||
    lower.includes('/.gemini/') ||
    lower.startsWith('.gemini/') ||
    lower.includes('/.nexau/') ||
    lower.startsWith('.nexau/') ||
    lower.includes('/tmp/') ||
    lower.startsWith('tmp/') ||
    lower.includes('/temp/') ||
    lower.startsWith('temp/')
  );
}

// ----------------------------------------------------------------------
// Helper to extract and format Artifact cards (Documentation, Spreadsheets, Visual Charts)
// ----------------------------------------------------------------------
export function extractArtifacts(msg: Message): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  const seenPaths = new Set<string>();

  const classifyArtifact = (p: string): { isArtifact: boolean; type: 'plan' | 'walkthrough' | 'doc' | 'spreadsheet' | 'chart' } => {
    const lower = p.toLowerCase().replace(/\\/g, '/');
    if (/\.(xlsx|xls|csv)$/i.test(lower)) {
      return { isArtifact: true, type: 'spreadsheet' };
    }
    if (/\.(png|jpe?g|svg|webp)$/i.test(lower)) {
      return { isArtifact: true, type: 'chart' };
    }
    if (lower.includes('implementation_plan') || lower.includes('plan.md')) {
      return { isArtifact: true, type: 'plan' };
    }
    if (lower.includes('walkthrough')) {
      return { isArtifact: true, type: 'walkthrough' };
    }
    if (lower.endsWith('.md')) {
      return { isArtifact: true, type: 'doc' };
    }
    return { isArtifact: false, type: 'doc' };
  };

  // 1. Check tools for created artifacts (plans, walkthroughs, spreadsheets, visual charts)
  if (msg.tools && msg.tools.length > 0) {
    for (const t of msg.tools) {
      let args = t.args || {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      const rawPath = args.TargetFile || args.AbsolutePath || args.file_path || args.path || args.target_file || args.filepath || args.ImageName;
      if (rawPath) {
        const pathStr = String(rawPath);
        const { isArtifact, type } = classifyArtifact(pathStr);
        if (isArtifact && !shouldExcludePath(pathStr) && !seenPaths.has(pathStr)) {
          seenPaths.add(pathStr);
          const rawFilename = pathStr.split(/[/\\]/).pop() || '';
          const rawExt = rawFilename.split('.').pop() || '';
          const rawTitle = rawFilename.replace(/\.[^/.]+$/, '') || 'Artifact';
          const friendlyTitle = rawTitle.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          const meta = args.ArtifactMetadata || args.artifact_metadata;

          // Dynamic summaries derived from file type and context (zero hardcoded static boilerplate)
          let dynamicSummary = meta?.Summary || meta?.summary;
          if (!dynamicSummary) {
            if (type === 'spreadsheet') {
              dynamicSummary = `Financial spreadsheet deliverable (${rawExt.toUpperCase()})`;
            } else if (type === 'chart') {
              dynamicSummary = `Visual data chart generated for reporting analysis (${rawExt.toUpperCase()})`;
            } else if (type === 'plan') {
              dynamicSummary = `Implementation plan for review and execution verification`;
            } else {
              dynamicSummary = `${friendlyTitle} documentation and analysis findings`;
            }
          }

          const isFeedbackRequested = Boolean(meta?.RequestFeedback ?? meta?.requestFeedback);
          const thumbnailUrl = type === 'chart' 
            ? `${BASE_URL}/files/content?path=${encodeURIComponent(pathStr)}${msg.sessionId ? `&session_id=${encodeURIComponent(msg.sessionId)}` : ''}`
            : undefined;

          artifacts.push({
            id: pathStr,
            title: friendlyTitle,
            summary: dynamicSummary,
            filePath: pathStr,
            type,
            thumbnailUrl,
            requestFeedback: isFeedbackRequested,
          });
        }
      }
    }
  }

  // 2. Strict Fallback: Check markdown text ONLY if no tool calls created cards
  if (artifacts.length === 0 && (!msg.tools || msg.tools.length === 0) && msg.content) {
    const linkRegex = /\[([^\]]+)\]\((file:\/\/\/[^)]+|(?:[a-zA-Z]:[/\\]|\/|\.\/|NexAU_Outputs\/|Audit_Deliverables\/|working_papers\/|scratch\/)[^)]+\.(?:md|xlsx?|csv|png|jpe?g|svg))\)/gi;
    let match;
    while ((match = linkRegex.exec(msg.content)) !== null) {
      const linkText = match[1];
      let linkPath = normalizePath(match[2]);

      const { isArtifact, type } = classifyArtifact(linkPath);
      if (isArtifact && !seenPaths.has(linkPath)) {
        seenPaths.add(linkPath);
        const rawFilename = linkPath.split(/[/\\]/).pop() || '';
        const rawExt = rawFilename.split('.').pop() || '';
        const rawTitle = rawFilename.replace(/\.[^/.]+$/, '') || linkText;
        const friendlyTitle = rawTitle.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const beforeText = msg.content.slice(0, match.index).trim();
        const lastSentence = beforeText.split('\n').pop() || '';
        
        let dynamicSummary = lastSentence.replace(/^#+\s*/, '').trim();
        if (!dynamicSummary) {
          if (type === 'spreadsheet') dynamicSummary = `Financial spreadsheet deliverable (${rawExt.toUpperCase()})`;
          else if (type === 'chart') dynamicSummary = `Visual data chart (${rawExt.toUpperCase()})`;
          else dynamicSummary = `${friendlyTitle} documentation`;
        }

        const thumbnailUrl = type === 'chart' 
          ? `${BASE_URL}/files/content?path=${encodeURIComponent(linkPath)}${msg.sessionId ? `&session_id=${encodeURIComponent(msg.sessionId)}` : ''}`
          : undefined;

        artifacts.push({
          id: linkPath,
          title: friendlyTitle,
          summary: dynamicSummary,
          filePath: linkPath,
          type,
          thumbnailUrl,
          requestFeedback: false,
        });
      }
    }
  }

  return artifacts;
}

// ponytail: canonical group for doc artifacts so revised plans/walkthroughs vanish from past turns
export function getArtifactCanonicalGroup(filePathOrTitle: string): string {
  if (!filePathOrTitle) return '';
  const clean = normalizePath(filePathOrTitle);
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
        return normalizePath(raw, false);
      };

      const shouldExclude = shouldExcludePath;

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
