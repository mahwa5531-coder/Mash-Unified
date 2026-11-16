import { normalizePath } from '@/utils/normalizePath';

/**
 * Returns true if a path points to an internal disposable scratchpad or temp file.
 * Matches any folder segment named scratch, .scratch, .system_generated, tmp, or temp.
 */
export function isScratchPath(p: string): boolean {
  if (!p) return false;
  const clean = normalizePath(p).toLowerCase().trim();
  const lower = clean.replace(/^\.\//, '');
  return /(?:^|\/)(?:\.?scratch|\.system_generated|tmp|temp)(?:$|\/)/i.test(lower);
}

// Backward-compatible alias for existing callers
export const shouldExcludePath = isScratchPath;

/**
 * Positive deliverable classification:
 * Artifact Cards (<WorkingPaperCard /> / <ArtifactCard />) are strictly and exclusively
 * for markdown (.md) documents created in that exact turn (Audit Memos, Plans, Walkthroughs).
 * 
 * Non-markdown files (spreadsheets, PDFs, images) are NOT rendered as artifact cards;
 * they are rendered cleanly in <TurnFilesGenerated /> as <FilePill />s, or embedded inline.
 */
export function isArtifactPath(p: string, meta?: any): boolean {
  if (!p || isScratchPath(p)) return false;

  // Explicit tool metadata rejecting a user-facing artifact card
  if (meta?.UserFacing === false || meta?.userFacing === false || meta?.user_facing === false) {
    return false;
  }

  const lower = p.toLowerCase().replace(/\\/g, '/');

  // Strict Invariant: Cards are ONLY for .md files created in that exact turn!
  if (!lower.endsWith('.md')) {
    return false;
  }

  return true;
}

// Canonical group for doc artifacts so revised plans/walkthroughs vanish from past turns
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
