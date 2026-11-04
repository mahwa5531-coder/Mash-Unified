/**
 * Safe URL policy for Agent Markdown (QA-BUG-3 Hardening & F-1 Resolution).
 * Strict allowlist: permits http, https, mailto, relative anchors/paths,
 * safe file URIs/Windows paths, and safe base64 images, while blocking
 * dangerous schemes (javascript:, vbscript:, data:text/html, etc.).
 */
export function safeUrlTransform(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();

  // Reject dangerous schemes explicitly
  if (/^(?:javascript|vbscript|data(?!\s*:\s*image\/)):/i.test(trimmed)) {
    return '';
  }

  // Allow safe web & mail protocols
  if (/^(?:https?|mailto):/i.test(trimmed)) return trimmed;

  // Allow safe base64 images
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,/i.test(trimmed)) {
    return trimmed;
  }

  // Allow safe file URIs and Windows absolute paths (desktop environment)
  if (/^(?:file:\/\/\/?|[a-zA-Z]:[\/\\])/i.test(trimmed)) {
    return trimmed;
  }

  // Allow relative links and bare filenames/paths without an explicit foreign scheme (F-1)
  // Bare filenames like 'notes.md', 'findings.csv', './doc.pdf', '../report.xlsx', '#anchor', '/path'
  const colonIdx = trimmed.indexOf(':');
  const slashIdx = trimmed.search(/[\/\\]/);
  // If no colon, or colon appears after a path slash, it is a safe relative path
  if (colonIdx === -1 || (slashIdx !== -1 && colonIdx > slashIdx)) {
    return trimmed;
  }

  return '';
}
