"use client";

import React from 'react';

interface Unit10ColorTokensProps {
  onSelectComponent: (name: string) => void;
}

export function Unit10ColorTokens({ onSelectComponent }: Unit10ColorTokensProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">10</span>
          <span>Elevation Tiers, Background Shades & Color Tokens Matrix</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/foundation/tokens.css`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1">
            1. Four-Tier Surface Elevation Hierarchy (Dark & Light Adaptive)
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)] mb-3">
            Strict z-index and elevation tokens ensuring consistent depth between background canvas, panels, modals, and toolbars.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { name: 'Layer 0: App Canvas', token: '--m-bg-app', hexDark: '#101012', hexLight: '#F7F8F9', desc: 'Main window backdrop' },
              { name: 'Layer 1: Surface Card', token: '--m-bg-surface', hexDark: '#141416', hexLight: '#FFFFFF', desc: 'Sidebars, cards, panels' },
              { name: 'Layer 2: Raised Modal', token: '--m-bg-raised', hexDark: '#1A1A1D', hexLight: '#FFFFFF', desc: 'Dialogs & popovers' },
              { name: 'Layer 3: Toolbar Row', token: '--m-bg-toolbar', hexDark: '#121214', hexLight: '#F1F3F5', desc: 'Row 1 & Row 2 headers' },
              { name: 'Hover State Surface', token: '--m-bg-surface-hover', hexDark: 'rgba(255,255,255,0.05)', hexLight: '#F1F3F5', desc: 'Hover feedback' },
              { name: 'Active State Surface', token: '--m-bg-surface-active', hexDark: 'rgba(255,255,255,0.09)', hexLight: '#E9ECEF', desc: 'Pressed / active items' },
            ].map((tier) => (
              <button
                key={tier.token}
                type="button"
                onClick={() => onSelectComponent(`Selected Token: ${tier.token}`)}
                className="p-3 rounded-lg border border-[var(--m-border-subtle)] text-left space-y-2 hover:border-[var(--m-accent)] transition-all cursor-pointer group"
                style={{ backgroundColor: `var(${tier.token})` }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider">Depth</span>
                  <span className="w-2 h-2 rounded-full border border-white/20" style={{ backgroundColor: `var(${tier.token})` }} />
                </div>
                <div className="font-semibold text-xs text-[var(--m-text-primary)] group-hover:text-[var(--m-accent)] transition-colors">
                  {tier.name}
                </div>
                <div className="font-mono text-[10.5px] text-[var(--m-text-muted)]">
                  {tier.token}
                </div>
                <div className="text-[11px] text-[var(--m-text-secondary)]">
                  {tier.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-[var(--m-text-muted)] block mb-1">
            2. Audit Semantic State Palette
          </span>
          <p className="text-[12px] text-[var(--m-text-secondary)] mb-3">
            Restrained, statutory-compliant color tokens for audit findings, risks, and execution status.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Executive Accent', token: '--m-accent', color: '#007ACC', bgSoft: 'rgba(0, 122, 204, 0.12)', meaning: 'Primary actions, active tab accents, focus rings' },
              { label: 'Audit Success / Pass', token: '--m-success', color: '#059669', bgSoft: 'rgba(5, 150, 105, 0.12)', meaning: 'Compliant controls, clean reconciliations, verified vouches' },
              { label: 'Audit Warning / Risk', token: '--m-warning', color: '#B45309', bgSoft: 'rgba(180, 83, 9, 0.12)', meaning: 'Sampling exceptions, pending client queries, scope alerts' },
              { label: 'Audit Danger / Defect', token: '--m-danger', color: '#DC2626', bgSoft: 'rgba(220, 38, 38, 0.12)', meaning: 'Material weaknesses, unrecorded liabilities, fraud flags' },
              { label: 'Audit Information / Scope', token: '--m-info', color: '#0369A1', bgSoft: 'rgba(3, 105, 161, 0.12)', meaning: 'Standards citation (SA 500, ICAI), walkthrough guidance' },
            ].map((item) => (
              <button
                key={item.token}
                type="button"
                onClick={() => onSelectComponent(`Selected Semantic Color: ${item.label} (${item.token})`)}
                className="p-3.5 rounded-lg border border-[var(--m-border-subtle)] text-left space-y-2 hover:border-[var(--m-border)] transition-all cursor-pointer bg-[var(--m-bg-app)]"
              >
                <div className="flex items-center justify-between">
                  <span className="w-3.5 h-3.5 rounded-md" style={{ backgroundColor: item.color }} />
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ backgroundColor: item.bgSoft, color: item.color }}>
                    {item.token}
                  </span>
                </div>
                <div className="font-semibold text-xs text-[var(--m-text-primary)]">
                  {item.label}
                </div>
                <p className="text-[11px] text-[var(--m-text-secondary)] leading-tight">
                  {item.meaning}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
