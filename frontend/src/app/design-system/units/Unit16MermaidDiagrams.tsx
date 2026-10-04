"use client";

import React, { useState } from 'react';
import MermaidRenderer from '@/components/renderers/MermaidRenderer';

export function Unit16MermaidDiagrams() {
  const [selectedChart, setSelectedChart] = useState<'audit' | 'architecture' | 'decision'>('audit');

  const charts = {
    audit: `graph TD
  A["Start Statutory Audit"] --> B["Compute Materiality (SA 320)"]
  B --> C{"Risk of Material Misstatement?"}
  C -->|"High"| D["Substantive Testing & 100% Confirmation (SA 505)"]
  C -->|"Low"| E["Analytical Review & Internal Controls Sampling"]
  D --> F["Inspect ERP Vouchers & Tax Invoices"]
  E --> F
  F --> G{"Material Discrepancy Found?"}
  G -->|"Yes"| H["Issue Qualified or Adverse Opinion"]
  G -->|"No"| I["Issue Clean Unqualified Audit Report"]`,

    architecture: `graph LR
  subgraph Frontend ["Next.js Desktop UI (Port 3000)"]
    Chat["ChatCanvas & Composer"]
    Viewer["File Viewer & Right Sidebar"]
  end

  subgraph Local ["Desktop Connector (Port 8000)"]
    FastAPI["FastAPI Connector"]
    LocalDB[("Local SQLite Vault")]
  end

  subgraph Cloud ["Mash Cloud API (Go bifrost)"]
    Bifrost["Bifrost Gateway"]
    Limiter["Token Limiter (6000 RPM)"]
    LLM["Upstream LLM Cluster"]
  end

  Chat <-->|"SSE Stream"| FastAPI
  FastAPI <-->|"DPAPI / AES"| LocalDB
  FastAPI <-->|"JWT Bearer"| Bifrost
  Bifrost --> Limiter
  Limiter --> LLM`,

    decision: `flowchart TD
  Q["Incoming Client Message"] --> R{"Agent Working?"}
  R -->|"Idle"| S["Dispatch Turn Immediately"]
  R -->|"Running"| T["Accumulate in Steering Queue"]
  T --> U{"User Action"}
  U -->|"Inject Mid-Flight"| V["Send Steering Event to Running Agent"]
  U -->|"Wait for Finish"| W["Auto-Dispatch Next in Queue on [DONE]"]
  U -->|"Cancel / Discard"| X["Remove from Session Queue"]`
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">16</span>
          <span>Mermaid Flowcharts &amp; Diagrams (`&lt;MermaidRenderer /&gt;`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`components/renderers/MermaidRenderer.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Clean Inline Flowcharts with Modal Lightbox:</strong> Diagrams render cleanly and naked inline without top bar buttons. Clicking any diagram opens an enlarged popup window with zoom controls and a corner close button.
        </div>

        {/* Chart selector tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] pb-2 text-xs">
          <button
            type="button"
            onClick={() => setSelectedChart('audit')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedChart === 'audit'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Statutory Audit Flowchart
          </button>
          <button
            type="button"
            onClick={() => setSelectedChart('architecture')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedChart === 'architecture'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            System Architecture (Desktop + Cloud)
          </button>
          <button
            type="button"
            onClick={() => setSelectedChart('decision')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              selectedChart === 'decision'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Chat Steering Queue Logic
          </button>
        </div>

        {/* Live Mermaid Renderer Instance */}
        <div className="p-2 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
          <MermaidRenderer chart={charts[selectedChart]} isStreaming={false} />
        </div>

      </div>
    </section>
  );
}
