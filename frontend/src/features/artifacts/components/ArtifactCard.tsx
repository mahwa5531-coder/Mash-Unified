"use client";

import React, { useState, useEffect } from 'react';
import { BookOpen, FileText, Check, FileSpreadsheet, Image as ImageIcon, ArrowUpRight, Download } from 'lucide-react';
import { ArtifactItem } from '@/types/artifacts';
import { BASE_URL } from '@/services/client';
import { WorkingPaperCard } from '@/primitives/WorkingPaperCard';

export type { ArtifactItem } from '@/types/artifacts';

interface ArtifactCardProps {
  artifact: ArtifactItem;
  sessionId?: string;
  onOpen: (path: string) => void;
  onProceed?: (path: string) => void;
  isLast?: boolean;
  isStreaming?: boolean;
}

export default function ArtifactCard({ 
  artifact, 
  sessionId,
  onOpen, 
  onProceed, 
  isLast = true, 
  isStreaming = false 
}: ArtifactCardProps) {
  const [hasProceeded, setHasProceeded] = useState(false);
  const lowerPath = artifact.filePath.toLowerCase();
  const lowerTitle = artifact.title.toLowerCase();

  const isExcel = artifact.type === 'spreadsheet' || /\.(xlsx|xls|csv)$/i.test(lowerPath);
  const isChart = artifact.type === 'chart' || /\.(png|jpe?g|svg|webp)$/i.test(lowerPath);
  const isWalkthrough = artifact.type === 'walkthrough' || lowerPath.includes('walkthrough') || lowerTitle.includes('walkthrough');
  const isPlan = !isWalkthrough && !isExcel && !isChart && (
    artifact.type === 'plan' ||
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

  // Dynamic icon and badge styling
  const renderIcon = () => {
    if (isExcel) {
      return (
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
          <FileSpreadsheet size={16} />
        </div>
      );
    }
    if (isChart) {
      if (artifact.thumbnailUrl) {
        return (
          <div className="w-8 h-8 rounded-lg overflow-hidden border border-purple-500/20 bg-purple-500/10 flex items-center justify-center shrink-0">
            <img 
              src={artifact.thumbnailUrl} 
              alt={artifact.title} 
              className="w-full h-full object-cover" 
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        );
      }
      return (
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-500 shrink-0">
          <ImageIcon size={16} />
        </div>
      );
    }
    if (isWalkthrough) {
      return (
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-500 shrink-0">
          <BookOpen size={16} />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center text-zinc-500 dark:text-zinc-400 font-mono text-xs font-semibold shrink-0">
        &lt;&gt;
      </div>
    );
  };

  const getTagBadge = () => {
    if (isExcel) return <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Deliverable</span>;
    if (isChart) return <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">Visual Chart</span>;
    if (isPlan) return <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">Plan</span>;
    if (isWalkthrough) return <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">Walkthrough</span>;
    return <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">Document</span>;
  };

  // For Markdown deliverables, Memos, Plans, and Walkthroughs: render sleek WorkingPaperCard (<> Title)
  if (!isExcel && !isChart) {
    const actionSlot = isPlan ? (
      <div>
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
    ) : undefined;

    return (
      <WorkingPaperCard
        filePath={artifact.filePath}
        title={artifact.title}
        summary={artifact.summary}
        type={artifact.type}
        onOpen={onOpen}
        action={actionSlot}
      />
    );
  }

  return (
    <div 
      onClick={() => onOpen(artifact.filePath)}
      className="w-full bg-zinc-50 hover:bg-zinc-100 dark:bg-[#141414] dark:hover:bg-[#1a1a1a] border border-zinc-200 hover:border-zinc-300 dark:border-white/[0.06] dark:hover:border-white/[0.14] rounded-xl p-3 my-1.5 cursor-pointer transition-all duration-150 group select-none shadow-xs flex items-center justify-between gap-3"
      title={`Open ${artifact.title}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {renderIcon()}
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13.5px] text-zinc-800 group-hover:text-zinc-950 dark:text-zinc-200 dark:group-hover:text-white truncate">
              {artifact.title}
            </span>
            {getTagBadge()}
          </div>
          {artifact.summary && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-normal">
              {artifact.summary}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isExcel && (
          <a
            href={`${BASE_URL}/files/content?path=${encodeURIComponent(artifact.filePath)}&raw=true${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors"
            title="Download spreadsheet to open in Microsoft Excel"
          >
            <Download size={14} />
          </a>
        )}
      </div>
    </div>
  );
}

