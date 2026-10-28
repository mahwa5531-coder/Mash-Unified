/**
 * Safe URL policy for Agent Markdown (QA-BUG-3 Hardening).
 * Strict allowlist: permits http, https, mailto, relative anchors/paths,
 * and safe base64 images, while blocking dangerous schemes (app://, file://,
 * javascript:, vbscript:, etc.) to prevent local file reads and privilege escalation.
 */
export function safeUrlTransform(url: string): string {
  if (!url) return '';
  const trimmed = url.trim();

  // Allow relative links (#anchor, /path, ./path)
  if (/^([#/]|\.\/)/.test(trimmed)) return trimmed;

  // Allow safe web & mail protocols
  if (/^(https?|mailto):/i.test(trimmed)) return trimmed;

  // Allow safe base64 images
  if (/^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,/i.test(trimmed)) {
    return trimmed;
  }

  // Reject all other schemes (app://, file://, javascript:, vbscript:, data:, etc.)
  return '';
}
