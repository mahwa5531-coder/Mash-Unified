"use client";

// Explorer mode: Audit Deliverables (<workspace>/Audit_Deliverables/) and
// Working Papers (~/.nexau/brain/<session_id>/working_papers/) collapsible sections
// rendered exclusively with canonical FilePill primitives.
import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { FilePill } from '@/primitives/FilePill';
import type { SessionArtifactsData } from '@/services/artifacts';
import type { BackgroundTaskItem } from '@/services/tasks';
import { Terminal } from 'lucide-react';

interface ExplorerPanelProps {
  artifactsData: SessionArtifactsData;
  openSections: { 
    deliverables?: boolean; 
    workingPapers?: boolean; 
    backgroundTasks?: boolean;
    [key: string]: boolean | undefined;
  };
  toggleSection: (key: 'deliverables' | 'workingPapers' | 'backgroundTasks') => void;
  openFileTab: (name: string, fullPath: string, type?: 'file' | 'image') => void;
  backgroundTasks?: BackgroundTaskItem[];
  openTerminalTab?: (taskId: string, title: string) => void;
}

export function ExplorerPanel({
  artifactsData,
  openSections,
  toggleSection,
  openFileTab,
  backgroundTasks = [],
  openTerminalTab,
}: ExplorerPanelProps) {
  return (
    <div className="flex-1 py-3 px-3 flex flex-col overflow-y-auto custom-scrollbar bg-[var(--bg-app)]">
      {/* Group 1: Audit Deliverables (Present ONLY for sessions inside a project) */}
      {artifactsData.isProjectSession && (
        <CollapsibleSection
          title="Audit Deliverables"
          count={artifactsData.deliverables.length}
          isOpen={openSections.deliverables ?? true}
          onToggle={() => toggleSection('deliverables')}
        >
          {artifactsData.deliverables.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-2 px-1 italic">
              No deliverables generated in Audit_Deliverables/ yet.
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1 py-1 px-0.5">
              {artifactsData.deliverables.map((item, idx) => (
                <FilePill
                  key={item.path || idx}
                  path={item.path}
                  label={item.name}
                  onOpenFile={() => openFileTab(item.name, item.path)}
                  className="max-w-full"
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* Group 2: Working Papers (Present for ALL sessions: standalone and project sessions) */}
      <CollapsibleSection
        title="Working Papers"
        count={artifactsData.workingPapers.length}
        isOpen={openSections.workingPapers ?? true}
        onToggle={() => toggleSection('workingPapers')}
      >
        {artifactsData.workingPapers.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2 px-1 italic">
            No working papers generated in working_papers/ yet.
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1 py-1 px-0.5">
            {artifactsData.workingPapers.map((item, idx) => (
              <FilePill
                key={item.path || idx}
                path={item.path}
                label={item.name}
                onOpenFile={() => openFileTab(item.name, item.path)}
                className="max-w-full"
              />
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Group 3: Background Tasks */}
      {backgroundTasks.length > 0 && (
        <CollapsibleSection
          title="Background Tasks"
          count={backgroundTasks.length}
          isOpen={openSections.backgroundTasks ?? true}
          onToggle={() => toggleSection('backgroundTasks')}
        >
          <div className="flex flex-col items-start gap-1 py-1 px-0.5">
            {backgroundTasks.map((t) => (
              <button
                key={t.pid}
                type="button"
                onClick={() => openTerminalTab?.(String(t.pid), t.command || `Task #${t.pid}`)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/60 text-xs font-mono text-left group transition-colors cursor-pointer"
                title={t.command || `Task #${t.pid}`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Terminal size={13} className="text-zinc-400 shrink-0" />
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                  <span className="truncate text-zinc-700 dark:text-zinc-300">{t.command || `Task #${t.pid}`}</span>
                </div>
                <span className="text-[10px] text-zinc-400 shrink-0 font-sans">{t.status}</span>
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
