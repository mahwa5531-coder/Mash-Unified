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
  containerClass: string;
  badgeClass: string;
  iconBoxClass: string;
  iconColor: string;
  titleColor: string;
  defaultIcon: React.ReactElement;
}> = {
  danger: {
    containerClass: 'bg-rose-50/80 dark:bg-[#1a1114] border-rose-200/90 dark:border-rose-900/50 shadow-[0_1px_3px_rgba(244,63,94,0.06)]',
    badgeClass: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/25',
    iconBoxClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
    iconColor: 'text-rose-600 dark:text-rose-400',
    titleColor: 'text-rose-950 dark:text-rose-100',
    defaultIcon: <ShieldAlert size={14} className="shrink-0" />,
  },
  warning: {
    containerClass: 'bg-amber-50/80 dark:bg-[#1a1610] border-amber-200/90 dark:border-amber-900/50 shadow-[0_1px_3px_rgba(245,158,11,0.06)]',
    badgeClass: 'bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-500/25',
    iconBoxClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    iconColor: 'text-amber-600 dark:text-amber-400',
    titleColor: 'text-amber-950 dark:text-amber-100',
    defaultIcon: <AlertTriangle size={14} className="shrink-0" />,
  },
  success: {
    containerClass: 'bg-emerald-50/80 dark:bg-[#101914] border-emerald-200/90 dark:border-emerald-900/50 shadow-[0_1px_3px_rgba(16,185,129,0.06)]',
    badgeClass: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/25',
    iconBoxClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    titleColor: 'text-emerald-950 dark:text-emerald-100',
    defaultIcon: <CheckCircle2 size={14} className="shrink-0" />,
  },
  info: {
    containerClass: 'bg-sky-50/80 dark:bg-[#101620] border-sky-200/90 dark:border-sky-900/50 shadow-[0_1px_3px_rgba(14,165,233,0.06)]',
    badgeClass: 'bg-sky-500/10 text-sky-800 dark:text-sky-400 border-sky-500/25',
    iconBoxClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
    iconColor: 'text-sky-600 dark:text-sky-400',
    titleColor: 'text-sky-950 dark:text-sky-100',
    defaultIcon: <Info size={14} className="shrink-0" />,
  },
  neutral: {
    containerClass: 'bg-zinc-50/90 dark:bg-[#141416] border-zinc-200 dark:border-white/[0.08] shadow-xs',
    badgeClass: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/20',
    iconBoxClass: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
    iconColor: 'text-zinc-500 dark:text-zinc-400',
    titleColor: 'text-zinc-900 dark:text-zinc-100',
    defaultIcon: <FileText size={14} className="shrink-0" />,
  },
};

/**
 * AuditCallout Primitive
 * 
 * Replaces outdated lopsided 2018 blockquotes with authoritative, full-width executive audit observation cards.
 * Designed specifically for statutory auditing (ICFR, CARO 2020, PCAOB, SA 315).
 * 
 * Features:
 * - Fully rounded-2xl container with high-visibility semantic ambient wash & subtle perimeter border
 * - Executive header: Frosted icon box + Statutory Status Badge + Crisp Finding Title
 * - Clear, readable body typography
 * - Statutory Authority footer bar with section (§) citation
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
        "my-3.5 p-4 rounded-2xl border transition-all select-text font-sans text-sm",
        config.containerClass,
        className
      )}
      {...props}
    >
      {/* Callout Header (Icon + Status Badge + Title + Top Citation if present) */}
      {(renderedIcon || status || title || cite) && (
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            {/* Frosted Icon Box */}
            <div className={cn(
              "w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 shadow-2xs",
              config.iconBoxClass
            )}>
              {renderedIcon}
            </div>
            
            {/* Status Badge */}
            {status && (
              <span className={cn(
                "font-mono text-[10.5px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md border shrink-0",
                config.badgeClass
              )}>
                {status}
              </span>
            )}

            {/* Finding Headline */}
            {title && (
              <span className={cn(
                "text-[13.5px] font-semibold tracking-tight truncate",
                config.titleColor
              )}>
                {title}
              </span>
            )}
          </div>

          {/* Top-Right Citation Tag (Compact Statutory Anchor) */}
          {cite && (
            <span className="shrink-0 hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 bg-white/70 dark:bg-white/[0.04] px-2 py-0.5 rounded-md border border-zinc-200/70 dark:border-white/[0.06]">
              <span className="text-zinc-400 dark:text-zinc-500 select-none">§</span>
              <span>{cite}</span>
            </span>
          )}
        </div>
      )}

      {/* Observation Body Prose */}
      <div className={cn(
        "text-[13.5px] leading-[1.68] text-zinc-700 dark:text-zinc-300 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1.5"
      )}>
        {children}
      </div>

      {/* Mobile or Full Statutory Authority Footer */}
      {cite && (
        <footer className="mt-3 sm:hidden text-xs text-zinc-500 dark:text-zinc-400 not-italic select-text flex items-center gap-1.5 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Authority:</span>
          <cite className="not-italic font-medium text-zinc-800 dark:text-zinc-200 font-mono text-[11px]">
            § {cite}
          </cite>
        </footer>
      )}
    </blockquote>
  );
}

export default AuditCallout;
