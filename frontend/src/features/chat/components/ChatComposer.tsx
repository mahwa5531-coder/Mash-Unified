"use client";

import { useState, useRef, useEffect } from 'react';
import type { KeyboardEvent, DragEvent } from 'react';
import { useChatAttachments } from '@/features/chat/hooks/useChatAttachments';
import { AttachedFilesList } from './composer/AttachedFilesList';
import { ComposerActions } from './composer/ComposerActions';

export type { AttachedFile } from '@/features/chat/hooks/useChatAttachments';

export interface ChatComposerProps {
  sessionId?: string | null;
  inputPrompt?: string;
  setInputPrompt?: (val: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  sessionRepo?: string;
}

export default function ChatComposer({
  sessionId,
  inputPrompt = '',
  setInputPrompt,
  onSend,
  onStop,
  isStreaming,
  disabled = false,
  sessionRepo,
}: ChatComposerProps) {
  const [localPrompt, setLocalPrompt] = useState<string>(inputPrompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const {
    attachedFiles,
    isUploading,
    uploadError,
    fileInputRef,
    handleFileChange,
    handlePaste,
    handleUploadFiles,
    removeAttachedFile,
    clearAttachments,
  } = useChatAttachments(sessionId);

  // Sync when parent changes inputPrompt (e.g. on Undo or reset)
  useEffect(() => {
    setLocalPrompt(inputPrompt);
  }, [inputPrompt]);

  // Auto-resize textarea to fit content cleanly up to 220px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 220)}px`;
    }
  }, [localPrompt]);

  const handleSendClick = () => {
    // Synchronous submission lock to prevent double-Enter race conditions and upload races
    if (isSubmittingRef.current || isUploading) return;
    let text = localPrompt.trim();
    if (!text && attachedFiles.length === 0) return;

    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles.map(f => `[Attached file: ${f.path}]`).join('\n');
      text = text ? `${text}\n\n${fileRefs}` : `Please inspect and analyze the attached audit documents:\n${fileRefs}`;
      clearAttachments();
    }

    isSubmittingRef.current = true;
    setLocalPrompt('');
    setInputPrompt?.('');
    onSend(text);
    setTimeout(() => {
      isSubmittingRef.current = false;
    }, 300);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isUploading) return;
      handleSendClick();
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  return (
    <div 
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
      className={`w-full bg-white dark:bg-[#18181b] rounded-2xl border ${
        isDragOver ? 'border-emerald-500/60 ring-2 ring-emerald-500/20' : 'border-zinc-200 dark:border-white/[0.08] focus-within:border-zinc-400 dark:focus-within:border-white/[0.2]'
      } ${disabled ? 'opacity-65 select-none' : ''} shadow-lg shadow-black/[0.03] dark:shadow-black/50 p-3 flex flex-col gap-1.5 transition-all relative`}
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        accept="image/*,.xlsx,.xls,.csv,.pdf,.txt,.json"
        multiple 
        disabled={disabled || isUploading}
        className="hidden" 
      />

      {/* Screen Reader Upload Feedback */}
      <div aria-live="polite" className="sr-only">
        {isUploading ? "Uploading files..." : uploadError ? uploadError : ""}
      </div>

      {/* Attached Files Chips */}
      <AttachedFilesList attachedFiles={attachedFiles} onRemove={removeAttachedFile} />

      {/* Main Input Textarea */}
      <textarea 
        ref={textareaRef}
        value={localPrompt}
        onChange={(e) => {
          setLocalPrompt(e.target.value);
          setInputPrompt?.(e.target.value);
        }}
        onKeyDown={disabled ? undefined : handleKeyDown}
        onPaste={disabled ? undefined : handlePaste}
        disabled={disabled}
        rows={1}
        placeholder={
          disabled
            ? "Loading conversation history..."
            : isDragOver 
              ? "Drop files or screenshots to attach..." 
              : sessionRepo && sessionRepo !== 'No Repo' 
                ? `Ask or audit in ${sessionRepo}...` 
                : "Ask an audit question or reference file paths..."
        }
        className="w-full bg-transparent text-[13.5px] text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none min-h-[38px] max-h-[220px] placeholder:text-zinc-400 dark:placeholder:text-zinc-500 custom-scrollbar leading-relaxed px-1 disabled:cursor-not-allowed"
      />

      {/* Bottom Action Bar */}
      <ComposerActions
        isStreaming={isStreaming}
        isUploading={isUploading}
        disabled={disabled}
        localPrompt={localPrompt}
        attachedFilesCount={attachedFiles.length}
        fileInputRef={fileInputRef}
        onSend={handleSendClick}
        onStop={onStop}
      />
    </div>
  );
}
