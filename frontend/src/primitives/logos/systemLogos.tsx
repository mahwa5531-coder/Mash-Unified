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

/** Docker Official Whale & Containers Logo */
export function DockerLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      {/* Containers */}
      <rect x="5" y="8" width="2.2" height="2" rx="0.3" fill="#2496ED" />
      <rect x="8" y="8" width="2.2" height="2" rx="0.3" fill="#2496ED" />
      <rect x="11" y="8" width="2.2" height="2" rx="0.3" fill="#2496ED" />
      <rect x="8" y="5.5" width="2.2" height="2" rx="0.3" fill="#2496ED" />
      <rect x="11" y="5.5" width="2.2" height="2" rx="0.3" fill="#2496ED" />
      {/* Whale body */}
      <path
        d="M2 13C2.5 11.5 4 11.5 5 11.5H16C18 11.5 20.5 12.5 22 14.5C21 15.5 19 16 18 16C17 18.5 14 20 10 20C5.5 20 2.5 17 2 13Z"
        fill="#2496ED"
      />
      <circle cx="17.5" cy="14" r="0.8" fill="#FFFFFF" />
    </svg>
  );
}

/** Git Official Branch Diamond Logo */
export function GitLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="4" transform="rotate(45 12 12)" fill="#F05032" />
      {/* Git commit nodes & branch lines */}
      <circle cx="8" cy="12" r="1.8" fill="#FFFFFF" />
      <circle cx="16" cy="8" r="1.8" fill="#FFFFFF" />
      <circle cx="16" cy="16" r="1.8" fill="#FFFFFF" />
      <path d="M8 12H13C14 12 15 11 16 8M13 12V16H16" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Environment & Secret Config (.env) Logo */
export function EnvConfigLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#E5C07B" fillOpacity="0.18" stroke="#E5C07B" strokeWidth="1.5" />
      <circle cx="10" cy="11" r="3" stroke="#E5C07B" strokeWidth="1.8" />
      <path d="M12.5 13L17 17.5M15 15.5L16.5 14" stroke="#E5C07B" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** General Config & Settings (.toml, .ini, .conf) Logo */
export function ConfigSettingsLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#71717A" fillOpacity="0.18" stroke="#71717A" strokeWidth="1.5" />
      <line x1="6" y1="8" x2="18" y2="8" stroke="#A1A1AA" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="8" r="1.8" fill="#F59E0B" />
      <line x1="6" y1="16" x2="18" y2="16" stroke="#A1A1AA" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14" cy="16" r="1.8" fill="#3B82F6" />
    </svg>
  );
}

/** Kubernetes Official Ship Wheel Logo */
export function KubernetesLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" fill="#326CE5" />
      <circle cx="12" cy="12" r="3.5" fill="#FFFFFF" />
      <circle cx="12" cy="12" r="1.8" fill="#326CE5" />
    </svg>
  );
}

/** Terraform Official Logo */
export function TerraformLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="4,3 9.5,6.5 9.5,13 4,9.5" fill="#844FBA" />
      <polygon points="10.5,6.5 16,10 16,16.5 10.5,13" fill="#844FBA" />
      <polygon points="10.5,13.8 16,17.3 16,23.8 10.5,20.3" fill="#844FBA" />
      <polygon points="17,10 22.5,13.5 22.5,20 17,16.5" fill="#5C4EE5" />
    </svg>
  );
}

/** Makefile & Build Tool Logo */
export function MakefileLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#4B5563" />
      <text x="6" y="16.5" fontFamily="system-ui, sans-serif" fontSize="11" fontWeight="900" fill="#FFFFFF">
        M
      </text>
    </svg>
  );
}
