"use client";

import React from 'react';

/** LOGO-TERM-1: Dark Modern Console >_ */
export function ConsoleTerminalLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="2" y="3" width="20" height="18" rx="3" fill="#18181B" stroke="#27272A" strokeWidth="1.5" />
      <path d="M6 8L10 12L6 16" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
      <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="16.5" cy="11.5" r="1.2" fill="currentColor" />
      <line x1="14.5" y1="15.5" x2="18.5" y2="15.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
