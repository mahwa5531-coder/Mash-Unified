"use client";

import React from 'react';
import { Info, Lightbulb, Flame, AlertTriangle, ShieldAlert } from 'lucide-react';
import Blockquote, { BlockquoteColor } from '../common/Blockquote';

// ----------------------------------------------------------------------
// Strip alert/color tags from children nodes
// ----------------------------------------------------------------------
function cleanCalloutChildren(children: any, tag: string): any {
  if (!children) return children;
  if (Array.isArray(children)) {
    let stripped = false;
    return children.map((child) => {
      if (!stripped && child) {
        const res = cleanCalloutChildren(child, tag);
        stripped = true;
        return res;
      }
      return child;
    });
  }
  if (typeof children === 'string') {
    return children.replace(new RegExp(`^\\s*\\[!${tag}\\]\\s*`, 'i'), '');
  }
  if (children.props && children.props.children) {
    return {
      ...children,
      props: {
        ...children.props,
        children: cleanCalloutChildren(children.props.children, tag),
      },
    };
  }
  return children;
}

function extractText(nodes: any): string {
  if (!nodes) return '';
  if (typeof nodes === 'string') return nodes;
  if (Array.isArray(nodes)) return nodes.map(extractText).join('');
  if (nodes.props && nodes.props.children) return extractText(nodes.props.children);
  return '';
}

export function CalloutBlockquote({ children }: { children: React.ReactNode }) {
  const rawText = extractText(children);

  // 1. Check for Astryx colored blockquote syntax: [!RED], [!GREEN], [!PURPLE], [!BLUE], [!AMBER], [!NEUTRAL]
  const colorMatch = rawText.match(/^\s*\[!(RED|ROSE|GREEN|EMERALD|PURPLE|VIOLET|BLUE|SKY|AMBER|NEUTRAL)\]/i);
  if (colorMatch) {
    const colorTag = colorMatch[1].toLowerCase() as BlockquoteColor;
    const cleaned = cleanCalloutChildren(children, colorMatch[1]);
    return (
      <Blockquote color={colorTag}>
        {cleaned}
      </Blockquote>
    );
  }

  // 2. Check for GitHub Alert Callouts: [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
  const alertMatch = rawText.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
  if (alertMatch) {
    const alertType = alertMatch[1].toUpperCase();

    const configs: Record<string, { border: string; bg: string; text: string; label: string; icon: any }> = {
      NOTE: {
        border: 'border-l-sky-500',
        bg: 'bg-sky-500/[0.04] dark:bg-sky-500/[0.06]',
        text: 'text-sky-600 dark:text-sky-400',
        label: 'Note',
        icon: Info,
      },
      TIP: {
        border: 'border-l-emerald-500',
        bg: 'bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06]',
        text: 'text-emerald-600 dark:text-emerald-400',
        label: 'Tip',
        icon: Lightbulb,
      },
      IMPORTANT: {
        border: 'border-l-purple-500',
        bg: 'bg-purple-500/[0.04] dark:bg-purple-500/[0.06]',
        text: 'text-purple-600 dark:text-purple-400',
        label: 'Important',
        icon: Flame,
      },
      WARNING: {
        border: 'border-l-amber-500',
        bg: 'bg-amber-500/[0.04] dark:bg-amber-500/[0.06]',
        text: 'text-amber-600 dark:text-amber-400',
        label: 'Warning',
        icon: AlertTriangle,
      },
      CAUTION: {
        border: 'border-l-rose-500',
        bg: 'bg-rose-500/[0.04] dark:bg-rose-500/[0.06]',
        text: 'text-rose-600 dark:text-rose-400',
        label: 'Caution',
        icon: ShieldAlert,
      },
    };

    const cfg = configs[alertType] || configs.NOTE;
    const IconComp = cfg.icon;

    return (
      <div className={`my-3 rounded-r-xl border-l-[3px] ${cfg.border} ${cfg.bg} border border-zinc-200/80 dark:border-white/[0.06] p-3 text-zinc-800 dark:text-zinc-300 shadow-xs select-text`}>
        <div className={`flex items-center gap-1.5 font-medium text-[12px] mb-1.5 ${cfg.text} tracking-wide select-none`}>
          <IconComp size={14} className="shrink-0" />
          <span>{cfg.label}</span>
        </div>
        <div className="text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 [&>p:first-child]:mt-0 [&>p]:mb-1 [&>p:last-child]:mb-0">
          {cleanCalloutChildren(children, alertType)}
        </div>
      </div>
    );
  }

  // 3. Standard Astryx Blockquote with optional citation extraction
  // Check if content ends with "— Author" or "-- Author"
  let citeText: string | undefined = undefined;
  const citeMatch = rawText.match(/(?:—|--)\s*([A-Za-z0-9\s,.'"-]+)$/);
  if (citeMatch) {
    citeText = citeMatch[1].trim();
  }

  return (
    <Blockquote color="neutral" cite={citeText}>
      {children}
    </Blockquote>
  );
}

export default CalloutBlockquote;
