"use client";

import React from 'react';
import { 
  Info, 
  AlertTriangle, 
  AlertOctagon, 
  CheckCircle2, 
  Lightbulb, 
  HelpCircle, 
  ListTodo, 
  Bug 
} from 'lucide-react';
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
  | 'INFO'
  | 'QUESTION'
  | 'TODO'
  | 'SUCCESS'
  | 'ERROR'
  | 'DANGER'
  | 'BUG'
  | 'EXAMPLE'
  | 'HINT'
  | 'ABSTRACT'
  | 'SUMMARY'
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

export const STATUS_VARIANT_MAP: Record<string, AuditCalloutVariant> = {
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
  'INFO': 'info',
  'QUESTION': 'neutral',
  'TODO': 'warning',
  'SUCCESS': 'success',
  'ERROR': 'danger',
  'DANGER': 'danger',
  'BUG': 'danger',
  'EXAMPLE': 'neutral',
  'HINT': 'info',
  'ABSTRACT': 'info',
  'SUMMARY': 'info',
  'DISCLOSURE': 'neutral',
  'OBSERVATION': 'neutral',
  'CARO 2020': 'neutral',
  'RED': 'danger',
  'AMBER': 'warning',
  'YELLOW': 'warning',
  'GREEN': 'success',
  'BLUE': 'info',
};

export const VARIANT_CONFIG: Record<AuditCalloutVariant, {
  border: string;
  bg: string;
  titleColor: string;
  defaultLabel?: string;
}> = {
  danger: {
    border: 'border-l-red-500 border-red-500/20 dark:border-red-500/30',
    bg: 'bg-red-500/[0.04] dark:bg-red-500/[0.08]',
    titleColor: 'text-red-600 dark:text-red-400',
    defaultLabel: 'CAUTION',
  },
  warning: {
    border: 'border-l-amber-500 border-amber-500/20 dark:border-amber-500/30',
    bg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.08]',
    titleColor: 'text-amber-600 dark:text-amber-400',
    defaultLabel: 'WARNING',
  },
  success: {
    border: 'border-l-emerald-500 border-emerald-500/20 dark:border-emerald-500/30',
    bg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.08]',
    titleColor: 'text-emerald-600 dark:text-emerald-400',
    defaultLabel: 'COMPLIANT',
  },
  info: {
    border: 'border-l-blue-500 border-blue-500/20 dark:border-blue-500/30',
    bg: 'bg-blue-500/[0.04] dark:bg-blue-500/[0.08]',
    titleColor: 'text-blue-600 dark:text-blue-400',
    defaultLabel: 'NOTE',
  },
  neutral: {
    border: 'border-l-zinc-500 border-zinc-200 dark:border-white/[0.08]',
    bg: 'bg-zinc-500/[0.04] dark:bg-white/[0.04]',
    titleColor: 'text-zinc-700 dark:text-zinc-300',
    defaultLabel: 'OBSERVATION',
  },
};

export function getDefaultCalloutIcon(status?: string, variant: AuditCalloutVariant = 'info'): React.ReactNode {
  const norm = status?.toUpperCase().trim();
  if (norm === 'TIP' || norm === 'HINT') return <Lightbulb size={13.5} className="shrink-0 text-amber-500 dark:text-amber-400" />;
  if (norm === 'QUESTION') return <HelpCircle size={13.5} className="shrink-0 text-purple-500 dark:text-purple-400" />;
  if (norm === 'TODO') return <ListTodo size={13.5} className="shrink-0 text-amber-500 dark:text-amber-400" />;
  if (norm === 'BUG' || norm === 'ERROR' || norm === 'FAIL' || norm === 'EXCEPTION') return <Bug size={13.5} className="shrink-0 text-red-500 dark:text-red-400" />;
  if (variant === 'danger') return <AlertOctagon size={13.5} className="shrink-0 text-red-500 dark:text-red-400" />;
  if (variant === 'warning') return <AlertTriangle size={13.5} className="shrink-0 text-amber-500 dark:text-amber-400" />;
  if (variant === 'success') return <CheckCircle2 size={13.5} className="shrink-0 text-emerald-500 dark:text-emerald-400" />;
  if (variant === 'neutral') return <HelpCircle size={13.5} className="shrink-0 text-zinc-500 dark:text-zinc-400" />;
  return <Info size={13.5} className="shrink-0 text-blue-500 dark:text-blue-400" />;
}

/**
 * AuditCallout Primitive
 * 
 * Clean, distraction-free modern blockquote callout matching executive specs:
 * - Subtle tinted background card with rounded corners
 * - Vivid colored left vertical border (3.5px)
 * - Clean uppercase bold colored title text with status icon
 * - Crisp body typography with zero awkward vertical gaps
 */
export function AuditCallout({
  status,
  variant: propVariant,
  title,
  cite,
  icon,
  children,
  className,
  ...props
}: AuditCalloutProps) {
  const normalizedStatus = status?.toUpperCase().trim();
  const variant: AuditCalloutVariant =
    propVariant ||
    (normalizedStatus ? STATUS_VARIANT_MAP[normalizedStatus] || 'info' : 'neutral');

  const config = VARIANT_CONFIG[variant] || VARIANT_CONFIG.info;
  const label = status && title && status !== title
    ? `${status} — ${title}`
    : (status || title);

  const displayIcon = icon || (label ? getDefaultCalloutIcon(normalizedStatus, variant) : null);

  return (
    <blockquote
      className={cn(
        "my-2.5 px-3 py-2 sm:px-3.5 sm:py-2 rounded-lg border border-l-[3px] select-text font-sans text-[13px] leading-[1.58] transition-colors",
        config.border,
        config.bg,
        className
      )}
      {...props}
    >
      {label && (
        <div className={cn("flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase mb-1 select-none", config.titleColor)}>
          {displayIcon}
          <span>{label}</span>
        </div>
      )}

      <div className="text-zinc-800 dark:text-zinc-300 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-0.5 leading-[1.58]">
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
