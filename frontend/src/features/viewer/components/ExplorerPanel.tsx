"use client";

// Explorer mode: Audit Deliverables (<workspace>/Audit_Deliverables/) and
// Working Papers (~/.nexau/brain/<session_id>/working_papers/) collapsible sections
// with folder reveal, copy path, native app open, and inline search.
import React, { useState, useMemo, MouseEvent as ReactMouseEvent } from 'react';
import { 
  Search, 
  X, 
  StopCircle, 
  Loader2, 
  Clock, 
  CheckCircle2, 
  ExternalLink, 
  FolderOpen, 
  Copy, 
  Check, 
  RotateCw,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/primitives';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { CollapsibleSection } from './CollapsibleSection';
import {
  formatArtifactTitle,
  getArtifactIcon,
  getArtifactExtensionBadge,
} from '../utils/artifactPresentation';
import type { ArtifactFileItem, SessionArtifactsData } from '@/services/artifacts';
import type { BackgroundTaskItem } from '@/services/tasks';
import { openSystemFile } from '@/services/files';

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ExplorerPanelProps {
  artifactsData: SessionArtifactsData;
  effectiveTasks: BackgroundTaskItem[];
  openSections: { 
    deliverables?: boolean; 
    workingPapers?: boolean; 
    backgroundTasks: boolean;
    artifacts?: boolean;
  };
  toggleSection: (key: 'deliverables' | 'workingPapers' | 'backgroundTasks') => void;
  expandedSection: { 
    deliverables?: boolean; 
    workingPapers?: boolean; 
    tasks: boolean;
    artifacts?: boolean;
  };
  setExpandedSection: React.Dispatch<React.SetStateAction<any>>;
  artifactFilter: string;
  setArtifactFilter: React.Dispatch<React.SetStateAction<string>>;
  taskFilter: string;
  setTaskFilter: React.Dispatch<React.SetStateAction<string>>;
  openFileTab: (name: string, fullPath: string, type?: 'file' | 'image') => void;
  openTerminalTab: (taskId: string, title: string) => void;
  handleKillTask: (e: ReactMouseEvent, pid: number) => void;
  handleKillAllTasks: (e: ReactMouseEvent) => void;
  onRefresh?: () => void;
}

export function ExplorerPanel({
  artifactsData,
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
  onRefresh,
}: ExplorerPanelProps) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleCopy = (e: ReactMouseEvent, path: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleOpenFolder = (e: ReactMouseEvent, folderPath?: string) => {
    e.stopPropagation();
    if (folderPath) {
      openSystemFile(folderPath);
    }
  };

  // Filter deliverables & working papers
  const q = artifactFilter.toLowerCase().trim();

  const filteredDeliverables = useMemo(() => {
    if (!q) return artifactsData.deliverables;
    return artifactsData.deliverables.filter(
      a => a.name.toLowerCase().includes(q) || formatArtifactTitle(a.name).toLowerCase().includes(q)
    );
  }, [artifactsData.deliverables, q]);

  const filteredWorkingPapers = useMemo(() => {
    if (!q) return artifactsData.workingPapers;
    return artifactsData.workingPapers.filter(
      a => a.name.toLowerCase().includes(q) || formatArtifactTitle(a.name).toLowerCase().includes(q)
    );
  }, [artifactsData.workingPapers, q]);

  const filteredTasks = useMemo(() => {
    if (!taskFilter.trim()) return effectiveTasks;
    const tq = taskFilter.toLowerCase().trim();
    return effectiveTasks.filter(t => (t.command || '').toLowerCase().includes(tq));
  }, [effectiveTasks, taskFilter]);

  // Display slices
  const displayedDeliverables = useMemo(() => {
    if (expandedSection.deliverables || filteredDeliverables.length <= 20) return filteredDeliverables;
    return filteredDeliverables.slice(0, 20);
  }, [filteredDeliverables, expandedSection.deliverables]);

  const displayedWorkingPapers = useMemo(() => {
    if (expandedSection.workingPapers || filteredWorkingPapers.length <= 20) return filteredWorkingPapers;
    return filteredWorkingPapers.slice(0, 20);
  }, [filteredWorkingPapers, expandedSection.workingPapers]);

  const displayedTasks = useMemo(() => {
    if (expandedSection.tasks) return filteredTasks;
    return filteredTasks.slice(0, 5);
  }, [filteredTasks, expandedSection.tasks]);

  const totalItemsCount = artifactsData.deliverables.length + artifactsData.workingPapers.length;

  const renderFileRow = (item: ArtifactFileItem, idx: number) => {
    const isCopied = copiedPath === item.path;
    const sizeStr = formatFileSize(item.size);

    return (
      <div 
        key={`${item.path}-${idx}`}
        onClick={() => openFileTab(item.name, item.path)}
        className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/60 cursor-pointer text-muted-foreground hover:text-foreground transition-colors text-[13px] font-normal group"
        title={item.path || item.name}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
          {getArtifactIcon(item)}
          <span className="truncate font-normal flex-1">{formatArtifactTitle(item.name)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {sizeStr && (
            <span className="text-[10.5px] font-mono text-zinc-400 dark:text-zinc-500 mr-1 hidden sm:inline-block">
              {sizeStr}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => handleCopy(e, item.path)}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.1] transition-all cursor-pointer"
            title={isCopied ? "Copied path!" : "Copy file path"}
          >
            {isCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openSystemFile(item.path);
            }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 rounded hover:bg-zinc-200/60 dark:hover:bg-white/[0.1] transition-all cursor-pointer"
            title="Open in system application (Excel/Word/Viewer)"
          >
            <ExternalLink size={12} />
          </button>
          {getArtifactExtensionBadge(item)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 py-3 px-3 flex flex-col overflow-y-auto custom-scrollbar bg-card">
      
      {/* Top Search & Refresh Bar */}
      {(totalItemsCount > 0 || onRefresh) && (
        <div className="flex items-center gap-1.5 mb-3 px-1">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
            <Input
              type="text"
              value={artifactFilter}
              onChange={(e) => setArtifactFilter(e.target.value)}
              placeholder="Filter deliverables & papers..."
              className="h-7.5 pl-8 pr-7 text-xs bg-zinc-100/70 dark:bg-white/[0.04] border border-zinc-200/80 dark:border-white/[0.08] focus-visible:bg-white dark:focus-visible:bg-[#1a1a1c] rounded-lg transition-colors"
            />
            {artifactFilter && (
              <button 
                type="button" 
                onClick={() => setArtifactFilter('')} 
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-0.5 cursor-pointer"
                title="Clear filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {onRefresh && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="h-7.5 w-7.5 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
                >
                  <RotateCw size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Rescan folder
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* GROUP 1: Audit Deliverables (PRESENT ONLY FOR SESSIONS INSIDE A PROJECT) */}
      {artifactsData.isProjectSession && (
        <CollapsibleSection 
          title="Audit Deliverables" 
          count={artifactsData.deliverables.length} 
          isOpen={openSections.deliverables ?? true} 
          onToggle={() => toggleSection('deliverables')}
          rightAction={
            artifactsData.deliverablesDirectory ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => handleOpenFolder(e, artifactsData.deliverablesDirectory)}
                    className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted/80 transition-colors"
                  >
                    <FolderOpen size={13} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs">
                  Reveal Audit_Deliverables in Explorer
                </TooltipContent>
              </Tooltip>
            ) : null
          }
        >
          {displayedDeliverables.length === 0 ? (
            <div className="text-[12px] text-muted-foreground py-2 px-2 italic text-center">
              {artifactFilter 
                ? 'No matching deliverables' 
                : 'No deliverables generated in Audit_Deliverables/ yet.'}
            </div>
          ) : (
            <>
              {displayedDeliverables.map(renderFileRow)}
              {filteredDeliverables.length > 20 && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedSection((prev: any) => ({ ...prev, deliverables: !prev.deliverables }));
                  }}
                  className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
                >
                  {expandedSection.deliverables ? 'Show less' : `See all (${filteredDeliverables.length})`}
                </button>
              )}
            </>
          )}
        </CollapsibleSection>
      )}

      {/* GROUP 2: Working Papers (PRESENT FOR ALL SESSIONS: standalone and project sessions) */}
      <CollapsibleSection 
        title="Working Papers" 
        count={artifactsData.workingPapers.length} 
        isOpen={openSections.workingPapers ?? true} 
        onToggle={() => toggleSection('workingPapers')}
        rightAction={
          artifactsData.workingPapersDirectory ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => handleOpenFolder(e, artifactsData.workingPapersDirectory)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted/80 transition-colors"
                >
                  <FolderOpen size={13} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="text-xs">
                Reveal working_papers in Explorer
              </TooltipContent>
            </Tooltip>
          ) : null
        }
      >
        {displayedWorkingPapers.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-2 px-2 italic text-center">
            {artifactFilter 
              ? 'No matching working papers' 
              : 'No working papers generated in working_papers/ yet.'}
          </div>
        ) : (
          <>
            {displayedWorkingPapers.map(renderFileRow)}
            {filteredWorkingPapers.length > 20 && (
              <button
                type="button"
                onClick={() => {
                  setExpandedSection((prev: any) => ({ ...prev, workingPapers: !prev.workingPapers }));
                }}
                className="py-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground text-left transition-colors font-normal select-none"
              >
                {expandedSection.workingPapers ? 'Show less' : `See all (${filteredWorkingPapers.length})`}
              </button>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* Audit Procedures in Progress (Background Verification Tasks) */}
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

          {effectiveTasks.length > 5 && (
            <button
              type="button"
              onClick={() => {
                setExpandedSection((prev: any) => ({ ...prev, tasks: !prev.tasks }));
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
