"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export type AuditCalloutStatus =
  | 'EXCEPTION'
  | 'MATERIAL WEAKNESS'
  | 'FAIL'
  | 'HIGH RISK'
  | 'SIGNIFICANT DEFICIENCY'
  | 'CONTROL DEFICIENCY'
  | 'WARNING'
  | 'MEDIUM RISK'
  | 'COMPLIANT'
  | 'PASS'
  | 'NO EXCEPTION'
  | 'LOW RISK'
  | 'NOTE'
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
  /** Custom icon override */
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

const VARIANT_CONFIG: Record<AuditCalloutVariant, { border: string; labelColor: string; defaultLabel?: string }> = {
  danger: {
    border: 'border-l-rose-500',
    labelColor: 'text-rose-500 dark:text-rose-400',
    defaultLabel: 'EXCEPTION',
  },
  warning: {
    border: 'border-l-amber-500',
    labelColor: 'text-amber-500 dark:text-amber-400',
    defaultLabel: 'WARNING',
  },
  success: {
    border: 'border-l-emerald-500',
    labelColor: 'text-emerald-500 dark:text-emerald-400',
    defaultLabel: 'COMPLIANT',
  },
  info: {
    border: 'border-l-blue-600',
    labelColor: 'text-blue-500 dark:text-blue-400',
    defaultLabel: 'NOTE',
  },
  neutral: {
    border: 'border-l-zinc-500',
    labelColor: 'text-zinc-400 dark:text-zinc-400',
    defaultLabel: 'OBSERVATION',
  },
};

/**
 * AuditCallout Primitive
 * 
 * Faithful implementation matching the clean Antigravity/Mash reference blockquote:
 * - Solid 3px colored accent bar on the left
 * - Transparent background (no box, no clashing borders)
 * - Uppercase bold colored label on top (e.g. NOTE, WARNING, EXCEPTION)
 * - Clean, high-legibility body prose directly below
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
    (normalizedStatus ? STATUS_VARIANT_MAP[normalizedStatus] || 'info' : 'info');

  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info;
  const label = status || title || (propVariant ? config.defaultLabel : undefined);

  return (
    <blockquote
      className={cn(
        "my-3 pl-3.5 py-0.5 border-l-[3px] select-text font-sans text-[13.5px] leading-relaxed bg-transparent",
        config.border,
        className
      )}
      {...props}
    >
      {label && (
        <div className={cn("font-semibold text-xs tracking-wider uppercase mb-1 select-none", config.labelColor)}>
          {label}
        </div>
      )}

      <div className="text-zinc-800 dark:text-zinc-300 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1">
        {children}
      </div>

      {cite && (
        <footer className="mt-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 not-italic select-text">
          — § {cite}
        </footer>
      )}
    </blockquote>
  );
}

export default AuditCallout;
