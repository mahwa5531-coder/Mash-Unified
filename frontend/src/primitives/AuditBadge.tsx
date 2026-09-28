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
  'CONTROL DEFICIENCY': 'info',
  'MEDIUM RISK': 'neutral',
  'LOW RISK': 'neutral',
  NOTE: 'neutral',
};

const VARIANT_STYLES: Record<AuditSemanticVariant, string> = {
  success: 'bg-[var(--m-success-soft)] text-[var(--m-success)] border-[var(--m-success)]/25',
  warning: 'bg-[var(--m-warning-soft)] text-[var(--m-warning)] border-[var(--m-warning)]/25',
  danger: 'bg-[var(--m-danger-soft)] text-[var(--m-danger)] border-[var(--m-danger)]/25',
  info: 'bg-[var(--m-info-soft)] text-[var(--m-info)] border-[var(--m-info)]/25',
  neutral: 'bg-[var(--m-bg-surface-hover)] text-[var(--m-text-secondary)] border-[var(--m-border)]',
};

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
        "inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[var(--m-radius-xs)] font-mono text-[10.5px] font-medium tracking-tight border select-none align-baseline leading-none shadow-2xs",
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
