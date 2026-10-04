import { normalizePath } from '@/utils/normalizePath';

export function shouldExcludePath(p: string): boolean {
  if (!p) return true;
  const lower = p.toLowerCase().replace(/\\/g, '/');
  return (
    lower.includes('/.scratch/') ||
    lower.startsWith('.scratch/') ||
    lower.includes('/.gemini/') ||
    lower.startsWith('.gemini/') ||
    lower.includes('/.nexau/') ||
    lower.startsWith('.nexau/') ||
    lower.includes('/.system_generated/') ||
    lower.startsWith('.system_generated/') ||
    lower.includes('/tmp/') ||
    lower.startsWith('tmp/') ||
    lower.includes('/temp/') ||
    lower.startsWith('temp/') ||
    lower.includes('/node_modules/')
  );
}

export function isArtifactPath(p: string): boolean {
  if (!p || shouldExcludePath(p)) return false;
  const lower = p.toLowerCase().replace(/\\/g, '/');
  // Scratch scripts/calculations belong in TurnFilesGenerated accordion, not executive deliverables
  if (lower.includes('/scratch/') || lower.startsWith('scratch/')) return false;

  // STRICT AUDITOR RULE: Only executive markdown (.md) documents (reports, memos, plans, walkthroughs)
  // are rendered as standalone WorkingPaperCards at the end of the turn.
  // Spreadsheets (.xlsx, .csv) and calculation scripts belong in the supporting files drawer.
  return lower.endsWith('.md');
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
