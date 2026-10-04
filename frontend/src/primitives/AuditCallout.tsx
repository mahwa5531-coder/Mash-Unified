"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export type AuditCalloutStatus =
  | 'EXCEPTION'
  | 'MATERIAL WEAKNESS'
  | 'FAIL'
  | 'HIGH RISK'
  | 'CAUTION'
  | 'SIGNIFICANT DEFICIENCY'
  | 'CONTROL DEFICIENCY'
  | 'WARNING'
  | 'MEDIUM RISK'
  | 'COMPLIANT'
  | 'PASS'
  | 'NO EXCEPTION'
  | 'LOW RISK'
  | 'NOTE'
  | 'TIP'
  | 'IMPORTANT'
  | 'DISCLOSURE'
  | 'OBSERVATION'
  | 'CARO 2020';

export type AuditCalloutVariant = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

export interface AuditCalloutProps extends React.ComponentPropsWithoutRef<'blockquote'> {
  /** Statutory audit status tag (e.g. 'NOTE', 'EXCEPTION', 'WARNING') */
  status?: AuditCalloutStatus | string;
  /** Explicit visual variant override */
  variant?: AuditCalloutVariant;
  /** Finding headline or clause title */
  title?: string;
  /** Statutory reference, standard citation, or workpaper cross-reference */
  cite?: string;
  /** Custom icon override (if explicitly needed) */
  icon?: React.ReactNode;
  /** Content of the audit observation */
  children: React.ReactNode;
  className?: string;
}

const STATUS_VARIANT_MAP: Record<string, AuditCalloutVariant> = {
  'EXCEPTION': 'danger',
  'MATERIAL WEAKNESS': 'danger',
  'FAIL': 'danger',
  'HIGH RISK': 'danger',
  'CAUTION': 'danger',
  'SIGNIFICANT DEFICIENCY': 'warning',
  'CONTROL DEFICIENCY': 'warning',
  'WARNING': 'warning',
  'MEDIUM RISK': 'warning',
  'COMPLIANT': 'success',
  'PASS': 'success',
  'NO EXCEPTION': 'success',
  'LOW RISK': 'success',
  'NOTE': 'info',
  'TIP': 'info',
  'IMPORTANT': 'info',
  'DISCLOSURE': 'neutral',
  'OBSERVATION': 'neutral',
  'CARO 2020': 'neutral',
};

const VARIANT_CONFIG: Record<AuditCalloutVariant, {
  border: string;
  titleColor: string;
  defaultLabel?: string;
}> = {
  danger: {
    border: 'border-l-red-500',
    titleColor: 'text-red-500 dark:text-red-400',
    defaultLabel: 'CAUTION',
  },
  warning: {
    border: 'border-l-amber-500',
    titleColor: 'text-amber-500 dark:text-amber-400',
    defaultLabel: 'WARNING',
  },
  success: {
    border: 'border-l-emerald-500',
    titleColor: 'text-emerald-500 dark:text-emerald-400',
    defaultLabel: 'COMPLIANT',
  },
  info: {
    border: 'border-l-blue-500',
    titleColor: 'text-blue-500 dark:text-blue-400',
    defaultLabel: 'NOTE',
  },
  neutral: {
    border: 'border-l-zinc-500',
    titleColor: 'text-zinc-500 dark:text-zinc-400',
    defaultLabel: 'OBSERVATION',
  },
};

/**
 * AuditCallout Primitive
 * 
 * Clean, distraction-free audit blockquote callout matching executive specs:
 * - Vivid colored left vertical border (3.5px)
 * - Pure pitch black / transparent background (no tinted box)
 * - Clean uppercase bold colored title text without badge/icon clutter
 * - Crisp body typography
 */
export function AuditCallout({
  status,
  variant: propVariant,
  title,
  cite,
  children,
  className,
  ...props
}: AuditCalloutProps) {
  const normalizedStatus = status?.toUpperCase().trim();
  const variant: AuditCalloutVariant =
    propVariant ||
    (normalizedStatus ? STATUS_VARIANT_MAP[normalizedStatus] || 'info' : 'neutral');

  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info;
  const label = status || title;

  return (
    <blockquote
      className={cn(
        "my-4 pl-4 py-1 border-l-[3.5px] bg-transparent select-text font-sans text-[13.5px] leading-relaxed",
        config.border,
        className
      )}
      {...props}
    >
      {label && (
        <div className={cn("text-[13px] font-bold tracking-wide uppercase mb-1 select-none", config.titleColor)}>
          {label}
        </div>
      )}

      <div className="text-zinc-800 dark:text-zinc-200 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1 leading-[1.68]">
        {children}
      </div>

      {cite && (
        <footer className="mt-2 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 not-italic select-text">
          — § {cite}
        </footer>
      )}
    </blockquote>
  );
}

export default AuditCallout;
