"use client";

import React from 'react';
import { ArtifactItem } from '@/types/artifacts';
import { WorkingPaperCard } from '@/primitives/WorkingPaperCard';

export type { ArtifactItem } from '@/types/artifacts';

interface ArtifactCardProps {
  artifact: ArtifactItem;
  sessionId?: string;
  onOpen: (path: string) => void;
  isLast?: boolean;
  isStreaming?: boolean;
}

/**
 * ArtifactCard Component
 * Renders executive .md deliverables and working papers generated in an assistant turn.
 * Delegates cleanly to the authentic WorkingPaperCard primitive.
 */
export default function ArtifactCard({ artifact, onOpen }: ArtifactCardProps) {
  return (
    <WorkingPaperCard
      filePath={artifact.filePath}
      title={artifact.title}
      summary={artifact.summary}
      type={artifact.type}
      onOpen={onOpen}
    />
  );
}
