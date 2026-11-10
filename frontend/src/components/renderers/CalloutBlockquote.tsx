"use client";

import React from 'react';
import { AuditCallout } from '@/primitives/AuditCallout';

// ----------------------------------------------------------------------
// Strip alert/color tags from children nodes and prune empty paragraph artifacts
// ----------------------------------------------------------------------
export function cleanCalloutChildren(node: any, tag: string, title?: string, state = { stripped: false }): any {
  if (!node || state.stripped) return node;
  if (typeof node === 'string') {
    const tagEscaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titlePattern = title ? `(?:\\s*${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?` : '';
    const reg = new RegExp(`^\\s*\\[!?${tagEscaped}\\]${titlePattern}\\s*`, 'i');
    if (reg.test(node)) {
      state.stripped = true;
      const strippedText = node.replace(reg, '').replace(/^\n+/, '');
      return strippedText;
    }
    return node;
  }
  if (Array.isArray(node)) {
    const cleaned = node.map((child) => cleanCalloutChildren(child, tag, title, state));
    return cleaned.filter((child) => {
      if (child === '' || child === null || child === undefined) return false;
      if (React.isValidElement(child)) {
        const c = (child.props as any)?.children;
        if (c === '' || (Array.isArray(c) && c.length === 0)) return false;
      }
      return true;
    });
  }
  if (React.isValidElement(node) && (node.props as any)?.children) {
    const newChildren = cleanCalloutChildren((node.props as any).children, tag, title, state);
    if (newChildren === '' || (Array.isArray(newChildren) && newChildren.length === 0)) {
      return null;
    }
    return React.cloneElement(node as React.ReactElement<any>, {}, newChildren);
  }
  return node;
}

export function extractText(nodes: any): string {
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
export function CalloutBlockquote({ children }: { children?: React.ReactNode }) {
  const rawText = extractText(children);

  // 1. Check for standard GitHub alert or statutory color tags: [!NOTE], [!TIP], [!WARNING], [!INFO], [!CAUTION], etc.
  const alertMatch = rawText.match(/^\s*\[!?(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|QUESTION|TODO|SUCCESS|ERROR|DANGER|BUG|EXAMPLE|HINT|ABSTRACT|SUMMARY|EXCEPTION|MATERIAL WEAKNESS|FAIL|CONTROL DEFICIENCY|SIGNIFICANT DEFICIENCY|COMPLIANT|PASS|NO EXCEPTION|LOW RISK|HIGH RISK|MEDIUM RISK|CARO 2020|OBSERVATION|DISCLOSURE|RED|GREEN|AMBER|YELLOW|BLUE|NEUTRAL)\](?:\s*([^\n\r]+))?/i);
  if (alertMatch) {
    const tag = alertMatch[1].toUpperCase();
    const trailingTitle = alertMatch[2]?.trim();
    const cleaned = cleanCalloutChildren(children, alertMatch[1], trailingTitle);
    return (
      <AuditCallout status={tag} title={trailingTitle}>
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
