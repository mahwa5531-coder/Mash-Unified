"use client";

import React from 'react';

/** LOGO-PY-1: Official Python Dual-Snake (Blue & Gold) */
export function AuthenticPythonLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M11.91 2c-5.09 0-4.78 2.2-4.78 2.2l.01 2.28h4.87v.69H5.13S2 6.81 2 11.94c0 5.12 2.73 4.93 2.73 4.93h1.63v-2.31s-.09-2.73 2.68-2.73h4.63s2.58.04 2.58-2.54V4.54S16.66 2 11.91 2zm-2.6 1.48a.91.91 0 1 1 0 1.82.91.91 0 0 1 0-1.82z"
        fill="#3776AB"
      />
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
      <ellipse cx="12" cy="6" rx="8" ry="3" fill="#3B82F6" />
      <path d="M4 6V11C4 12.65 7.58 14 12 14C16.42 14 20 12.65 20 11V6" fill="#2563EB" />
      <path d="M4 12V17C4 18.65 7.58 20 12 20C16.42 20 20 18.65 20 17V12" fill="#1D4ED8" />
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
