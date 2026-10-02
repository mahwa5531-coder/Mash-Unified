"use client";

import React, { useState, useMemo, memo } from 'react';
import TaskWorkLogAccordion from '@/features/chat/components/TaskWorkLogAccordion';
import ArtifactCard from '@/features/artifacts/components/ArtifactCard';
import { TurnFilesGenerated } from '@/features/artifacts';
import { extractArtifacts, extractEditedFiles } from '@/features/artifacts/utils/extraction';
import { Message } from '@/types/chat';
import { ArtifactItem } from '@/types/artifacts';
import { ExecutionStatusDisclosure } from './ExecutionStatusDisclosure';
import { ImageLightboxModal, LightboxImageData } from './ImageLightboxModal';
import { AssistantMessageFooter } from './AssistantMessageFooter';
import { AssistantProse } from './AssistantProse';
import { useInterleavedUnits } from './useInterleavedUnits';

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

  // Filter edited files to exclude files already displayed as prominent artifact/deliverable cards
  const nonArtifactEditedFiles = useMemo(() => {
    const artifactPaths = new Set(artifacts.map(a => a.filePath.toLowerCase().replace(/\\/g, '/')));
    return editedFilesData.files.filter(f => !artifactPaths.has(f.path.toLowerCase().replace(/\\/g, '/')));
  }, [editedFilesData.files, artifacts]);

  // Interleaved Sequential Units — clean chronological flow where worklogs and authentic prose alternate
  const units = useInterleavedUnits(msg, isActivelyStreaming);

  // Aggregate all prose text for clipboard copy in footer
  const allProseText = useMemo(() => {
    const proseTexts = units
      .filter((u): u is { type: 'prose'; id: string; content: string } => u.type === 'prose')
      .map((u) => u.content);
    if (proseTexts.length > 0) return proseTexts.join('\n\n');
    return msg.content || '';
  }, [units, msg.content]);

  return (
    <div className="text-[13.5px] text-[var(--text-primary)] w-full mb-1.5">
      {/* Interleaved Sequential Units (Thoughts, Tools, and Authentic Assistant Prose in Chronological Order) */}
      {units.map((unit, uIdx) => {
        if (unit.type === 'worklog') {
          return (
            <TaskWorkLogAccordion
              key={unit.id}
              steps={unit.steps}
              thoughts={unit.thoughts}
              tools={unit.tools}
              isStreaming={isLast && isStreaming && !units.some((u, i) => i > uIdx && u.type === 'worklog')}
              isLast={isLast}
              thinkingDurationSeconds={msg.thinkingDurationSeconds}
              hasAssistantContent={units.some((u, i) => i > uIdx && u.type === 'prose')}
              totalDurationSeconds={msg.totalDurationSeconds}
              turnStartTime={msg.turnStartTime}
              onOpenFile={onOpenFile}
            />
          );
        }

        return (
          <AssistantProse
            key={unit.id}
            content={unit.content}
            isStreaming={isActivelyStreaming && uIdx === units.length - 1}
            sessionId={msg.sessionId}
            onOpenFile={onOpenFile}
            onImageClick={setLightboxImage}
          />
        );
      })}

      {/* 3. Execution Status Disclosure (Error / Interrupted / Aborted) */}
      <ExecutionStatusDisclosure
        status={msg.status}
        error={msg.error}
        errorId={msg.errorId}
        totalDurationSeconds={msg.totalDurationSeconds}
        onRetry={onRetry}
        onContinue={onContinue}
      />

      {/* 4. Deliverable & Working Paper Cards (Walkthrough, Plans, Spreadsheets, Memos) */}
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

      {/* 5. Additional Code / Configuration Files Modified in this turn */}
      {nonArtifactEditedFiles.length > 0 && (
        <TurnFilesGenerated
          files={nonArtifactEditedFiles}
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
          rawText={allProseText}
          hasPrecedingContent={!!(allProseText || artifacts.length > 0 || editedFilesData.files.length > 0)}
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
