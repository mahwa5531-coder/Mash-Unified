"use client";

import React from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileSpreadsheet, 
  FileCode, 
  FileText, 
  FileJson, 
  Database, 
  Settings, 
  Archive, 
  Image as ImageIcon, 
  File,
  Terminal,
  FileSearch
} from 'lucide-react';

interface FileIconProps {
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

/** Authentic Python Snake SVG Logo */
function PythonIconSvg({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M11.91 2c-5.09 0-4.78 2.2-4.78 2.2l.01 2.28h4.87v.69H5.13S2 6.81 2 11.94c0 5.12 2.73 4.93 2.73 4.93h1.63v-2.31s-.09-2.73 2.68-2.73h4.63s2.58.04 2.58-2.54V4.54S16.66 2 11.91 2zm-2.6 1.48a.91.91 0 1 1 0 1.82.91.91 0 0 1 0-1.82z"
        fill="#2dd4bf"
      />
      <path
        d="M12.09 22c5.09 0 4.78-2.2 4.78-2.2l-.01-2.28H11.99v-.69h6.88s3.13.36 3.13-4.77c0-5.12-2.73-4.93-2.73-4.93h-1.63v2.31s.09 2.73-2.68 2.73h-4.63s-2.58-.04-2.58 2.54v4.75S7.34 22 12.09 22zm2.6-1.48a.91.91 0 1 1 0-1.82.91.91 0 0 1 0-1.82z"
        fill="#2dd4bf"
      />
    </svg>
  );
}

export default function FileIcon({ 
  filename, 
  className = "shrink-0", 
  size = 14, 
  isFolder = false, 
  isOpen = false 
}: FileIconProps) {
  const iconStyle = { width: `${size}px`, height: `${size}px` };

  if (isFolder) {
    if (isOpen) {
      return <FolderOpen style={iconStyle} className={`${className} text-[#DCB67A]`} />;
    }
    return <Folder style={iconStyle} className={`${className} text-[#DCB67A]`} />;
  }

  const clean = filename.toLowerCase().trim();
  const basename = clean.split(/[/\\]/).pop() || clean;
  const ext = basename.split('.').pop() || '';

  // 1. Special full filenames & config patterns
  if (basename === 'dockerfile' || basename.startsWith('dockerfile.') || basename.startsWith('docker-compose')) {
    return <FileCode style={iconStyle} className={`${className} text-[#2496ED]`} />;
  }
  if (basename === '.gitignore' || basename === '.gitattributes' || basename === '.gitmodules') {
    return <FileText style={iconStyle} className={`${className} text-[#F05032]`} />;
  }
  if (basename.startsWith('.env')) {
    return <Settings style={iconStyle} className={`${className} text-[#E5C07B]`} />;
  }
  if (basename === 'package.json' || basename === 'package-lock.json' || basename === 'tsconfig.json') {
    return <FileJson style={iconStyle} className={`${className} text-[#FBC02D]`} />;
  }
  if (basename === 'cargo.toml' || basename === 'cargo.lock') {
    return <Settings style={iconStyle} className={`${className} text-[#DEA584]`} />;
  }
  if (basename === 'go.mod' || basename === 'go.sum') {
    return <FileCode style={iconStyle} className={`${className} text-[#00ADD8]`} />;
  }
  if (basename === 'requirements.txt' || basename === 'pyproject.toml') {
    return <FileText style={iconStyle} className={`${className} text-[#3776AB]`} />;
  }

  // 2. Extensions matching
  switch (ext) {
    // Spreadsheets & Data Analytics
    case 'xlsx':
    case 'xls':
    case 'xlsm':
    case 'csv':
    case 'tsv':
    case 'parquet':
    case 'feather':
      return <FileSpreadsheet style={iconStyle} className={`${className} text-[#107C41]`} />;

    // Python & Data Science
    case 'py':
    case 'pyw':
    case 'pyi':
      return <PythonIconSvg size={size} className={className} />;
    case 'ipynb':
      return <FileCode style={iconStyle} className={`${className} text-[#F37626]`} />;

    // JavaScript & TypeScript Ecosystem
    case 'ts':
    case 'mts':
    case 'cts':
      return <FileCode style={iconStyle} className={`${className} text-[#3178C6]`} />;
    case 'tsx':
    case 'jsx':
      return <ReactIconSvg size={size} className={className} />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileCode style={iconStyle} className={`${className} text-[#F7DF1E]`} />;

    // Templates & Documentations
    case 'j2':
    case 'jinja':
    case 'jinja2':
      return <File style={iconStyle} className={`${className} text-zinc-400`} strokeWidth={1.5} />;
    case 'md':
    case 'markdown':
    case 'mdx':
      return <FileText style={iconStyle} className={`${className} text-[#388bfd]`} strokeWidth={1.5} />;
    case 'pdf':
      return <FileText style={iconStyle} className={`${className} text-[#F40F02]`} />;
    case 'txt':
    case 'log':
      return <FileText style={iconStyle} className={`${className} text-zinc-400`} />;

    // Web Frontend
    case 'html':
    case 'htm':
      return <FileCode style={iconStyle} className={`${className} text-[#E34F26]`} />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <FileCode style={iconStyle} className={`${className} text-[#1572B6]`} />;

    // Data Formats & Configs
    case 'json':
    case 'json5':
    case 'jsonc':
      return <FileJson style={iconStyle} className={`${className} text-[#FBC02D]`} />;
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'conf':
    case 'cfg':
      return <Settings style={iconStyle} className={`${className} text-[#E5C07B]`} />;

    // Database & SQL
    case 'sql':
    case 'db':
    case 'sqlite':
    case 'sqlite3':
      return <Database style={iconStyle} className={`${className} text-[#336791]`} />;

    // Shell Scripts
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ps1':
    case 'psm1':
    case 'bat':
    case 'cmd':
      return <Terminal style={iconStyle} className={`${className} text-[#4EAA25]`} />;

    // Systems & Compiled Languages
    case 'rs':
    case 'go':
    case 'c':
    case 'h':
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
    case 'java':
    case 'class':
    case 'jar':
      return <FileCode style={iconStyle} className={`${className} text-[#DEA584]`} />;

    // Archives & Compressed Files
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return <Archive style={iconStyle} className={`${className} text-[#D97706]`} />;

    // Media & Assets
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
    case 'bmp':
      return <ImageIcon style={iconStyle} className={`${className} text-[#A074C4]`} />;

    default:
      return <File style={iconStyle} className={`${className} text-[var(--text-muted)]`} />;
  }
}
