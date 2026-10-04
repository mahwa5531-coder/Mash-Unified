"use client";

import React from 'react';
import { FileBreadcrumbBar } from '@/primitives';

interface Unit06BreadcrumbsProps {
  onSelectComponent: (name: string) => void;
}

export function Unit06Breadcrumbs({ onSelectComponent }: Unit06BreadcrumbsProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">6</span>
          <span>Subheader File Breadcrumb Bar (`&lt;FileBreadcrumbBar /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/FileBreadcrumbBar.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Ghost Text Whitening with Leaf File Logo:</strong> The second row displays the full directory path hierarchy. Leading directory words are ghost-muted and transition individually to crisp white on cursor hover (no shadow/shining, no background box). The final item renders the active file with its authentic <strong>file extension logo + filename</strong>. On the far right, only the vertical 3-dots menu button remains.
        </div>

        {/* Live Interactive Breadcrumb Simulation */}
        <div className="p-3 bg-[var(--m-bg-app)] rounded-xl border border-[var(--m-border)] space-y-2">
          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
            Sample 1: Deep Nested Financial Audit Workpaper (Hover individual words to test white highlight)
          </span>
          <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
            <FileBreadcrumbBar
              path="audit_engagements/FY26_Statutory/working_papers/Trade_Payables_Vouching.xlsx"
              onMenuClick={() => onSelectComponent('FileBreadcrumbBar: 3-dots Menu')}
            />
          </div>

          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block pt-2">
            Sample 2: Statutory Compliance Report (PDF)
          </span>
          <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
            <FileBreadcrumbBar
              path="deliverables/CARO_2020_Clause_3_Exceptions.pdf"
              onMenuClick={() => onSelectComponent('FileBreadcrumbBar: 3-dots Menu')}
            />
          </div>

          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block pt-2">
            Sample 3: Python Automation Procedure
          </span>
          <div className="bg-[var(--m-bg-surface)] rounded-md border border-[var(--m-border-subtle)]">
            <FileBreadcrumbBar
              path="procedures/benford_fraud_analysis.py"
              onMenuClick={() => onSelectComponent('FileBreadcrumbBar: 3-dots Menu')}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
