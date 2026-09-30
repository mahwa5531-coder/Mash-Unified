"use client";

// Explorer mode: Working Papers + Audit Procedures collapsible sections with
// inline filters and "See all" expansion. Filter/display memos live here.
import React, { useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { Search, X, StopCircle, Loader2, Clock, CheckCircle2, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/primitives';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { CollapsibleSection } from './CollapsibleSection';
import {
  formatArtifactTitle,
  getArtifactIcon,
  getArtifactExtensionBadge,
} from '../utils/artifactPresentation';
import type { ArtifactFileItem } from '@/services/artifacts';
import type { BackgroundTaskItem } from '@/services/tasks';
import { openSystemFile } from '@/services/files';

interface ExplorerPanelProps {
  artifacts: ArtifactFileItem[];
  effectiveTasks: BackgroundTaskItem[];
  openSections: { artifacts: boolean; backgroundTasks: boolean };
  toggleSection: (key: 'artifacts' | 'backgroundTasks') => void;
  expandedSection: { artifacts: boolean; tasks: boolean };
  setExpandedSection: React.Dispatch<React.SetStateAction<{ artifacts: boolean; tasks: boolean }>>;
  artifactFilter: string;
  setArtifactFilter: React.Dispatch<React.SetStateAction<string>>;
  taskFilter: string;
  setTaskFilter: React.Dispatch<React.SetStateAction<string>>;
  openFileTab: (name: string, fullPath: string, type?: 'file' | 'image') => void;
  openTerminalTab: (taskId: string, title: string) => void;
  handleKillTask: (e: ReactMouseEvent, pid: number) => void;
  handleKillAllTasks: (e: ReactMouseEvent) => void;
}

export function ExplorerPanel({
  artifacts,
  effectiveTasks,
  openSections,
  toggleSection,
  expandedSection,
  setExpandedSection,
  artifactFilter,
  setArtifactFilter,
  taskFilter,
  setTaskFilter,
  openFileTab,
  openTerminalTab,
  handleKillTask,
  handleKillAllTasks,
}: ExplorerPanelProps) {
  // Filtered lists for inline search
  const filteredArtifacts = useMemo(() => {
    if (!artifactFilter.trim()) return artifacts;
    const q = artifactFilter.toLowerCase().trim();
    return artifacts.filter(a => a.name.toLowerCase().includes(q) || formatArtifactTitle(a.name).toLowerCase().includes(q));
  }, [artifacts, artifactFilter]);

  const filteredTasks = useMemo(() => {
    if (!taskFilter.trim()) return effectiveTasks;
    const q = taskFilter.toLowerCase().trim();
    return effectiveTasks.filter(t => (t.command || '').toLowerCase().includes(q));
  }, [effectiveTasks, taskFilter]);

  // Slice lists for "See all" - show up to 20 by default so files are immediately visible without extra clicks
  const displayedArtifacts = useMemo(() => {
    if (expandedSection.artifacts || filteredArtifacts.length <= 20) return filteredArtifacts;
    return filteredArtifacts.slice(0, 20);
  }, [filteredArtifacts, expandedSection.artifacts]);

  const displayedTasks = useMemo(() => {
    if (expandedSection.tasks) return filteredTasks;
    return filteredTasks.slice(0, 5);
  }, [filteredTasks, expandedSection.tasks]);

  return (
    <div className="flex-1 py-3 px-3 flex flex-col overflow-y-auto custom-scrollbar bg-card">
          
      {/* Section 1: Working Papers */}
      <CollapsibleSection 
        title="Working Papers" 
        count={artifacts.length} 
        isOpen={openSections.artifacts} 
        onToggle={() => toggleSection('artifacts')}
      >
        {/* Inline search filter */}
        {artifacts.length > 0 && (
          <div className="relative mb-2 px-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
            <Input
              type="text"
              value={artifactFilter}
              onChange={(e) => setArtifactFilter(e.target.value)}
              placeholder="Filter working papers & deliverables..."
              className="h-7.5 pl-8 pr-7 text-xs bg-zinc-100/70 dark:bg-white/[0.04] border border-zinc-200/80 dark:border-white/[0.08] focus-visible:bg-white dark:focus-visible:bg-[#1a1a1c] rounded-lg transition-colors"
            />
            {artifactFilter && (
              <button 
                type="button" 
                onClick={() => setArtifactFilter('')} 
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-0.5 cursor-pointer"
                title="Clear filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {displayedArtifacts.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2 px-2 italic text-center">
            {artifactFilter 
              ? 'No matching working papers' 
              : 'No working papers generated yet. Generated files will appear here.'}
          </div>
        ) : (
          <>
            {displayedArtifacts.map((item, idx) => (
              <div 
                key={idx}
                onClick={() => openFileTab(item.name, item.path)}
                className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/60 cursor-pointer text-muted-foreground hover:text-foreground transition-colors text-[13px] font-normal group"
                title={item.path || item.name}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                  {getArtifactIcon(item)}
                  <span className="truncate font-normal flex-1">{formatArtifactTitle(item.name)}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openSystemFile(item.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.1] transition-all cursor-pointer"
                    title="Open in system application"
                  >
                    <ExternalLink size={12} />
                  </button>
                  {getArtifactExtensionBadge(item)}
                </div>
              </div>
            ))}

            {/* See all (N) link */}
            {filteredArtifacts.length > 20 && (
              <button
                type="button"
                onClick={() => {
                  setExpandedSection(prev => ({ ...prev, artifacts: !prev.artifacts }));
                  if (expandedSection.artifacts) setArtifactFilter('');
                }}
                className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
              >
                {expandedSection.artifacts ? 'Show less' : `See all (${filteredArtifacts.length})`}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

          {/* Section 2: Audit Procedures (Only displayed when background verification/analysis is active) */}
          {effectiveTasks.length > 0 && (
            <CollapsibleSection 
              title="Audit Procedures in Progress" 
              count={effectiveTasks.length} 
              isOpen={openSections.backgroundTasks} 
              onToggle={() => toggleSection('backgroundTasks')}
              rightAction={
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleKillAllTasks}
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    >
                      <StopCircle className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">
                    Cancel all procedures
                  </TooltipContent>
                </Tooltip>
              }
            >
              {/* Inline search filter when expanded */}
              {expandedSection.tasks && effectiveTasks.length > 5 && (
                <div className="relative mb-1.5 px-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    value={taskFilter}
                    onChange={(e) => setTaskFilter(e.target.value)}
                    placeholder="Filter procedures..."
                    className="h-7 pl-8 pr-7 text-xs bg-muted/40 border border-zinc-200/70 dark:border-white/[0.06] focus-visible:bg-background"
                  />
                  {taskFilter && (
                    <button 
                      type="button" 
                      onClick={() => setTaskFilter('')} 
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}

              {displayedTasks.map((t) => {
                const isRunning = t.status === 'running';
                const isTimer = t.command.toLowerCase().startsWith('timer');
                const procedureName = isTimer 
                  ? 'Verification Procedure Timer' 
                  : (t.command ? t.command.replace(/^(python|bash|sh|node)\s+/, '') : `Audit Procedure ${t.pid}`);
                return (
                  <div 
                    key={t.pid}
                    onClick={() => openTerminalTab(t.pid.toString(), procedureName)}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center min-w-0 flex-1 mr-2">
                      {isRunning ? (
                        <Loader2 size={14} className="mr-2.5 animate-spin text-muted-foreground shrink-0" />
                      ) : isTimer ? (
                        <Clock size={14} className="mr-2.5 text-muted-foreground shrink-0" />
                      ) : (
                        <CheckCircle2 size={14} className="mr-2.5 text-muted-foreground shrink-0" />
                      )}
                      <span className={`font-mono text-[12.5px] truncate ${
                        isRunning ? 'text-foreground font-medium' : 'text-muted-foreground font-normal group-hover:text-foreground'
                      }`}>
                        {procedureName}
                      </span>
                    </div>
                    <div className="shrink-0">
                      {isRunning && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleKillTask(e, t.pid)}
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            >
                              <StopCircle className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="text-xs">
                            Cancel procedure
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* See all (N) link */}
              {effectiveTasks.length > 5 && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedSection(prev => ({ ...prev, tasks: !prev.tasks }));
                    if (expandedSection.tasks) setTaskFilter('');
                  }}
                  className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
                >
                  {expandedSection.tasks ? 'Show less' : `See all (${effectiveTasks.length})`}
                </button>
              )}
            </CollapsibleSection>
          )}

        </div>
  );
}
