"use client";

import React from 'react';

/** LOGO-PDF-1: Adobe Acrobat Official Crimson Wave */
export function AdobePdfLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#DC2626" />
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
      <path d="M5 3H15L19 7V20C19 20.6 18.6 21 18 21H5C4.4 21 4 20.6 4 20V4C4 3.4 4.4 3 5 3Z" fill="#F87171" fillOpacity="0.15" stroke="#EF4444" strokeWidth="1.5" />
      <path d="M15 3V7H19" stroke="#EF4444" strokeWidth="1.5" strokeLinejoin="round" />
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
      <rect x="3" y="8" width="14" height="15" rx="2" fill="#103F91" />
      <path
        d="M5.5 12L7.3 19H8.7L10 14.5L11.3 19H12.7L14.5 12H13L11.9 17L10.7 12.8H9.3L8.1 17L7 12H5.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** LOGO-MD-1: Slate Markdown Note Sheet (Notion / Executive Document Style) */
export function OfficialMarkdownLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="2.5" width="18" height="19" rx="3" fill="#64748B" fillOpacity="0.14" stroke="#64748B" strokeWidth="1.5" />
      <path d="M7 7.5H17" stroke="#64748B" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M7 11.5H15" stroke="#64748B" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
      <path d="M7 15.5H11.5" stroke="#64748B" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
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
