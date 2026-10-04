"use client";

import React from 'react';
import { AuditBadge, AuditCallout } from '@/primitives';

export function Unit03Callouts() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">3</span>
          <span>Audit Observation Blockquotes &amp; Callouts (`&lt;AuditCallout /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/AuditCallout.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Unified Blockquote Engine:</strong> Solid 3.5px vertical accent bar on the left, transparent background, bold colored uppercase label on top, followed by clean body text. Shared identically across <strong>Chat assistant messages</strong> and <strong>Markdown working paper documents</strong> when markdown contains <code className="font-mono text-indigo-400">&gt; [!TAG]</code> or standard quotes.
        </div>

        {/* 1. Direct Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1.5">❌ Flawed: Tiny Isolated Badge</span>
            <div className="p-3 bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border)] text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[var(--m-text-muted)]">Observation #1:</span>
                <AuditBadge status="MATERIAL WEAKNESS" />
              </div>
              <p className="text-[var(--m-text-secondary)] text-[11px] pt-1">
                Discrepancy detected in fixed assets inventory. (Hard to notice, no authority anchor)
              </p>
            </div>
          </div>

          <div>
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--m-success)] block mb-1.5">✅ Reference Blockquote (Exact Match)</span>
            <AuditCallout status="NOTE">
              In <strong>&quot;Pro&quot; Reasoning Mode</strong>, the model generates hidden reasoning tokens (Chain-of-Thought) before writing code or checking ledger balances. We model both <strong>Standard Output</strong> (~416 tokens/call) and <strong>Pro Reasoning Output</strong> (~1,000 tokens/call including reasoning tokens).
            </AuditCallout>
          </div>
        </div>

        {/* 2. All Statutory & Markdown Callout Variants */}
        <div className="space-y-3 pt-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">All Statutory Severity &amp; Alert Variants</span>

          {/* EXCEPTION / CAUTION / MATERIAL WEAKNESS */}
          <AuditCallout
            status="EXCEPTION"
            cite="CGST Act 2017 / Rule 36(4)"
          >
            14 vendor invoices totaling ₹ 28.5 Lakhs claimed in GSTR-3B do not reflect in auto-populated GSTR-2B portal data for Q3.
          </AuditCallout>

          {/* CONTROL DEFICIENCY / WARNING */}
          <AuditCallout
            status="CONTROL DEFICIENCY"
            title="Inadequate Segregation of Duties in ERP Vendor Master"
            cite="Section 143(3)(i) ICFR Framework"
          >
            Accounts payable executives possess dual rights to create vendor records and release payments exceeding threshold limits.
          </AuditCallout>

          {/* COMPLIANT / PASS / VERIFIED */}
          <AuditCallout
            status="COMPLIANT"
            title="Statutory Dues Remittance Verified"
            cite="PF & ESI Act / CARO Clause 3(vii)"
          >
            Undisputed statutory dues including Provident Fund, ESI, and TDS have been regularly deposited with appropriate authorities without delays.
          </AuditCallout>

          {/* NOTE / IMPORTANT */}
          <AuditCallout
            status="NOTE"
            title="Management Representation Letter Pending Signature"
            cite="SA 580 Written Representations"
          >
            Draft representation letter submitted to CFO on Sept 22; final signed copy awaited prior to report sign-off.
          </AuditCallout>

          {/* TIP / OPTIMIZATION */}
          <AuditCallout status="TIP">
            DuckDB in-memory queries are pre-cached against parquet representations of spreadsheets for sub-millisecond audit calculations.
          </AuditCallout>

          {/* STANDARD BLOCKQUOTE (Citation only, no status tag) */}
          <AuditCallout cite="Standard on Auditing (SA 200)">
            &quot;The auditor&apos;s objective is to obtain reasonable assurance about whether the financial statements as a whole are free from material misstatement, whether due to fraud or error.&quot;
          </AuditCallout>
        </div>
      </div>
    </section>
  );
}
