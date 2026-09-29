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

export interface ExtensionBadgeProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  extension: string;
}

const EXT_LOGO_MAP: Record<string, { label: string; logo: React.ReactElement }> = {
  xlsx: { label: '.xlsx', logo: <FluentExcelLogo size={12} /> },
  xls: { label: '.xls', logo: <FluentExcelLogo size={12} /> },
  xlsm: { label: '.xlsm', logo: <FluentExcelLogo size={12} /> },
  csv: { label: '.csv', logo: <CsvDelimitedLogo size={12} /> },
  pdf: { label: '.pdf', logo: <AdobePdfLogo size={12} /> },
  docx: { label: '.docx', logo: <FluentWordLogo size={12} /> },
  doc: { label: '.doc', logo: <FluentWordLogo size={12} /> },
  pptx: { label: '.pptx', logo: <FluentPowerPointLogo size={12} /> },
  md: { label: '.md', logo: <OfficialMarkdownLogo size={12} /> },
  markdown: { label: '.markdown', logo: <OfficialMarkdownLogo size={12} /> },
  py: { label: '.py', logo: <AuthenticPythonLogo size={12} /> },
  sql: { label: '.sql', logo: <SqlDatabaseLogo size={12} /> },
  json: { label: '.json', logo: <JsonObjectLogo size={12} /> },
  zip: { label: '.zip', logo: <ZipArchiveLogo size={12} /> },
};

/**
 * ExtensionBadge Primitive
 * 
 * Follows the exact calm ghost pill format of FilePill and PathPill.
 * Renders an authentic left vector logo + clean monospace extension label
 * in neutral, non-alarmist ghost styling.
 */
export function ExtensionBadge({
  extension,
  className,
  onClick,
  ...props
}: ExtensionBadgeProps) {
  const clean = extension.replace(/^\.+/, '').toLowerCase().trim();
  const config = EXT_LOGO_MAP[clean];
  const displayLabel = config?.label || `.${clean}`;
  const Logo = config?.logo;

  return (
    <button
      type="button"
      onClick={onClick}
      title={`File format: ${displayLabel}`}
      className={cn(
        "group inline-flex items-center gap-1.5 h-[21px] px-1.5 py-0 mx-0.5 rounded-[4px] font-mono text-[11px] leading-none select-none cursor-pointer align-baseline my-0 outline-none transition-all duration-150 active:scale-[0.98]",
        "bg-zinc-100 hover:bg-zinc-200/90 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]",
        "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.20]",
        "shadow-2xs",
        className
      )}
      {...props}
    >
      {Logo && (
        <span className="shrink-0 flex items-center justify-center transition-transform group-hover:scale-105">
          {Logo}
        </span>
      )}
      <span className="font-semibold leading-none">
        {displayLabel}
      </span>
    </button>
  );
}

export default ExtensionBadge;
