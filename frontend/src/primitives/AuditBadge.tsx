"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export type AuditSemanticVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type AuditStandardStatus =
  | 'COMPLIANT'
  | 'PASS'
  | 'NO EXCEPTION'
  | 'NO EXCEPTION NOTED'
  | 'EXCEPTION'
  | 'MATERIAL WEAKNESS'
  | 'FAIL'
  | 'SIGNIFICANT DEFICIENCY'
  | 'CONTROL DEFICIENCY'
  | 'HIGH RISK'
  | 'MEDIUM RISK'
  | 'LOW RISK'
  | 'NOTE'
  | 'WARNING'
  | 'CAUTION';

export interface AuditBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: AuditStandardStatus | string;
  variant?: AuditSemanticVariant;
}

const STATUS_VARIANT_MAP: Record<string, AuditSemanticVariant> = {
  COMPLIANT: 'success',
  PASS: 'success',
  'NO EXCEPTION': 'success',
  'NO EXCEPTION NOTED': 'success',
  EXCEPTION: 'danger',
  'MATERIAL WEAKNESS': 'danger',
  FAIL: 'danger',
  'SIGNIFICANT DEFICIENCY': 'warning',
  'HIGH RISK': 'warning',
  WARNING: 'warning',
  CAUTION: 'warning',
  'CONTROL DEFICIENCY': 'warning',
  'MEDIUM RISK': 'neutral',
  'LOW RISK': 'neutral',
  NOTE: 'neutral',
};

// Non-Alarmist Palette: calm, desaturated light shades that smoothly work on dark/light backgrounds without color clash
const VARIANT_STYLES: Record<AuditSemanticVariant, string> = {
  danger: 'bg-rose-500/[0.08] dark:bg-rose-500/[0.12] text-rose-700 dark:text-rose-400 border-rose-500/20 dark:border-rose-500/30',
  warning: 'bg-amber-500/[0.08] dark:bg-amber-500/[0.12] text-amber-800 dark:text-amber-400 border-amber-500/20 dark:border-amber-500/30',
  success: 'bg-emerald-500/[0.08] dark:bg-emerald-500/[0.12] text-emerald-800 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30',
  info: 'bg-zinc-100 dark:bg-white/[0.05] text-zinc-700 dark:text-zinc-300 border-zinc-200/80 dark:border-white/[0.08]',
  neutral: 'bg-zinc-100 dark:bg-white/[0.05] text-zinc-700 dark:text-zinc-300 border-zinc-200/80 dark:border-white/[0.08]',
};

/**
 * AuditBadge Primitive
 * 
 * Non-alarmist statutory audit status badges.
 * Uses calm, light shades that blend cleanly with the background without visual clash or neon glare.
 */
export function AuditBadge({
  status,
  variant,
  children,
  className,
  ...props
}: AuditBadgeProps) {
  const label = children || status;
  const resolvedVariant = variant || (status ? STATUS_VARIANT_MAP[status.toString().toUpperCase()] : 'neutral') || 'neutral';

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[4px] font-mono text-[10.5px] font-medium tracking-tight border select-none align-baseline leading-none shadow-2xs",
        VARIANT_STYLES[resolvedVariant],
        className
      )}
      {...props}
    >
      {label}
    </span>
  );
}

export default AuditBadge;
