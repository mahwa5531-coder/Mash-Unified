import { normalizePath } from '@/utils/normalizePath';

const EXCLUDED_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.system_generated',
  'scratch',
  '.scratch',
  'cache',
  '.cache',
  'tmp',
  'temp',
  'database',
]);

export function shouldExcludePath(p: string): boolean {
  if (!p) return true;
  const segments = p.toLowerCase().split(/[/\\]/);
  return segments.some(seg => EXCLUDED_SEGMENTS.has(seg));
}

export function isArtifactPath(p: string): boolean {
  if (!p || shouldExcludePath(p)) return false;
  // STRICT AUDITOR RULE: Only executive markdown (.md) documents (reports, memos, plans, walkthroughs)
  // are rendered as standalone WorkingPaperCards at the end of the turn.
  // Spreadsheets (.xlsx, .csv) and calculation scripts belong in the supporting files drawer.
  return p.toLowerCase().endsWith('.md');
}

// canonical group for doc artifacts so revised plans/walkthroughs vanish from past turns
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
