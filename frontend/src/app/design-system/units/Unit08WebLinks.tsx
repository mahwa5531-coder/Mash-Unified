"use client";

import React from 'react';
import { WebLink } from '@/primitives';

export function Unit08WebLinks() {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">8</span>
          <span>Interactive Web Links &amp; External Anchors (`&lt;WebLink /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/WebLink.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Standardized Web & Citation Hyperlinks:</strong> All outbound URLs and statutory references render with standard security (<code className="font-mono text-[11px] text-[var(--m-accent)]">target="_blank" rel="noopener noreferrer"</code>) and the standard external indicator (<code className="font-mono text-[11px] text-[var(--m-accent)]">↗</code>). Optional one-click copy badge allows auditors to copy URLs directly into audit workpaper citations.
        </div>

        {/* Direct Match to User Specification */}
        <div className="p-4 rounded-xl bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-3">
          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
            User Specification: Standard Blue Web Link with External Icon (↗)
          </span>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <WebLink href="http://localhost:3000/design-system">
              http://localhost:3000/design-system
            </WebLink>
            <WebLink href="https://github.com" withCopy>
              https://github.com
            </WebLink>
          </div>
        </div>

        {/* Regulatory & Statutory Citations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
            <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
              Statutory Regulatory Portals
            </span>
            <div className="flex flex-col space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[var(--m-text-secondary)]">Ministry of Corporate Affairs:</span>
                <WebLink href="https://www.mca.gov.in" withCopy>mca.gov.in</WebLink>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--m-text-secondary)]">PCAOB Auditing Standards:</span>
                <WebLink href="https://pcaobus.org/oversight/standards" withCopy>pcaobus.org</WebLink>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--m-text-secondary)]">ICAI Standards on Auditing:</span>
                <WebLink href="https://www.icai.org" withCopy>icai.org</WebLink>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] space-y-2">
            <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
              Inline Workpaper Statutory Anchors (`variant="citation"`)
            </span>
            <p className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
              As mandated under <WebLink href="https://www.mca.gov.in" variant="citation">MCA Section 143(3)(i)</WebLink> and reporting requirements of <WebLink href="https://www.mca.gov.in" variant="citation">CARO 2020 Clause 3(vii)</WebLink>, fixed asset register reconciliations must adhere to <WebLink href="https://www.icai.org" variant="citation">SA 315 Risk Assessment</WebLink>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
