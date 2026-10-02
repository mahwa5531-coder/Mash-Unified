"use client";

// Explorer mode: Audit Deliverables (<workspace>/Audit_Deliverables/) and
// Working Papers (~/.nexau/brain/<session_id>/working_papers/) collapsible sections
// rendered exclusively with canonical FilePill primitives.
import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import { FilePill } from '@/primitives/FilePill';
import type { SessionArtifactsData } from '@/services/artifacts';

interface ExplorerPanelProps {
  artifactsData: SessionArtifactsData;
  openSections: { 
    deliverables?: boolean; 
    workingPapers?: boolean; 
    [key: string]: boolean | undefined;
  };
  toggleSection: (key: 'deliverables' | 'workingPapers') => void;
  openFileTab: (name: string, fullPath: string, type?: 'file' | 'image') => void;
}

export function ExplorerPanel({
  artifactsData,
  openSections,
  toggleSection,
  openFileTab,
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
    </div>
  );
}
