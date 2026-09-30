"use client";

import React, { useState, useMemo, memo } from 'react';
import TaskWorkLogAccordion from '@/features/chat/components/TaskWorkLogAccordion';
import ArtifactCard from '@/features/artifacts/components/ArtifactCard';
import { TurnFilesGenerated } from '@/features/artifacts';
import { extractArtifacts, extractEditedFiles } from '@/features/artifacts/utils/extraction';
import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { WorkingPaperCard } from '@/primitives';
import { formatArtifactTitle } from '@/features/viewer/utils/artifactPresentation';
import { ExecutionStatusDisclosure } from './ExecutionStatusDisclosure';
import { ImageLightboxModal, LightboxImageData } from './ImageLightboxModal';
import { AssistantMessageFooter } from './AssistantMessageFooter';
import { AssistantProse } from './AssistantProse';

interface AssistantMessageProps {
  msg: Message;
  artifacts?: ArtifactItem[];
  isLast: boolean;
  isStreaming: boolean;
  onOpenFile?: (path: string) => void;
  onProceed?: (path: string) => void;
  onRetry?: () => void;
  onContinue?: () => void;
}

function formatTurnTimestamp(ts?: string): string {
  if (!ts) return '';
  try {
    if (/^\d{1,2}:\d{2}(\s?[APap][Mm])?$/.test(ts.trim())) {
      return ts.trim();
    }
    const d = new Date(ts);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return ts;
  } catch {
    return ts;
  }
}

// ponytail: memoize AssistantMessage so past turns never re-render during 120fps streaming
const AssistantMessage = memo(function AssistantMessage({
  msg,
  artifacts: passedArtifacts,
  isLast,
  isStreaming,
  onOpenFile,
  onProceed,
  onRetry,
  onContinue,
}: AssistantMessageProps) {
  const [lightboxImage, setLightboxImage] = useState<LightboxImageData | null>(null);

  // Freeze fallback completion time once on mount so it never drifts with live clock
  const [latchedTime] = useState(() => 
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
  const displayTime = (msg.timestamp && formatTurnTimestamp(msg.timestamp)) || latchedTime;
  const isActivelyStreaming = isLast && isStreaming;

  // Extract artifacts and generated files on completed turns
  const localArtifacts = useMemo(() => isActivelyStreaming ? [] : extractArtifacts(msg), [msg.content, msg.tools, isActivelyStreaming]);
  const artifacts = passedArtifacts !== undefined ? passedArtifacts : localArtifacts;
  const editedFilesData = useMemo(() => isActivelyStreaming ? { files: [], totalAdded: 0, totalDeleted: 0 } : extractEditedFiles(msg), [msg.tools, isActivelyStreaming]);

  // Filter markdown files created in this turn to render executive WorkingPaperCards
  const mdWorkingPapers = useMemo(() => {
    return editedFilesData.files.filter((f) => 
      f.filename.toLowerCase().endsWith('.md') || f.path.toLowerCase().endsWith('.md')
    );
  }, [editedFilesData.files]);

  // Extract raw assistant prose text with fallback to text steps
  const rawText = useMemo(() => {
    if (msg.content && msg.content.trim().length > 0) return msg.content;
    if (msg.steps && msg.steps.length > 0) {
      const textSteps = msg.steps.filter((s: any) => s.type === 'text' && s.content && s.content.trim().length > 0);
      if (textSteps.length > 0) {
        return textSteps.map((s: any) => s.content.trim()).join('\n\n');
      }
    }
    return '';
  }, [msg.content, msg.steps]);

  return (
    <div className="text-[13.5px] text-[var(--text-primary)] w-full mb-1.5">
      {/* 1. Reasoning & Tools (Chronological work trace with in-between text) */}
      <TaskWorkLogAccordion 
        steps={msg.steps}
        thoughts={msg.thoughts} 
        tools={msg.tools} 
        isStreaming={isLast && isStreaming} 
        isLast={isLast}
        thinkingDurationSeconds={msg.thinkingDurationSeconds}
        hasAssistantContent={!!(msg.content && msg.content.trim().length > 0)}
        totalDurationSeconds={msg.totalDurationSeconds}
        turnStartTime={msg.turnStartTime}
        onOpenFile={onOpenFile}
      />

      {/* 2. Decoupled Executive Markdown Prose */}
      {rawText && (
        <AssistantProse
          content={rawText}
          isStreaming={isActivelyStreaming}
          sessionId={msg.sessionId}
          onOpenFile={onOpenFile}
          onImageClick={setLightboxImage}
        />
      )}

      {/* 3. Execution Status Disclosure (Error / Interrupted / Aborted) */}
      <ExecutionStatusDisclosure
        status={msg.status}
        error={msg.error}
        errorId={msg.errorId}
        totalDurationSeconds={msg.totalDurationSeconds}
        onRetry={onRetry}
        onContinue={onContinue}
      />

      {/* 4. Bottom Artifact Cards (Walkthrough, Implementation Plan, etc.) */}
      {artifacts.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {artifacts.map((art) => (
            <ArtifactCard 
              key={art.id} 
              artifact={art} 
              onOpen={(p) => onOpenFile?.(p)} 
              onProceed={onProceed}
              isLast={isLast}
              isStreaming={isStreaming}
            />
          ))}
        </div>
      )}

      {/* 5. Working Paper Deliverable Cards (.md files created in this turn) */}
      {mdWorkingPapers.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-1">
          {mdWorkingPapers.map((file) => (
            <WorkingPaperCard
              key={file.path}
              filePath={file.path}
              title={formatArtifactTitle(file.filename)}
              onOpen={onOpenFile}
            />
          ))}
        </div>
      )}

      {/* 6. Files Generated in this turn */}
      {editedFilesData.files.length > 0 && (
        <TurnFilesGenerated
          files={editedFilesData.files}
          totalAdded={editedFilesData.totalAdded}
          totalDeleted={editedFilesData.totalDeleted}
          onOpenFile={onOpenFile}
          sessionId={msg.sessionId}
        />
      )}

      {/* Footer: timestamp on left, copy button on right */}
      {!isActivelyStreaming && (
        <AssistantMessageFooter
          displayTime={displayTime}
          rawText={rawText || (msg.thoughts && msg.thoughts.length > 0 ? msg.thoughts.join('\n\n') : '')}
          hasPrecedingContent={!!(rawText || artifacts.length > 0 || editedFilesData.files.length > 0)}
        />
      )}

      {/* Image Lightbox / Fullscreen Overlay */}
      <ImageLightboxModal
        image={lightboxImage}
        onClose={() => setLightboxImage(null)}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}, (prev, next) => {
  if (next.isLast && next.isStreaming) {
    return false;
  }
  return (
    prev.isLast === next.isLast &&
    prev.isStreaming === next.isStreaming &&
    prev.msg.status === next.msg.status &&
    prev.msg.content === next.msg.content &&
    prev.msg.timestamp === next.msg.timestamp &&
    prev.msg.error === next.msg.error &&
    prev.msg.thoughts === next.msg.thoughts &&
    prev.msg.tools === next.msg.tools &&
    (prev.msg.tools?.length ?? 0) === (next.msg.tools?.length ?? 0) &&
    prev.msg.steps === next.msg.steps &&
    (prev.msg.steps?.length ?? 0) === (next.msg.steps?.length ?? 0) &&
    prev.msg.thinkingDurationSeconds === next.msg.thinkingDurationSeconds &&
    prev.msg.totalDurationSeconds === next.msg.totalDurationSeconds &&
    prev.msg.steeringInjected === next.msg.steeringInjected &&
    (prev.artifacts === next.artifacts || ((prev.artifacts?.length ?? 0) === 0 && (next.artifacts?.length ?? 0) === 0))
  );
});

export default AssistantMessage;
