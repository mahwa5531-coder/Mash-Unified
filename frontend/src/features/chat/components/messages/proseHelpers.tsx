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

  const parts = filePath.split(/[\\/]/);
  const basename = parts.pop() || filePath;
  const labelParts = safeDecodeURI(rawLabel || '').split(/[\\/]/);
  const cleanLabelRaw = labelParts.pop() || basename;
  const cleanLabel = cleanLabelRaw.split('#')[0];

  const parent = parts.length > 0 ? parts[parts.length - 1] : '';
  const halfPath = parent && parent !== '.' && !/^[a-zA-Z]:$/.test(parent) ? `${parent}/${basename}` : basename;
  let display = (cleanLabel && !cleanLabel.startsWith('file:') && cleanLabel !== '[object Object]' ? cleanLabel : halfPath).trim();
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
  const match = p.match(/([.,;:!?)"'`>\]]+)$/i);
  if (match) {
    trailing = match[1];
    p = p.slice(0, -trailing.length);
  }

  return { cleanPath: p, trailingPunctuation: trailing };
}

// Detect if a string is a valid file path with recognized extension under structural rules:
// Supports absolute paths, relative paths, known system audit roots, and relative folder/file paths.
export function isFullFilePath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  // ponytail: reject web URLs so external links (e.g. docs, sklearn) never become local FilePills
  if (/^https?:\/\//i.test(trimmed)) return false;

  const clean = normalizePath(trimmed);
  if (/^https?:\/\//i.test(clean)) return false;
  if (clean.includes('/node_modules/') || clean.startsWith('node_modules/')) return false;
  if (!clean || clean.includes(' ') || clean.includes('\n') || clean.includes('*') || clean.includes('?')) return false;
  if (clean.endsWith('/') || clean.endsWith('\\')) return false;

  const FILE_EXT_REGEX = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|log|html|css|scss|xml|xbrl|sh|bash|zsh|ps1|rs|go|c|cpp|h|java|zip|tar|gz|png|jpe?g|gif|svg|webp|env)$/i;

  if (!FILE_EXT_REGEX.test(clean) && !/\.env(?:\.[a-zA-Z0-9_-]+)?$/i.test(clean)) return false;

  const parts = clean.split(/[/\\]/);
  const filename = parts.pop() || '';
  if (!filename || (filename.startsWith('.') && !filename.startsWith('.env') && !filename.startsWith('.git'))) return false;

  return true;
}

// Detect if a string is a standalone file extension
export function isFileExtension(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  return /^\.(xlsx?|xlsm|xlsb|ods|csv|tsv|pdf|docx?|pptx?|py|ipynb|tsx?|jsx?|json|ya?ml|toml|sql|md|markdown|txt|log|xml|xbrl|zip|tar|gz|png|jpe?g|svg|env)$/i.test(clean);
}

// Detect if a string is a directory or partial folder path
export function isDirectoryPath(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  const clean = raw.trim();
  if (clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')')) return false;

  // CRITICAL: If a path has a recognized file extension, it is NEVER a directory
  if (isFullFilePath(clean)) return false;

  const hasSlash = clean.includes('/') || clean.includes('\\');
  const endsWithSlash = clean.endsWith('/') || clean.endsWith('\\');
  const isLikelyFolder = (
    clean.startsWith('./') ||
    clean.startsWith('../') ||
    clean.startsWith('/') ||
    /^(workpapers|working_papers|audit_deliverables|deliverables|src|features|components|tests|scratch|docs|models|views|controllers)\//i.test(clean)
  );
  return (endsWithSlash || (isLikelyFolder && hasSlash));
}

const STATUS_TAG_REGEX = /(\[(?:COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|RECONCILED|APPROVED|DONE|EXCEPTION|MATERIAL WEAKNESS|FAIL|UNVERIFIED|REJECTED|QUALIFIED|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NEEDS REVIEW|PENDING|NOTE|WARNING|CAUTION|UNCHANGED|IN PROGRESS|RUNNING)\])/gi;
const FILE_PATH_IN_PROSE_REGEX = /((?:\.env(?:\.[a-zA-Z0-9_-]+)?|(?:(?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|\.\.?\/|[a-zA-Z0-9_.-]+[/\\])[^\s'",;()<>]+\.(?:xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|diff|patch|html|css|log|xml|xbrl|png|jpe?g|gif|svg|webp|env)))(?:#L\d+(?:-\d+)?)?)/gi;

export function processTextNodes(children: any, onOpenFile?: (path: string) => void): any {
  if (typeof children === 'string') {
    // ponytail: O(1) fast-path bailout for ordinary text with no audit tags or file paths
    if (!children.includes('[') && !children.includes('/') && !children.includes('\\') && !children.includes(':')) {
      return children;
    }
    const parts = children.split(STATUS_TAG_REGEX);
    const result = parts.flatMap((part, idx) => {
      const match = part.match(/^\[(COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|RECONCILED|APPROVED|DONE|EXCEPTION|MATERIAL WEAKNESS|FAIL|UNVERIFIED|REJECTED|QUALIFIED|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NEEDS REVIEW|PENDING|NOTE|WARNING|CAUTION|UNCHANGED|IN PROGRESS|RUNNING)\]$/i);
      if (match) {
        const tag = match[1].toUpperCase();
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

