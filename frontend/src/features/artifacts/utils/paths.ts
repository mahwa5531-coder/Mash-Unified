import { normalizePath } from '@/utils/normalizePath';

/**
 * Returns true if a path points to an internal disposable scratchpad or temp file.
 */
export function isScratchPath(p: string): boolean {
  if (!p) return false;
  const lower = p.toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/scratch/') ||
    lower.startsWith('scratch/') ||
    lower.includes('/.scratch/') ||
    lower.startsWith('.scratch/') ||
    lower.includes('/.system_generated/') ||
    lower.startsWith('.system_generated/') ||
    lower.includes('/tmp/') ||
    lower.startsWith('tmp/') ||
    lower.includes('/temp/') ||
    lower.startsWith('temp/')
  );
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
  const lower = p.toLowerCase().replace(/\\/g, '/');

  // Strict Invariant: Cards are ONLY for .md files created in that exact turn!
  if (!lower.endsWith('.md')) {
    return false;
  }

  // 1. Explicit tool metadata declaring a user-facing artifact (.md)
  if (meta?.UserFacing !== false && (meta?.Summary || meta?.summary || meta?.RequestFeedback !== undefined)) {
    return true;
  }

  // 2. Canonical executive plans and walkthroughs (.md)
  if (
    lower.endsWith('implementation_plan.md') ||
    lower.endsWith('plan.md') ||
    lower.endsWith('walkthrough.md') ||
    lower.includes('implementation_plan') ||
    lower.includes('walkthrough')
  ) {
    return true;
  }

  // 3. Designated deliverable namespaces (.md only!)
  if (
    lower.includes('/working_papers/') ||
    lower.startsWith('working_papers/') ||
    lower.includes('/workpapers/') ||
    lower.startsWith('workpapers/') ||
    lower.includes('/audit_deliverables/') ||
    lower.startsWith('audit_deliverables/')
  ) {
    return true;
  }

  // 4. Any executive markdown (.md) document outside scratch/tmp is a statutory deliverable / working paper
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
