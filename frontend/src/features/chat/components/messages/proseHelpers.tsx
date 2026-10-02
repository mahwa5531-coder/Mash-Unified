import React from 'react';
import { FilePill, AuditBadge } from '@/primitives';
import { normalizePath, safeDecodeURI } from '@/utils/normalizePath';
import { shouldExcludePath } from '@/features/artifacts/utils/extraction';

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

// Dynamic financial cell detector: recognizes all Unicode currency symbols (\p{Sc}), 
// currency codes (INR, USD, EUR, etc.), accounting negative parens (e.g. ($4,000) or (₹1,50,000)),
// Dr/Cr indicators, percentages, and Indian scales (Lakhs/Crores)
export function isFinancialCell(raw: string): boolean {
  const text = (raw || '').trim();
  if (!text) return false;
  if (/^[-−–—]$/.test(text) || /^(nil|n\/a|none)$/i.test(text)) return true;

  let s = text;
  if (s.startsWith('(') && s.endsWith(')')) {
    s = s.slice(1, -1).trim();
  }

  s = s.replace(/^[-+−–]/, '').replace(/[-+−–]$/, '').trim();
  s = s.replace(/^\p{Sc}\s*/u, '').replace(/\s*\p{Sc}$/u, '');
  s = s.replace(/^(rs\.?|inr|usd|eur|gbp|aed|cad|aud|sgd|chf|jpy|cny)\s*/i, '');
  s = s.replace(/\s*(rs\.?|inr|usd|eur|gbp|aed|cad|aud|sgd|chf|jpy|cny)$/i, '');
  s = s.replace(/\s*(%|dr\.?|cr\.?|lakhs?|crores?|[kmb])\s*$/i, '').trim();

  if (!s) return false;
  return /^[\d,]+(\.\d+)?$/.test(s) || /^[\d\.]+(,\d+)?$/.test(s);
}

// Format file pill label and path cleanly
export function formatFilePill(rawLabel: string, rawHref: string) {
  const rawPath = normalizePath(rawHref || rawLabel || '', false);
  const [filePath, lineAnchor] = rawPath.split('#');

  const parts = filePath.split(/[/\\]/);
  const basename = parts.pop() || filePath;
  const labelParts = safeDecodeURI(rawLabel || '').split(/[/\\]/);
  const cleanLabel = labelParts.pop() || basename;

  let display = (cleanLabel && !cleanLabel.startsWith('file:') && cleanLabel !== '[object Object]' ? cleanLabel : basename).trim();
  if (lineAnchor && !/:(?:L)?\d+(?:-\d+)?$/i.test(display)) {
    const cleanAnchor = lineAnchor.replace(/^[#L]+/, '');
    if (cleanAnchor) display = `${display}:${cleanAnchor}`;
  }

  return { filePath, display };
}

// Detect if a string is a valid full file path with recognized extension (must have directory slash, no wildcards)
export function isFullFilePath(raw: string): boolean {
  if (!raw || typeof raw !== 'string' || shouldExcludePath(raw)) return false;
  const clean = normalizePath(raw.trim());
  if (shouldExcludePath(clean)) return false;
  if (!clean || clean.includes(' ') || clean.includes('\n') || clean.includes('(') || clean.includes(')') || clean.includes('*') || clean.includes('?')) return false;

  const FILE_EXT_REGEX = /\.(xlsx?|xlsm|xlsb|ods|csv|tsv|parquet|pdf|docx?|pptx?|py|pyw|ipynb|tsx?|jsx?|mjs|cjs|json|ya?ml|toml|sql|db|sqlite|md|markdown|txt|log|html|css|scss|xml|xbrl|sh|bash|zsh|ps1|rs|go|c|cpp|h|java|zip|tar|gz|png|jpe?g|gif|svg|webp)$/i;

  const hasSlash = clean.includes('/') || clean.includes('\\');
  const parts = clean.split(/[/\\]/);
  const filename = parts.pop() || '';
  return hasSlash && FILE_EXT_REGEX.test(clean) && filename.length > 0 && !filename.startsWith('.');
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
const FILE_PATH_IN_PROSE_REGEX = /((?:file:\/\/\/?|[a-zA-Z]:[/\\]|\/(?:Users|home|tmp)\/|(?:scratch|tests|frontend|connector|src|working_papers|Audit_Deliverables)\/)[^\s'",;()<>]+\.(?:py|tsx?|jsx?|mjs|json|ya?ml|toml|sql|csv|xlsx?|md|txt|diff|patch|html|css|log)(?:#L\d+(?:-\d+)?)?)/gi;

export function processTextNodes(children: any, onOpenFile?: (path: string) => void): any {
  if (typeof children === 'string') {
    const parts = children.split(STATUS_TAG_REGEX);
    return parts.map((part, idx) => {
      const match = part.match(/^\[(COMPLIANT|NO EXCEPTION|NO EXCEPTION NOTED|PASS|VERIFIED|EXCEPTION|MATERIAL WEAKNESS|FAIL|SIGNIFICANT DEFICIENCY|CONTROL DEFICIENCY|HIGH RISK|MEDIUM RISK|LOW RISK|NOTE|WARNING|CAUTION)\]$/);
      if (match) {
        const tag = match[1];
        return (
          <AuditBadge key={`tag_${idx}`} status={tag}>
            {tag}
          </AuditBadge>
        );
      }

      const pathParts = part.split(FILE_PATH_IN_PROSE_REGEX);
      if (pathParts.length === 1) return part;

      return pathParts.map((pPart, pIdx) => {
        if (pPart && isFullFilePath(pPart)) {
          const { filePath, display } = formatFilePill(pPart, pPart);
          return (
            <FilePill
              key={`pill_${pIdx}_${filePath}`}
              path={filePath}
              label={display}
              onOpenFile={onOpenFile}
            />
          );
        }
        return pPart;
      });
    });
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

// Safely balance LaTeX delimiters during live streaming
export function sanitizeMathString(content: string, isStreaming: boolean = false): string {
  if (!content) return content;
  let text = content;

  if (isStreaming) {
    const lastOpenDisplay = text.lastIndexOf('\\[');
    const lastCloseDisplay = text.lastIndexOf('\\]');
    if (lastOpenDisplay !== -1 && lastOpenDisplay > lastCloseDisplay) {
      text = text + '\n\\]';
    }

    const lastOpenInline = text.lastIndexOf('\\(');
    const lastCloseInline = text.lastIndexOf('\\)');
    if (lastOpenInline !== -1 && lastOpenInline > lastCloseInline) {
      text = text + '\\)';
    }

    const doubleDollarMatches = text.match(/(?<!\\)\$\$/g);
    if (doubleDollarMatches && doubleDollarMatches.length % 2 === 1) {
      text = text + '\n$$';
    }
  }

  return text;
}
