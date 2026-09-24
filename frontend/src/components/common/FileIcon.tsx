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
      return <FileCode style={iconStyle} className={`${className} text-[#3776AB]`} />;
    case 'ipynb':
      return <FileCode style={iconStyle} className={`${className} text-[#F37626]`} />;

    // JavaScript & TypeScript Ecosystem
    case 'ts':
    case 'mts':
    case 'cts':
      return <FileCode style={iconStyle} className={`${className} text-[#3178C6]`} />;
    case 'tsx':
    case 'jsx':
      return <FileCode style={iconStyle} className={`${className} text-[#61DAFB]`} />;
    case 'js':
    case 'mjs':
    case 'cjs':
      return <FileCode style={iconStyle} className={`${className} text-[#F7DF1E]`} />;

    // Documentation
    case 'md':
    case 'markdown':
    case 'mdx':
      return <FileSearch style={iconStyle} className={`${className} text-[#388bfd]`} />;
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
