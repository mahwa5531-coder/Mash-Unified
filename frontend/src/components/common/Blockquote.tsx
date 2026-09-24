"use client";

import React from 'react';
import { cn } from '@/lib/utils';

export type BlockquoteColor = 'neutral' | 'red' | 'green' | 'purple' | 'blue' | 'amber' | 'emerald' | 'rose' | 'violet' | 'sky';

export interface BlockquoteProps extends React.ComponentPropsWithoutRef<'blockquote'> {
  /** The quoted content passed as children */
  children: React.ReactNode;
  /** Optional citation or author source credited in a semantic <cite> element */
  cite?: string;
  /** The accent color of the inline-start rule (red, green, purple, blue, amber, neutral) */
  color?: BlockquoteColor;
  /** Optional container class overrides */
  className?: string;
}

const COLOR_STYLES: Record<string, { border: string; bg: string; text: string }> = {
  neutral: {
    border: 'border-l-zinc-300 dark:border-l-zinc-600',
    bg: 'bg-transparent',
    text: 'text-zinc-600 dark:text-zinc-400',
  },
  red: {
    border: 'border-l-rose-500 dark:border-l-rose-400',
    bg: 'bg-rose-500/[0.03] dark:bg-rose-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  rose: {
    border: 'border-l-rose-500 dark:border-l-rose-400',
    bg: 'bg-rose-500/[0.03] dark:bg-rose-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  green: {
    border: 'border-l-emerald-500 dark:border-l-emerald-400',
    bg: 'bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  emerald: {
    border: 'border-l-emerald-500 dark:border-l-emerald-400',
    bg: 'bg-emerald-500/[0.03] dark:bg-emerald-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  purple: {
    border: 'border-l-purple-500 dark:border-l-purple-400',
    bg: 'bg-purple-500/[0.03] dark:bg-purple-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  violet: {
    border: 'border-l-purple-500 dark:border-l-purple-400',
    bg: 'bg-purple-500/[0.03] dark:bg-purple-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  blue: {
    border: 'border-l-sky-500 dark:border-l-sky-400',
    bg: 'bg-sky-500/[0.03] dark:bg-sky-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  sky: {
    border: 'border-l-sky-500 dark:border-l-sky-400',
    bg: 'bg-sky-500/[0.03] dark:bg-sky-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
  amber: {
    border: 'border-l-amber-500 dark:border-l-amber-400',
    bg: 'bg-amber-500/[0.03] dark:bg-amber-500/[0.05]',
    text: 'text-zinc-700 dark:text-zinc-300',
  },
};

/**
 * Astryx Blockquote Component (@astryxdesign/core/Blockquote)
 * A quotation block with a rule on its inline-start edge and secondary text color.
 * The rule and padding are logical, automatically adapting to LTR and RTL locales.
 */
export function Blockquote({
  children,
  cite,
  color = 'neutral',
  className,
  ...props
}: BlockquoteProps) {
  const activeStyle = COLOR_STYLES[color] || COLOR_STYLES.neutral;

  return (
    <blockquote
      className={cn(
        "astryx-blockquote",
        "my-3 pl-4 pr-3 py-1.5 rounded-r-lg border-l-[3px] transition-colors select-text font-sans text-[13.5px] leading-relaxed",
        activeStyle.border,
        activeStyle.bg,
        activeStyle.text,
        className
      )}
      {...props}
    >
      <div className="[&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-1">
        {children}
      </div>

      {cite && (
        <footer className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400 not-italic select-text">
          <cite className="not-italic font-medium text-zinc-600 dark:text-zinc-300">
            — {cite}
          </cite>
        </footer>
      )}
    </blockquote>
  );
}

export default Blockquote;
