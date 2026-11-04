"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export type AuditSemanticVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type AuditStandardStatus =
  | 'COMPLIANT'
  | 'PASS'
  | 'NO EXCEPTION'
  | 'NO EXCEPTION NOTED'
  | 'VERIFIED'
  | 'RECONCILED'
  | 'APPROVED'
  | 'DONE'
  | 'EXCEPTION'
  | 'MATERIAL WEAKNESS'
  | 'FAIL'
  | 'UNVERIFIED'
  | 'REJECTED'
  | 'QUALIFIED'
  | 'SIGNIFICANT DEFICIENCY'
  | 'CONTROL DEFICIENCY'
  | 'HIGH RISK'
  | 'MEDIUM RISK'
  | 'LOW RISK'
  | 'NEEDS REVIEW'
  | 'PENDING'
  | 'NOTE'
  | 'WARNING'
  | 'CAUTION'
  | 'UNCHANGED'
  | 'IN PROGRESS'
  | 'RUNNING';

export interface AuditBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: AuditStandardStatus | string;
  variant?: AuditSemanticVariant;
}

const STATUS_VARIANT_MAP: Record<string, AuditSemanticVariant> = {
  COMPLIANT: 'success',
  PASS: 'success',
  'NO EXCEPTION': 'success',
  'NO EXCEPTION NOTED': 'success',
  VERIFIED: 'success',
  RECONCILED: 'success',
  APPROVED: 'success',
  DONE: 'success',

  EXCEPTION: 'danger',
  'MATERIAL WEAKNESS': 'danger',
  FAIL: 'danger',
  UNVERIFIED: 'danger',
  REJECTED: 'danger',
  QUALIFIED: 'danger',

  'SIGNIFICANT DEFICIENCY': 'warning',
  'CONTROL DEFICIENCY': 'warning',
  'HIGH RISK': 'warning',
  WARNING: 'warning',
  CAUTION: 'warning',
  'NEEDS REVIEW': 'warning',
  PENDING: 'warning',

  'MEDIUM RISK': 'neutral',
  'LOW RISK': 'neutral',
  NOTE: 'neutral',
  UNCHANGED: 'neutral',

  'IN PROGRESS': 'info',
  RUNNING: 'info',
  INFO: 'info',
};

// Option 3: Full Soft Capsule Pill (Stripe / GitHub Style)
const VARIANT_STYLES: Record<AuditSemanticVariant, { pill: string; dot: string }> = {
  success: {
    pill: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 dark:border-emerald-500/35',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  warning: {
    pill: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 dark:border-amber-500/35',
    dot: 'bg-amber-500 dark:bg-amber-400',
  },
  danger: {
    pill: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 dark:border-rose-500/35',
    dot: 'bg-rose-500 dark:bg-rose-400',
  },
  info: {
    pill: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30 dark:border-sky-500/35',
    dot: 'bg-sky-500 dark:bg-sky-400',
  },
  neutral: {
    pill: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 border-zinc-500/30 dark:border-zinc-500/35',
    dot: 'bg-zinc-400 dark:bg-zinc-400',
  },
};

/**
 * Resolves the semantic variant for standard statuses or dynamic custom audit strings.
 */
function resolveVariant(status?: string, variantOverride?: AuditSemanticVariant): AuditSemanticVariant {
  if (variantOverride) return variantOverride;
  if (!status) return 'neutral';
  
  const upper = status.toString().toUpperCase().trim();
  if (STATUS_VARIANT_MAP[upper]) return STATUS_VARIANT_MAP[upper];

  // Dynamic semantic fallback: check negative/danger first so UNVERIFIED / NON-COMPLIANT do not match positive tokens
  if (/(?:FAIL|EXCEPT|WEAK|DEFIC|DANGER|REJECT|ADVERSE|ERROR|UNVERIF|NON-COMPLI|NOT VERIF)/.test(upper)) return 'danger';
  if (/(?:PASS|COMPLI|VERIF|APPROV|RECONCIL|DONE|CLEAN)/.test(upper)) return 'success';
  if (/(?:WARN|RISK|CAUTION|REVIEW|PENDING|QUALIF|AMBIG)/.test(upper)) return 'warning';
  if (/(?:INFO|RUNNING|PROGRESS|CARO|DISCLOS)/.test(upper)) return 'info';

  return 'neutral';
}

/**
 * AuditBadge Primitive (Option 3: Full Soft Capsule Pill)
 * 
 * Styled as an institutional, tactile soft pill capsule with a 6px status indicator
 * dot, translucent background tint, and crisp 1px hairline border.
 */
export function AuditBadge({
  status,
  variant,
  children,
  className,
  ...props
}: AuditBadgeProps) {
  const label = children || status;
  const resolvedVariant = resolveVariant(status ? String(status) : undefined, variant);
  const style = VARIANT_STYLES[resolvedVariant] || VARIANT_STYLES.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-[21px] px-2.5 rounded-full font-sans text-[11px] font-semibold tracking-tight border select-none align-baseline leading-none mx-0.5 shadow-2xs transition-colors",
        style.pill,
        className
      )}
      {...props}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", style.dot)} />
      <span className="truncate">{label}</span>
    </span>
  );
}

export default AuditBadge;
