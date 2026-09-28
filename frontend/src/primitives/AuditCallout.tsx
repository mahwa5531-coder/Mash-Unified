"use client";

import React from 'react';
import { ShieldAlert, AlertTriangle, CheckCircle2, Info, FileText } from 'lucide-react';
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
  'NOTE': 'info',
  'DISCLOSURE': 'info',
  'OBSERVATION': 'info',
  'CARO 2020': 'info',
};

const VARIANT_CONFIG: Record<AuditCalloutVariant, {
  borderColor: string;
  titleColor: string;
  iconColor: string;
  defaultIcon: React.ReactElement;
}> = {
  danger: {
    borderColor: 'border-l-[var(--m-danger)]',
    titleColor: 'text-[var(--m-danger)]',
    iconColor: 'text-[var(--m-danger)]',
    defaultIcon: <ShieldAlert size={16} className="shrink-0" />,
  },
  warning: {
    borderColor: 'border-l-[var(--m-warning)]',
    titleColor: 'text-[var(--m-warning)]',
    iconColor: 'text-[var(--m-warning)]',
    defaultIcon: <AlertTriangle size={16} className="shrink-0" />,
  },
  success: {
    borderColor: 'border-l-[var(--m-success)]',
    titleColor: 'text-[var(--m-success)]',
    iconColor: 'text-[var(--m-success)]',
    defaultIcon: <CheckCircle2 size={16} className="shrink-0" />,
  },
  info: {
    borderColor: 'border-l-[var(--m-info)]',
    titleColor: 'text-[var(--m-info)]',
    iconColor: 'text-[var(--m-info)]',
    defaultIcon: <Info size={16} className="shrink-0" />,
  },
  neutral: {
    borderColor: 'border-l-[var(--m-border-strong)]',
    titleColor: 'text-[var(--m-text-primary)]',
    iconColor: 'text-[var(--m-text-secondary)]',
    defaultIcon: <FileText size={16} className="shrink-0" />,
  },
};

/**
 * AuditCallout Primitive
 * 
 * Replaces miniature status badges with authoritative, full-width callout blockquotes
 * tailored for statutory auditing (ICFR, CARO 2020, PCAOB, SA 315).
 * 
 * Features:
 * - 3px semantic left accent border + subtle tinted background
 * - Icon + Status label + Finding Title in header
 * - Primary/Secondary readable prose container
 * - Statutory workpaper citation footer (`— SA 315 / Ind AS 115`)
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
  // Determine variant from explicit prop or statutory status
  const normalizedStatus = status?.toUpperCase().trim();
  const variant: AuditCalloutVariant =
    propVariant ||
    (normalizedStatus ? STATUS_VARIANT_MAP[normalizedStatus] || 'neutral' : 'neutral');

  const config = VARIANT_CONFIG[variant];
  const renderedIcon = icon ?? config.defaultIcon;

  return (
    <blockquote
      className={cn(
        "my-3.5 pl-4 pr-4 py-3 rounded-r-xl border-l-[3.5px] transition-colors select-text font-sans text-sm",
        "bg-[var(--m-bg-inset)]",
        config.borderColor,
        className
      )}
      {...props}
    >
      {/* Callout Header (Icon + Status + Title) */}
      {(renderedIcon || status || title) && (
        <div className="flex items-center gap-2 mb-1.5 font-medium leading-snug">
          <span className={config.iconColor}>{renderedIcon}</span>
          
          {status && (
            <span className={cn(
              "font-mono text-[10.5px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded",
              config.titleColor,
              "bg-black/5 dark:bg-white/10"
            )}>
              {status}
            </span>
          )}

          {title && (
            <span className="text-xs font-semibold tracking-tight text-[var(--m-text-primary)]">
              {title}
            </span>
          )}
        </div>
      )}

      {/* Observation Body Prose */}
      <div className={cn("text-[13px] leading-relaxed text-[var(--m-text-secondary)] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1")}>
        {children}
      </div>

      {/* Statutory Authority / Citation Footer */}
      {cite && (
        <footer className="mt-2 text-xs text-[var(--m-text-muted)] not-italic select-text flex items-center gap-1.5 pt-1.5 border-t border-black/5 dark:border-white/5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--m-text-muted)]">Authority:</span>
          <cite className="not-italic font-medium text-[var(--m-text-primary)] font-mono text-[11px]">
            {cite}
          </cite>
        </footer>
      )}
    </blockquote>
  );
}

export default AuditCallout;
