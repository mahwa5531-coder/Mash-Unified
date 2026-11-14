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
 * Positive deliverable classification (DeepSeek Harness / SWE-bench domain scoping):
 * A path is an executive deliverable (artifact) if:
 * 1. It explicitly carries user-facing ArtifactMetadata from the tool call, OR
 * 2. It is a canonical executive plan / walkthrough (implementation_plan.md, walkthrough.md), OR
 * 3. It resides in a designated deliverable namespace (working_papers/, workpapers/, deliverables/, Audit_Deliverables/), OR
 * 4. It is an executive markdown (.md) document outside scratchpad/temp storage.
 */
export function isArtifactPath(p: string, meta?: any): boolean {
  if (!p || isScratchPath(p)) return false;
  const lower = p.toLowerCase().replace(/\\/g, '/');

  // 1. Explicit tool metadata declaring a user-facing artifact
  if (meta?.UserFacing !== false && (meta?.Summary || meta?.summary || meta?.RequestFeedback !== undefined)) {
    return true;
  }

  // 2. Canonical executive plans and walkthroughs
  if (
    lower.endsWith('implementation_plan.md') ||
    lower.endsWith('plan.md') ||
    lower.endsWith('walkthrough.md') ||
    lower.includes('implementation_plan') ||
    lower.includes('walkthrough')
  ) {
    return true;
  }

  // 3. Designated deliverable namespaces (project deliverables or session brain working papers)
  // Non-markdown formats (.xlsx, .csv, .pdf, images) are accepted within these explicit deliverable namespaces.
  if (
    lower.includes('/working_papers/') ||
    lower.startsWith('working_papers/') ||
    lower.includes('/workpapers/') ||
    lower.startsWith('workpapers/') ||
    lower.includes('/deliverables/') ||
    lower.startsWith('deliverables/') ||
    lower.includes('/audit_deliverables/') ||
    lower.startsWith('audit_deliverables/')
  ) {
    return (
      lower.endsWith('.md') ||
      lower.endsWith('.xlsx') ||
      lower.endsWith('.csv') ||
      lower.endsWith('.pdf') ||
      lower.endsWith('.png') ||
      lower.endsWith('.svg') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp')
    );
  }

  // 4. Any executive markdown (.md) document outside scratch/tmp is a statutory deliverable / working paper
  return lower.endsWith('.md');
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
