"use client";

import React from 'react';
import { AuditBadge } from '@/primitives';

export function Unit02Badges() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">2</span>
          <span>Audit Compliance Badges (`&lt;AuditBadge /&gt;`) — Non-Alarmist Palette</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/AuditBadge.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Non-Alarmist Palette:</strong> Calibrated light shades (subtle 8–12% desaturated tints) that smoothly work on dark and light backgrounds. Eliminates glaring neon colors and background-clashing bright fills.
        </div>

        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Pre-Mapped Standard Audit Statuses</span>
          <div className="flex flex-wrap gap-2 items-center">
            <AuditBadge status="COMPLIANT" />
            <AuditBadge status="PASS" />
            <AuditBadge status="NO EXCEPTION" />
            <AuditBadge status="EXCEPTION" />
            <AuditBadge status="MATERIAL WEAKNESS" />
            <AuditBadge status="FAIL" />
            <AuditBadge status="SIGNIFICANT DEFICIENCY" />
            <AuditBadge status="CONTROL DEFICIENCY" />
            <AuditBadge status="HIGH RISK" />
            <AuditBadge status="MEDIUM RISK" />
            <AuditBadge status="LOW RISK" />
            <AuditBadge status="NOTE" />
            <AuditBadge status="WARNING" />
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--m-border-subtle)]">
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-2.5">Custom Ad-Hoc Auditor Tags</span>
          <div className="flex flex-wrap gap-2 items-center">
            <AuditBadge variant="danger">BENFORD LAW ANOMALY</AuditBadge>
            <AuditBadge variant="warning">PENDING PARTNER SIGN-OFF</AuditBadge>
            <AuditBadge variant="success">SAMPLE RECONCILED</AuditBadge>
            <AuditBadge variant="info">CARO 2020 DISCLOSURE</AuditBadge>
          </div>
        </div>
      </div>
    </section>
  );
}
