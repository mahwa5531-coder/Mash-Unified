"use client";

import React from 'react';

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
