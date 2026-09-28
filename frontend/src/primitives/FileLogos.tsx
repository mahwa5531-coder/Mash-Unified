"use client";

import React from 'react';

export interface LogoItem {
  id: string;
  name: string;
  category: 'Spreadsheets' | 'Documents' | 'Code & Data' | 'System & Folders';
  source: 'Microsoft Fluent 365' | 'VS Code Material' | 'Adobe Official' | 'Official Language' | 'Modern Minimal';
  component: (props: { size?: number; className?: string }) => React.ReactElement;
  description: string;
}

// --------------------------------------------------------------------------
// 1. SPREADSHEETS (Excel, CSV, TSV)
// --------------------------------------------------------------------------

/** LOGO-XLSX-1: Microsoft Fluent Excel 365 Authentic */
export function FluentExcelLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`shrink-0 ${className}`}>
      {/* Back document grid */}
      <rect x="6" y="3" width="22" height="26" rx="2.5" fill="#107C41" />
      <rect x="15" y="8" width="10" height="3.5" rx="0.5" fill="#FFFFFF" opacity="0.35" />
      <rect x="15" y="14" width="10" height="3.5" rx="0.5" fill="#FFFFFF" opacity="0.35" />
      <rect x="15" y="20" width="10" height="3.5" rx="0.5" fill="#FFFFFF" opacity="0.35" />
      {/* Front 3D 'X' Tile */}
      <rect x="3" y="8" width="14" height="15" rx="2" fill="#185C37" />
      <path
        d="M6.5 11.5L9.5 15.5L6.5 19.5H8.2L10.3 16.6L12.4 19.5H14.1L11.1 15.5L14.1 11.5H12.4L10.3 14.4L8.2 11.5H6.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** LOGO-XLSX-2: VS Code Material Green Spreadsheet Grid */
export function MaterialSpreadsheetLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0E703C" />
      {/* Table grid rows and columns */}
      <rect x="5.5" y="5.5" width="13" height="3.5" rx="1" fill="#FFFFFF" fillOpacity="0.9" />
      <path
        d="M5.5 11.5H10.5V14H5.5V11.5ZM12 11.5H18.5V14H12V11.5ZM5.5 15.5H10.5V18.5H5.5V15.5ZM12 15.5H18.5V18.5H12V15.5Z"
        fill="#FFFFFF"
        fillOpacity="0.8"
      />
    </svg>
  );
}

/** LOGO-XLSX-3: Accounting Ledger Double-Line Grid */
export function AccountingLedgerLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path d="M4 3H20C20.6 3 21 3.4 21 4V20C21 20.6 20.6 21 20 21H4C3.4 21 3 20.6 3 20V4C3 3.4 3.4 3 4 3Z" fill="#166534" />
      <path d="M3 8H21" stroke="#4ADE80" strokeWidth="1.5" />
      <path d="M9 8V21" stroke="#4ADE80" strokeWidth="1.2" />
      <path d="M15 8V21" stroke="#4ADE80" strokeWidth="1.2" />
      <path d="M5 12H7M5 16H7M11 12H13M11 16H13M17 12H19M17 16H19" stroke="#DCFCE7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** LOGO-CSV-1: Teal Delimited Data Matrix */
export function CsvDelimitedLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0D9488" />
      <text x="6" y="16" fontFamily="system-ui, sans-serif" fontSize="8" fontWeight="800" fill="#FFFFFF" letterSpacing="0.5">
        CSV
      </text>
    </svg>
  );
}

/** LOGO-CSV-2: Dual-Tone Split Comma Grid */
export function CsvTableGridLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="2.5" fill="#14B8A6" fillOpacity="0.15" stroke="#14B8A6" strokeWidth="1.5" />
      <path d="M3 9H21M9 3V21M15 3V21" stroke="#14B8A6" strokeWidth="1.2" />
      <circle cx="6" cy="15" r="1.2" fill="#14B8A6" />
      <circle cx="12" cy="15" r="1.2" fill="#14B8A6" />
      <circle cx="18" cy="15" r="1.2" fill="#14B8A6" />
    </svg>
  );
}

// --------------------------------------------------------------------------
// 2. DOCUMENTS (PDF, Word, Markdown, Text)
// --------------------------------------------------------------------------

/** LOGO-PDF-1: Adobe Acrobat Official Crimson Wave */
export function AdobePdfLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#DC2626" />
      {/* Acrobat Ribbon Knot */}
      <path
        d="M18.2 14.8C17.6 14.1 16.3 13.9 14.5 14.2C13.8 13.7 13.1 12.8 12.6 11.6C12.9 10.4 13.1 9.2 12.8 8.4C12.6 7.6 11.9 7.2 11.4 7.4C10.7 7.7 10.6 8.7 10.8 9.9C11.0 10.9 11.4 12.1 12.0 13.2C11.3 14.7 10.5 16.0 9.8 16.8C8.9 17.5 8.1 17.8 7.6 17.7C7.2 17.6 7.0 17.2 7.1 16.8C7.3 16.1 8.3 15.6 9.4 15.4C9.5 15.4 9.6 15.4 9.7 15.4C9.2 16.1 8.8 16.6 8.4 16.9C8.3 16.9 8.2 17.0 8.1 17.0C8.1 16.9 8.1 16.7 8.3 16.4C8.7 15.8 9.8 15.3 11.0 14.7C12.3 14.1 13.8 13.7 15.1 13.6C16.1 13.5 17.0 13.7 17.5 14.1C18.0 14.5 18.0 14.7 18.2 14.8Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** LOGO-PDF-2: Modern Red Document with PDF Badge */
export function ModernPdfBadgeLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      {/* Folded Paper Outline */}
      <path d="M5 3H15L19 7V20C19 20.6 18.6 21 18 21H5C4.4 21 4 20.6 4 20V4C4 3.4 4.4 3 5 3Z" fill="#F87171" fillOpacity="0.15" stroke="#EF4444" strokeWidth="1.5" />
      <path d="M15 3V7H19" stroke="#EF4444" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Red PDF Pill Tag */}
      <rect x="6" y="11" width="12" height="6.5" rx="1.5" fill="#EF4444" />
      <text x="7" y="16" fontFamily="system-ui, sans-serif" fontSize="5.5" fontWeight="900" fill="#FFFFFF" letterSpacing="0.4">
        PDF
      </text>
    </svg>
  );
}

/** LOGO-WORD-1: Microsoft Fluent Word 365 Authentic */
export function FluentWordLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`shrink-0 ${className}`}>
      <rect x="6" y="3" width="22" height="26" rx="2.5" fill="#185ABD" />
      <rect x="15" y="8" width="10" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.4" />
      <rect x="15" y="13" width="10" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.4" />
      <rect x="15" y="18" width="7" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.4" />
      {/* Front 'W' Tile */}
      <rect x="3" y="8" width="14" height="15" rx="2" fill="#103F91" />
      <path
        d="M5.5 12L7.3 19H8.7L10 14.5L11.3 19H12.7L14.5 12H13L11.9 17L10.7 12.8H9.3L8.1 17L7 12H5.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** LOGO-MD-1: Official Markdown M↓ Octicon */
export function OfficialMarkdownLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="2" y="4" width="20" height="16" rx="3" fill="#0284C7" fillOpacity="0.15" stroke="#0284C7" strokeWidth="1.5" />
      <path
        d="M5 15V9H7L9 11.5L11 9H13V15H11.5V11.2L9.8 13.3H8.2L6.5 11.2V15H5ZM16.5 15L14 12H15.5V9H17.5V12H19L16.5 15Z"
        fill="#0284C7"
      />
    </svg>
  );
}

/** LOGO-PLAN-1: Executive Implementation & Audit Plan Checklist */
export function ImplementationPlanLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="4" y="4" width="16" height="17" rx="2.5" fill="#0284C7" fillOpacity="0.15" stroke="#0284C7" strokeWidth="1.5" />
      <rect x="8" y="2" width="8" height="4" rx="1.5" fill="#0284C7" />
      <path d="M7.5 9.5L9 11L12.5 7.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 9.5H16.5" stroke="#0284C7" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7.5 14L9 15.5L12.5 12" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 14H16.5" stroke="#0284C7" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="9" cy="18" r="1.2" fill="#0284C7" />
      <path d="M13 18H16.5" stroke="#0284C7" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** LOGO-WALK-1: Audit Walkthrough Route Compass / Steps */
export function AuditWalkthroughLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#8B5CF6" fillOpacity="0.15" stroke="#8B5CF6" strokeWidth="1.5" />
      <circle cx="7" cy="17" r="1.8" fill="#8B5CF6" />
      <path d="M7 15V11H12V7H17" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="7" r="2.2" fill="#8B5CF6" stroke="#EDE9FE" strokeWidth="1" />
    </svg>
  );
}

// --------------------------------------------------------------------------
// 3. CODE & DATA (Python, SQL, JSON)
// --------------------------------------------------------------------------

/** LOGO-PY-1: Official Python Dual-Snake (Blue & Gold) */
export function AuthenticPythonLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      {/* Blue Top Snake */}
      <path
        d="M11.91 2c-5.09 0-4.78 2.2-4.78 2.2l.01 2.28h4.87v.69H5.13S2 6.81 2 11.94c0 5.12 2.73 4.93 2.73 4.93h1.63v-2.31s-.09-2.73 2.68-2.73h4.63s2.58.04 2.58-2.54V4.54S16.66 2 11.91 2zm-2.6 1.48a.91.91 0 1 1 0 1.82.91.91 0 0 1 0-1.82z"
        fill="#3776AB"
      />
      {/* Gold Bottom Snake */}
      <path
        d="M12.09 22c5.09 0 4.78-2.2 4.78-2.2l-.01-2.28H11.99v-.69h6.88s3.13.36 3.13-4.77c0-5.12-2.73-4.93-2.73-4.93h-1.63v2.31s.09 2.73-2.68 2.73h-4.63s-2.58-.04-2.58 2.54v4.75S7.34 22 12.09 22zm2.6-1.48a.91.91 0 1 1 0-1.82.91.91 0 0 1 0-1.82z"
        fill="#FFD438"
      />
    </svg>
  );
}

/** LOGO-SQL-1: Dual Relational Cylinders with Query Spark */
export function SqlDatabaseLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      {/* Top Cylinder */}
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="#3B82F6" />
      <path d="M4 6V11C4 12.65 7.58 14 12 14C16.42 14 20 12.65 20 11V6" fill="#2563EB" />
      {/* Bottom Cylinder */}
      <path d="M4 12V17C4 18.65 7.58 20 12 20C16.42 20 20 18.65 20 17V12" fill="#1D4ED8" />
      {/* Query Spark Accent */}
      <path d="M17 11L14 16H18L15 21" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** LOGO-JSON-1: Gold Curly Braces Object */
export function JsonObjectLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#F59E0B" fillOpacity="0.15" stroke="#F59E0B" strokeWidth="1.5" />
      <text x="6" y="16.5" fontFamily="monospace" fontSize="13" fontWeight="900" fill="#F59E0B">
        &#123;&#125;
      </text>
    </svg>
  );
}

// --------------------------------------------------------------------------
// 4. SYSTEM & FOLDERS (Terminal, Folder, Image)
// --------------------------------------------------------------------------

/** LOGO-TERM-1: Dark Modern Console >_ */
export function ConsoleTerminalLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#18181B" stroke="#27272A" strokeWidth="1.5" />
      {/* Prompt > */}
      <path d="M6 8L10 12L6 16" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Underscore _ */}
      <path d="M12 16H17" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** LOGO-DIR-1: Warm Gold Enterprise Audit Binder */
export function EnterpriseFolderLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M3 6C3 4.9 3.9 4 5 4H9.5C10.3 4 11 4.5 11.4 5.2L12.6 7H19C20.1 7 21 7.9 21 9V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V6Z"
        fill="#F59E0B"
      />
      <path
        d="M3 9C3 7.9 3.9 7 5 7H19C20.1 7 21 7.9 21 9V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 18V9Z"
        fill="#D97706"
      />
    </svg>
  );
}

/** Executive Audit Workspaces & Engagement Hub Logo */
export function AuditWorkspacesLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      {/* Back Layer: Workspace Vault Plane (Isometric Depth) */}
      <rect 
        x="3" 
        y="3.5" 
        width="13" 
        height="13" 
        rx="2.5" 
        fill="currentColor" 
        fillOpacity="0.18" 
        stroke="currentColor" 
        strokeWidth="1.2" 
        strokeOpacity="0.4" 
      />
      {/* Front Layer: Active Engagement Desk */}
      <rect 
        x="8" 
        y="7.5" 
        width="13" 
        height="13" 
        rx="2.5" 
        fill="currentColor" 
        fillOpacity="0.08" 
        stroke="currentColor" 
        strokeWidth="1.5" 
      />
      {/* Workspace Division / Kanban Lanes */}
      <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Active Workpaper Stack Indicator */}
      <circle cx="16.5" cy="11.5" r="1.2" fill="currentColor" />
      <line x1="14.5" y1="15.5" x2="18.5" y2="15.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** LOGO-PPT-1: Microsoft Fluent PowerPoint 365 Authentic */
export function FluentPowerPointLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={`shrink-0 ${className}`}>
      <rect x="6" y="3" width="22" height="26" rx="2.5" fill="#D83B01" />
      <circle cx="19" cy="13" r="4.5" fill="#FFFFFF" opacity="0.35" />
      <path d="M19 8.5V13H23.5" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.5" />
      <rect x="15" y="21" width="10" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.35" />
      <rect x="3" y="8" width="14" height="15" rx="2" fill="#A4260C" />
      <path
        d="M6.5 12H10.5C11.6 12 12.5 12.8 12.5 13.9C12.5 15 11.6 15.8 10.5 15.8H8.5V19H6.5V12ZM8.5 14.2H10.2C10.6 14.2 11 13.9 11 13.6C11 13.3 10.6 13 10.2 13H8.5V14.2Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** LOGO-NOTEBOOK-1: Jupyter Data Science Notebook */
export function JupyterNotebookLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#F37626" fillOpacity="0.15" stroke="#F37626" strokeWidth="1.5" />
      <path d="M6.5 9.5C8 7.5 10.5 6.5 12 6.5C13.5 6.5 16 7.5 17.5 9.5" stroke="#F37626" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.5 14.5C8 16.5 10.5 17.5 12 17.5C13.5 17.5 16 16.5 17.5 14.5" stroke="#F37626" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7" cy="8" r="1.3" fill="#6B7280" />
      <circle cx="17" cy="16" r="1.3" fill="#6B7280" />
      <circle cx="12" cy="12" r="1.6" fill="#F37626" />
    </svg>
  );
}

/** LOGO-XML-1: XML & XBRL Regulatory Filing Tag */
export function XmlXbrlLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#EA580C" />
      <text x="4.2" y="15.8" fontFamily="system-ui, sans-serif" fontSize="7.5" fontWeight="900" fill="#FFFFFF" letterSpacing="0.4">
        XML
      </text>
    </svg>
  );
}

/** LOGO-YAML-1: YAML Pipeline Configuration */
export function YamlConfigLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#7C3AED" />
      <text x="3.8" y="15.8" fontFamily="system-ui, sans-serif" fontSize="7.2" fontWeight="900" fill="#FFFFFF" letterSpacing="0.3">
        YML
      </text>
    </svg>
  );
}

/** LOGO-ZIP-1: Forensic Evidence Zip Archive */
export function ZipArchiveLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" fill="#D97706" />
      <line x1="12" y1="3" x2="12" y2="15" stroke="#FFFFFF" strokeWidth="1.5" strokeDasharray="1.5 1.5" opacity="0.8" />
      <rect x="10.5" y="14" width="3" height="4.5" rx="1" fill="#FFFFFF" />
      <circle cx="12" cy="16.5" r="0.8" fill="#D97706" />
    </svg>
  );
}

/** LOGO-IMG-1: Auditor Sample & Voucher Photo Frame */
export function ImageEvidenceLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="4" width="18" height="16" rx="3" fill="#A855F7" fillOpacity="0.15" stroke="#A855F7" strokeWidth="1.5" />
      <circle cx="8" cy="9" r="1.8" fill="#A855F7" />
      <path d="M4.5 17L9 12L13 16L16 13L19.5 17H4.5Z" fill="#A855F7" fillOpacity="0.7" />
    </svg>
  );
}

/** LOGO-MEDIA-1: Statutory Audio/Video Recording Evidence */
export function MediaEvidenceLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="4" width="18" height="16" rx="3" fill="#EC4899" fillOpacity="0.15" stroke="#EC4899" strokeWidth="1.5" />
      <polygon points="10,8 16,12 10,16" fill="#EC4899" />
    </svg>
  );
}

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
