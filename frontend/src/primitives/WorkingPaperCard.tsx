"use client";

import React from 'react';
import { ArrowUpRight, Check, FileText } from 'lucide-react';
import { 
  OfficialMarkdownLogo, 
  FluentExcelLogo, 
  AdobePdfLogo, 
  CsvDelimitedLogo,
  AuditWalkthroughLogo,
  ImplementationPlanLogo,
} from './FileLogos';
import { cn } from '@/lib/utils';
import { normalizePath } from '@/utils/normalizePath';

export type WorkingPaperType = 'memo' | 'schedule' | 'report' | 'walkthrough' | 'plan';

export interface WorkingPaperCardProps {
  /** Relative or absolute path of the generated deliverable */
  filePath: string;
  /** Human-readable working paper title */
  title: string;
  /** One-line executive summary of findings or testing procedures */
  summary?: string;
  /** Document category */
  type?: WorkingPaperType;
  /** Current review / sign-off status */
  status?: 'ready_for_review' | 'signed_off' | 'in_progress';
  /** Action when clicked to open in right-side File Viewer */
  onOpen?: (filePath: string) => void;
  /** Optional review sign-off callback */
  onSignOff?: (filePath: string) => void;
  className?: string;
}

/**
 * WorkingPaperCard Primitive
 * 
 * Executive deliverable card rendered at the end of an audit procedure turn,
 * immediately before the files generated section.
 * Presents working papers (.md memos, .xlsx schedules, .pdf reports) ready for CA sign-off.
 */
export function WorkingPaperCard({
  filePath,
  title,
  summary,
  type = 'memo',
  status = 'ready_for_review',
  onOpen,
  onSignOff,
  className,
}: WorkingPaperCardProps) {
  const cleanPath = normalizePath(filePath, false);
  const ext = (cleanPath.split('.').pop() || '').toLowerCase();

  // Dynamic vector icon based on extension and document type
  const renderLogo = () => {
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      return <FluentExcelLogo size={20} />;
    }
    if (ext === 'pdf') {
      return <AdobePdfLogo size={20} />;
    }
    if (ext === 'csv') {
      return <CsvDelimitedLogo size={20} />;
    }
    if (type === 'walkthrough' || cleanPath.includes('walkthrough')) {
      return <AuditWalkthroughLogo size={20} />;
    }
    if (type === 'plan' || cleanPath.includes('plan')) {
      return <ImplementationPlanLogo size={20} />;
    }
    return <OfficialMarkdownLogo size={20} />;
  };

  const getCategoryBadge = () => {
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
      return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">Audit Schedule</span>;
    }
    if (ext === 'pdf') {
      return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/25">Statutory Report</span>;
    }
    if (type === 'walkthrough') {
      return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/25">Process Walkthrough</span>;
    }
    if (type === 'plan') {
      return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/25">Audit Plan</span>;
    }
    return <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border border-zinc-500/20">Working Paper Memo</span>;
  };

  return (
    <div
      onClick={() => onOpen?.(cleanPath)}
      className={cn(
        "w-full bg-zinc-50/90 hover:bg-zinc-100 dark:bg-[#141416] dark:hover:bg-[#1a1a1d]",
        "border border-zinc-200/90 hover:border-zinc-300 dark:border-white/[0.08] dark:hover:border-white/[0.18]",
        "rounded-xl p-3 my-2 cursor-pointer transition-all duration-150 group select-none shadow-xs",
        "flex items-center justify-between gap-3",
        className
      )}
      title={`Click to review ${title} in File Viewer`}
    >
      {/* Left: Icon & Deliverable Details */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#1a1a1c] border border-zinc-200/80 dark:border-white/[0.08] flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
          {renderLogo()}
        </div>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[13.5px] text-zinc-800 group-hover:text-zinc-950 dark:text-zinc-200 dark:group-hover:text-white truncate">
              {title}
            </span>
            {getCategoryBadge()}
          </div>
          {summary && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-normal">
              {summary}
            </p>
          )}
        </div>
      </div>

      {/* Right: Review & Sign-off Actions */}
      <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {status === 'signed_off' ? (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-md text-[11px] font-medium select-none">
            <Check size={11} className="shrink-0" />
            <span>Signed Off</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onOpen?.(cleanPath)}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-zinc-100 dark:bg-[#1e1e22] dark:hover:bg-[#28282e] border border-zinc-200 dark:border-white/[0.1] rounded-lg text-xs font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white transition-all cursor-pointer shadow-2xs group/btn"
          >
            <span>Review</span>
            <ArrowUpRight size={12} className="opacity-70 group-hover/btn:opacity-100 transition-opacity" />
          </button>
        )}
      </div>
    </div>
  );
}

export default WorkingPaperCard;
