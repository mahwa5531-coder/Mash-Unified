"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import {
  FluentExcelLogo,
  AdobePdfLogo,
  CsvDelimitedLogo,
  FluentWordLogo,
  AuthenticPythonLogo,
  OfficialMarkdownLogo,
  SqlDatabaseLogo,
  JsonObjectLogo,
  FluentPowerPointLogo,
  ZipArchiveLogo,
} from './FileLogos';

export interface ExtensionBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  extension: string;
}

const EXT_MAP: Record<string, { label: string; logo: React.ReactElement; style: string }> = {
  xlsx: {
    label: 'XLSX',
    logo: <FluentExcelLogo size={12} />,
    style: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  xls: {
    label: 'XLS',
    logo: <FluentExcelLogo size={12} />,
    style: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  xlsm: {
    label: 'XLSM',
    logo: <FluentExcelLogo size={12} />,
    style: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25',
  },
  csv: {
    label: 'CSV',
    logo: <CsvDelimitedLogo size={12} />,
    style: 'bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/25',
  },
  pdf: {
    label: 'PDF',
    logo: <AdobePdfLogo size={12} />,
    style: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25',
  },
  docx: {
    label: 'DOCX',
    logo: <FluentWordLogo size={12} />,
    style: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25',
  },
  doc: {
    label: 'DOC',
    logo: <FluentWordLogo size={12} />,
    style: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25',
  },
  pptx: {
    label: 'PPTX',
    logo: <FluentPowerPointLogo size={12} />,
    style: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/25',
  },
  md: {
    label: 'MD',
    logo: <OfficialMarkdownLogo size={12} />,
    style: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25',
  },
  markdown: {
    label: 'MARKDOWN',
    logo: <OfficialMarkdownLogo size={12} />,
    style: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25',
  },
  py: {
    label: 'PYTHON',
    logo: <AuthenticPythonLogo size={12} />,
    style: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/25',
  },
  sql: {
    label: 'SQL',
    logo: <SqlDatabaseLogo size={12} />,
    style: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/25',
  },
  json: {
    label: 'JSON',
    logo: <JsonObjectLogo size={12} />,
    style: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25',
  },
  zip: {
    label: 'ZIP',
    logo: <ZipArchiveLogo size={12} />,
    style: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/25',
  },
};

/**
 * ExtensionBadge Primitive
 * 
 * Renders standalone file extensions (e.g. `.xlsx`, `.pdf`, `.md`) with authentic
 * vector logos and executive, non-alarmist color grading.
 */
export function ExtensionBadge({ extension, className, ...props }: ExtensionBadgeProps) {
  const clean = extension.replace(/^\.+/, '').toLowerCase().trim();
  const config = EXT_MAP[clean];

  if (!config) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-[4px] font-mono text-[10.5px] font-medium tracking-wide select-none align-baseline leading-none",
          "bg-zinc-100 dark:bg-white/[0.06] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-white/[0.08]",
          className
        )}
        {...props}
      >
        .{clean.toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-[4px] font-mono text-[10.5px] font-semibold tracking-wide select-none align-baseline leading-none border shadow-2xs",
        config.style,
        className
      )}
      {...props}
    >
      <span className="shrink-0">{config.logo}</span>
      <span>{config.label}</span>
    </span>
  );
}

export default ExtensionBadge;
