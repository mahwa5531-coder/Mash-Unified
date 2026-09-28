"use client";

// Re-export canonical FilePill primitive from @/primitives
import React from 'react';
import { FilePill as PrimitiveFilePill, FilePillProps } from '@/primitives';

export { FilePill as PrimitiveFilePill } from '@/primitives';

/**
 * Work-log FilePill adapter: supports both primitive props ({ path, label, line })
 * and legacy work-log props ({ filename, filePath, lineRange }) with 100% type safety.
 */
export function FilePill(props: {
  filename?: string;
  filePath?: string;
  lineRange?: string | null;
  path?: string;
  label?: string;
  line?: number | string;
  onOpenFile?: (path: string) => void;
  onClose?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  const resolvedPath = props.path || props.filePath || '';
  const resolvedLabel = props.label || props.filename;
  const resolvedLine = props.line !== undefined ? props.line : props.lineRange;

  return (
    <PrimitiveFilePill
      path={resolvedPath}
      label={resolvedLabel}
      line={resolvedLine || undefined}
      onOpenFile={props.onOpenFile}
      onClose={props.onClose}
      className={props.className}
    />
  );
}

/**
 * Clickable output link renderer for terminal/task execution outputs:
 * Converts raw file:/// links into canonical ghost FilePills.
 */
export function renderOutputWithLinks(text: string, onOpenFile?: (path: string) => void) {
  if (!text) return null;
  const linkRegex = /(file:\/\/\/[^\s\)\"\']+)/g;
  const parts = text.split(linkRegex);
  if (parts.length === 1) return text;

  return parts.map((part, idx) => {
    if (part.startsWith('file:///')) {
      const cleanPath = decodeURIComponent(part.replace(/^file:\/\/\/?/, '')).replace(/^\/([a-zA-Z]:)/, '$1');
      const basename = cleanPath.split(/[/\\]/).pop() || cleanPath;
      return (
        <PrimitiveFilePill
          key={idx}
          path={cleanPath}
          label={basename}
          onOpenFile={onOpenFile}
        />
      );
    }
    return part;
  });
}
