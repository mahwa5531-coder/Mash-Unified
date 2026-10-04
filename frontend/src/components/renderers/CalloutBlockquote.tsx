"use client";

import React from 'react';
import { AuditCallout } from '@/primitives/AuditCallout';

// ----------------------------------------------------------------------
// Strip alert/color tags from children nodes
// ----------------------------------------------------------------------
function cleanCalloutChildren(node: any, tag: string, state = { stripped: false }): any {
  if (!node || state.stripped) return node;
  if (typeof node === 'string') {
    const reg = new RegExp(`^\\s*\\[!${tag}\\]\\s*`, 'i');
    if (reg.test(node)) {
      state.stripped = true;
      return node.replace(reg, '');
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((child) => cleanCalloutChildren(child, tag, state));
  }
  if (React.isValidElement(node) && (node.props as any)?.children) {
    const newChildren = cleanCalloutChildren((node.props as any).children, tag, state);
    return React.cloneElement(node as React.ReactElement<any>, {}, newChildren);
  }
  return node;
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
