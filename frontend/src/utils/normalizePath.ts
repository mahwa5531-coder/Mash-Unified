/**
 * Single source of truth for file:// URI → local path conversion.
 * Handles: file:/// prefix, URI decoding, Windows drive letters (/C: → C:),
 * backslash→forward slash, and optional #anchor stripping.
 */
export function normalizePath(raw: string, stripAnchor = true): string {
  const stripped = (raw || '').replace(/^file:\/\/\/?/i, '');
  let p = stripped;
  try {
    p = decodeURIComponent(stripped);
  } catch {
    try {
      p = decodeURIComponent(stripped.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch {
      p = stripped;
    }
  }
  p = p.replace(/^\/([a-zA-Z]:)/, '$1');
  p = p.replace(/\\/g, '/');
  if (stripAnchor) p = p.split('#')[0];
  return p;
}
