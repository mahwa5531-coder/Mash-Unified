import { FileIcon } from '@/primitives/FileIcon';
import type { ArtifactFileItem } from '@/services/artifacts';

export function formatArtifactTitle(name: string): string {
  const clean = name.replace(/^(scratch|nexau_outputs|audit_deliverables|working_papers)\//i, '').replace(/\.(md|markdown|txt|py|ts|tsx|js|json|sql|sh|xlsx?|csv|xlsm|pdf|png|jpe?g|svg|webp)$/i, '');
  const words = clean.replace(/[_-]+/g, ' ').trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase()) || name;
}

export const UNSUPPORTED_DOC_REGEX = /\.(docx|doc|pptx|ppt|zip|tar|gz|7z|rar|exe|bin|iso|dmg|dll|so|dylib)$/i;

export function getArtifactIcon(item: ArtifactFileItem) {
  return <FileIcon filename={item.name} size={14} />;
}

export function getArtifactExtensionBadge(item: ArtifactFileItem) {
  const ext = item.name.split('.').pop()?.toUpperCase() || 'FILE';
  const lower = ext.toLowerCase();
  let style = 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-white/[0.08]';
  if (lower === 'xlsx' || lower === 'xls' || lower === 'xlsm') {
    style = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
  } else if (lower === 'csv') {
    style = 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20';
  } else if (lower === 'pdf') {
    style = 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';
  } else if (lower === 'md') {
    style = 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20';
  } else if (['png', 'jpg', 'jpeg', 'svg', 'webp'].includes(lower)) {
    style = 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
  }
  return (
    <span className={`px-1 py-0.2 rounded text-[9.5px] font-mono font-medium border ${style} shrink-0`}>
      {ext}
    </span>
  );
}
