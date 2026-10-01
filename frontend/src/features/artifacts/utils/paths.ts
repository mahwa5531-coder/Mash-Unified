import { normalizePath } from '@/utils/normalizePath';

export function shouldExcludePath(p: string): boolean {
  if (!p) return true;
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
  // Mash strictly parses deliverables and working papers from 2 designated folders:
  // 1. Audit_Deliverables/ (statutory deliverables in project workspace)
  // 2. working_papers/ (session working papers in brain)
  // Plus explicit executive plans/walkthroughs
  return (
    lower.includes('audit_deliverables/') ||
    lower.startsWith('audit_deliverables/') ||
    lower.includes('working_papers/') ||
    lower.startsWith('working_papers/') ||
    lower.endsWith('implementation_plan.md') ||
    lower.endsWith('plan.md') ||
    lower.endsWith('walkthrough.md')
  );
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
