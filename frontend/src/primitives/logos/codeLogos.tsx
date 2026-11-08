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

/** TypeScript Official Blue Square with TS */
export function TypeScriptLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#3178C6" />
      <text x="4.8" y="16.2" fontFamily="system-ui, sans-serif" fontSize="10" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.3">
        TS
      </text>
    </svg>
  );
}

/** JavaScript Official Gold Square with JS */
export function JavaScriptLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#F7DF1E" />
      <text x="5.2" y="16.2" fontFamily="system-ui, sans-serif" fontSize="10" fontWeight="900" fill="#000000" letterSpacing="-0.3">
        JS
      </text>
    </svg>
  );
}

/** React Atom Official Cyan Orbit Logo */
export function ReactLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
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

/** Rust Official Gear Emblem */
export function RustLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="#DEA584" strokeWidth="1.8" strokeDasharray="2.5 1.5" />
      <circle cx="12" cy="12" r="6.5" fill="#DEA584" fillOpacity="0.15" stroke="#DEA584" strokeWidth="1.2" />
      <text x="8.5" y="15.8" fontFamily="system-ui, sans-serif" fontSize="11" fontWeight="900" fill="#DEA584">
        R
      </text>
    </svg>
  );
}

/** Go Official Cyan Badge */
export function GoLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#00ADD8" />
      <text x="4.5" y="16.2" fontFamily="system-ui, sans-serif" fontSize="9.5" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.2">
        GO
      </text>
    </svg>
  );
}

/** C Language Blue Hexagon */
export function CLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" fill="#00599C" />
      <text x="8.5" y="16" fontFamily="system-ui, sans-serif" fontSize="11" fontWeight="900" fill="#FFFFFF">
        C
      </text>
    </svg>
  );
}

/** C++ Language Blue Hexagon */
export function CppLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" fill="#00599C" />
      <text x="5" y="15.5" fontFamily="system-ui, sans-serif" fontSize="8" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.5">
        C++
      </text>
    </svg>
  );
}

/** C# Language Purple Hexagon */
export function CSharpLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,2 21,7.2 21,16.8 12,22 3,16.8 3,7.2" fill="#68217A" />
      <text x="6" y="15.8" fontFamily="system-ui, sans-serif" fontSize="9" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.5">
        C#
      </text>
    </svg>
  );
}

/** Java Official Coffee Cup */
export function JavaLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#ED8B00" fillOpacity="0.18" stroke="#ED8B00" strokeWidth="1.5" />
      <path d="M6 10H16V15C16 17 14 18 11 18C8 18 6 17 6 15V10Z" fill="#ED8B00" />
      <path d="M16 11H18C19 11 19.5 11.5 19.5 12.5C19.5 13.5 19 14 18 14H16" stroke="#ED8B00" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 7C9.5 6 10.5 6 10 5" stroke="#EA580C" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M12 7C12.5 6 13.5 6 13 5" stroke="#EA580C" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** Kotlin Official Badge */
export function KotlinLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#7F52FF" />
      <polygon points="4,20 20,4 12,4 4,12" fill="#C711E1" opacity="0.8" />
      <polygon points="4,4 12,4 4,12" fill="#7F52FF" />
      <polygon points="4,20 20,20 12,12" fill="#E24462" opacity="0.9" />
    </svg>
  );
}

/** Swift Official Bird */
export function SwiftLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#F05138" />
      <path
        d="M18.5 7.5C16 10 14 12 11.5 12.5C13 11 14.5 9 15.5 7C13 8 11.5 9.5 9.5 11.5C8 13 7.5 14.5 7 17C9 16.5 11.5 15.5 13.5 14C11.5 15.5 8.5 17.5 6.5 17.5C9 19 13.5 18.5 16.5 15.5C18.5 13.5 19 10.5 18.5 7.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/** Ruby Official Gem */
export function RubyLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="7,4 17,4 21,9 12,20 3,9" fill="#CC342D" />
      <polygon points="7,4 12,20 17,4" fill="#E53935" fillOpacity="0.4" />
      <polygon points="3,9 21,9 12,20" fill="#991B1B" fillOpacity="0.3" />
    </svg>
  );
}

/** PHP Official Oval Logo */
export function PhpLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.5" fill="#777BB4" />
      <text x="5.2" y="14.5" fontFamily="system-ui, sans-serif" fontSize="7.5" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.2">
        php
      </text>
    </svg>
  );
}

/** Vue.js Official Logo */
export function VueLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,19.5 2,4.5 6.5,4.5 12,14 17.5,4.5 22,4.5" fill="#42B883" />
      <polygon points="12,14 6.5,4.5 9.5,4.5 12,9 14.5,4.5 17.5,4.5" fill="#35495E" />
    </svg>
  );
}

/** Svelte Official Flame Logo */
export function SvelteLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#FF3E00" />
      <path
        d="M16.5 7.5C15.5 6.5 14 6 12 6C9.5 6 8 7.5 8 9.5C8 12.5 16 11.5 16 14.5C16 16.5 14.5 18 12 18C10 18 8.5 17.5 7.5 16.5"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Astro Official Logo */
export function AstroLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#18181B" stroke="#BC52EE" strokeWidth="1.5" />
      <path d="M12 6L6.5 17H9.5L10.8 14H13.2L14.5 17H17.5L12 6ZM11.4 12L12 10.2L12.6 12H11.4Z" fill="#FFFFFF" />
      <circle cx="12" cy="18" r="1.5" fill="#FF5D01" />
    </svg>
  );
}

/** HTML5 Official Shield */
export function HtmlLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="4,3 6,19 12,21 18,19 20,3" fill="#E34F26" />
      <polygon points="12,5 12,19.2 16.5,17.7 18.2,5" fill="#EF652A" />
      <text x="6.8" y="15" fontFamily="system-ui, sans-serif" fontSize="7.5" fontWeight="900" fill="#FFFFFF">
        &lt;&gt;
      </text>
    </svg>
  );
}

/** CSS3 Official Shield */
export function CssLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="4,3 6,19 12,21 18,19 20,3" fill="#1572B6" />
      <polygon points="12,5 12,19.2 16.5,17.7 18.2,5" fill="#33A9DC" />
      <text x="5.8" y="15" fontFamily="system-ui, sans-serif" fontSize="8" fontWeight="900" fill="#FFFFFF">
        #
      </text>
    </svg>
  );
}

/** Sass/SCSS Official Badge */
export function SassLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#CF649A" />
      <text x="4" y="15.5" fontFamily="system-ui, sans-serif" fontSize="6.8" fontWeight="900" fill="#FFFFFF" letterSpacing="-0.2">
        SCSS
      </text>
    </svg>
  );
}

/** Tailwind CSS Dual Crest */
export function TailwindLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0B1120" stroke="#38BDF8" strokeWidth="1.2" />
      <path
        d="M7.5 12.5C7.5 10.5 9 9.5 11 9.5C13.5 9.5 14 11 15 11C15.8 11 16.5 10.5 16.5 9.5M10.5 15.5C10.5 13.5 12 12.5 14 12.5C16.5 12.5 17 14 18 14C18.8 14 19.5 13.5 19.5 12.5"
        stroke="#38BDF8"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** GraphQL Official Hexagon */
export function GraphqlLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,2.5 20.2,7.2 20.2,16.8 12,21.5 3.8,16.8 3.8,7.2" stroke="#E10098" strokeWidth="1.5" />
      <polygon points="12,5 18,16 6,16" stroke="#E10098" strokeWidth="1.2" />
      <circle cx="12" cy="2.5" r="1.5" fill="#E10098" />
      <circle cx="20.2" cy="7.2" r="1.5" fill="#E10098" />
      <circle cx="20.2" cy="16.8" r="1.5" fill="#E10098" />
      <circle cx="12" cy="21.5" r="1.5" fill="#E10098" />
      <circle cx="3.8" cy="16.8" r="1.5" fill="#E10098" />
      <circle cx="3.8" cy="7.2" r="1.5" fill="#E10098" />
    </svg>
  );
}

/** Prisma Official Logo */
export function PrismaLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <polygon points="12,3 21,19 3,19" fill="#2D3748" stroke="#5A67D8" strokeWidth="1.5" />
      <polygon points="12,3 15,19 9,19" fill="#5A67D8" fillOpacity="0.6" />
    </svg>
  );
}

/** Protocol Buffers Logo */
export function ProtobufLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#4285F4" />
      <text x="3.8" y="15.5" fontFamily="system-ui, sans-serif" fontSize="6.5" fontWeight="900" fill="#FFFFFF">
        PROTO
      </text>
    </svg>
  );
}

/** Dart Official Badge */
export function DartLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0175C2" />
      <polygon points="12,6 18,12 12,18 6,12" fill="#00B4AB" />
      <polygon points="12,6 18,12 12,12" fill="#FFFFFF" fillOpacity="0.7" />
    </svg>
  );
}

/** Lua Official Planet Logo */
export function LuaLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <circle cx="12" cy="12" r="8" fill="#000080" />
      <circle cx="15.5" cy="8.5" r="3" fill="#FFFFFF" />
      <circle cx="18" cy="6" r="1.5" fill="#000080" />
    </svg>
  );
}

/** Zig Official Orange Badge */
export function ZigLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#F7A41D" />
      <text x="7.5" y="16.5" fontFamily="system-ui, sans-serif" fontSize="12" fontWeight="900" fill="#000000">
        Z
      </text>
    </svg>
  );
}

/** Elixir Official Drop Logo */
export function ElixirLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <path
        d="M12 3C12 3 6 10.5 6 15C6 18.3 8.7 21 12 21C15.3 21 18 18.3 18 15C18 10.5 12 3 12 3Z"
        fill="#4E2A8E"
      />
      <circle cx="10" cy="14" r="1.5" fill="#A855F7" fillOpacity="0.8" />
    </svg>
  );
}

/** Scala Official Red Stairs */
export function ScalaLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <ellipse cx="12" cy="6" rx="8" ry="2.5" fill="#DC322F" />
      <ellipse cx="12" cy="11.5" rx="8" ry="2.5" fill="#DC322F" />
      <ellipse cx="12" cy="17" rx="8" ry="2.5" fill="#DC322F" />
    </svg>
  );
}

/** Haskell Official Lambda */
export function HaskellLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`shrink-0 ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#5E5086" fillOpacity="0.18" stroke="#5E5086" strokeWidth="1.5" />
      <path d="M5 5L9 12L5 19H7.5L10.2 14.3L13 19H15.5L10.2 9.7L12.5 5H10L8 8.8L6.8 5H5Z" fill="#5E5086" />
      <path d="M14 10L12.8 12.2L16.5 12.2V10H14ZM12 13.8L11 15.5H16.5V13.8H12Z" fill="#8F4E8B" />
    </svg>
  );
}
