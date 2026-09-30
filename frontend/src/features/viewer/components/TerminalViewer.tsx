"use client";

// Terminal tab body: task header + status chip + numbered monospace log.
import React, { MouseEvent as ReactMouseEvent } from 'react';
import { StopCircle } from 'lucide-react';
import { Button } from '@/primitives';
import type { TabItem } from '../types';

interface TerminalViewerProps {
  activeTab: TabItem;
  terminalStatuses: Record<string, 'running' | 'completed' | 'failed'>;
  tabContent: Record<string, string>;
  handleKillTask: (e: ReactMouseEvent, pid: number) => void;
  terminalPreRef: React.RefObject<HTMLDivElement | null>;
}

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
              const logLines = rawLog.split('\n');

              return (
                <div className="flex flex-col h-full bg-[#121214] overflow-hidden text-zinc-100 select-text">
                  {/* Top Task Header Bar (styled cleanly after Image 4) */}
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

                    {/* Prominent Stop / Cancel Button */}
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

                  {/* Clean Monospace Terminal Log with Line Numbers (matching Image 4) */}
                  <div ref={terminalPreRef} className="p-3 overflow-auto custom-scrollbar font-mono text-[11.5px] leading-relaxed text-zinc-300 flex-1 bg-[#0d0d0f]">
                    {logLines.map((line, idx) => (
                      <div key={idx} className="flex hover:bg-white/[0.02] py-0.5 px-1 rounded-sm">
                        <span className="select-none text-zinc-600 w-9 text-right pr-3.5 shrink-0 tabular-nums font-mono text-[11px]">
                          {idx + 1}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-all text-zinc-200">
                          {line}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
}
