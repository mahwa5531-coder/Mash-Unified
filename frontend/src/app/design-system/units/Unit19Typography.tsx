"use client";

import React from 'react';
import { FilePill, PathPill, ExtensionBadge } from '@/primitives';

export function Unit19Typography() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">19</span>
          <span>Structured Text Hierarchy &amp; Markdown Typography</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`components/markdown/useAgentMarkdownComponents.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Strict Visual Hierarchy:</strong> Heading scales, paragraph leading, bullet list indentation, bold lead-in tags, and inline workspace pill resolution shared identically between Chat and Markdown Document Viewers.
        </div>

        {/* 1. Heading Scale */}
        <div className="space-y-4 p-4 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
          <div>
            <span className="text-[10px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block mb-1">Heading 1 (# H1 — 22px Bold):</span>
            <h1 className="text-[22px] font-bold text-zinc-950 dark:text-white tracking-tight">
              Statutory Audit Executive Summary &amp; Materiality Assessment
            </h1>
          </div>

          <div>
            <span className="text-[10px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block mb-1">Heading 2 (## H2 — 17.5px Semibold with subtle divider):</span>
            <h2 className="text-[17.5px] font-semibold text-zinc-950 dark:text-zinc-50 tracking-tight border-b border-zinc-200/60 dark:border-white/[0.08] pb-1.5">
              1. Substantive Testing of Trade Receivables &amp; Bank Balances
            </h2>
          </div>

          <div>
            <span className="text-[10px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block mb-1">Heading 3 (### H3 — 15px Semibold):</span>
            <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
              A. External Confirmation Letters Reconciled (SA 505)
            </h3>
          </div>

          <div>
            <span className="text-[10px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block mb-1">Heading 4 (#### H4 — 13px Uppercase Tracking-Wider):</span>
            <h4 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              Observation Protocol 2026.04
            </h4>
          </div>
        </div>

        {/* 2. Body Prose with Bold Lead-Ins and Inline Workspace Pills */}
        <div className="space-y-3 p-4 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)] text-[13.5px] leading-[1.72] text-zinc-800 dark:text-[#d4d4d8]">
          <span className="text-[10px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block mb-1">Paragraphs with Bold Lead-Ins &amp; Inline Pills:</span>
          
          <p>
            During our field audit in <PathPill path="C:/Users/rama/Downloads/Mash/workpapers" />, we cross-referenced the general ledger voucher export in <FilePill path="C:/Users/rama/Downloads/Mash/data/general_ledger_q3.csv" /> against the statutory filing in <ExtensionBadge extension=".xlsx" />.
          </p>

          <ul className="my-2 pl-5 list-disc space-y-1.5 marker:text-zinc-400 dark:marker:text-zinc-500">
            <li>
              <strong className="text-zinc-950 dark:text-white">Materiality Threshold:</strong> Performance materiality set at 5% of normalized profit before tax (₹ 15,00,000).
            </li>
            <li>
              <strong className="text-zinc-950 dark:text-white">Sample Coverage:</strong> Tested 100% of debit vouchers above ₹ 5,00,000 and selected 40 random items via Benford sampling.
            </li>
            <li>
              <strong className="text-zinc-950 dark:text-white">GSTR-2B Verification:</strong> Automated script verified tax credit matching with 0 unresolved debit memos.
            </li>
          </ul>

          <ol className="my-2 pl-5 list-decimal space-y-1.5 marker:font-medium marker:text-zinc-500 dark:marker:text-zinc-400">
            <li>Review board minutes regarding related-party guarantees.</li>
            <li>Validate bank confirmation certificates from HDFC and ICICI.</li>
            <li>Finalize the unqualified statutory audit report.</li>
          </ol>
        </div>

      </div>
    </section>
  );
}
