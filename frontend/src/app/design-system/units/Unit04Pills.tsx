"use client";

import React from 'react';
import { FilePill } from '@/primitives';

interface Unit04PillsProps {
  onSelectComponent: (name: string) => void;
}

export function Unit04Pills({ onSelectComponent }: Unit04PillsProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4</span>
          <span>Interactive File Pills (`&lt;FilePill /&gt;`) — Ghost Style</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FilePill.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="space-y-1">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            Ghost Interaction: Calm Neutral Surface, Authentic Left Logo, Smooth Hover Highlight
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            Replaces the artificial mustard-yellow glow with a calm ghost chip. The left SVG logo provides the authentic file identity, while the chip brightens subtly upon cursor hover without layout shifts or distracting neon borders.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5 items-center p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
          <FilePill path="workpapers/Trade_Payables_Vouching.xlsx" line="42" onClick={() => onSelectComponent('FilePill: Trade_Payables.xlsx:42')} />
          <FilePill path="reports/Statutory_Audit_Report_FY26.pdf" onClick={() => onSelectComponent('FilePill: Audit_Report.pdf')} />
          <FilePill path="data/Ledger_Sampling_Results.csv" line="100-250" onClick={() => onSelectComponent('FilePill: Sampling.csv:100-250')} />
          <FilePill path="plans/audit_plan.md" onClick={() => onSelectComponent('FilePill: audit_plan.md')} />
          <FilePill path="controls/walkthrough.md" onClick={() => onSelectComponent('FilePill: walkthrough.md')} />
          <FilePill path="procedures/benford_fraud_detection.py" line="18" onClick={() => onSelectComponent('FilePill: benford.py:18')} />
          <FilePill path="queries/sap_duplicate_invoices.sql" onClick={() => onSelectComponent('FilePill: duplicate_invoices.sql')} />
          <FilePill path="filings/MCA_XBRL_FY26.xml" onClick={() => onSelectComponent('FilePill: XBRL_FY26.xml')} />
        </div>

        <div className="text-[11.5px] text-[var(--m-text-muted)] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Hover any file pill above to preview the cursor highlight response. Active click dispatches to the workspace editor.</span>
        </div>
      </div>
    </section>
  );
}
