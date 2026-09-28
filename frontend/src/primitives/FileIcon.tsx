"use client";

import React from 'react';
import { 
  FileCode, 
  FileText, 
  Settings, 
  Archive, 
  Image as ImageIcon, 
  File,
  FileSearch
} from 'lucide-react';
import {
  FluentExcelLogo,
  AdobePdfLogo,
  CsvDelimitedLogo,
  FluentWordLogo,
  AuthenticPythonLogo,
  OfficialMarkdownLogo,
  SqlDatabaseLogo,
  JsonObjectLogo,
  ConsoleTerminalLogo,
  EnterpriseFolderLogo,
  ImplementationPlanLogo,
  AuditWalkthroughLogo,
  FluentPowerPointLogo,
  JupyterNotebookLogo,
  XmlXbrlLogo,
  YamlConfigLogo,
  ZipArchiveLogo,
  ImageEvidenceLogo,
  MediaEvidenceLogo,
} from './FileLogos';

export interface FileIconProps {
  filename: string;
  className?: string;
  size?: number;
  isFolder?: boolean;
  isOpen?: boolean;
}

/** Authentic React Atom SVG Logo */
function ReactIconSvg({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="-11.5 -10.23 23 20.46" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="0" cy="0" r="2.05" fill="#61dafb" />
      <g stroke="#61dafb" strokeWidth="1" fill="none">
        <ellipse rx="11" ry="4.2" />
        <ellipse rx="11" ry="4.2" transform="rotate(60)" />
        <ellipse rx="11" ry="4.2" transform="rotate(120)" />
      </g>
    </svg>
  );
}

export function FileIcon({ 
  filename, 
  className = "shrink-0", 
  size = 14, 
  isFolder = false, 
  isOpen = false 
}: FileIconProps) {
  const iconStyle = { width: `${size}px`, height: `${size}px` };

  if (isFolder) {
    return <EnterpriseFolderLogo size={size} className={className} />;
  }

  const clean = filename.toLowerCase().trim();
  const basename = clean.split(/[/\\]/).pop() || clean;
  const ext = basename.split('.').pop() || '';

  // 1. Special full filenames & config patterns
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.') || basename.startsWith('docker-compose')) {
    return <FileCode size={size} style={iconStyle} className={`${className} text-[#2496ED]`} />;
  }
  if (basename === '.gitignore' || basename === '.gitattributes' || basename === '.gitmodules') {
    return <FileText size={size} style={iconStyle} className={`${className} text-[#F05032]`} />;
  }
  if (basename.startsWith('.env')) {
    return <Settings size={size} style={iconStyle} className={`${className} text-[#E5C07B]`} />;
  }
  if (basename === 'package.json' || basename === 'package-lock.json' || basename === 'tsconfig.json') {
    return <JsonObjectLogo size={size} className={className} />;
  }
  if (basename === 'cargo.toml' || basename === 'cargo.lock') {
    return <Settings size={size} style={iconStyle} className={`${className} text-[#DEA584]`} />;
  }
  if (basename === 'go.mod' || basename === 'go.sum') {
    return <FileCode size={size} style={iconStyle} className={`${className} text-[#00ADD8]`} />;
  }
  if (basename === 'requirements.txt' || basename === 'pyproject.toml') {
    return <AuthenticPythonLogo size={size} className={className} />;
  }
  if (basename.includes('plan') && (ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext)) {
    return <ImplementationPlanLogo size={size} className={className} />;
  }
  if ((basename.includes('walkthrough') || basename.includes('worklog') || basename.includes('audit_trail')) && (ext === 'md' || ext === 'log' || ext === 'txt')) {
    return <AuditWalkthroughLogo size={size} className={className} />;
  }

  // 2. Extensions matching
  switch (ext) {
    // Spreadsheets & Financial Workpapers (Microsoft Fluent 365)
    case 'xlsx':
    case 'xls':
    case 'xlsm':
    case 'xlsb':
    case 'ods':
      return <FluentExcelLogo size={size} className={className} />;

    // Presentations & Executive Decks (Microsoft Fluent 365)
    case 'pptx':
    case 'ppt':
    case 'odp':
    case 'key':
      return <FluentPowerPointLogo size={size} className={className} />;

    // Delimited Data & Analytics (Teal CSV Matrix)
    case 'csv':
    case 'tsv':
    case 'tab':
    case 'parquet':
    case 'feather':
    case 'arrow':
      return <CsvDelimitedLogo size={size} className={className} />;

    // Statutory Documents & Memos (Adobe Acrobat Official)
    case 'pdf':
      return <AdobePdfLogo size={size} className={className} />;

    // Word Documents & Letters (Microsoft Fluent 365)
    case 'docx':
    case 'doc':
    case 'odt':
    case 'rtf':
      return <FluentWordLogo size={size} className={className} />;

    // Python & Data Science (Official Language Dual-Snake)
    case 'py':
    case 'pyw':
    case 'pyi':
      return <AuthenticPythonLogo size={size} className={className} />;
    case 'ipynb':
      return <JupyterNotebookLogo size={size} className={className} />;

    // JavaScript & TypeScript Ecosystem
    case 'ts':
    case 'mts':
    case 'cts':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#3178C6]`} />;
    case 'tsx':
    case 'jsx':
      return <ReactIconSvg size={size} className={className} />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#F7DF1E]`} />;

    // Templates & Documentations
    case 'md':
    case 'markdown':
    case 'mdx':
      return <OfficialMarkdownLogo size={size} className={className} />;
    case 'txt':
    case 'log':
      return <FileText size={size} style={iconStyle} className={`${className} text-zinc-400`} />;

    // Web Frontend
    case 'html':
    case 'htm':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#E34F26]`} />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#1572B6]`} />;

    // Data Formats & Configs
    case 'json':
    case 'json5':
    case 'jsonc':
      return <JsonObjectLogo size={size} className={className} />;
    case 'yaml':
    case 'yml':
      return <YamlConfigLogo size={size} className={className} />;
    case 'xml':
    case 'xbrl':
      return <XmlXbrlLogo size={size} className={className} />;
    case 'toml':
    case 'ini':
    case 'conf':
    case 'cfg':
      return <Settings size={size} style={iconStyle} className={`${className} text-[#E5C07B]`} />;

    // Database & SQL
    case 'sql':
    case 'db':
    case 'sqlite':
    case 'sqlite3':
    case 'duckdb':
      return <SqlDatabaseLogo size={size} className={className} />;

    // Shell Scripts & Terminal
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'psm1':
    case 'bat':
    case 'cmd':
      return <ConsoleTerminalLogo size={size} className={className} />;

    // Systems & Compiled Languages
    case 'rs':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#DEA584]`} />;
    case 'go':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#00ADD8]`} />;
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#00599C]`} />;
    case 'java':
    case 'class':
    case 'jar':
      return <FileCode size={size} style={iconStyle} className={`${className} text-[#ED8B00]`} />;

    // Media & Scanned Evidence Vouchers
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
    case 'tiff':
    case 'tif':
      return <ImageEvidenceLogo size={size} className={className} />;

    // Statutory Interview & Audio/Video Recordings
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv':
    case 'webm':
    case 'mp3':
    case 'wav':
    case 'm4a':
    case 'ogg':
      return <MediaEvidenceLogo size={size} className={className} />;

    // Evidence Archives & Backups
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
    case 'bz2':
    case 'xz':
      return <ZipArchiveLogo size={size} className={className} />;

    // Fallback default
    default:
      return <FileText size={size} style={iconStyle} className={`${className} text-zinc-400`} />;
  }
}

export default FileIcon;
