/**
 * Safe URI decoder that handles unencoded bare percent signs (e.g. 50%_wip.md)
 * without throwing URIError: URI malformed.
 */
export function safeDecodeURI(raw: string): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    try {
      return decodeURIComponent(raw.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'));
    } catch {
      return raw;
    }
  }
}

/**
 * Single source of truth for file:// URI → local path conversion.
 * Handles: file:/// prefix, safe URI decoding, Windows drive letters (/C: → C:),
 * backslash→forward slash, and optional #anchor stripping.
 */
export function normalizePath(raw: string, stripAnchor = true): string {
  let p = raw || '';
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    // QA-BUG-2 Fix: Strip leading slash ONLY before Windows drive letters (/C: -> C:),
    // preserving the root slash for POSIX absolute paths (/home/u/x.md)
    p = p.replace(/^\/([a-zA-Z]:)/, '$1');
  }
  p = safeDecodeURI(p);
  p = p.replace(/^\/([a-zA-Z]:)/, '$1');
  p = p.replace(/\\/g, '/');
  if (stripAnchor) p = p.split('#')[0];
  return p;
}
