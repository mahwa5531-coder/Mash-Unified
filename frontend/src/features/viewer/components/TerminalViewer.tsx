"use client";

// Terminal tab body: task header + status chip + line-windowed virtualized monospace log.
import React, { useState, useEffect, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { StopCircle, Copy, Check } from 'lucide-react';
import { Button } from '@/primitives';
import type { TabItem } from '../types';

interface TerminalViewerProps {
  activeTab: TabItem;
  terminalStatuses: Record<string, 'running' | 'completed' | 'failed'>;
  tabContent: Record<string, string>;
  handleKillTask: (e: ReactMouseEvent, pid: number) => void;
  terminalPreRef: React.RefObject<HTMLDivElement | null>;
}

const LINE_HEIGHT = 22; // px per monospace terminal line
const OVERSCAN = 20; // buffer lines above and below viewport

export function TerminalViewer({
  activeTab,
  terminalStatuses,
  tabContent,
  handleKillTask,
  terminalPreRef,
}: TerminalViewerProps) {
  const currentPid = parseInt(activeTab.id.replace('terminal-', ''), 10);
  const isRunning = (terminalStatuses[activeTab.id] || 'running') === 'running';
  const rawLog = tabContent[activeTab?.id || ''] || '// Waiting for process output...';

  // Fast memoized line splitting
  const logLines = useMemo(() => rawLog.split('\n'), [rawLog]);
  const totalLines = logLines.length;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [copied, setCopied] = useState(false);

  // Measure container height dynamically
  useEffect(() => {
    const el = terminalPreRef.current;
    if (!el) return;

    setViewportHeight(el.clientHeight || 600);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const h = entry.contentRect?.height || entry.borderBoxSize?.[0]?.blockSize;
          if (h && h > 0) {
            setViewportHeight(Math.round(h));
          }
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [terminalPreRef]);

  // Zero-dependency line virtualization window
  const startIndex = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / LINE_HEIGHT) + 2 * OVERSCAN;
  const endIndex = Math.min(totalLines, startIndex + visibleCount);

  const topSpacerHeight = startIndex * LINE_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalLines - endIndex) * LINE_HEIGHT);
  const visibleLines = useMemo(() => {
    return logLines.slice(startIndex, endIndex);
  }, [logLines, startIndex, endIndex]);

  const handleCopyLog = (e: ReactMouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(rawLog);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#121214] overflow-hidden text-zinc-100 select-text">
      {/* Top Task Header Bar */}
      <div className="px-3.5 py-2.5 border-b border-zinc-800/80 bg-[#161619] flex items-center justify-between shrink-0">
        <div className="flex flex-col min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-zinc-200">Background Task Output</span>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium ${
              isRunning 
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                : (terminalStatuses[activeTab.id] === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700/60')
            }`}>
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
              {isRunning ? 'RUNNING' : (terminalStatuses[activeTab.id] === 'failed' ? 'FAILED' : 'COMPLETED')}
            </span>
          </div>
          <span className="font-mono text-[12px] text-sky-400 dark:text-sky-300 truncate mt-0.5" title={activeTab.title}>
            {activeTab.title}
          </span>
        </div>

        {/* Action Controls: Copy Log & Stop/Cancel */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyLog}
            className="h-6 px-2 text-[11px] flex items-center gap-1 rounded font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-700/60 transition-colors cursor-pointer"
            title="Copy entire log output to clipboard"
          >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {isRunning && !isNaN(currentPid) && (
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => handleKillTask(e, currentPid)}
              className="h-6 px-2.5 text-[11px] flex items-center gap-1 font-sans cursor-pointer shrink-0 bg-red-600/90 hover:bg-red-600 text-white shadow-xs"
              title="Cancel or stop this background task immediately"
            >
              <StopCircle className="h-3 w-3" />
              <span>Cancel Task</span>
            </Button>
          )}
        </div>
      </div>

      {/* Line-Windowed Monospace Virtualized Terminal Log */}
      <div 
        ref={terminalPreRef} 
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="p-3 overflow-auto custom-scrollbar font-mono text-[11.5px] leading-relaxed text-zinc-300 flex-1 bg-[#0d0d0f]"
      >
        {topSpacerHeight > 0 && (
          <div style={{ height: `${topSpacerHeight}px` }} aria-hidden="true" />
        )}

        {visibleLines.map((line, offset) => {
          const idx = startIndex + offset;
          return (
            <div 
              key={idx} 
              className="flex hover:bg-white/[0.02] py-0.5 px-1 rounded-sm h-[22px] items-center shrink-0"
            >
              <span className="select-none text-zinc-600 w-9 text-right pr-3.5 shrink-0 tabular-nums font-mono text-[11px]">
                {idx + 1}
              </span>
              <span className="flex-1 whitespace-pre text-zinc-200 overflow-hidden text-ellipsis">
                {line}
              </span>
            </div>
          );
        })}

        {bottomSpacerHeight > 0 && (
          <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

export default TerminalViewer;
