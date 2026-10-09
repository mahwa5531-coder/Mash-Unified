"use client";

import React, { useState } from 'react';
import { ToolTimelineRow } from '@/features/chat/components/work-log/ToolTimelineRow';
import { CommandTimelineRow } from '@/features/chat/components/work-log/CommandTimelineRow';
import { GroupTimelineRow } from '@/features/chat/components/work-log/GroupTimelineRow';
import { ReasoningDisclosure } from '@/primitives';
import type { TimelineEntry } from '@/features/chat/components/work-log/types';

export function Unit14AllToolMatrix() {
  const [expandedCmds, setExpandedCmds] = useState<Record<string, boolean>>({ 'cmd-decomposed-demo': true });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isThoughtOpen, setIsThoughtOpen] = useState(false);
  const [isLiveThinkingOpen, setIsLiveThinkingOpen] = useState(false);
  const [isGroupOpen, setIsGroupOpen] = useState<Record<string, boolean>>({
    'demo-group-explore': false,
    'demo-group-cmd': false,
    'demo-group-edit': false,
  });
  const [openedFileAlert, setOpenedFileAlert] = useState<string | null>(null);

  const toggleCmd = (id: string) => {
    setExpandedCmds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleOpenFile = (path: string) => {
    setOpenedFileAlert(`Opened in right sidebar: ${path}`);
    setTimeout(() => setOpenedFileAlert(null), 3000);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const toggleGroup = (id: string) => {
    setIsGroupOpen(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
          <span className="w-5 h-5 rounded-md bg-[var(--m-accent-soft)] text-[var(--m-accent)] flex items-center justify-center text-xs font-mono">14</span>
          <span>Timeline Tool &amp; Action Matrix (4 Core Atoms + Grouping)</span>
        </h2>
        <span className="font-mono text-xs text-[var(--m-text-muted)]">`work-log/ToolTimelineRow.tsx`</span>
      </div>

      {openedFileAlert && (
        <div className="px-3 py-2 text-xs font-mono rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-all">
          ✓ {openedFileAlert}
        </div>
      )}

      <div className="p-5 rounded-xl border border-[var(--m-border)] bg-[var(--m-bg-surface)] space-y-6">
        
        {/* 1. THINKING */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] pb-1.5">
            <span className="text-xs font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-500" />
              1. Thinking (Decomposes on click ›)
            </span>
            <span className="text-[11px] font-mono text-[var(--m-text-muted)]">Active vs. Completed</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">A. While Running (Click to decompose):</span>
              <ReasoningDisclosure
                text={"Analyzing file structure and import boundaries...\n1. Checking existing table primitives in components/renderers.\n2. Checking MermaidRenderer SVG generator and zoom controls.\n3. Preparing live Design System units for real-time inspection."}
                isStreaming={true}
                isOpen={isLiveThinkingOpen}
                onToggle={() => setIsLiveThinkingOpen(v => !v)}
              />
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">B. Completed (Click to decompose):</span>
              <ReasoningDisclosure
                text={"The user observed severe system stutter during Next.js startup.\n1. Identified Webpack cache=false forcing full compilation in RAM.\n2. Switched to Turbopack with persistent disk caching.\n3. Verified memory footprint dropped from 2GB to 140MB."}
                isStreaming={false}
                durationSeconds={12}
                isOpen={isThoughtOpen}
                onToggle={() => setIsThoughtOpen(v => !v)}
              />
            </div>
          </div>
        </div>

        {/* 2. EDITING */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] pb-1.5">
            <span className="text-xs font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              2. Editing (FilePill opens in right sidebar, NO decomposition)
            </span>
            <span className="text-[11px] font-mono text-[var(--m-text-muted)]">Editing... vs. Edited</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">A. While Running:</span>
              <ToolTimelineRow
                entry={{
                  id: 'edit-active',
                  type: 'edit',
                  data: {
                    filename: 'TaskWorkLogAccordion.tsx',
                    filePath: 'C:/Users/rama/Downloads/Mash/frontend/src/features/chat/components/TaskWorkLogAccordion.tsx',
                    tool: { id: 't-e1', name: 'replace_file_content', status: 'running' }
                  }
                }}
                isStreaming={true}
                onOpenFile={handleOpenFile}
                toggleGroup={() => {}}
              />
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">B. Completed (Click pill to open file):</span>
              <ToolTimelineRow
                entry={{
                  id: 'edit-done',
                  type: 'edit',
                  data: {
                    filename: 'ToolTimelineRow.tsx',
                    filePath: 'C:/Users/rama/Downloads/Mash/frontend/src/features/chat/components/work-log/ToolTimelineRow.tsx',
                    tool: { id: 't-e2', name: 'replace_file_content', status: 'completed' }
                  }
                }}
                onOpenFile={handleOpenFile}
                toggleGroup={() => {}}
              />
            </div>
          </div>
        </div>

        {/* 3. COMMAND EXECUTION */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] pb-1.5">
            <span className="text-xs font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              3. Running Command (Decomposes on click ›)
            </span>
            <span className="text-[11px] font-mono text-[var(--m-text-muted)]">Running... vs. Ran ›</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">A. While Running:</span>
              <CommandTimelineRow
                entry={{
                  id: 'cmd-active',
                  type: 'command',
                  data: {
                    cmd: 'pnpm test:chat',
                    fullCmd: 'pnpm test:chat',
                    tool: { id: 'c-act', name: 'run_command', status: 'running' }
                  }
                }}
                isStreaming={true}
                isCmdExpanded={!!expandedCmds['c-act']}
                copiedId={copiedId}
                handleCopy={handleCopy}
                toggleCmd={toggleCmd}
              />
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">B. Completed (Click to toggle terminal drawer):</span>
              <CommandTimelineRow
                entry={{
                  id: 'cmd-decomposed-demo',
                  type: 'command',
                  data: {
                    cmd: 'git status -s',
                    fullCmd: 'git status -s',
                    tool: {
                      id: 'cmd-decomposed-demo',
                      name: 'run_command',
                      status: 'completed',
                      output: 'M frontend/src/features/chat/components/work-log/ToolTimelineRow.tsx\nM frontend/src/features/chat/components/work-log/GroupTimelineRow.tsx\n\nExit code: 0'
                    }
                  }
                }}
                isCmdExpanded={!!expandedCmds['cmd-decomposed-demo']}
                copiedId={copiedId}
                handleCopy={handleCopy}
                toggleCmd={toggleCmd}
              />
            </div>
          </div>
        </div>

        {/* 4. ANALYSING */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] pb-1.5">
            <span className="text-xs font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500" />
              4. Analysing (FilePill opens in right sidebar, NO decomposition)
            </span>
            <span className="text-[11px] font-mono text-[var(--m-text-muted)]">Analysing... vs. Analysed</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">A. While Running:</span>
              <ToolTimelineRow
                entry={{
                  id: 'read-active',
                  type: 'file_read',
                  data: {
                    filename: 'audit_engagement_2026.xlsx',
                    filePath: 'C:/Users/rama/Downloads/Mash/workpapers/audit_engagement_2026.xlsx',
                    tool: { id: 't-r1', name: 'read_file', status: 'running' }
                  }
                }}
                isStreaming={true}
                onOpenFile={handleOpenFile}
                toggleGroup={() => {}}
              />
            </div>
            <div>
              <span className="text-[11px] font-mono text-[var(--m-text-muted)] block mb-1">B. Completed (Click pill to open file):</span>
              <ToolTimelineRow
                entry={{
                  id: 'read-done',
                  type: 'file_read',
                  data: {
                    filename: 'general_ledger_q3.csv',
                    filePath: 'C:/Users/rama/Downloads/Mash/data/general_ledger_q3.csv',
                    tool: { id: 't-r2', name: 'read_file', status: 'completed' }
                  }
                }}
                onOpenFile={handleOpenFile}
                toggleGroup={() => {}}
              />
            </div>
          </div>
        </div>

        {/* 5. PARALLEL OPERATIONS IN A SINGLE TURN */}
        <div className="space-y-2">
          <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] pb-1.5">
            <span className="text-xs font-semibold text-[var(--m-text-primary)] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              5. Parallel Execution (What if 3 Reads, 2 Commands, and 2 Edits happen in the same turn?)
            </span>
            <span className="text-[11px] font-mono text-[var(--m-text-muted)]">Parallel grouping</span>
          </div>
          <div className="text-xs text-[var(--m-text-secondary)] leading-relaxed">
            When multiple tool categories execute concurrently in the same turn/step, they arrange <strong>horizontally</strong> side by side. Clicking any group decomposes into its discrete <strong>sequential units</strong> (e.g. individual command rows, not another group):
          </div>
          {/* Horizontal parallel groups bar */}
          <div className="flex flex-wrap items-start gap-8 p-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg-app)]">
            
            {/* Explored files */}
            <div className="min-w-[190px]">
              <GroupTimelineRow
                entry={{
                  id: 'demo-group-explore',
                  type: 'exploration_group',
                  data: { count: 3 },
                  items: [
                    { id: 'g-e1', type: 'file_read', data: { filename: 'balance_sheet.xlsx', filePath: 'C:/Mash/balance_sheet.xlsx' } },
                    { id: 'g-e2', type: 'file_read', data: { filename: 'ledger.csv', filePath: 'C:/Mash/ledger.csv' } },
                    { id: 'g-e3', type: 'file_read', data: { filename: 'tax_return.pdf', filePath: 'C:/Mash/tax_return.pdf' } },
                  ]
                }}
                isGroupExpanded={!!isGroupOpen['demo-group-explore']}
                toggleGroup={toggleGroup}
                renderChildRow={(child) => (
                  <ToolTimelineRow
                    key={child.id}
                    entry={child}
                    isChild={true}
                    onOpenFile={handleOpenFile}
                    toggleGroup={() => {}}
                  />
                )}
              />
            </div>

            {/* Ran commands (Decomposes into sequential command units) */}
            <div className="min-w-[220px]">
              <GroupTimelineRow
                entry={{
                  id: 'demo-group-cmd',
                  type: 'command_group',
                  data: { count: 2 },
                  items: [
                    {
                      id: 'g-c1',
                      type: 'command',
                      data: {
                        cmd: 'git status -s',
                        fullCmd: 'git status -s',
                        tool: { id: 'g-c1', name: 'run_command', status: 'completed', output: 'M package.json\nM src/app/page.tsx\n\nExit code: 0' }
                      }
                    },
                    {
                      id: 'g-c2',
                      type: 'command',
                      data: {
                        cmd: 'npm test',
                        fullCmd: 'npm test',
                        tool: { id: 'g-c2', name: 'run_command', status: 'completed', output: 'All 7 frontend tests passed.' }
                      }
                    },
                  ]
                }}
                isGroupExpanded={!!isGroupOpen['demo-group-cmd']}
                toggleGroup={toggleGroup}
                renderChildRow={(child) => (
                  <CommandTimelineRow
                    key={child.id}
                    entry={child}
                    isChild={true}
                    isCmdExpanded={!!expandedCmds[child.id]}
                    copiedId={copiedId}
                    handleCopy={handleCopy}
                    toggleCmd={toggleCmd}
                  />
                )}
              />
            </div>

            {/* Edited files */}
            <div className="min-w-[190px]">
              <GroupTimelineRow
                entry={{
                  id: 'demo-group-edit',
                  type: 'edit_group',
                  data: { count: 2 },
                  items: [
                    { id: 'g-ed1', type: 'edit', data: { filename: 'ToolTimelineRow.tsx', filePath: 'C:/Mash/frontend/src/features/chat/components/work-log/ToolTimelineRow.tsx' } },
                    { id: 'g-ed2', type: 'edit', data: { filename: 'GroupTimelineRow.tsx', filePath: 'C:/Mash/frontend/src/features/chat/components/work-log/GroupTimelineRow.tsx' } },
                  ]
                }}
                isGroupExpanded={!!isGroupOpen['demo-group-edit']}
                toggleGroup={toggleGroup}
                renderChildRow={(child) => (
                  <ToolTimelineRow
                    key={child.id}
                    entry={child}
                    isChild={true}
                    onOpenFile={handleOpenFile}
                    toggleGroup={() => {}}
                  />
                )}
              />
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
