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

// Non-Alarmist Palette: crisp terminal indicators without bulky pill bubbles
const VARIANT_STYLES: Record<AuditSemanticVariant, { text: string; dot: string }> = {
  danger: {
    text: 'text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-500',
  },
  warning: {
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  success: {
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  info: {
    text: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  neutral: {
    text: 'text-zinc-600 dark:text-zinc-400',
    dot: 'bg-zinc-400',
  },
};

/**
 * AuditBadge Primitive
 * 
 * Non-alarmist statutory audit status indicator.
 * Renders as a crisp terminal marker (dot + uppercase monospace text)
 * without toy-like pill bubbles or bulky backgrounds.
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
  const style = VARIANT_STYLES[resolvedVariant] || VARIANT_STYLES.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-tight select-none align-baseline leading-none mx-0.5",
        style.text,
        className
      )}
      {...props}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", style.dot)} />
      <span>{label}</span>
    </span>
  );
}

export default AuditBadge;
