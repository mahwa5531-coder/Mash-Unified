"use client";

import React from 'react';
import { ExtensionBadge, PathPill, WorkingPaperCard } from '@/primitives';
import { TurnFilesGenerated } from '@/features/artifacts';

interface Unit04BWorkingPapersProps {
  onSelectComponent: (name: string) => void;
}

export function Unit04BWorkingPapers({ onSelectComponent }: Unit04BWorkingPapersProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4B</span>
          <span>Audit Primitives: `&lt;ExtensionBadge /&gt;`, `&lt;PathPill /&gt;` &amp; `&lt;TurnFilesGenerated /&gt;`</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">Non-Alarmist Palette for CAs &amp; Auditors</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        {/* 1. Standalone File Extension Badges */}
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            1. Standalone Extension Badges (`&lt;ExtensionBadge /&gt;`)
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            Static ghost badges for file formats (`.xlsx`, `.pdf`, `.md`). Logos and cursor glow removed for a clean, non-distracting monochrome audit appearance.
          </p>
          <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
            <ExtensionBadge extension=".xlsx" />
            <ExtensionBadge extension=".pdf" />
            <ExtensionBadge extension=".csv" />
            <ExtensionBadge extension=".docx" />
            <ExtensionBadge extension=".md" />
            <ExtensionBadge extension=".py" />
            <ExtensionBadge extension=".sql" />
            <ExtensionBadge extension=".json" />
            <ExtensionBadge extension=".zip" />
          </div>
        </div>

        {/* 2. Directory / Partial Path Pills */}
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            2. Directory &amp; Partial Path Pills (`&lt;PathPill /&gt;`) — Strictly Static
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            Renders workspace folders and directories cleanly. <strong className="text-[var(--m-text-primary)]">Strictly non-clickable</strong>: only files with complete paths and links are interactive, eliminating false click targets.
          </p>
          <div className="flex flex-wrap gap-2 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
            <PathPill path="workpapers/FY26/" />
            <PathPill path="Audit_Deliverables/CARO_2020/" />
            <PathPill path="procedures/statutory_vouching/" />
            <PathPill path="evidence/bank_confirmations/" />
            <PathPill path="src/primitives/" />
          </div>
        </div>

        {/* 3. Created .md Deliverables & Working Paper Cards */}
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            3. Created .md Deliverables &amp; Working Paper Cards (`&lt;WorkingPaperCard /&gt;`)
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            Rendered at the end of an audit procedure turn, <em>immediately before</em> the files generated section. Presents working paper memos, substantive schedules, and walkthroughs with humanized titles, executive findings, and sign-off status.
          </p>
          <div className="p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
            <WorkingPaperCard
              title="Revenue Recognition Testing Memo (Ind AS 115)"
              filePath="Audit_Deliverables/Revenue_Recognition_Memo.md"
              summary="Substantive testing of 45 high-value customer contracts; verified 5-step performance obligation satisfaction and accrued rebates."
              type="memo"
              status="ready_for_review"
              onOpen={(p) => onSelectComponent(`Review Working Paper: ${p}`)}
            />

            <WorkingPaperCard
              title="Procure-to-Pay ICFR Walkthrough Documentation"
              filePath="Audit_Deliverables/Controls_Walkthrough_P2P.md"
              summary="End-to-end testing of 3-way matching controls between purchase orders, goods receipt notes, and vendor tax invoices."
              type="walkthrough"
              status="ready_for_review"
              onOpen={(p) => onSelectComponent(`Review Walkthrough: ${p}`)}
            />

            <WorkingPaperCard
              title="Trade Payables Substantive Verification Schedule"
              filePath="workpapers/Trade_Payables_Substantive_Testing.xlsx"
              summary="100% sampling of balances exceeding materiality threshold (₹10 Lakhs); circularization confirmations reconciled."
              type="schedule"
              status="signed_off"
              onOpen={(p) => onSelectComponent(`Review Schedule: ${p}`)}
            />
          </div>
        </div>

        {/* 4. TurnFilesGenerated Component */}
        <div className="space-y-2">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            4. Files Generated at End of Turn (`&lt;TurnFilesGenerated /&gt;`)
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            Rendered at the end of an assistant turn right before the footer. Displays files produced or updated in that procedure, complete with authentic vector logos and one-click &quot;Open&quot; action into the side viewer.
          </p>
          <div className="p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)]">
            <TurnFilesGenerated
              files={[
                {
                  filename: 'Revenue_Recognition_Memo.md',
                  path: 'Audit_Deliverables/Revenue_Recognition_Memo.md',
                  dir: 'Audit_Deliverables',
                  addedLines: 84,
                },
                {
                  filename: 'Trade_Payables_Substantive_Testing.xlsx',
                  path: 'workpapers/Trade_Payables_Substantive_Testing.xlsx',
                  dir: 'workpapers',
                  addedLines: 230,
                },
                {
                  filename: 'CARO_Clause_3_Summary.pdf',
                  path: 'reports/CARO_Clause_3_Summary.pdf',
                  dir: 'reports',
                },
              ]}
              onOpenFile={(p) => onSelectComponent(`Open Generated File: ${p}`)}
            />
          </div>
        </div>

        {/* 5. Color Grading: Calm Executive Neutral vs Old False-Alarm Yellow */}
        <div className="space-y-2 pt-1 border-t border-[var(--m-border-subtle)]">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block">
            5. Audit Color Grading: Calm Executive Neutral vs Old False-Alarm Amber
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)]">
            In auditing, amber/yellow signals <strong className="text-amber-500 font-medium">CAUTION / RISK / DEFICIENCY</strong>. Neutral parameters and code tokens are now rendered in crisp neutral zinc to eliminate false alarms:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] space-y-1.5">
              <span className="text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400 block uppercase">
                ❌ Old Style (Jarring False Alarm)
              </span>
              <p className="text-xs text-[var(--m-text-secondary)]">
                Checked formula <code className="bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/20 px-1 py-0.5 rounded font-mono text-[11px]">SUM(D2:D140)</code> under account <code className="bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/20 px-1 py-0.5 rounded font-mono text-[11px]">GL_2100_TradePayables</code>.
              </p>
              <span className="text-[10.5px] text-amber-700/80 dark:text-amber-400/70 block">
                Distracting amber makes routine account codes look like audit violations.
              </span>
            </div>

            <div className="p-3 rounded-lg border border-zinc-200/80 dark:border-white/[0.1] bg-zinc-50 dark:bg-white/[0.02] space-y-1.5">
              <span className="text-[11px] font-mono font-semibold text-emerald-600 dark:text-emerald-400 block uppercase">
                ✓ New Calm Executive Tone
              </span>
              <p className="text-xs text-[var(--m-text-secondary)]">
                Checked formula <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">SUM(D2:D140)</code> under account <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">GL_2100_TradePayables</code>.
              </p>
              <span className="text-[10.5px] text-[var(--m-text-muted)] block">
                Clear, calm neutral text. Amber is preserved exclusively for actual risk tags.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
