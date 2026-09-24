"use client";

import React, { useState, useEffect } from 'react';
import { BookOpen, FileText, Loader2, Check } from 'lucide-react';
import { ArtifactItem } from '@/lib/types';

export type { ArtifactItem } from '@/lib/types';

interface ArtifactCardProps {
  artifact: ArtifactItem;
  onOpen: (path: string) => void;
  onProceed?: (path: string) => void;
  isLast?: boolean;
  isStreaming?: boolean;
}

export default function ArtifactCard({ 
  artifact, 
  onOpen, 
  onProceed, 
  isLast = true, 
  isStreaming = false 
}: ArtifactCardProps) {
  const [hasProceeded, setHasProceeded] = useState(false);
  const lowerPath = artifact.filePath.toLowerCase();
  const lowerTitle = artifact.title.toLowerCase();
  const isWalkthrough = lowerPath.includes('walkthrough') || lowerTitle.includes('walkthrough');
  const isPlan = !isWalkthrough && (
    lowerPath.includes('implementation_plan') ||
    lowerPath.includes('plan.md') ||
    lowerTitle.includes('implementation plan')
  );

  const isExplicitFeedbackRequested = Boolean(artifact.requestFeedback);
  const shouldShowProceed = isPlan && isLast && !isStreaming && isExplicitFeedbackRequested && !hasProceeded;
  const isPlanImplemented = isPlan && (hasProceeded || !isExplicitFeedbackRequested);

  const handleProceedClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasProceeded || isStreaming) return;
    setHasProceeded(true);
    onProceed?.(artifact.filePath);
  };

  // ponytail: Ctrl+Enter shortcut triggers Proceed when active on latest turn
  useEffect(() => {
    if (!shouldShowProceed || !onProceed) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase();
        const activeValue = (document.activeElement as HTMLTextAreaElement | HTMLInputElement)?.value || '';
        // If user is typing custom text in composer, let Enter send their text instead of auto-proceed
        if (activeTag === 'textarea' && activeValue.trim().length > 0) {
          return;
        }
        e.preventDefault();
        setHasProceeded(true);
        onProceed(artifact.filePath);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldShowProceed, onProceed, artifact.filePath]);

  return (
    <div 
      onClick={() => onOpen(artifact.filePath)}
      className="w-full bg-zinc-50 hover:bg-zinc-100 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] border border-zinc-200 hover:border-zinc-300 dark:border-white/[0.06] dark:hover:border-white/[0.14] rounded-xl px-4 py-2.5 my-1 cursor-pointer transition-all duration-150 group select-none shadow-xs flex items-center justify-between"
      title={`Open ${artifact.title}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 font-semibold tracking-tighter shrink-0 select-none">
          &lt;&gt;
        </span>
        <span className="font-medium text-[13.5px] text-zinc-800 group-hover:text-zinc-950 dark:text-zinc-200 dark:group-hover:text-white truncate">
          {artifact.title}
        </span>
      </div>

      {isPlan && (
        <div className="shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          {shouldShowProceed ? (
            <button
              type="button"
              onClick={handleProceedClick}
              disabled={isStreaming}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#174ea6] text-white text-xs font-medium rounded-lg transition-colors cursor-pointer shadow-xs disabled:opacity-50 select-none"
              title="Proceed with the implementation plan (Ctrl+Enter)"
            >
              <span>Proceed</span>
              <span className="text-[10px] text-blue-100/80 font-mono tracking-tight ml-0.5">Ctrl+↵</span>
            </button>
          ) : isPlanImplemented ? (
            <div className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-md text-[11px] font-medium select-none">
              <Check size={11} className="shrink-0" />
              <span>Implemented</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

