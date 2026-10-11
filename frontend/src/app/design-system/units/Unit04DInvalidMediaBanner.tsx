"use client";

import React, { useState } from 'react';
import { Plus, Send } from 'lucide-react';
import { InvalidMediaBanner } from '@/primitives';
import { AttachedFilesList } from '@/features/chat/components/composer/AttachedFilesList';
import type { AttachedFile } from '@/features/chat/hooks/useChatAttachments';

interface Unit04DInvalidMediaBannerProps {
  onSelectComponent: (name: string) => void;
}

const DEFAULT_FIVE_ATTACHMENTS: AttachedFile[] = [
  {
    name: 'audit_evidence_screenshot.png',
    path: '/uploads/audit_evidence_screenshot.png',
    previewUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="12" fill="%231e293b"/><circle cx="45" cy="45" r="14" fill="%2338bdf8"/><path d="M20 95 L50 65 L80 85 L105 55 L115 65 L115 105 L20 105 Z" fill="%230284c7"/></svg>',
    size: 245760,
  },
  {
    name: 'statutory_audit_2026.pdf',
    path: '/uploads/statutory_audit_2026.pdf',
    size: 1468006, // 1.4 MB
  },
  {
    name: 'balance_sheet_q3.xlsx',
    path: '/uploads/balance_sheet_q3.xlsx',
    size: 356352, // 348 KB
  },
  {
    name: 'vendor_transactions.csv',
    path: '/uploads/vendor_transactions.csv',
    size: 89088, // 87 KB
  },
  {
    name: 'compliance_rules.json',
    path: '/uploads/compliance_rules.json',
    size: 12288, // 12 KB
  },
];

export function Unit04DInvalidMediaBanner({
  onSelectComponent,
}: Unit04DInvalidMediaBannerProps) {
  const [bannerOpen, setBannerOpen] = useState(true);
  const [demoFiles, setDemoFiles] = useState<AttachedFile[]>(DEFAULT_FIVE_ATTACHMENTS);
  const [attemptedOverflow, setAttemptedOverflow] = useState(false);

  const handleAttemptAdd6thFile = () => {
    // Attempting to attach more than 5 files triggers the banner and rejects addition
    if (demoFiles.length >= 5) {
      setBannerOpen(true);
      setAttemptedOverflow(true);
      onSelectComponent('InvalidMediaBanner: Exceeded 5 attachment cap');
    } else {
      const nextIdx = demoFiles.length;
      if (DEFAULT_FIVE_ATTACHMENTS[nextIdx]) {
        setDemoFiles((prev) => [...prev, DEFAULT_FIVE_ATTACHMENTS[nextIdx]]);
      }
    }
  };

  const handleRemoveFile = (idx: number) => {
    setDemoFiles((prev) => prev.filter((_, i) => i !== idx));
    setAttemptedOverflow(false);
  };

  const handleResetToFive = () => {
    setDemoFiles(DEFAULT_FIVE_ATTACHMENTS);
    setBannerOpen(true);
    setAttemptedOverflow(true);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">4D</span>
          <span>Invalid Media / 5-Attachment Limit Banner (`<InvalidMediaBanner />`)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`src/primitives/InvalidMediaBanner.tsx`</span>
      </div>

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-5">
        <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed space-y-1">
          <p>
            <strong className="text-[var(--m-text-primary)]">Chat UI Location & Trigger:</strong> The Invalid Media Banner is docked in <code className="bg-zinc-100 dark:bg-white/[0.06] text-zinc-800 dark:text-zinc-200 border border-zinc-200/80 dark:border-white/[0.08] px-1 py-0.5 rounded font-mono text-[11px]">ChatCanvas.tsx</code> directly above the bottom chat composer dock. It triggers whenever the user attempts to attach more than 5 media files (images/attachments) via drag & drop, file selection, or clipboard paste.
          </p>
        </div>

        {/* Interactive Control Toolbar */}
        <div className="flex flex-wrap gap-2.5 items-center p-3 rounded-lg bg-[var(--m-bg-app)] border border-[var(--m-border-subtle)] text-xs">
          <span className="text-[11px] font-mono text-[var(--m-text-muted)] uppercase tracking-wider mr-1">Controls:</span>
          <button
            type="button"
            onClick={handleAttemptAdd6thFile}
            className="px-2.5 py-1 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-medium cursor-pointer transition-colors"
          >
            Attach 6th File (Trigger Cap)
          </button>
          <button
            type="button"
            onClick={handleResetToFive}
            className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] font-medium cursor-pointer transition-colors"
          >
            Reset to 5 Attached Files
          </button>
          <button
            type="button"
            onClick={() => setBannerOpen((v) => !v)}
            className="px-2.5 py-1 rounded-md border border-[var(--m-border)] bg-[var(--m-bg-surface)] hover:bg-[var(--m-bg-surface-hover)] font-medium cursor-pointer transition-colors"
          >
            {bannerOpen ? 'Hide Banner' : 'Show Banner'}
          </button>
          <span className="text-zinc-500 text-[11.5px] ml-2">
            Active Attachments: <strong className="text-zinc-200 font-mono">{demoFiles.length}/5</strong>
          </span>
        </div>

        {/* Full Composer Dock Simulation */}
        <div className="w-full max-w-2xl mx-auto space-y-2 pt-2">
          {bannerOpen && (
            <InvalidMediaBanner
              open={bannerOpen}
              onOpenChange={setBannerOpen}
              title="Invalid Media"
              description="Maximum number of attachments reached"
              onDismiss={() => {
                setBannerOpen(false);
                onSelectComponent('InvalidMediaBanner: Dismissed');
              }}
            />
          )}

          {/* Composer Box with 5 Attached Image Thumbnails */}
          <div className="w-full bg-white dark:bg-[#18181b] rounded-2xl border border-zinc-200 dark:border-white/[0.08] p-3 shadow-lg flex flex-col gap-1.5">
            <AttachedFilesList attachedFiles={demoFiles} onRemove={handleRemoveFile} />
            {demoFiles.length > 0 && (
              <div className="h-[1px] bg-zinc-200/80 dark:bg-white/[0.08] my-1 mx-0.5 shrink-0" />
            )}
            <div className="text-[13.5px] text-zinc-900 dark:text-zinc-100 px-1 py-1 font-sans">
              refer these you will understand cleanly is it possible or not ,once research about the electron packer...
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-white/[0.04] text-xs text-zinc-400">
              <button
                type="button"
                className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-zinc-200/80 dark:hover:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400 transition-colors"
                aria-label="Attach files"
              >
                <Plus size={16} />
              </button>
              <div className="w-7 h-7 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-black flex items-center justify-center font-bold shadow-sm">
                <Send size={12} className="ml-0.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Unit04DInvalidMediaBanner;
