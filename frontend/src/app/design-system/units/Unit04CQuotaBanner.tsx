"use client";

import React from 'react';
import { QuotaBanner } from '@/primitives';

interface Unit04CQuotaBannerProps {
  quotaBannerOpen: boolean;
  setQuotaBannerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSelectComponent: (name: string) => void;
}

export function Unit04CQuotaBanner({
  quotaBannerOpen,
  setQuotaBannerOpen,
  onSelectComponent,
}: Unit04CQuotaBannerProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4C</span>
          <span>Quota &amp; Rate Limit Banners (`&lt;QuotaBanner /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/QuotaBanner.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1">
          <p>
            <strong className="text-[var(--m-text-primary)]">Chat UI Location & Trigger:</strong> The Quota Banner is mounted in <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">ChatCanvas.tsx</code> directly above the bottom chat composer dock. It triggers automatically whenever the LLM or gateway returns a 429 rate limit or quota exhaustion event.
          </p>
        </div>

        {/* Interactive Control Toolbar */}
        <div className="flex flex-wrap gap-2.5 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] text-xs">
          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider mr-1">Controls:</span>
          <button
            type="button"
            onClick={() => setQuotaBannerOpen((v) => !v)}
            className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] font-medium cursor-pointer transition-colors"
          >
            {quotaBannerOpen ? 'Hide Banner' : 'Show Banner'}
          </button>
          <span className="text-zinc-500 text-[11.5px] ml-2">
            (Faithful 1:1 match to production Antigravity quota design — single canonical style)
          </span>
        </div>

        {/* Live Interactive Banner Display */}
        {quotaBannerOpen ? (
          <div className="space-y-3">
            <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider block">
              Live Production Quota Banner Preview
            </span>
            <QuotaBanner
              open={quotaBannerOpen}
              onOpenChange={setQuotaBannerOpen}
              title="Baseline model quota reached"
              refreshDate={new Date(Date.now() + 24 * 3600 * 1000)}
              onSeePlans={() => onSelectComponent('QuotaBanner: Clicked See Plans')}
              onEnableOverages={() => onSelectComponent('QuotaBanner: Clicked Enable Overages')}
              onDismiss={() => {
                setQuotaBannerOpen(false);
                onSelectComponent('QuotaBanner: Dismissed');
              }}
            />
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-[var(--m-border)] text-center text-xs text-[var(--m-text-muted)]">
            Banner is dismissed. Click &quot;Show Banner&quot; above to re-open.
          </div>
        )}
      </div>
    </section>
  );
}
