"use client";

import React from 'react';
import { AuditCallout } from '@/primitives/AuditCallout';

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

/**
 * CalloutBlockquote
 * 
 * Markdown renderer for blockquotes (> ...).
 * Delegates directly to the canonical AuditCallout primitive from src/primitives.
 */
export function CalloutBlockquote({ children }: { children: React.ReactNode }) {
  const rawText = extractText(children);

  // 1. Check for statutory alert or color tags: [!EXCEPTION], [!WARNING], [!COMPLIANT], [!NOTE], etc.
  const alertMatch = rawText.match(/^\s*\[!(EXCEPTION|MATERIAL WEAKNESS|FAIL|WARNING|CAUTION|CONTROL DEFICIENCY|SIGNIFICANT DEFICIENCY|COMPLIANT|PASS|NOTE|TIP|IMPORTANT|RED|GREEN|AMBER|BLUE|NEUTRAL)\]/i);
  if (alertMatch) {
    const tag = alertMatch[1].toUpperCase();
    const cleaned = cleanCalloutChildren(children, alertMatch[1]);
    return (
      <AuditCallout status={tag}>
        {cleaned}
      </AuditCallout>
    );
  }

  // 2. Standard blockquote with optional citation extraction (— Author / Ref)
  let citeText: string | undefined = undefined;
  const citeMatch = rawText.match(/(?:—|--)\s*([A-Za-z0-9\s,.'"-]+)$/);
  if (citeMatch) {
    citeText = citeMatch[1].trim();
  }

  return (
    <AuditCallout cite={citeText}>
      {children}
    </AuditCallout>
  );
}

export default CalloutBlockquote;
