/**
 * Safe URL policy for Agent Markdown.
 * Blocks executable schemes (javascript:, vbscript:) and dangerous data types (e.g. data:text/html),
 * while permitting safe base64 images and regular web/file links.
 */
export function safeUrlTransform(url: string): string {
  if (!url) return '';
  if (/^\s*(javascript|vbscript):/i.test(url)) return '';
  if (/^\s*data:/i.test(url)) {
    return /^\s*data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml|avif);base64,/i.test(url) ? url : '';
  }
  return url;
}
