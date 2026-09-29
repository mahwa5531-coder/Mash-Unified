/**
 * Single source of truth for file:// URI → local path conversion.
 * Handles: file:/// prefix, URI decoding, Windows drive letters (/C: → C:),
 * backslash→forward slash, and optional #anchor stripping.
 */
export function normalizePath(raw: string, stripAnchor = true): string {
  let p = decodeURIComponent((raw || '').replace(/^file:\/\/\/?/i, ''));
  p = p.replace(/^\/([a-zA-Z]:)/, '$1');
  p = p.replace(/\\/g, '/');
  if (stripAnchor) p = p.split('#')[0];
  return p;
}
