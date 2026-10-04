import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { normalizePath } from '@/utils/normalizePath';
import { isArtifactPath, shouldExcludePath, getArtifactCanonicalGroup } from './paths';

export { isArtifactPath, shouldExcludePath, getArtifactCanonicalGroup } from './paths';
export { extractEditedFiles } from './extractEditedFiles';

// ----------------------------------------------------------------------
// Helper to extract and format Artifact cards (Documentation, Spreadsheets, Visual Charts)
// ----------------------------------------------------------------------
export function extractArtifacts(msg: Message): ArtifactItem[] {
  const artifacts: ArtifactItem[] = [];
  const seenPaths = new Set<string>();

  const classifyArtifact = (p: string): { isArtifact: boolean; type: 'plan' | 'walkthrough' | 'doc' } => {
    // Strictly guard: only .md documents are standalone executive deliverables/working papers
    if (!isArtifactPath(p)) {
      return { isArtifact: false, type: 'doc' };
    }
    const lower = p.toLowerCase().replace(/\\/g, '/');
    if (lower.includes('implementation_plan') || lower.includes('plan.md')) {
      return { isArtifact: true, type: 'plan' };
    }
    if (lower.includes('walkthrough')) {
      return { isArtifact: true, type: 'walkthrough' };
    }
    return { isArtifact: true, type: 'doc' };
  };

  // 1. Check tools for created artifacts (plans, walkthroughs, spreadsheets, visual charts)
  if (msg.tools && msg.tools.length > 0) {
    for (const t of msg.tools) {
      // Guard against phantom cards: never create deliverable cards for failed tools or schema errors
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

          const isFeedbackRequested = Boolean(meta?.RequestFeedback ?? meta?.requestFeedback ?? meta?.request_feedback);
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
    const linkRegex = /\[([^\]]+)\]\((file:\/\/\/[^)]+|(?:[a-zA-Z]:[/\\]|\/|\.\/|Audit_Deliverables\/|working_papers\/)[^)]+\.(?:md|xlsx?|csv|png|jpe?g|svg))\)/gi;
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
