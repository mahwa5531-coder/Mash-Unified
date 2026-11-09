"use client";

import React from 'react';
import { 
  FileText 
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
  TypeScriptLogo,
  JavaScriptLogo,
  ReactLogo,
  RustLogo,
  GoLogo,
  CLogo,
  CppLogo,
  CSharpLogo,
  JavaLogo,
  KotlinLogo,
  SwiftLogo,
  RubyLogo,
  PhpLogo,
  VueLogo,
  SvelteLogo,
  AstroLogo,
  HtmlLogo,
  CssLogo,
  SassLogo,
  GraphqlLogo,
  PrismaLogo,
  ProtobufLogo,
  DartLogo,
  LuaLogo,
  ZigLogo,
  ElixirLogo,
  ScalaLogo,
  HaskellLogo,
  DockerLogo,
  GitLogo,
  EnvConfigLogo,
  ConfigSettingsLogo,
  KubernetesLogo,
  TerraformLogo,
  MakefileLogo,
} from './FileLogos';

export interface FileIconProps {
  filename: string;
  className?: string;
  size?: number;
  isFolder?: boolean;
  isOpen?: boolean;
}

type LogoComponent = React.ComponentType<{ size?: number; className?: string }>;

/** Exact filename lookup for common development & configuration files */
const EXACT_FILE_MAP: Record<string, LogoComponent> = {
  'dockerfile': DockerLogo,
  '.dockerignore': DockerLogo,
  'docker-compose.yml': DockerLogo,
  'docker-compose.yaml': DockerLogo,
  '.gitignore': GitLogo,
  '.gitattributes': GitLogo,
  '.gitmodules': GitLogo,
  'package.json': JsonObjectLogo,
  'package-lock.json': JsonObjectLogo,
  'tsconfig.json': TypeScriptLogo,
  'cargo.toml': RustLogo,
  'cargo.lock': RustLogo,
  'go.mod': GoLogo,
  'go.sum': GoLogo,
  'requirements.txt': AuthenticPythonLogo,
  'pyproject.toml': AuthenticPythonLogo,
  'makefile': MakefileLogo,
  'gnumakefile': MakefileLogo,
  'cmakelists.txt': CLogo,
  '.editorconfig': ConfigSettingsLogo,
};

/** Extension lookup dictionary covering languages, formats, and tools */
const EXTENSION_MAP: Record<string, LogoComponent> = {
  // Spreadsheets & Financial Workpapers
  'xlsx': FluentExcelLogo,
  'xls': FluentExcelLogo,
  'xlsm': FluentExcelLogo,
  'xlsb': FluentExcelLogo,
  'ods': FluentExcelLogo,

  // Presentations & Executive Decks
  'pptx': FluentPowerPointLogo,
  'ppt': FluentPowerPointLogo,
  'odp': FluentPowerPointLogo,
  'key': FluentPowerPointLogo,

  // Delimited Data & Analytics
  'csv': CsvDelimitedLogo,
  'tsv': CsvDelimitedLogo,
  'tab': CsvDelimitedLogo,
  'parquet': CsvDelimitedLogo,
  'feather': CsvDelimitedLogo,
  'arrow': CsvDelimitedLogo,

  // Statutory Documents & Memos
  'pdf': AdobePdfLogo,

  // Word Documents & Letters
  'docx': FluentWordLogo,
  'doc': FluentWordLogo,
  'odt': FluentWordLogo,
  'rtf': FluentWordLogo,

  // Python & Data Science
  'py': AuthenticPythonLogo,
  'pyw': AuthenticPythonLogo,
  'pyi': AuthenticPythonLogo,
  'ipynb': JupyterNotebookLogo,

  // TypeScript & JavaScript Ecosystem
  'ts': TypeScriptLogo,
  'mts': TypeScriptLogo,
  'cts': TypeScriptLogo,
  'tsx': ReactLogo,
  'jsx': ReactLogo,
  'js': JavaScriptLogo,
  'mjs': JavaScriptLogo,
  'cjs': JavaScriptLogo,

  // Web Frameworks & Frontend
  'vue': VueLogo,
  'svelte': SvelteLogo,
  'astro': AstroLogo,
  'html': HtmlLogo,
  'htm': HtmlLogo,
  'xhtml': HtmlLogo,
  'css': CssLogo,
  'scss': SassLogo,
  'sass': SassLogo,
  'less': SassLogo,

  // Systems & Compiled Languages
  'rs': RustLogo,
  'go': GoLogo,
  'c': CLogo,
  'h': CLogo,
  'cpp': CppLogo,
  'hpp': CppLogo,
  'cc': CppLogo,
  'cxx': CppLogo,
  'c++': CppLogo,
  'cs': CSharpLogo,
  'csx': CSharpLogo,
  'java': JavaLogo,
  'class': JavaLogo,
  'jar': JavaLogo,
  'kt': KotlinLogo,
  'kts': KotlinLogo,
  'swift': SwiftLogo,
  'rb': RubyLogo,
  'erb': RubyLogo,
  'gemspec': RubyLogo,
  'php': PhpLogo,
  'phtml': PhpLogo,
  'dart': DartLogo,
  'lua': LuaLogo,
  'zig': ZigLogo,
  'ex': ElixirLogo,
  'exs': ElixirLogo,
  'scala': ScalaLogo,
  'sc': ScalaLogo,
  'hs': HaskellLogo,
  'lhs': HaskellLogo,

  // API, Database & Schemas
  'graphql': GraphqlLogo,
  'gql': GraphqlLogo,
  'prisma': PrismaLogo,
  'proto': ProtobufLogo,
  'protobuf': ProtobufLogo,
  'sql': SqlDatabaseLogo,
  'db': SqlDatabaseLogo,
  'sqlite': SqlDatabaseLogo,
  'sqlite3': SqlDatabaseLogo,
  'duckdb': SqlDatabaseLogo,

  // DevOps & Cloud Configuration
  'tf': TerraformLogo,
  'tfvars': TerraformLogo,
  'k8s': KubernetesLogo,

  // Data Formats & Configs
  'json': JsonObjectLogo,
  'json5': JsonObjectLogo,
  'jsonc': JsonObjectLogo,
  'yaml': YamlConfigLogo,
  'yml': YamlConfigLogo,
  'xml': XmlXbrlLogo,
  'xbrl': XmlXbrlLogo,
  'xaml': XmlXbrlLogo,
  'toml': ConfigSettingsLogo,
  'ini': ConfigSettingsLogo,
  'conf': ConfigSettingsLogo,
  'cfg': ConfigSettingsLogo,
  'properties': ConfigSettingsLogo,

  // Documentation & Templates
  'md': OfficialMarkdownLogo,
  'markdown': OfficialMarkdownLogo,
  'mdx': OfficialMarkdownLogo,
  'rmd': OfficialMarkdownLogo,

  // Shell Scripts & Terminal
  'sh': ConsoleTerminalLogo,
  'bash': ConsoleTerminalLogo,
  'zsh': ConsoleTerminalLogo,
  'ps1': ConsoleTerminalLogo,
  'psm1': ConsoleTerminalLogo,
  'psd1': ConsoleTerminalLogo,
  'bat': ConsoleTerminalLogo,
  'cmd': ConsoleTerminalLogo,

  // Media & Scanned Evidence Vouchers
  'png': ImageEvidenceLogo,
  'jpg': ImageEvidenceLogo,
  'jpeg': ImageEvidenceLogo,
  'gif': ImageEvidenceLogo,
  'svg': ImageEvidenceLogo,
  'webp': ImageEvidenceLogo,
  'ico': ImageEvidenceLogo,
  'bmp': ImageEvidenceLogo,
  'tiff': ImageEvidenceLogo,
  'tif': ImageEvidenceLogo,
  'avif': ImageEvidenceLogo,

  // Statutory Audio/Video Recordings
  'mp4': MediaEvidenceLogo,
  'mov': MediaEvidenceLogo,
  'avi': MediaEvidenceLogo,
  'mkv': MediaEvidenceLogo,
  'webm': MediaEvidenceLogo,
  'mp3': MediaEvidenceLogo,
  'wav': MediaEvidenceLogo,
  'm4a': MediaEvidenceLogo,
  'ogg': MediaEvidenceLogo,
  'flac': MediaEvidenceLogo,

  // Evidence Archives & Backups
  'zip': ZipArchiveLogo,
  'tar': ZipArchiveLogo,
  'gz': ZipArchiveLogo,
  'rar': ZipArchiveLogo,
  '7z': ZipArchiveLogo,
  'bz2': ZipArchiveLogo,
  'xz': ZipArchiveLogo,
  'tgz': ZipArchiveLogo,
};

export function FileIcon({ 
  filename, 
  className = "shrink-0", 
  size = 14, 
  isFolder = false, 
  isOpen: _isOpen = false 
}: FileIconProps) {
  const iconStyle = { width: `${size}px`, height: `${size}px` };

  if (isFolder) {
    return <EnterpriseFolderLogo size={size} className={className} />;
  }

  const clean = filename.toLowerCase().trim();
  const basename = clean.split(/[/\\]/).pop() || clean;
  const ext = basename.split('.').pop() || '';

  // 1. Exact Filename Match
  const ExactMatch = EXACT_FILE_MAP[basename];
  if (ExactMatch) {
    return <ExactMatch size={size} className={className} />;
  }

  // 2. Prefix / Pattern Matches
  if (basename.startsWith('.env')) {
    return <EnvConfigLogo size={size} className={className} />;
  }
  if (basename.startsWith('dockerfile') || basename.startsWith('docker-compose')) {
    return <DockerLogo size={size} className={className} />;
  }
  if (basename.includes('plan') && (ext === 'md' || ext === 'markdown' || ext === 'txt' || !ext)) {
    return <ImplementationPlanLogo size={size} className={className} />;
  }
  if ((basename.includes('walkthrough') || basename.includes('worklog') || basename.includes('audit_trail')) && (ext === 'md' || ext === 'log' || ext === 'txt')) {
    return <AuditWalkthroughLogo size={size} className={className} />;
  }

  // 3. Extension Map Match
  const ExtMatch = EXTENSION_MAP[ext];
  if (ExtMatch) {
    return <ExtMatch size={size} className={className} />;
  }

  // 4. Fallback Default
  return <FileText size={size} style={iconStyle} className={`${className} text-zinc-400`} />;
}

export default FileIcon;
