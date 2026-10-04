"use client";

import React, { useState } from 'react';
import { FileViewerNotice } from '@/features/viewer/components/renderers/FileViewerNotice';

export function Unit20FileViewerStates() {
  const [activeTab, setActiveTab] = useState<'notFound' | 'unsupported'>('notFound');

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">20</span>
          <span>Right-Sidebar File Viewer Error &amp; Fallback States</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`renderers/FileViewerNotice.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-4">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
          <strong className="text-[var(--m-text-primary)]">Clean Centered Status Shield:</strong> High-authority, distraction-free indicator with zero external download links or clutter. Used identically for missing files and unsupported formats (CSV, Excel, binaries).
        </div>

        {/* State Toggle Tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] pb-2 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('notFound')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              activeTab === 'notFound'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            File not found
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('unsupported')}
            className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
              activeTab === 'unsupported'
                ? 'bg-zinc-200 dark:bg-zinc-800 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            File format not supported (.csv, .xlsx, .docx)
          </button>
        </div>

        {/* Live Canvas Preview */}
        <div className="h-64 w-full rounded-lg border border-[var(--m-border-subtle)] overflow-hidden bg-black flex items-center justify-center">
          {activeTab === 'notFound' ? (
            <FileViewerNotice message="File not found" />
          ) : (
            <FileViewerNotice message="File format not supported" />
          )}
        </div>
      </div>
    </section>
  );
}
