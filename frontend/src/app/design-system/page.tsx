"use client";

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Sun, Moon } from 'lucide-react';
import {
  Unit01Buttons,
  Unit02Badges,
  Unit03Callouts,
  Unit04Pills,
  Unit04BWorkingPapers,
  Unit04CQuotaBanner,
  Unit05FileTabs,
  Unit06Breadcrumbs,
  Unit07Logos,
  Unit08WebLinks,
  Unit09SystemIcons,
  Unit10ColorTokens,
} from './units';

const Unit14AllToolMatrix = dynamic(() => import('./units').then(m => m.Unit14AllToolMatrix), { ssr: false });
const Unit15Tables = dynamic(() => import('./units').then(m => m.Unit15Tables), { ssr: false });
const Unit16MermaidDiagrams = dynamic(() => import('./units').then(m => m.Unit16MermaidDiagrams), { ssr: false });
const Unit17CodeBlocks = dynamic(() => import('./units').then(m => m.Unit17CodeBlocks), { ssr: false });
const Unit19Typography = dynamic(() => import('./units').then(m => m.Unit19Typography), { ssr: false });
const Unit20FileViewerStates = dynamic(() => import('./units').then(m => m.Unit20FileViewerStates), { ssr: false });
const Unit21SignIn = dynamic(() => import('./units').then(m => m.Unit21SignIn), { ssr: false });
const Unit22SettingsModal = dynamic(() => import('./units').then(m => m.Unit22SettingsModal), { ssr: false });

export default function DesignSystemPreviewPage() {
  const [isDark, setIsDark] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [lastClicked, setLastClicked] = useState<string>('None');
  const [quotaBannerOpen, setQuotaBannerOpen] = useState(true);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (next) {
        root.classList.add('dark');
        root.setAttribute('data-theme', 'dark');
      } else {
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      }
    }
  };

  return (
    <div className={`min-h-screen bg-[var(--m-bg-app)] text-[var(--m-text-primary)] p-6 sm:p-12 font-sans transition-colors ${isDark ? 'dark' : ''}`}>
      <div className="max-w-4xl mx-auto space-y-10">

        {/* Top Header Row with Theme Toggle */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--m-border-subtle)]">
          <div>
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--m-text-muted)]">MASh Audit Operating System</span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--m-text-primary)] mt-1">Design System & Primitive Verification</h1>
            <p className="text-sm text-[var(--m-text-secondary)] mt-1">
              Verify atomic Lego-block components in isolation before assembling screens. All 14 modular units rendered on one live canvas.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] text-xs font-medium cursor-pointer shadow-xs transition-colors"
          >
            {isDark ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-600" />}
            <span>{isDark ? 'Switch to Light' : 'Switch to Dark'}</span>
          </button>
        </div>

        {/* Verification Status Banner */}
        <div className="p-3.5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--m-success)]" />
            <span className="text-[var(--m-text-secondary)]">Last Component Clicked:</span>
            <span className="font-mono font-medium text-[var(--m-text-primary)]">{lastClicked}</span>
          </div>
          <button
            type="button"
            onClick={() => setIsLoading((v) => !v)}
            className="text-[var(--m-accent)] hover:underline cursor-pointer"
          >
            Toggle Button Loading State: {isLoading ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* UNIT 1: Button Primitive */}
        <Unit01Buttons isLoading={isLoading} onSelectComponent={setLastClicked} />

        {/* UNIT 2: AuditBadge Primitive */}
        <Unit02Badges />

        {/* UNIT 3: AuditCallout Primitive */}
        <Unit03Callouts />

        {/* UNIT 4: FilePill Primitive */}
        <Unit04Pills onSelectComponent={setLastClicked} />

        {/* UNIT 4B: Working Papers & TurnFilesGenerated */}
        <Unit04BWorkingPapers onSelectComponent={setLastClicked} />

        {/* UNIT 4C: Quota & Rate Limit Banner */}
        <Unit04CQuotaBanner
          quotaBannerOpen={quotaBannerOpen}
          setQuotaBannerOpen={setQuotaBannerOpen}
          onSelectComponent={setLastClicked}
        />

        {/* UNIT 5: FileTab Primitive */}
        <Unit05FileTabs onSelectComponent={setLastClicked} />

        {/* UNIT 6: FileBreadcrumbBar Primitive */}
        <Unit06Breadcrumbs onSelectComponent={setLastClicked} />

        {/* UNIT 7: Active Enterprise File & Brand Logos */}
        <Unit07Logos onSelectComponent={setLastClicked} />

        {/* UNIT 8: Interactive Web Links & External Anchors */}
        <Unit08WebLinks />

        {/* UNIT 9: Enterprise System & Action Icons Suite */}
        <Unit09SystemIcons onSelectComponent={setLastClicked} />

        {/* UNIT 10: Canvas Surfaces, Elevation Shades & Semantic Color Tokens */}
        <Unit10ColorTokens onSelectComponent={setLastClicked} />

        {/* UNIT 14: All Tool Types, States & Combinations Matrix (4 Core Atoms + Parallel Grouping) */}
        <Unit14AllToolMatrix />

        {/* UNIT 15: Clean Data Tables (Header stripped) */}
        <Unit15Tables />

        {/* UNIT 16: Mermaid Interactive Diagrams (Inline Naked + Lightbox Modal) */}
        <Unit16MermaidDiagrams />

        {/* UNIT 17: Syntax-Highlighted Code Blocks */}
        <Unit17CodeBlocks />

        {/* UNIT 19: Structured Text Hierarchy & Markdown Typography */}
        <Unit19Typography />

        {/* UNIT 20: Right-Sidebar File Viewer Error & Fallback States */}
        <Unit20FileViewerStates />

        {/* UNIT 21: Desktop Sign-In View */}
        <Unit21SignIn />

        {/* UNIT 22: Unified Settings Modal */}
        <Unit22SettingsModal />

      </div>
    </div>
  );
}
