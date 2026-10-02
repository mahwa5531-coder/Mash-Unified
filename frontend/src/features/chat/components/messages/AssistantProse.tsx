"use client";

import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import type { LightboxImageData } from './ImageLightboxModal';
import { AgentMarkdown } from '@/components/markdown/AgentMarkdown';

/**
 * AssistantProse — chat-mode wrapper around the unified AgentMarkdown
 * renderer (streamdown + @streamdown/{code,math,mermaid}).
 *
 * Kept as a thin facade so every existing call site (AssistantMessage)
 * continues to work unchanged. All rendering logic now lives in
 * AgentMarkdown + useAgentMarkdownComponents.
 */
export interface AssistantProseProps {
  content: string;
  isStreaming?: boolean;
  sessionId?: string;
  onOpenFile?: (path: string) => void;
  onImageClick?: (img: LightboxImageData) => void;
  className?: string;
}

export const AssistantProse = memo(function AssistantProse({
  content,
  isStreaming = false,
  sessionId,
  onOpenFile,
  onImageClick,
  className,
}: AssistantProseProps) {
  if (!content) return null;

  return (
    <AgentMarkdown
      content={content}
      mode="chat"
      isStreaming={isStreaming}
      sessionId={sessionId}
      onOpenFile={onOpenFile}
      onImageClick={onImageClick}
      className={cn(className)}
    />
  );
});

export default AssistantProse;
