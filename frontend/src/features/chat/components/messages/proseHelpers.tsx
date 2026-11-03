import React from 'react';
import { FilePill, AuditBadge } from '@/primitives';
import { normalizePath, safeDecodeURI } from '@/utils/normalizePath';

// Safely extract plain text from markdown AST / React children
export function extractChildText(node: any): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractChildText).join('');
  if (typeof node === 'object' && node.props && node.props.children) {
    return extractChildText(node.props.children);
  }
  return '';
}

// Format file pill label and path cleanly
export function formatFilePill(rawLabel: string, rawHref: string) {
  const rawPath = normalizePath(rawHref || rawLabel || '', false);
  const [filePath, lineAnchor] = rawPath.split('#');

  // ponytail: preserve relative folder paths (e.g. working_papers/rev_cutoff.md) instead of popping only basename
  let display = safeDecodeURI(rawLabel || '').trim();
  if (!display || display.startsWith('file:') || display === '[object Object]') {
    display = filePath;
  }
  display = display.replace(/^(?:\.\/|file:\/\/+)/, '').split('#')[0];

  if (lineAnchor && !/:(?:L)?\d+(?:-\d+)?$/i.test(display)) {
    const cleanAnchor = lineAnchor.replace(/^[#L]+/i, '').replace(/-L/i, '-');
    if (cleanAnchor) display = `${display}:${cleanAnchor}`;
  }

  return { filePath, display };
}

// Prune surrounding quotes, brackets, and trailing sentence punctuation from a path token
export function prunePathPunctuation(raw: string): { cleanPath: string; trailingPunctuation: string } {
  if (!raw || typeof raw !== 'string') return { cleanPath: '', trailingPunctuation: '' };

  let p = raw.trim();
  let trailing = '';

  // 1. Strip leading quotes / brackets
  p = p.replace(/^['"`<(\[]+/, '');

  // 2. Peel trailing quotes, sentence punctuation, and closing brackets
  const match = p.match(/([.,;:!?)"'`>\]]+)$/);
  if (match) {
    trailing = match[1];
    p = p.slice(0, -trailing.length);
  }

  return { cleanPath: p, trailingPunctuation: trailing };
}

// Detect if a string is a valid file path with recognized extension under structural rules:
// 1. Absolute paths (Windows drive, Unix root, or file:// URI)
// 2. Explicit relative paths (starts with ./ or ../) - supports ANY dynamic user folder
// 3. Known system audit roots (Audit_Deliverables/, working_papers/, workpapers/, scratch/)
export function isFullFilePath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = normalizePath(raw.trim());
  if (clean.includes('/node_modules/') || clean.startsWith('node_modules/')) return false;
  if (!clean || clean.includes(' ') || clean.includes('\n') || clean.includes('*') || clean.includes('?')) return false;

  const FILE_EXT_REGEX = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|log|html|css|scss|xml|xbrl|sh|bash|zsh|ps1|rs|go|c|cpp|h|java|zip|tar|gz|png|jpe?g|gif|svg|webp)$/i;

  if (!FILE_EXT_REGEX.test(clean)) return false;

  const parts = clean.split(/[/\\]/);
  const filename = parts.pop() || '';
  if (!filename || filename.startsWith('.')) return false;

  // 1. Absolute full path (drive letter, unix root, or file:// URI)
  const isAbsolute = (
    /^[a-zA-Z]:[/\\]/.test(clean) ||
    /^\/(?:Users|home|tmp|var|etc)\//.test(clean) ||
    clean.startsWith('file://')
  );

  // 2. Explicit relative path (starts with ./ or ../) - supports ANY dynamic user folder
  const isExplicitRelative = /^\.\.?\//.test(clean);

  // 3. Known System Audit Roots
  const isSystemAuditRoot = /^(?:Audit_Deliverables|working_papers|workpapers|scratch)\//i.test(clean);

  return isAbsolute || isExplicitRelative || isSystemAuditRoot;
}

// Detect if a string is a standalone file extension
export function isFileExtension(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  return /^\.(xlsx?|xlsm|xlsb|ods|csv|tsv|pdf|docx?|pptx?|py|ipynb|tsx?|jsx?|json|ya?ml|toml|sql|md|markdown|txt|log|xml|xbrl|zip|tar|gz|png|jpe?g|svg)$/i.test(clean);
}

// Detect if a string is a directory or partial folder path
export function isDirectoryPath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  if (clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')')) return false;
  const hasSlash = clean.includes('/') || clean.includes('\\');
  const endsWithSlash = clean.endsWith('/') || clean.endsWith('\\');
  const isLikelyFolder = (
    clean.startsWith('./') ||
    clean.startsWith('../') ||
    clean.startsWith('/') ||
    /^(workpapers|working_papers|audit_deliverables|deliverables|src|features|components|tests|scratch|docs|models|views|controllers)\//i.test(clean)
  );
  return (endsWithSlash || isLikelyFolder) && hasSlash && !isFullFilePath(clean);
}

const STATUS_TAG_REGEX = /(\[(?:COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\])/g;
const FILE_PATH_IN_PROSE_REGEX = /((?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|\.\.?\/|(?:Audit_Deliverables|working_papers|workpapers|scratch)\/)[^\s'",;()<>]+\.(?:xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|md|markdown|txt|diff|patch|html|css|log|xml|xbrl)(?:#L\d+(?:-\d+)?)?)/gi;

export function processTextNodes(children: any, onOpenFile?: (path: string) => void): any {
  if (typeof children === 'string') {
    // ponytail: O(1) fast-path bailout for ordinary text with no audit tags or file paths
    if (!children.includes('[') && !children.includes('/') && !children.includes('\\') && !children.includes(':')) {
      return children;
    }
    const parts = children.split(STATUS_TAG_REGEX);
    const result = parts.flatMap((part, idx) => {
      const match = part.match(/^\[(COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\]$/);
      if (match) {
        const tag = match[1];
        return [
          <AuditBadge key={`tag_${idx}`} status={tag}>
            {tag}
          </AuditBadge>
        ];
      }

      const pathParts = part.split(FILE_PATH_IN_PROSE_REGEX);
      if (pathParts.length === 1) return [part];

      const nodes: any[] = [];
      pathParts.forEach((pPart, pIdx) => {
        if (!pPart) return; // Prune empty string fragments
        const { cleanPath, trailingPunctuation } = prunePathPunctuation(pPart);
        if (cleanPath && isFullFilePath(cleanPath)) {
          const { filePath, display } = formatFilePill(cleanPath, cleanPath);
          nodes.push(
            <FilePill
              key={`pill_${pIdx}_${filePath}`}
              path={filePath}
              label={display}
              onOpenFile={onOpenFile}
            />
          );
          if (trailingPunctuation) {
            nodes.push(trailingPunctuation);
          }
        } else {
          nodes.push(pPart);
        }
      });
      return nodes;
    });

    return result.length === 1 && typeof result[0] === 'string' ? result[0] : result;
  }

  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c === 'string') {
        return processTextNodes(c, onOpenFile);
      }
      if (React.isValidElement(c)) {
        const isInteractive = c.type === 'a' || c.type === FilePill || typeof (c.props as any)?.href === 'string' || (c.props as any)?.path;
        if (isInteractive) return c;

        if (c.type === 'code' || c.type === 'pre' || typeof c.type === 'function') {
          return c;
        }

        return React.cloneElement(c, { key: i } as any, processTextNodes((c.props as any)?.children, onOpenFile));
      }
      return c;
    });
  }
  return children;
}

// Guard unescaped currency dollar signs (e.g. $100) outside math formulas,
// and normalize Windows CRLF / corrupted \r\r\n to prevent table & blockquote layout breaks
export function escapeCurrencyInMarkdown(content: string): string {
  if (!content) return '';
  const normalized = content.replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.includes('$')) return normalized;
  return normalized.replace(/(?<![\$\\])\$(?=\d)/g, '\\$');
}

