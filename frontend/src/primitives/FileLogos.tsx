"use client";

export type { LogoItem } from './logos/types';

export {
  FluentExcelLogo,
  MaterialSpreadsheetLogo,
  AccountingLedgerLogo,
  CsvDelimitedLogo,
  CsvTableGridLogo,
} from './logos/spreadsheetLogos';

export {
  AdobePdfLogo,
  ModernPdfBadgeLogo,
  FluentWordLogo,
  OfficialMarkdownLogo,
  ImplementationPlanLogo,
  AuditWalkthroughLogo,
  FluentPowerPointLogo,
} from './logos/documentLogos';

export {
  AuthenticPythonLogo,
  SqlDatabaseLogo,
  JsonObjectLogo,
  JupyterNotebookLogo,
  XmlXbrlLogo,
  YamlConfigLogo,
} from './logos/codeLogos';

export {
  ConsoleTerminalLogo,
  EnterpriseFolderLogo,
  AuditWorkspacesLogo,
  ZipArchiveLogo,
  ImageEvidenceLogo,
  MediaEvidenceLogo,
} from './logos/systemLogos';

import type { LogoItem } from './logos/types';
import {
  FluentExcelLogo,
  MaterialSpreadsheetLogo,
  AccountingLedgerLogo,
  CsvDelimitedLogo,
  CsvTableGridLogo,
} from './logos/spreadsheetLogos';
import {
  AdobePdfLogo,
  ModernPdfBadgeLogo,
  FluentWordLogo,
  OfficialMarkdownLogo,
} from './logos/documentLogos';
import {
  AuthenticPythonLogo,
  SqlDatabaseLogo,
  JsonObjectLogo,
} from './logos/codeLogos';
import {
  ConsoleTerminalLogo,
  EnterpriseFolderLogo,
} from './logos/systemLogos';

/** Complete catalog of enterprise file & extension logos for user selection */
export const FILE_LOGO_CATALOG: LogoItem[] = [
  {
    id: 'LOGO-XLSX-1',
    name: 'Microsoft Fluent Excel 365 (3D Tile)',
    category: 'Spreadsheets',
    source: 'Microsoft Fluent 365',
    component: FluentExcelLogo,
    description: 'Authentic Office 365 green 3D tile with white X badge and ledger grid background.',
  },
  {
    id: 'LOGO-XLSX-2',
    name: 'VS Code Material Spreadsheet Grid',
    category: 'Spreadsheets',
    source: 'VS Code Material',
    component: MaterialSpreadsheetLogo,
    description: 'Clean dark emerald container with crisp white header row and column partitions.',
  },
  {
    id: 'LOGO-XLSX-3',
    name: 'Accounting Ledger Audit Grid',
    category: 'Spreadsheets',
    source: 'Modern Minimal',
    component: AccountingLedgerLogo,
    description: 'Statutory accounting workpaper green with double-line divider rules.',
  },
  {
    id: 'LOGO-CSV-1',
    name: 'Teal Delimited Data Matrix',
    category: 'Spreadsheets',
    source: 'VS Code Material',
    component: CsvDelimitedLogo,
    description: 'Teal rounded pill badge with crisp bold CSV uppercase lettering.',
  },
  {
    id: 'LOGO-CSV-2',
    name: 'Dual-Tone Comma Table Grid',
    category: 'Spreadsheets',
    source: 'Modern Minimal',
    component: CsvTableGridLogo,
    description: 'Cyan grid outline with data row dots representing comma-separated values.',
  },
  {
    id: 'LOGO-PDF-1',
    name: 'Adobe Acrobat Official Crimson Knot',
    category: 'Documents',
    source: 'Adobe Official',
    component: AdobePdfLogo,
    description: 'Official Adobe crimson tile with authentic infinity wave ribbon emblem.',
  },
  {
    id: 'LOGO-PDF-2',
    name: 'Modern Folded Paper with PDF Badge',
    category: 'Documents',
    source: 'VS Code Material',
    component: ModernPdfBadgeLogo,
    description: 'Crisp folded paper sheet with embedded red PDF statutory pill.',
  },
  {
    id: 'LOGO-WORD-1',
    name: 'Microsoft Fluent Word 365 (3D Tile)',
    category: 'Documents',
    source: 'Microsoft Fluent 365',
    component: FluentWordLogo,
    description: 'Authentic Office 365 blue tile with white W badge and text line preview.',
  },
  {
    id: 'LOGO-MD-1',
    name: 'Official Markdown M↓ Octicon',
    category: 'Documents',
    source: 'Modern Minimal',
    component: OfficialMarkdownLogo,
    description: 'Official standard Markdown Consortium M with down-arrow badge in sky blue.',
  },
  {
    id: 'LOGO-PY-1',
    name: 'Authentic Python Dual-Snake (Blue/Gold)',
    category: 'Code & Data',
    source: 'Official Language',
    component: AuthenticPythonLogo,
    description: 'Original Python Software Foundation logo in authentic Royal Blue (#3776AB) and Warm Gold (#FFD438).',
  },
  {
    id: 'LOGO-SQL-1',
    name: 'Relational DB Cylinders with Query Spark',
    category: 'Code & Data',
    source: 'VS Code Material',
    component: SqlDatabaseLogo,
    description: '3D blue database disks with energetic amber query execution spark.',
  },
  {
    id: 'LOGO-JSON-1',
    name: 'Gold Curly Braces {} Object',
    category: 'Code & Data',
    source: 'Modern Minimal',
    component: JsonObjectLogo,
    description: 'Amber curly braces indicating structured JSON dictionary / payload.',
  },
  {
    id: 'LOGO-TERM-1',
    name: 'Dark CLI Console with Green Prompt >_',
    category: 'System & Folders',
    source: 'VS Code Material',
    component: ConsoleTerminalLogo,
    description: 'Developer/Auditor shell window with vibrant green cursor prompt.',
  },
  {
    id: 'LOGO-DIR-1',
    name: 'Warm Gold Enterprise Audit Folder',
    category: 'System & Folders',
    source: 'Microsoft Fluent 365',
    component: EnterpriseFolderLogo,
    description: 'Warm Manila gold folder with front flap for workpaper file collections.',
  },
];
