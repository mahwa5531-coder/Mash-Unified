"use client";

import React from 'react';
import { cn } from '@/lib/utils';
import { AuditBadge } from './AuditBadge';

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
  /** Statutory audit status tag (e.g. 'EXCEPTION', 'MATERIAL WEAKNESS', 'COMPLIANT') */
  status?: AuditCalloutStatus | string;
  /** Explicit visual variant override */
  variant?: AuditCalloutVariant;
  /** Finding headline or statutory clause title */
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
  'NOTE': 'neutral',
  'DISCLOSURE': 'neutral',
  'OBSERVATION': 'neutral',
  'CARO 2020': 'neutral',
};

// Non-Alarmist border accents: only the side line color changes subtly
const SIDE_BORDER_MAP: Record<AuditCalloutVariant, string> = {
  danger: 'border-l-rose-500/70 dark:border-l-rose-500/60',
  warning: 'border-l-amber-500/70 dark:border-l-amber-500/60',
  success: 'border-l-emerald-500/70 dark:border-l-emerald-500/60',
  info: 'border-l-zinc-400 dark:border-l-zinc-600',
  neutral: 'border-l-zinc-300 dark:border-l-zinc-700',
};

/**
 * AuditCallout Primitive
 * 
 * Minimalist, non-alarmist blockquote for audit observations.
 * Uses a visible calm gray/black background with only the side border line colored.
 * Presents only the pure audit data without bright clashing containers or flashy boxes.
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
    (normalizedStatus ? STATUS_VARIANT_MAP[normalizedStatus] || 'neutral' : 'neutral');

  const sideBorder = SIDE_BORDER_MAP[variant];

  return (
    <blockquote
      className={cn(
        "my-3 pl-3.5 pr-3 py-2.5 rounded-r-lg border-l-2 select-text font-sans text-[13.5px] leading-relaxed transition-colors",
        "bg-zinc-100/70 dark:bg-[#141416] text-zinc-800 dark:text-zinc-200 border-r border-t border-b border-zinc-200/50 dark:border-white/[0.04]",
        sideBorder,
        className
      )}
      {...props}
    >
      {(status || title) && (
        <div className="flex items-center gap-2 mb-1.5 font-medium flex-wrap">
          {status && (
            <AuditBadge status={status} />
          )}
          {title && (
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 text-[13px]">
              {title}
            </span>
          )}
          {cite && (
            <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 ml-auto">
              § {cite}
            </span>
          )}
        </div>
      )}

      <div className="text-zinc-700 dark:text-zinc-300 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1">
        {children}
      </div>

      {cite && !title && (
        <footer className="mt-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 not-italic select-text">
          — § {cite}
        </footer>
      )}
    </blockquote>
  );
}

export default AuditCallout;
